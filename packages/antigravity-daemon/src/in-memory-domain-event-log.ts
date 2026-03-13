/**
 * PR-07: In-memory implementation of DaemonDomainEventLog.
 *
 * Provides the minimal viable append-only log for daemon domain events.
 * Used for dual-write alongside the legacy ledger.
 *
 * A durable JSONL/SQLite implementation can replace this later;
 * the contract (DaemonDomainEventLog) is stable from PR-06.
 */
import type {
  DaemonDomainEventEnvelope,
  DaemonDomainEventAppendInput,
  DaemonDomainEventAppendResult,
  DaemonDomainEventLog,
} from './daemon-domain-events.js'

export class InMemoryDaemonDomainEventLog implements DaemonDomainEventLog {
  /** Per-run event storage: runId → events ordered by sequence */
  private readonly store = new Map<string, DaemonDomainEventEnvelope[]>()

  async append(input: DaemonDomainEventAppendInput): Promise<DaemonDomainEventAppendResult> {
    const { runId, events, expectedSequence } = input
    if (events.length === 0) {
      return { committedSequence: expectedSequence, count: 0 }
    }

    const existing = this.store.get(runId) ?? []
    const currentSequence = existing.length > 0
      ? existing[existing.length - 1]!.sequence
      : -1

    if (expectedSequence !== currentSequence) {
      throw new Error(
        `SEQUENCE_CONFLICT: expected ${expectedSequence}, actual ${currentSequence} for runId=${runId}`,
      )
    }

    existing.push(...events)
    this.store.set(runId, existing)

    const lastEvent = events[events.length - 1]!
    return {
      committedSequence: lastEvent.sequence,
      count: events.length,
    }
  }

  async load(runId: string, fromSequence?: number): Promise<DaemonDomainEventEnvelope[]> {
    const events = this.store.get(runId) ?? []
    if (fromSequence !== undefined) {
      return events.filter(e => e.sequence >= fromSequence)
    }
    return [...events]
  }

  async getLatestSequence(runId: string): Promise<number> {
    const events = this.store.get(runId) ?? []
    return events.length > 0 ? events[events.length - 1]!.sequence : -1
  }
}
