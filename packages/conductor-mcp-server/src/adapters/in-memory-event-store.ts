/**
 * Conductor AGC — 内存 EventStore 实现
 *
 * 审查修复 #13: 批次内版本连续性校验 + 首版本必须从 1 开始
 */
import type { EventStore, AppendEventsInput, LoadEventsQuery } from '@anthropic/conductor-core'
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'

export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, AGCEventEnvelope[]>()

  async append(input: AppendEventsInput): Promise<void> {
    const existing = this.streams.get(input.runId)
    const currentVersion = existing && existing.length > 0
      ? existing[existing.length - 1]!.version
      : 0

    // 乐观并发控制
    if (input.expectedVersion === 'no_stream' && existing) {
      throw new AGCError(
        AGCErrorCode.STATE_VERSION_CONFLICT,
        `运行 ${input.runId} 的事件流已存在`,
      )
    }

    if (typeof input.expectedVersion === 'number') {
      if (currentVersion !== input.expectedVersion) {
        throw new AGCError(
          AGCErrorCode.STATE_VERSION_CONFLICT,
          `版本冲突: 期望 ${input.expectedVersion}, 实际 ${currentVersion}`,
        )
      }
    }

    // 审查修复 #13 + 二次审查 P1: runId 校验 + 版本连续性校验
    const startVersion = currentVersion + 1
    for (let i = 0; i < input.events.length; i++) {
      const event = input.events[i]!
      if (event.runId !== input.runId) {
        throw new AGCError(
          AGCErrorCode.STATE_VERSION_CONFLICT,
          `事件 runId 不匹配: 期望 ${input.runId}, 实际 ${event.runId}`,
        )
      }
      const expectedVer = startVersion + i
      if (event.version !== expectedVer) {
        throw new AGCError(
          AGCErrorCode.STATE_VERSION_CONFLICT,
          `版本不连续: 期望 ${expectedVer}, 实际 ${event.version}`,
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
