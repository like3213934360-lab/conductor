/**
 * Conductor AGC — 容错增强 (Fault Tolerance: Recovery Manager + Idempotent Executor)
 *
 * AGC v8.0: 利用现有 Event Sourcing 实现崩溃恢复、幂等执行、每步检查点。
 *
 * 设计参考:
 * - Temporal.io: 确定性重放 + 幂等活动
 * - Amazon Step Functions: 状态机检查点
 * - Microsoft Orleans: Virtual Actor + 事件流重放
 *
 * 核心思想:
 * - IO Effect 事件化: 外部调用（LLM/CLI）的结果写入 EventStore
 * - 重放时跳过已记录的 IO，直接用缓存结果
 * - 每步检查点: 节点完成后写入 CheckpointStore
 */

import type { AGCEventEnvelope, AGCState, CheckpointDTO } from '@anthropic/conductor-shared'
import type { EventStore, LoadEventsQuery } from '../contracts/event-store.js'
import type { CheckpointStore } from '../contracts/checkpoint-store.js'

// ── IO Effect 事件 ────────────────────────────────────────────────────────────

export interface IOEffectPayload {
  /** 任务 ID (关联到子任务) */
  taskId: string
  /** 幂等键 (用于重放时去重) */
  idempotencyKey: string
  /** IO 类型 */
  ioType: 'llm_call' | 'cli_exec' | 'file_read' | 'network_request'
  /** IO 结果 */
  output: string
  /** IO 状态 */
  status: 'success' | 'error' | 'timeout'
  /** 耗时 (ms) */
  durationMs: number
  /** 允许额外属性 (兼容 AGCEventEnvelope.payload 的 Record<string, unknown>) */
  [key: string]: unknown
}

export interface IOEffectEvent extends AGCEventEnvelope {
  type: 'IO_EFFECT_RECORDED'
  payload: IOEffectPayload
}

// ── 幂等执行器 ────────────────────────────────────────────────────────────────

export interface SubTaskResult {
  id: string
  output: string
  status: 'success' | 'error' | 'timeout'
  durationMs: number
}

export interface SubTaskSpec {
  id: string
  idempotencyKey: string
  execute: () => Promise<SubTaskResult>
}

/**
 * IdempotentExecutor — 幂等任务执行器
 *
 * 执行逻辑:
 * 1. 查询 EventStore 中是否已有此 idempotencyKey 的 IO_EFFECT_RECORDED 事件
 * 2. 如有 → 直接返回缓存结果 (跳过 IO)
 * 3. 如无 → 执行任务，记录 IO_EFFECT_RECORDED 事件
 */
export class IdempotentExecutor {
  private readonly eventStore: EventStore
  private readonly runId: string
  private readonly cachedEffects: Map<string, IOEffectPayload> = new Map()
  /** 并发去重: 相同 key 的请求共享同一个 Promise */
  private readonly inFlight: Map<string, Promise<SubTaskResult & { fromCache: boolean }>> = new Map()

  constructor(eventStore: EventStore, runId: string) {
    this.eventStore = eventStore
    this.runId = runId
  }

  /**
   * 从 EventStore 预加载已记录的 IO 效果
   *
   * 在崩溃恢复时调用一次，缓存所有 IO_EFFECT_RECORDED 事件。
   */
  async preload(): Promise<number> {
    const events = await this.eventStore.load({ runId: this.runId })
    let count = 0
    for (const event of events) {
      if (event.type === 'IO_EFFECT_RECORDED') {
        const payload = event.payload as unknown as IOEffectPayload
        this.cachedEffects.set(payload.idempotencyKey, payload)
        count++
      }
    }
    return count
  }

