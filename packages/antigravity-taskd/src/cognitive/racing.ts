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

export interface RacingExecutor {
  race<T>(
    candidates: RacingCandidate<T>[],
    parentSignal: AbortSignal,
  ): Promise<RacingResult<T>>
}

// ── 实现 ─────────────────────────────────────────────────────────────────────

export class DefaultRacingExecutor implements RacingExecutor {
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

          candidate.run(ctrl.signal).then((value) => {
            if (settled) return

            // 合法性校验：失败则视为该路不可用，不 abort 其他路
            if (!candidate.validate(value)) {
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
            const abortedBackends: WorkerBackend[] = []
            candidates.forEach((c, i) => {
              if (i !== idx) {
                controllers[i]!.abort()
                abortedBackends.push(c.backend)
                // 触发 loser 的资源清理钩子（fire-and-forget，错误静默吞掉）
                // onAborted 不能影响 winner 路径，所以 catch 强制兜底
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

      return result
    } finally {
      parentSignal.removeEventListener('abort', onParentAbort)
      // 确保所有 controller 都被 abort（防止获胜后 loser 还在后台跑）
      for (const ctrl of controllers) {
        if (!ctrl.signal.aborted) ctrl.abort()
      }
    }
  }
}
