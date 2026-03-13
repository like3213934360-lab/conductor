import { describe, it, expect } from 'vitest'
import { UpcastingEventStore } from '../event-store/upcasting-event-store.js'
import type { EventStore, UpcastingRegistry, AppendEventsInput, LoadEventsQuery } from '@anthropic/antigravity-core'
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

/**
 * C3: strict replay mode tests for UpcastingEventStore.
 * Verifies that strict mode correctly rejects malformed events,
 * unknown types, and invalid payloads instead of swallowing them.
 */

class FakeEventStore implements EventStore {
  private events: WorkflowEventEnvelope[] = []

  setEvents(events: WorkflowEventEnvelope[]) {
    this.events = events
  }

  async append(_input: AppendEventsInput): Promise<void> {}
  async load(_query: LoadEventsQuery): Promise<WorkflowEventEnvelope[]> {
    return this.events
  }
  async exists(_runId: string): Promise<boolean> { return true }
  async getCurrentVersion(_runId: string): Promise<number> { return this.events.length }
}

class FakeUpcastingRegistry implements UpcastingRegistry {
  upcast(event: WorkflowEventEnvelope): WorkflowEventEnvelope {
    if (event.type === 'UNKNOWN_EVENT') {
      throw new Error(`Unknown event type: ${event.type}`)
    }
    return event
  }
}

describe('C3: strict replay mode', () => {
  it('strict mode throws on malformed event (missing type)', async () => {
    const inner = new FakeEventStore()
    const registry = new FakeUpcastingRegistry()
    const store = new UpcastingEventStore(inner, registry, { strictReplayMode: true })

    inner.setEvents([
      { eventId: 'e1', runId: 'r1', type: '', payload: {}, timestamp: '2026-01-01T00:00:00Z', version: 1 } as any,
    ])

    await expect(store.load({ runId: 'r1' })).rejects.toThrow('malformed event')
  })

  it('strict mode throws on malformed event (missing payload)', async () => {
    const inner = new FakeEventStore()
    const registry = new FakeUpcastingRegistry()
    const store = new UpcastingEventStore(inner, registry, { strictReplayMode: true })

    inner.setEvents([
      { eventId: 'e2', runId: 'r1', type: 'VALID_TYPE', payload: null, timestamp: '2026-01-01T00:00:00Z', version: 1 } as any,
    ])

    await expect(store.load({ runId: 'r1' })).rejects.toThrow('malformed event')
  })

  it('strict mode throws on upcast error', async () => {
    const inner = new FakeEventStore()
    const registry = new FakeUpcastingRegistry()
    const store = new UpcastingEventStore(inner, registry, { strictReplayMode: true })

    inner.setEvents([
      { eventId: 'e3', runId: 'r1', type: 'UNKNOWN_EVENT', payload: { data: true }, timestamp: '2026-01-01T00:00:00Z', version: 1 },
    ])

    await expect(store.load({ runId: 'r1' })).rejects.toThrow('Unknown event type')
  })

  it('default mode swallows upcast error and marks event', async () => {
    const inner = new FakeEventStore()
    const registry = new FakeUpcastingRegistry()
    const store = new UpcastingEventStore(inner, registry) // no strict mode

    inner.setEvents([
      { eventId: 'e4', runId: 'r1', type: 'UNKNOWN_EVENT', payload: { data: true }, timestamp: '2026-01-01T00:00:00Z', version: 1 },
    ])

    const events = await store.load({ runId: 'r1' })
    expect(events).toHaveLength(1)
    expect((events[0]!.payload as any)._upcastError).toBe(true)
  })
})
