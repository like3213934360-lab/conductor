import { describe, it, expect } from 'vitest'
import {
  DaemonDomainEventEnvelopeSchema,
  DaemonDomainEventTypes,
  ALL_DAEMON_DOMAIN_EVENT_TYPES,
  DAEMON_DOMAIN_EVENT_SCHEMA_VERSION,
  validateDaemonDomainEvent,
  createDaemonDomainEvent,
  type DaemonDomainEventEnvelope,
  type DaemonDomainEventType,
} from '../daemon-domain-events.js'

/**
 * PR-06: Daemon domain event v1 — schema, validation, and contract tests.
 */
describe('daemon domain events v1', () => {
  // ── Helpers ──────────────────────────────────────────────────────────
  function validEnvelope(
    eventType: DaemonDomainEventType = 'receipt.recorded',
    payload: Record<string, unknown> = {
      receiptId: 'r-1', nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'abc123', durationMs: 1200,
    },
  ): DaemonDomainEventEnvelope {
    return {
      domainEventId: 'evt-001',
      runId: 'run-1',
      nodeId: 'PARALLEL',
      eventType,
      schemaVersion: DAEMON_DOMAIN_EVENT_SCHEMA_VERSION,
      timestamp: '2026-03-13T00:00:00.000Z',
      sequence: 0,
      payload,
    }
  }

  // ── Taxonomy ─────────────────────────────────────────────────────────
  it('defines exactly 7 event types', () => {
    expect(ALL_DAEMON_DOMAIN_EVENT_TYPES).toHaveLength(7)
  })

  it('all event types follow naming convention', () => {
    for (const type of ALL_DAEMON_DOMAIN_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })

  it('schema version baseline is 1', () => {
    expect(DAEMON_DOMAIN_EVENT_SCHEMA_VERSION).toBe(1)
  })

  // ── Envelope Schema ──────────────────────────────────────────────────
  it('valid envelope passes schema validation', () => {
    const result = DaemonDomainEventEnvelopeSchema.safeParse(validEnvelope())
    expect(result.success).toBe(true)
  })

  it('rejects envelope with missing domainEventId', () => {
    const env = validEnvelope()
    delete (env as any).domainEventId
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('rejects envelope with empty runId', () => {
    const env = validEnvelope()
    env.runId = ''
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('rejects envelope with unknown event type', () => {
    const env = { ...validEnvelope(), eventType: 'unknown.type' }
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('rejects envelope with negative sequence', () => {
    const env = validEnvelope()
    env.sequence = -1
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('rejects envelope with schemaVersion 0', () => {
    const env = validEnvelope()
    env.schemaVersion = 0
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(false)
  })

  it('accepts envelope without optional nodeId', () => {
    const env = validEnvelope()
    delete env.nodeId
    const result = DaemonDomainEventEnvelopeSchema.safeParse(env)
    expect(result.success).toBe(true)
  })

  // ── Per-type Payload Validation ──────────────────────────────────────
  it('validates completion_session.started payload', () => {
    const env = validEnvelope('completion_session.started', {
      leaseId: 'l-1', nodeId: 'PARALLEL', attempt: 0,
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates completion_session.committed payload', () => {
    const env = validEnvelope('completion_session.committed', {
      leaseId: 'l-1', nodeId: 'PARALLEL', attempt: 0,
      status: 'success', outputHash: 'hash1', model: 'codex', durationMs: 500,
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates receipt.recorded payload', () => {
    const env = validEnvelope('receipt.recorded', {
      receiptId: 'r-1', nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'hash1', durationMs: 1200,
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates handoff.recorded payload', () => {
    const env = validEnvelope('handoff.recorded', {
      handoffId: 'h-1', nodeId: 'PARALLEL',
      sourceNodeId: 'PARALLEL', targetNodeId: 'DEBATE',
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates skip.authorized payload', () => {
    const env = validEnvelope('skip.authorized', {
      nodeId: 'DEBATE', sourceNodeId: 'PARALLEL',
      reason: 'Adaptive debate skip', strategyId: 'adaptive.debate-express.v1',
      authorityOwner: 'daemon',
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates policy_verdict.recorded payload', () => {
    const env = validEnvelope('policy_verdict.recorded', {
      nodeId: 'VERIFY', verdictType: 'tribunal',
      verdict: 'approved', details: { confidence: 0.95 },
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  it('validates artifact.exported payload', () => {
    const env = validEnvelope('artifact.exported', {
      artifactType: 'trace-bundle', artifactId: 'tb-1',
      path: '/tmp/traces/run-1.jsonl', status: 'exported',
    })
    expect(validateDaemonDomainEvent(env)).not.toBeNull()
  })

  // ── Invalid Payloads ─────────────────────────────────────────────────
  it('rejects receipt.recorded with missing receiptId', () => {
    const env = validEnvelope('receipt.recorded', {
      nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'hash1', durationMs: 1200,
      // missing receiptId
    })
    expect(validateDaemonDomainEvent(env)).toBeNull()
  })

  it('rejects skip.authorized with empty reason', () => {
    const env = validEnvelope('skip.authorized', {
      nodeId: 'DEBATE', sourceNodeId: 'PARALLEL',
      reason: '', // empty
      authorityOwner: 'daemon',
    })
    expect(validateDaemonDomainEvent(env)).toBeNull()
  })

  it('rejects policy_verdict.recorded with invalid verdictType', () => {
    const env = validEnvelope('policy_verdict.recorded', {
      verdictType: 'unknown_type', verdict: 'approved',
    })
    expect(validateDaemonDomainEvent(env)).toBeNull()
  })

  it('rejects artifact.exported with invalid status', () => {
    const env = validEnvelope('artifact.exported', {
      artifactType: 'trace-bundle', artifactId: 'tb-1',
      status: 'invalid_status',
    })
    expect(validateDaemonDomainEvent(env)).toBeNull()
  })

  it('rejects completely wrong payload structure', () => {
    const env = validEnvelope('receipt.recorded', {
      foo: 'bar', baz: 123,
    })
    expect(validateDaemonDomainEvent(env)).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(validateDaemonDomainEvent('not an object')).toBeNull()
    expect(validateDaemonDomainEvent(42)).toBeNull()
    expect(validateDaemonDomainEvent(null)).toBeNull()
  })

  // ── Builder Utility ──────────────────────────────────────────────────
  it('createDaemonDomainEvent generates valid envelope', () => {
    const event = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'abc', durationMs: 1200,
    }, 'PARALLEL')

    expect(event.runId).toBe('run-1')
    expect(event.eventType).toBe('receipt.recorded')
    expect(event.schemaVersion).toBe(1)
    expect(event.sequence).toBe(0)
    expect(event.nodeId).toBe('PARALLEL')
    expect(event.domainEventId).toBeTruthy()
    expect(event.timestamp).toBeTruthy()
    // Validates through full pipeline
    expect(validateDaemonDomainEvent(event)).not.toBeNull()
  })

  it('createDaemonDomainEvent without nodeId', () => {
    const event = createDaemonDomainEvent('run-1', 'artifact.exported', 5, {
      artifactType: 'release-bundle', artifactId: 'rb-1', status: 'exported',
    })

    expect(event.nodeId).toBeUndefined()
    expect(event.sequence).toBe(5)
    expect(validateDaemonDomainEvent(event)).not.toBeNull()
  })

  it('each call to createDaemonDomainEvent generates a unique domainEventId', () => {
    const e1 = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1,
    })
    const e2 = createDaemonDomainEvent('run-1', 'receipt.recorded', 1, {
      receiptId: 'r-2', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1,
    })
    expect(e1.domainEventId).not.toBe(e2.domainEventId)
  })
})
