/**
 * Conductor AGC — 内存 EventStore 实现
 *
 * Phase 1 使用内存存储，Phase 2 切换到 JSONL 文件。
 */
import type { EventStore, AppendEventsInput, LoadEventsQuery } from '@anthropic/conductor-core'
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'

export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, AGCEventEnvelope[]>()

  async append(input: AppendEventsInput): Promise<void> {
    const existing = this.streams.get(input.runId)

    // 乐观并发控制
    if (input.expectedVersion === 'no_stream' && existing) {
      throw new AGCError(
        AGCErrorCode.STATE_VERSION_CONFLICT,
        `运行 ${input.runId} 的事件流已存在`,
      )
    }

    if (typeof input.expectedVersion === 'number' && existing) {
      const currentVersion = existing.length > 0
        ? existing[existing.length - 1]!.version
        : 0
      if (currentVersion !== input.expectedVersion) {
        throw new AGCError(
          AGCErrorCode.STATE_VERSION_CONFLICT,
          `版本冲突: 期望 ${input.expectedVersion}, 实际 ${currentVersion}`,
        )
      }
    }

    if (!existing) {
      this.streams.set(input.runId, [...input.events])
    } else {
      existing.push(...input.events)
    }
  }

  async load(query: LoadEventsQuery): Promise<AGCEventEnvelope[]> {
    const stream = this.streams.get(query.runId) ?? []
    if (query.fromVersion !== undefined) {
      return stream.filter(e => e.version >= query.fromVersion!)
    }
    return [...stream]
  }

  async exists(runId: string): Promise<boolean> {
    return this.streams.has(runId)
  }
}
