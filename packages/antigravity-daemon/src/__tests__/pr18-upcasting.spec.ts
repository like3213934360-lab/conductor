import { describe, expect, it } from 'vitest'
import { UpcastingRegistry } from '@anthropic/antigravity-core'
import { UpcastingEventStore } from '@anthropic/antigravity-persistence'
import { createDaemonUpcastingRegistry } from '../daemon-upcasting-registry.js'
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

/**
 * PR-18: Upcasting compatibility — verifies that:
 * 1. UpcastingEventStore is wired into daemon via createDaemonUpcastingRegistry
 * 2. Old v1 NODE_COMPLETED events are upcasted to v2
 * 3. Mixed version event streams work correctly
 * 4. Non-upcasted event types pass through unchanged
 */

function makeEvent(type: string, payload: Record<string, unknown>, version = 0): WorkflowEventEnvelope {
  return {
    eventId: `e-${Math.random().toString(36).slice(2)}`,
    runId: 'run-1',
    type,
    payload,
    timestamp: new Date().toISOString(),
    version,
  }
}

describe('PR-18: upcasting compatibility', () => {
  const registry = createDaemonUpcastingRegistry()

  // ─── registry creation ────────────────────────────────────────────────

  it('createDaemonUpcastingRegistry returns an UpcastingRegistry', () => {
    expect(registry).toBeInstanceOf(UpcastingRegistry)
  })

  it('registry knows NODE_COMPLETED latest version is 2', () => {
    expect(registry.getLatestVersion('NODE_COMPLETED')).toBe(2)
  })

  it('registry knows NODE_STARTED latest version is 2', () => {
    expect(registry.getLatestVersion('NODE_STARTED')).toBe(2)
  })

  it('registry knows RUN_CREATED latest version is 2', () => {
    expect(registry.getLatestVersion('RUN_CREATED')).toBe(2)
  })

  // ─── v1 → v2 upcast ──────────────────────────────────────────────────

  it('upcasts NODE_COMPLETED v1 (no schemaVersion) to v2 with elapsedMs', () => {
    const v1Event = makeEvent('NODE_COMPLETED', {
      nodeId: 'ANALYZE',
      status: 'success',
      output: 'result',
      durationMs: 1500,
    })
    const upcasted = registry.upcast(v1Event)
    expect(upcasted.payload.schemaVersion).toBe(2)
    expect(upcasted.payload.elapsedMs).toBe(1500)
    expect(upcasted.payload.nodeId).toBe('ANALYZE')
  })

  it('upcasts NODE_COMPLETED v1 without durationMs → elapsedMs defaults to 0', () => {
    const v1Event = makeEvent('NODE_COMPLETED', {
      nodeId: 'VERIFY',
      status: 'success',
      output: 'ok',
    })
    const upcasted = registry.upcast(v1Event)
    expect(upcasted.payload.schemaVersion).toBe(2)
    expect(upcasted.payload.elapsedMs).toBe(0)
  })

  it('does not double-upcast NODE_COMPLETED v2 events', () => {
    const v2Event = makeEvent('NODE_COMPLETED', {
      nodeId: 'PERSIST',
      status: 'success',
      output: 'ok',
      durationMs: 200,
      elapsedMs: 200,
      schemaVersion: 2,
    })
    const result = registry.upcast(v2Event)
    expect(result.payload.schemaVersion).toBe(2)
    expect(result.payload.elapsedMs).toBe(200)
  })

  // ─── NODE_STARTED v1 → v2 ─────────────────────────────────────────────

  it('upcasts NODE_STARTED v1 to v2 with startedAtMs', () => {
    const v1Event = makeEvent('NODE_STARTED', {
      nodeId: 'ANALYZE',
      leaseId: 'lease-1',
      attempt: 1,
      expiresAt: '2026-01-01T00:05:00Z',
      requiredEvidence: [],
      allowedModelPool: ['codex'],
    })
    const upcasted = registry.upcast(v1Event)
    expect(upcasted.payload.schemaVersion).toBe(2)
    expect(upcasted.payload.startedAtMs).toBe(0)
    expect(upcasted.payload.nodeId).toBe('ANALYZE')
  })

  it('does not double-upcast NODE_STARTED v2 events', () => {
    const v2Event = makeEvent('NODE_STARTED', {
      nodeId: 'VERIFY',
      startedAtMs: 1234567890,
      schemaVersion: 2,
    })
    const result = registry.upcast(v2Event)
    expect(result.payload.schemaVersion).toBe(2)
    expect(result.payload.startedAtMs).toBe(1234567890)
  })

  // ─── RUN_CREATED v1 → v2 ──────────────────────────────────────────────

  it('upcasts RUN_CREATED v1 to v2 with createdAtMs', () => {
    const v1Event = makeEvent('RUN_CREATED', {
      goal: 'code review',
      nodeIds: ['ANALYZE', 'VERIFY'],
      files: ['main.ts'],
    })
    const upcasted = registry.upcast(v1Event)
    expect(upcasted.payload.schemaVersion).toBe(2)
    expect(upcasted.payload.createdAtMs).toBe(0)
    expect(upcasted.payload.goal).toBe('code review')
  })

  it('does not double-upcast RUN_CREATED v2 events', () => {
    const v2Event = makeEvent('RUN_CREATED', {
      goal: 'test',
      nodeIds: ['A'],
      files: [],
      createdAtMs: 9999,
      schemaVersion: 2,
    })
    const result = registry.upcast(v2Event)
    expect(result.payload.schemaVersion).toBe(2)
    expect(result.payload.createdAtMs).toBe(9999)
  })

  // ─── passthrough for non-upcasted types ───────────────────────────────

  it('passes through NODE_QUEUED events unchanged', () => {
    const event = makeEvent('NODE_QUEUED', { nodeId: 'ANALYZE' })
    const result = registry.upcast(event)
    expect(result).toEqual(event)
  })

  it('passes through WORKFLOW_STARTED events unchanged', () => {
    const event = makeEvent('WORKFLOW_STARTED', { workflowId: 'wf-1' })
    const result = registry.upcast(event)
    expect(result).toEqual(event)
  })

  // ─── batch upcast (mixed version stream) ──────────────────────────────

  it('upcastAll handles mixed v1/v2 stream with all 3 upcast chains', () => {
    const events = [
      makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 0),
      makeEvent('NODE_STARTED', { nodeId: 'A', leaseId: 'l', attempt: 1, expiresAt: '', requiredEvidence: [], allowedModelPool: [] }, 1),
      makeEvent('NODE_COMPLETED', { nodeId: 'A', status: 'success', durationMs: 100 }, 2),
      makeEvent('NODE_QUEUED', { nodeId: 'B' }, 3),
    ]
    const upcasted = registry.upcastAll(events)
    expect(upcasted).toHaveLength(4)
    // RUN_CREATED v1→v2
    expect(upcasted[0]!.payload.schemaVersion).toBe(2)
    expect(upcasted[0]!.payload.createdAtMs).toBe(0)
    // NODE_STARTED v1→v2
    expect(upcasted[1]!.payload.schemaVersion).toBe(2)
    expect(upcasted[1]!.payload.startedAtMs).toBe(0)
    // NODE_COMPLETED v1→v2
    expect(upcasted[2]!.payload.schemaVersion).toBe(2)
    expect(upcasted[2]!.payload.elapsedMs).toBe(100)
    // NODE_QUEUED unchanged
    expect(upcasted[3]!.payload).toEqual({ nodeId: 'B' })
  })

  // ─── UpcastingEventStore integration ──────────────────────────────────

  it('UpcastingEventStore wraps inner store and upcasts all 3 chains on load', async () => {
    const mockEvents: WorkflowEventEnvelope[] = [
      makeEvent('RUN_CREATED', { goal: 'test', nodeIds: ['A'], files: [] }, 0),
      makeEvent('NODE_STARTED', { nodeId: 'A', leaseId: 'l', attempt: 1, expiresAt: '', requiredEvidence: [], allowedModelPool: [] }, 1),
      makeEvent('NODE_COMPLETED', { nodeId: 'A', status: 'ok', durationMs: 300 }, 2),
    ]
    const mockInner = {
      load: async () => mockEvents,
      append: async () => {},
      exists: async () => true,
      getCurrentVersion: async () => 2,
    }
    const store = new UpcastingEventStore(mockInner, registry)
    const loaded = await store.load({ runId: 'run-1' })
    expect(loaded[0]!.payload.schemaVersion).toBe(2)
    expect(loaded[0]!.payload.createdAtMs).toBe(0)
    expect(loaded[1]!.payload.schemaVersion).toBe(2)
    expect(loaded[1]!.payload.startedAtMs).toBe(0)
    expect(loaded[2]!.payload.schemaVersion).toBe(2)
    expect(loaded[2]!.payload.elapsedMs).toBe(300)
  })

  // ─── daemon default path verification ─────────────────────────────────

  it('daemon runtime.ts uses UpcastingEventStore (source check)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const runtimePath = path.resolve(import.meta.dirname, '../runtime.ts')
    const source = fs.readFileSync(runtimePath, 'utf8')
    expect(source).toContain('UpcastingEventStore')
    expect(source).toContain('createDaemonUpcastingRegistry')
    expect(source).toContain('new UpcastingEventStore(')
  })
})
