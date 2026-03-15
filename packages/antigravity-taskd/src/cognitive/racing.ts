/**
 * racing.ts — 推测性赛马执行器 (Speculative Racing)
 *
 * 在 SHARD_ANALYZE 阶段同时向 Codex 和 Gemini 发送同一任务。
 * 谁先返回合法结果（通过 validate() 检查），立即 abort 另一路请求。
 * 彻底消灭大模型长尾延迟（P99 latency）。
 *
 * 防御红线：
 *  - 胜者确定后立即 loserController.abort()，killProcessTree 由 Worker 内部响应
 *  - validate() 可拒绝空结果 / 格式非法的"垃圾胜出"
 *  - 若所有候选均失败，抛出 AggregateError（包含每路的错误）
 *  - 外层 signal abort 时，所有候选同步取消
 */

import type { WorkerBackend } from '../schema.js'

// ── 错误类型 ──────────────────────────────────────────────────────────────────

export class AllCandidatesFailedError extends Error {
  constructor(
    public readonly errors: Error[],
    public readonly backends: WorkerBackend[],
  ) {
    super(
      `All racing candidates failed: ${errors.map((e, i) => `[${backends[i]}] ${e.message}`).join('; ')}`,
    )
    this.name = 'AllCandidatesFailedError'
  }
}

// ── 接口契约 ──────────────────────────────────────────────────────────────────

export interface RacingCandidate<T> {
  backend: WorkerBackend
  /** 启动实际 Worker 调用。signal 来自 loserController — 胜者出现时自动 abort */
  run(signal: AbortSignal): Promise<T>
  /**
   * 结果合法性校验。防止第一个返回垃圾（空文本 / 非法 JSON）就被采纳。
   * 返回 false → 该候选视为失败，继续等其他路。
   */
  validate(result: T): boolean
  /**
   * 资源清理钩子：当此候选成为 loser 并被 abort 后调用。
   *
   * 用途：清理 MCP Blackboard 缓存、取消挂起的 LSP publishDiagnostics
   * 定时器（cancelPendingSessionForAbort）等。
   *
   * 若清理逻辑抛出，异常被静默吞掉 — 绝不允许 loser 清理错误影响 winner 结果。
   */
  onAborted?(): void | Promise<void>
}

export interface RacingResult<T> {
  winner: WorkerBackend
  result: T
  /** 所有候选从启动到胜者确定的耗时（ms），用于延迟分析 */
  elapsedMs: number
  /** 被 abort 的 loser backend 列表 */
  abortedBackends: WorkerBackend[]
}

// ── 赛马遥测 (Racing Telemetry) ──────────────────────────────────────────────

export type RaceCandidateOutcome = 'winner' | 'loser' | 'error' | 'validate_failed'

export interface RaceCandidateTelemetry {
  backend: WorkerBackend
  outcome: RaceCandidateOutcome
  /** 该候选从启动到结束（完成/abort/报错）的耗时（ms） */
  latencyMs: number
  /** 报错时的错误信息 */
  error?: string
}

/** 一场赛马的完整战报 — 由 RacingExecutor 在每场比赛结束后发射 */
export interface RaceTelemetry {
  /** 赛马总耗时（= 胜者耗时） */
  totalElapsedMs: number
  /** 每个参赛者的详细战报 */
  candidates: RaceCandidateTelemetry[]
  /** 胜者 backend（全部失败时为 undefined） */
  winner?: WorkerBackend
  /** 时间戳 */
  timestamp: number
}

export interface RacingExecutor {
  race<T>(
    candidates: RacingCandidate<T>[],
    parentSignal: AbortSignal,
  ): Promise<RacingResult<T>>
}

// ── 实现 ─────────────────────────────────────────────────────────────────────

export class DefaultRacingExecutor implements RacingExecutor {
  private readonly onRaceComplete?: (telemetry: RaceTelemetry) => void

  constructor(options?: { onRaceComplete?: (telemetry: RaceTelemetry) => void }) {
    this.onRaceComplete = options?.onRaceComplete
  }