  /**
   * 幂等执行任务
   *
   * @returns SubTaskResult (可能来自缓存或实际执行)
   */
  async execute(spec: SubTaskSpec): Promise<SubTaskResult & { fromCache: boolean }> {
    // 1. 检查缓存
    const cached = this.cachedEffects.get(spec.idempotencyKey)
    if (cached) {
      return {
        id: spec.id,
        output: cached.output,
        status: cached.status,
        durationMs: cached.durationMs,
        fromCache: true,
      }
    }

    // 2. 并发去重: 相同 key 的请求共享同一个 Promise
    const existing = this.inFlight.get(spec.idempotencyKey)
    if (existing) return existing

    const promise = this.executeAndPersist(spec)
    this.inFlight.set(spec.idempotencyKey, promise)

    try {
      return await promise
    } finally {
      this.inFlight.delete(spec.idempotencyKey)
    }
  }

  /** 执行 + 原子持久化 (先持久化，再缓存) */
  private async executeAndPersist(spec: SubTaskSpec): Promise<SubTaskResult & { fromCache: boolean }> {
    // 实际执行
    const result = await spec.execute()

    // 记录 IO Effect 事件
    const ioEvent: IOEffectEvent = {
      eventId: `io-${spec.idempotencyKey}-${Date.now()}`,
      runId: this.runId,
      type: 'IO_EFFECT_RECORDED',
      payload: {
        taskId: spec.id,
        idempotencyKey: spec.idempotencyKey,
        ioType: 'llm_call',
        output: result.output,
        status: result.status,
        durationMs: result.durationMs,
      },
      timestamp: new Date().toISOString(),
      version: -1,
    }

    // 原子持久化: 必须成功后才缓存 (崩溃安全)
    await this.eventStore.append({
      runId: this.runId,
      events: [ioEvent],
      expectedVersion: 'any',
    })

    // 持久化成功后更新本地缓存
    this.cachedEffects.set(spec.idempotencyKey, ioEvent.payload)

    return { ...result, fromCache: false }
  }
}

// ── 崩溃恢复管理器 ────────────────────────────────────────────────────────────

/**
 * CrashRecoveryManager — 崩溃恢复
 *
 * 恢复流程:
 * 1. 从 CheckpointStore 加载最近的检查点快照
 * 2. 从快照版本开始，加载增量事件
 * 3. 重放事件重建 AGCState
 * 4. 返回恢复后的状态（包含所有已缓存的 IO 效果）
 */
export class CrashRecoveryManager {
  constructor(
    private readonly eventStore: EventStore,
    private readonly checkpointStore: CheckpointStore,
  ) {}

  /**
   * 恢复运行状态
   *
   * @returns 恢复后的事件列表（从检查点到最新）
   */
  async recoverEvents(runId: string): Promise<{
    checkpoint: CheckpointDTO | null
    incrementalEvents: AGCEventEnvelope[]
    totalEvents: number
  }> {
    // 1. 尝试加载最近检查点
    const checkpoint = await this.checkpointStore.loadLatest(runId)

    // 2. 从检查点版本加载增量事件
    const fromVersion = checkpoint?.version ? checkpoint.version + 1 : undefined
    const events = await this.eventStore.load({
      runId,
      fromVersion,
    })

    return {
      checkpoint,
      incrementalEvents: events,
      totalEvents: (checkpoint?.version ?? 0) + events.length,
    }
  }

  /**
   * 每步检查点 — 节点完成后写入
   */
  async checkpointPerStep(
    runId: string,
    version: number,
    state: AGCState,
  ): Promise<void> {
    const checkpoint: CheckpointDTO = {
      checkpointId: `cp-${runId}-v${version}`,
      runId,
      version,
      state: JSON.parse(JSON.stringify(state)), // deep clone
      createdAt: new Date().toISOString(),
    }

    await this.checkpointStore.save({ checkpoint })
  }
}

// ── 幂等键生成 ────────────────────────────────────────────────────────────────

/**
 * 生成幂等键
 *
 * 基于 (runId, nodeId, taskType, attempt) 组合。
 * 同一个节点的同一次 attempt 总是得到相同的 key。
 */
export function generateIdempotencyKey(
  runId: string,
  nodeId: string,
  taskType: string,
  attempt: number = 0,
): string {
  return `${runId}:${nodeId}:${taskType}:${attempt}`
}
