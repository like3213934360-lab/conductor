import { describe, expect, it } from 'vitest'
import { UpcastingRegistry } from '@anthropic/antigravity-core'
import { UpcastingEventStore } from '@anthropic/antigravity-persistence'
import { loadRunStateWithDiagnostics } from '../run-bootstrap.js'
import { createDaemonUpcastingRegistry } from '../daemon-upcasting-registry.js'
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

function makeEvent(type: string, payload: Record<string, unknown>, version: number): WorkflowEventEnvelope {
  return {
    eventId: `e-${version}`,
    runId: 'run-1',
    type,
    payload,
    timestamp: '2026-01-01T00:00:00.000Z',
    version,
  }
}

function makeMockStore(events: WorkflowEventEnvelope[]): any {
  return {
    load: async () => events,
    append: async () => {},
    exists: async () => events.length > 0,
    getCurrentVersion: async () => events.length > 0 ? events[events.length - 1]!.version : -1,
  }
}

describe('PR-18E: replay/recovery hardening', () => {
  const registry = createDaemonUpcastingRegistry()

  // ─── upcast failure resilience ────────────────────────────────────────

  it('UpcastingEventStore survives upcast function throwing', async () => {
    const badRegistry = new UpcastingRegistry()
    badRegistry.register({
      eventType: 'NODE_COMPLETED',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast() { throw new Error('boom') },
    })

    const events = [
      makeEvent('NODE_COMPLETED', { nodeId: 'A', durationMs: 100 }, 1),
      makeEvent('NODE_STARTED', { nodeId: 'B' }, 2),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), badRegistry)
    const loaded = await store.load({ runId: 'run-1' })

    expect(loaded).toHaveLength(2)
    // Failed upcast event has diagnostic marker
    expect(loaded[0]!.payload._upcastError).toBe(true)
    expect(loaded[0]!.payload._upcastErrorType).toBe('NODE_COMPLETED')
    expect(loaded[0]!.payload.nodeId).toBe('A') // original preserved
    // Non-upcasted event passes through fine
    expect(loaded[1]!.payload._upcastError).toBeUndefined()
  })

  it('UpcastingEventStore returns original event on upcast error', async () => {
    const badRegistry = new UpcastingRegistry()
    badRegistry.register({
      eventType: 'RUN_CREATED',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast() { throw new TypeError('invalid payload') },
    })
    const events = [makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 1)]
    const store = new UpcastingEventStore(makeMockStore(events), badRegistry)
    const loaded = await store.load({ runId: 'run-1' })

    expect(loaded[0]!.type).toBe('RUN_CREATED')
    expect(loaded[0]!.payload.goal).toBe('test')
    expect(loaded[0]!.payload._upcastError).toBe(true)
  })

  // ─── loadRunStateWithDiagnostics ──────────────────────────────────────

  it('reports diagnostics on normal event stream', async () => {
    const events = [
      makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 1),
      makeEvent('NODE_QUEUED', { nodeId: 'A' }, 2),
      makeEvent('NODE_STARTED', { nodeId: 'A', leaseId: 'l', attempt: 1, expiresAt: '', requiredEvidence: [], allowedModelPool: [] }, 3),
      makeEvent('NODE_COMPLETED', { nodeId: 'A', leaseId: 'l', output: {}, durationMs: 100 }, 4),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), registry)
    const { state, diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    expect(state.status).toBe('running')
    expect(diagnostics.eventCount).toBe(4)
    expect(diagnostics.emptyStream).toBe(false)
    expect(diagnostics.upcastErrorCount).toBe(0)
    expect(diagnostics.unknownTypeCount).toBe(0)
    expect(diagnostics.eventTypes).toContain('RUN_CREATED')
    expect(diagnostics.eventTypes).toContain('NODE_COMPLETED')
  })

  it('reports empty stream diagnostic', async () => {
    const store = new UpcastingEventStore(makeMockStore([]), registry)
    const { state, diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    expect(state.status).toBe('pending')
    expect(diagnostics.emptyStream).toBe(true)
    expect(diagnostics.eventCount).toBe(0)
  })

  it('reports unknown event types', async () => {
    const events = [
      makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 1),
      makeEvent('CUSTOM_FUTURE_EVENT', { data: 'something' }, 2),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), registry)
    const { diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    expect(diagnostics.unknownTypeCount).toBe(1)
    expect(diagnostics.eventTypes).toContain('CUSTOM_FUTURE_EVENT')
  })

  it('reports upcast error count via diagnostics', async () => {
    const badRegistry = new UpcastingRegistry()
    badRegistry.register({
      eventType: 'NODE_COMPLETED',
      fromSchemaVersion: 1,
      toSchemaVersion: 2,
      upcast() { throw new Error('fail') },
    })
    const events = [
      makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 1),
      makeEvent('NODE_COMPLETED', { nodeId: 'A', durationMs: 50 }, 2),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), badRegistry)
    const { diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    expect(diagnostics.upcastErrorCount).toBe(1)
    expect(diagnostics.eventCount).toBe(2)
  })

  // ─── mixed-version replay compatibility ───────────────────────────────

  it('mixed v1/v2 event stream projects correctly through upcasting', async () => {
    const events = [
      // v1 RUN_CREATED (no schemaVersion)
      makeEvent('RUN_CREATED', { goal: 'mixed test', nodeIds: ['A', 'B'], files: [] }, 1),
      // v1 NODE_QUEUED (no upcast needed)
      makeEvent('NODE_QUEUED', { nodeId: 'A' }, 2),
      // v1 NODE_STARTED (will be upcasted to v2)
      makeEvent('NODE_STARTED', { nodeId: 'A', leaseId: 'l1', attempt: 1, expiresAt: '2026-01-01T01:00:00Z', requiredEvidence: [], allowedModelPool: [] }, 3),
      // v2 NODE_COMPLETED (already has schemaVersion: 2)
      makeEvent('NODE_COMPLETED', { nodeId: 'A', leaseId: 'l1', output: { result: 'ok' }, durationMs: 200, elapsedMs: 200, schemaVersion: 2 }, 4),
      // v1 NODE_COMPLETED (will be upcasted)
      makeEvent('NODE_STARTED', { nodeId: 'B', leaseId: 'l2', attempt: 1, expiresAt: '2026-01-01T01:00:00Z', requiredEvidence: [], allowedModelPool: [] }, 5),
      makeEvent('NODE_COMPLETED', { nodeId: 'B', leaseId: 'l2', output: { result: 'done' }, durationMs: 150 }, 6),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), registry)
    const { state, diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    // State is correctly projected
    expect(state.status).toBe('running')
    expect(state.nodes['A']!.status).toBe('completed')
    expect(state.nodes['B']!.status).toBe('completed')
    expect(state.nodes['A']!.durationMs).toBe(200)
    expect(state.nodes['B']!.durationMs).toBe(150)

    // Diagnostics clean
    expect(diagnostics.eventCount).toBe(6)
    expect(diagnostics.upcastErrorCount).toBe(0)
    expect(diagnostics.unknownTypeCount).toBe(0)
  })

  it('legacy v1-only event stream still projects correctly', async () => {
    const events = [
      makeEvent('RUN_CREATED', { goal: 'legacy', nodeIds: ['X'], files: [] }, 1),
      makeEvent('NODE_QUEUED', { nodeId: 'X' }, 2),
      makeEvent('NODE_STARTED', { nodeId: 'X', leaseId: 'l', attempt: 1, expiresAt: '', requiredEvidence: [], allowedModelPool: [] }, 3),
      makeEvent('NODE_COMPLETED', { nodeId: 'X', leaseId: 'l', output: {}, durationMs: 500 }, 4),
      makeEvent('RUN_COMPLETED', { finalStatus: 'completed' }, 5),
    ]
    const store = new UpcastingEventStore(makeMockStore(events), registry)
    const { state, diagnostics } = await loadRunStateWithDiagnostics(store, 'run-1')

    expect(state.status).toBe('completed')
    expect(state.nodes['X']!.status).toBe('completed')
    expect(diagnostics.upcastErrorCount).toBe(0)
    expect(diagnostics.emptyStream).toBe(false)
  })
})
