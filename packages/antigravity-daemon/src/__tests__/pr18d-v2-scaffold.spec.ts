import { describe, expect, it } from 'vitest'
import {
  DAEMON_DOMAIN_EVENT_SCHEMA_VERSION,
  DAEMON_DOMAIN_EVENT_SCHEMA_VERSION_V2,
  DaemonDomainEventEnvelopeSchema,
  createDaemonDomainEvent,
  createDaemonDomainEventV2,
  validateDaemonDomainEvent,
} from '../daemon-domain-events.js'
import { InMemoryDaemonDomainEventLog } from '../in-memory-domain-event-log.js'

/**
 * PR-18D: v2 envelope scaffold coexistence tests.
 */
describe('PR-18D: domain event v2 scaffold', () => {
  // ─── v2 builder ───────────────────────────────────────────────────────

  it('createDaemonDomainEventV2 produces schemaVersion 2', () => {
    const event = createDaemonDomainEventV2('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'abc', durationMs: 100,
    }, { correlationId: 'corr-1', causationId: 'cause-1', producer: 'runtime' }, 'PARALLEL')

    expect(event.schemaVersion).toBe(DAEMON_DOMAIN_EVENT_SCHEMA_VERSION_V2)
    expect(event.correlationId).toBe('corr-1')
    expect(event.causationId).toBe('cause-1')
    expect(event.producer).toBe('runtime')
    expect(event.eventType).toBe('receipt.recorded')
    expect(event.domainEventId).toBeTruthy()
  })

  it('createDaemonDomainEventV2 with partial v2 options', () => {
    const event = createDaemonDomainEventV2('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-2', nodeId: 'VERIFY', model: 'codex',
      status: 'success', outputHash: 'def', durationMs: 50,
    }, { producer: 'governance' })

    expect(event.schemaVersion).toBe(2)
    expect(event.producer).toBe('governance')
    expect(event.correlationId).toBeUndefined()
    expect(event.causationId).toBeUndefined()
  })

  // ─── v1 builder still works ───────────────────────────────────────────

  it('createDaemonDomainEvent still produces schemaVersion 1', () => {
    const event = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-3', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'ghi', durationMs: 10,
    })
    expect(event.schemaVersion).toBe(DAEMON_DOMAIN_EVENT_SCHEMA_VERSION)
    expect(event.correlationId).toBeUndefined()
    expect(event.causationId).toBeUndefined()
    expect(event.producer).toBeUndefined()
  })

  // ─── Zod validation ───────────────────────────────────────────────────

  it('Zod schema validates v1 events (no v2 fields)', () => {
    const v1 = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    })
    const result = DaemonDomainEventEnvelopeSchema.safeParse(v1)
    expect(result.success).toBe(true)
  })

  it('Zod schema validates v2 events (with v2 fields)', () => {
    const v2 = createDaemonDomainEventV2('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    }, { correlationId: 'c-1', causationId: 'e-prev', producer: 'runtime' })
    const result = DaemonDomainEventEnvelopeSchema.safeParse(v2)
    expect(result.success).toBe(true)
  })

  it('Zod rejects invalid producer', () => {
    const bad = createDaemonDomainEventV2('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    }, { producer: 'runtime' })
    // Force invalid producer
    ;(bad as any).producer = 'invalid-source'
    const result = DaemonDomainEventEnvelopeSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  // ─── validateDaemonDomainEvent accepts both ───────────────────────────

  it('validateDaemonDomainEvent accepts v1 events', () => {
    const v1 = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    })
    expect(validateDaemonDomainEvent(v1)).not.toBeNull()
  })

  it('validateDaemonDomainEvent accepts v2 events', () => {
    const v2 = createDaemonDomainEventV2('run-1', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    }, { correlationId: 'corr-1', producer: 'governance' })
    expect(validateDaemonDomainEvent(v2)).not.toBeNull()
  })

  // ─── InMemoryDaemonDomainEventLog coexistence ─────────────────────────

  it('event log stores and loads mixed v1/v2 events', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const v1 = createDaemonDomainEvent('run-mixed', 'receipt.recorded', 0, {
      receiptId: 'r-1', nodeId: 'A', model: 'x',
      status: 'success', outputHash: 'abc', durationMs: 100,
    })
    const v2 = createDaemonDomainEventV2('run-mixed', 'skip.authorized', 1, {
      nodeId: 'B', sourceNodeId: 'A', reason: 'consensus',
      authorityOwner: 'daemon',
    }, { correlationId: 'corr-1', producer: 'policy' })

    await log.append({ runId: 'run-mixed', events: [v1], expectedSequence: -1 })
    await log.append({ runId: 'run-mixed', events: [v2], expectedSequence: 0 })

    const loaded = await log.load('run-mixed')
    expect(loaded).toHaveLength(2)
    expect(loaded[0]!.schemaVersion).toBe(1)
    expect(loaded[0]!.correlationId).toBeUndefined()
    expect(loaded[1]!.schemaVersion).toBe(2)
    expect(loaded[1]!.correlationId).toBe('corr-1')
    expect(loaded[1]!.producer).toBe('policy')
  })
})
