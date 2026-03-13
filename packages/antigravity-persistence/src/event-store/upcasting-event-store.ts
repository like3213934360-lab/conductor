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
import type { EventStore, AppendEventsInput, LoadEventsQuery, UpcastingRegistry } from '@anthropic/antigravity-core'

/**
 * UpcastingEventStore — 读路径自动升级装饰器
 *
 * 职责单一: 仅在 load/loadStream 时应用 upcasting
 */
/**
 * UpcastingEventStore — 读路径自动升级装饰器
 *
 * 职责单一: 仅在 load/loadStream 时应用 upcasting
 *
 * C3 fix: supports strict replay mode — when enabled, upcast errors,
 * unknown event types, and malformed payloads throw instead of being swallowed.
 */
export class UpcastingEventStore implements EventStore {
  /** C3 fix: strict replay mode — when true, upcast errors are fatal */
  private readonly strictReplayMode: boolean

  constructor(
    private readonly inner: EventStore,
    private readonly registry: UpcastingRegistry,
    options?: { strictReplayMode?: boolean },
  ) {
    this.strictReplayMode = options?.strictReplayMode ?? false
  }

  /** 追加事件 — 直接委托 (写入路径不做转换) */
  async append(input: AppendEventsInput): Promise<void> {
    return this.inner.append(input)
  }

  /** 加载事件 — 读取后自动 upcast */
  async load(query: LoadEventsQuery): Promise<WorkflowEventEnvelope[]> {
    const events = await this.inner.load(query)
    return this.upcastAll(events)
  }

  /** 流式加载 — 逐条 upcast */
  async *loadStream(query: LoadEventsQuery): AsyncIterable<WorkflowEventEnvelope> {
    if (!this.inner.loadStream) {
      const events = await this.load(query)
      for (const event of events) {
        yield event
      }
      return
    }
    for await (const event of this.inner.loadStream(query)) {
      yield this.upcastSingle(event)
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

  // ─── PR-18E + C3: upcast helpers with strict mode support ──────────────

  /**
   * Per-event upcast. In strict mode, errors are fatal.
   * In default mode, errors are isolated and the original event is returned with a diagnostic marker.
   */
  private upcastSingle(event: WorkflowEventEnvelope): WorkflowEventEnvelope {
    // C3 fix: strict mode validates event structure before upcast
    if (this.strictReplayMode) {
      if (!event.type || typeof event.type !== 'string') {
        throw new Error(
          `Strict replay mode: malformed event — missing or invalid 'type' field in event ${event.eventId ?? 'unknown'}`,
        )
      }
      if (!event.payload || typeof event.payload !== 'object') {
        throw new Error(
          `Strict replay mode: malformed event — missing or invalid 'payload' in event ${event.eventId ?? 'unknown'} (type: ${event.type})`,
        )
      }
      // In strict mode, let upcast errors propagate
      return this.registry.upcast(event)
    }

    // Default resilient mode — error isolation
    try {
      return this.registry.upcast(event)
    } catch {
      return {
        ...event,
        payload: {
          ...event.payload,
          _upcastError: true,
          _upcastErrorType: event.type,
        },
      }
    }
  }

  /** Batch upcast */
  private upcastAll(events: WorkflowEventEnvelope[]): WorkflowEventEnvelope[] {
    return events.map(e => this.upcastSingle(e))
  }
}
