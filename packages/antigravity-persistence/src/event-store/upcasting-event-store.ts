/**
 * Antigravity Workflow Runtime — Upcasting EventStore 装饰器
 *
 * Phase 4 接入: 在事件读取路径自动应用 upcasting 链
 *
 * 设计模式: Decorator Pattern
 * - 包装底层 EventStore (如 JsonlEventStore)
 * - 读取时自动将旧版事件升级到最新 schema
 * - 写入时不做转换 (写入的事件已是最新版本)
 *
 * 参考:
 * - Axon Framework: UpcastingEventStorageEngine
 * - EventStoreDB: projection-based upcasting
 */
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'
import type { EventStore, AppendEventsInput, LoadEventsQuery } from '@anthropic/antigravity-core/src/contracts/event-store.js'
import type { UpcastingRegistry } from '@anthropic/antigravity-core/src/event-sourcing/upcasting.js'

/**
 * UpcastingEventStore — 读路径自动升级装饰器
 *
 * 职责单一: 仅在 load/loadStream 时应用 upcasting
 */
export class UpcastingEventStore implements EventStore {
  constructor(
    private readonly inner: EventStore,
    private readonly registry: UpcastingRegistry,
  ) {}

  /** 追加事件 — 直接委托 (写入路径不做转换) */
  async append(input: AppendEventsInput): Promise<void> {
    return this.inner.append(input)
  }

  /** 加载事件 — 读取后自动 upcast */
  async load(query: LoadEventsQuery): Promise<WorkflowEventEnvelope[]> {
    const events = await this.inner.load(query)
    return this.registry.upcastAll(events)
  }

  /** 流式加载 — 逐条 upcast */
  async *loadStream(query: LoadEventsQuery): AsyncIterable<WorkflowEventEnvelope> {
    if (!this.inner.loadStream) {
      // 回退到 load()
      const events = await this.load(query)
      for (const event of events) {
        yield event
      }
      return
    }
    for await (const event of this.inner.loadStream(query)) {
      yield this.registry.upcast(event)
    }
  }

  /** 获取当前版本 — 直接委托 */
  async getCurrentVersion(runId: string): Promise<number> {
    if (!this.inner.getCurrentVersion) return -1
    return this.inner.getCurrentVersion(runId)
  }

  /** 检查是否存在 — 直接委托 */
  async exists(runId: string): Promise<boolean> {
    return this.inner.exists(runId)
  }
}
