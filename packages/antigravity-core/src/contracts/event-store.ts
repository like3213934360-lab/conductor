/**
 * Antigravity Workflow Runtime — EventStore 接口
 *
 * Event Sourcing 的写入端接口。
 * 当前实现以 durable event log 为中心，支持追加、加载与流式读取。
 *
 * 设计参考:
 * - Greg Young EventStoreDB: stream-per-aggregate, expected revision
 * - Kurrent append & concurrency: https://docs.kurrent.io/clients/grpc/appending-events
 */
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

/** 乐观并发版本控制 */
export type ExpectedVersion = number | 'any' | 'no_stream'

/** 追加事件输入 */
export interface AppendEventsInput {
  runId: string
  events: WorkflowEventEnvelope[]
  expectedVersion: ExpectedVersion
}

/** 加载事件查询 */
export interface LoadEventsQuery {
  runId: string
  /** 从指定版本开始加载（可选） */
  fromVersion?: number
}

/**
 * EventStore 接口 — Event Sourcing 的持久化抽象
 *
 * 实现者必须保证:
 * 1. append 是原子的（全部成功或全部失败）
 * 2. load 返回的事件按 version 升序排列
 * 3. expectedVersion 冲突时抛出 STATE_VERSION_CONFLICT 错误
 * 4. loadStream 支持流式读取，避免大事件流内存爆炸
 */
export interface EventStore {
  /** 追加事件到指定运行的事件流 */
  append(input: AppendEventsInput): Promise<void>

  /** 加载指定运行的全部事件 */
  load(query: LoadEventsQuery): Promise<WorkflowEventEnvelope[]>

  /**
   * 流式加载事件
   *
   * 对大事件流使用 O(1) 内存消费。
   * 默认实现可通过 load() 提供。
   */
  loadStream?(query: LoadEventsQuery): AsyncIterable<WorkflowEventEnvelope>

  /**
   * 获取当前最新版本号
   *
   * 用于 JSONL 尾部读取优化。
   * 流不存在时返回 -1。
   */
  getCurrentVersion?(runId: string): Promise<number>

  /** 检查运行是否存在 */
  exists(runId: string): Promise<boolean>
}
