/**
 * Conductor AGC — 内存 CheckpointStore 实现
 */
import type { CheckpointStore, SaveCheckpointInput, LoadCheckpointQuery } from '@anthropic/conductor-core'
import type { CheckpointDTO } from '@anthropic/conductor-shared'

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, CheckpointDTO[]>()

  async save(input: SaveCheckpointInput): Promise<void> {
    const list = this.store.get(input.checkpoint.runId) ?? []
    list.push(input.checkpoint)
    this.store.set(input.checkpoint.runId, list)
  }

  async loadLatest(runId: string): Promise<CheckpointDTO | null> {
    const list = this.store.get(runId)
    if (!list || list.length === 0) return null
    return list[list.length - 1] ?? null
  }

  async loadByVersion(query: LoadCheckpointQuery): Promise<CheckpointDTO | null> {
    const list = this.store.get(query.runId) ?? []
    if (query.version !== undefined) {
      return list.find(cp => cp.version === query.version) ?? null
    }
    return this.loadLatest(query.runId)
  }

  async list(runId: string): Promise<CheckpointDTO[]> {
    return [...(this.store.get(runId) ?? [])]
  }
}