  async race<T>(
    candidates: RacingCandidate<T>[],
    parentSignal: AbortSignal,
  ): Promise<RacingResult<T>> {
    if (candidates.length === 0) {
      throw new Error('RacingExecutor: at least one candidate required')
    }

    const startMs = Date.now()

    // 每个候选拥有独立的 AbortController，以便胜者可以精准取消 loser
    const controllers = candidates.map(() => new AbortController())
    // 📊 每个候选的遥测数据收集器
    const telemetryData: RaceCandidateTelemetry[] = candidates.map(c => ({
      backend: c.backend,
      outcome: 'loser' as RaceCandidateOutcome,  // 默认为 loser，胜者/报错会覆盖
      latencyMs: 0,
    }))

    // 外层 Job 取消时，同步取消所有候选
    const onParentAbort = () => {
      for (const ctrl of controllers) ctrl.abort()
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true })

    const errors: Error[] = new Array(candidates.length)
    let settled = false

    try {
      // 用 Promise.any-like 语义：第一个通过 validate() 的胜出
      const result = await new Promise<RacingResult<T>>((resolve, reject) => {
        let pendingCount = candidates.length

        candidates.forEach((candidate, idx) => {
          const ctrl = controllers[idx]!
          const candidateStartMs = Date.now()

          candidate.run(ctrl.signal).then((value) => {
            telemetryData[idx]!.latencyMs = Date.now() - candidateStartMs

            if (settled) return

            // 合法性校验：失败则视为该路不可用，不 abort 其他路
            if (!candidate.validate(value)) {
              telemetryData[idx]!.outcome = 'validate_failed'
              errors[idx] = new Error(`${candidate.backend} result failed validate()`)
              pendingCount--
              if (pendingCount === 0) {
                settled = true
                reject(new AllCandidatesFailedError(
                  errors.filter(Boolean),
                  candidates.map(c => c.backend),
                ))
              }
              return
            }

            // 🏆 胜者：立即 abort 所有其他候选（loser）+ 触发清理钩子
            settled = true
            telemetryData[idx]!.outcome = 'winner'
            const abortedBackends: WorkerBackend[] = []
            candidates.forEach((c, i) => {
              if (i !== idx) {
                controllers[i]!.abort()
                abortedBackends.push(c.backend)
                // loser 的 latency 记录到被 abort 的时刻
                telemetryData[i]!.latencyMs = telemetryData[i]!.latencyMs || (Date.now() - candidateStartMs)
                // 触发 loser 的资源清理钩子（fire-and-forget，错误静默吞掉）
                Promise.resolve(c.onAborted?.()).catch(() => {})
              }
            })

            resolve({
              winner: candidate.backend,
              result: value,
              elapsedMs: Date.now() - startMs,
              abortedBackends,
            })
          }).catch((error: unknown) => {
            telemetryData[idx]!.latencyMs = Date.now() - candidateStartMs
            telemetryData[idx]!.outcome = 'error'
            telemetryData[idx]!.error = error instanceof Error ? error.message : String(error)

            if (settled) return
            errors[idx] = error instanceof Error ? error : new Error(String(error))
            pendingCount--
            if (pendingCount === 0) {
              settled = true
              reject(new AllCandidatesFailedError(
                errors.filter(Boolean),
                candidates.map(c => c.backend),
              ))
            }
          })
        })
      })

      // 📊 发射战报：胜者确定后
      this.emitTelemetry(startMs, telemetryData, result.winner)

      return result
    } catch (raceError) {
      // 📊 全军覆没也要发射战报
      this.emitTelemetry(startMs, telemetryData, undefined)
      throw raceError
    } finally {
      parentSignal.removeEventListener('abort', onParentAbort)
      // 确保所有 controller 都被 abort（防止获胜后 loser 还在后台跑）
      for (const ctrl of controllers) {
        if (!ctrl.signal.aborted) ctrl.abort()
      }
    }
  }

  /** 🔥 发射赛马战报 — fire-and-forget，绝不影响主流程 */
  private emitTelemetry(
    startMs: number,
    candidates: RaceCandidateTelemetry[],
    winner: WorkerBackend | undefined,
  ): void {
    if (!this.onRaceComplete) return
    try {
      this.onRaceComplete({
        totalElapsedMs: Date.now() - startMs,
        candidates,
        winner,
        timestamp: Date.now(),
      })
    } catch {
      // 战报回调不能影响赛马流程
    }
  }
}
