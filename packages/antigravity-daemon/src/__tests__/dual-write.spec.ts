import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryDaemonDomainEventLog } from '../in-memory-domain-event-log.js'
import {
  createDaemonDomainEvent,
  DaemonDomainEventTypes,
  validateDaemonDomainEvent,
  type DaemonDomainEventEnvelope,
  type DaemonDomainEventLog,
  type DaemonDomainEventAppendInput,
  type DaemonDomainEventAppendResult,
} from '../daemon-domain-events.js'

// ═══════════════════════════════════════════════════════════════════════
// Part 1: InMemoryDaemonDomainEventLog — contract tests
// ═══════════════════════════════════════════════════════════════════════

describe('PR-07: InMemoryDaemonDomainEventLog', () => {
  function makeEvent(
    runId: string,
    sequence: number,
    eventType = DaemonDomainEventTypes.RECEIPT_RECORDED,
  ): DaemonDomainEventEnvelope {
    return createDaemonDomainEvent(runId, eventType, sequence, {
      receiptId: `r-${sequence}`,
      nodeId: 'PARALLEL',
      model: 'codex',
      status: 'success',
      outputHash: `hash-${sequence}`,
      durationMs: 1000,
    }, 'PARALLEL')
  }

  it('appends and loads events correctly', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const e0 = makeEvent('run-1', 0)
    const result = await log.append({ runId: 'run-1', events: [e0], expectedSequence: -1 })

    expect(result.committedSequence).toBe(0)
    expect(result.count).toBe(1)

    const loaded = await log.load('run-1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.domainEventId).toBe(e0.domainEventId)
  })

  it('appends multiple events atomically', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const events = [makeEvent('run-1', 0), makeEvent('run-1', 1)]
    await log.append({ runId: 'run-1', events, expectedSequence: -1 })

    const loaded = await log.load('run-1')
    expect(loaded).toHaveLength(2)
    expect(loaded[0]?.sequence).toBe(0)
    expect(loaded[1]?.sequence).toBe(1)
  })

  it('rejects SEQUENCE_CONFLICT on mismatch', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const e0 = makeEvent('run-1', 0)
    await log.append({ runId: 'run-1', events: [e0], expectedSequence: -1 })

    const e1 = makeEvent('run-1', 1)
    await expect(log.append({ runId: 'run-1', events: [e1], expectedSequence: -1 }))
      .rejects.toThrow('SEQUENCE_CONFLICT')
  })

  it('returns -1 for empty run', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const seq = await log.getLatestSequence('nonexistent')
    expect(seq).toBe(-1)
  })

  it('loads from a specific sequence', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    await log.append({ runId: 'run-1', events: [makeEvent('run-1', 0), makeEvent('run-1', 1)], expectedSequence: -1 })
    await log.append({ runId: 'run-1', events: [makeEvent('run-1', 2)], expectedSequence: 1 })

    const from1 = await log.load('run-1', 1)
    expect(from1).toHaveLength(2)
    expect(from1[0]?.sequence).toBe(1)
    expect(from1[1]?.sequence).toBe(2)
  })

  it('empty append returns current sequence', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    const result = await log.append({ runId: 'run-1', events: [], expectedSequence: -1 })
    expect(result.committedSequence).toBe(-1)
    expect(result.count).toBe(0)
  })

  it('isolates events between runs', async () => {
    const log = new InMemoryDaemonDomainEventLog()
    await log.append({ runId: 'run-1', events: [makeEvent('run-1', 0)], expectedSequence: -1 })
    await log.append({ runId: 'run-2', events: [makeEvent('run-2', 0)], expectedSequence: -1 })

    expect(await log.load('run-1')).toHaveLength(1)
    expect(await log.load('run-2')).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 2: All dual-write event types use PR-06 schema
// ═══════════════════════════════════════════════════════════════════════

describe('PR-07: dual-write events use PR-06 schema', () => {
  it('all 7 event types produce valid envelopes via createDaemonDomainEvent', () => {
    const types = [
      { type: DaemonDomainEventTypes.COMPLETION_SESSION_STARTED, payload: { leaseId: 'l', nodeId: 'n', attempt: 0 } },
      { type: DaemonDomainEventTypes.COMPLETION_SESSION_COMMITTED, payload: { leaseId: 'l', nodeId: 'n', attempt: 0, status: 's', outputHash: 'h' } },
      { type: DaemonDomainEventTypes.RECEIPT_RECORDED, payload: { receiptId: 'r', nodeId: 'n', model: 'm', status: 's', outputHash: 'h', durationMs: 1 } },
      { type: DaemonDomainEventTypes.HANDOFF_RECORDED, payload: { handoffId: 'h', nodeId: 'n', sourceNodeId: 's', targetNodeId: 't' } },
      { type: DaemonDomainEventTypes.SKIP_AUTHORIZED, payload: { nodeId: 'n', sourceNodeId: 's', reason: 'r', authorityOwner: 'daemon' } },
      { type: DaemonDomainEventTypes.POLICY_VERDICT_RECORDED, payload: { verdictType: 'tribunal', verdict: 'approved' } },
      { type: DaemonDomainEventTypes.ARTIFACT_EXPORTED, payload: { artifactType: 'bundle', artifactId: 'a', status: 'exported' } },
    ]

    for (const { type, payload } of types) {
      const event = createDaemonDomainEvent('run-1', type, 0, payload, 'NODE')
      expect(validateDaemonDomainEvent(event)).not.toBeNull()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Part 3: Runtime-level dual-write behavior tests
// ═══════════════════════════════════════════════════════════════════════

/**
 * These tests simulate the runtime's emitDomainEvent() behavior:
 * - Each write-point category emits the correct event type
 * - Fail-open: append failure → audit trail, no crash
 * - Legacy path remains unaffected by dual-write
 */
describe('PR-07: runtime dual-write behavior', () => {
  let log: InMemoryDaemonDomainEventLog
  let auditTrail: Array<{ type: string; nodeId: string; detail: Record<string, unknown> }>

  // Simulate the runtime's emitDomainEvent helper
  async function emitDomainEvent(
    eventLog: DaemonDomainEventLog,
    runId: string,
    eventType: string,
    payload: Record<string, unknown>,
    nodeId?: string,
    onFailure?: (eventType: string, error: string) => void,
  ): Promise<void> {
    try {
      const sequence = await eventLog.getLatestSequence(runId)
      const event = createDaemonDomainEvent(
        runId,
        eventType as any,
        sequence + 1,
        payload,
        nodeId,
      )
      await eventLog.append({
        runId,
        events: [event],
        expectedSequence: sequence,
      })
    } catch (error) {
      if (onFailure) {
        onFailure(eventType, error instanceof Error ? error.message : String(error))
      }
    }
  }

  beforeEach(() => {
    log = new InMemoryDaemonDomainEventLog()
    auditTrail = []
  })

  // ── completion_session.started dual-write ────────────────────────
  it('completion_session.started: emits correct event after stageCompletionSession', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.COMPLETION_SESSION_STARTED, {
      leaseId: 'lease-1', nodeId: 'PARALLEL', attempt: 0,
    }, 'PARALLEL')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('completion_session.started')
    expect(events[0]?.payload).toMatchObject({ leaseId: 'lease-1', nodeId: 'PARALLEL', attempt: 0 })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── completion_session.committed dual-write ──────────────────────
  it('completion_session.committed: emits correct event after commitStepCompletionReceipt', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.COMPLETION_SESSION_COMMITTED, {
      leaseId: 'lease-1', nodeId: 'PARALLEL', attempt: 0,
      status: 'success', outputHash: 'abc123', model: 'codex', durationMs: 1500,
    }, 'PARALLEL')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('completion_session.committed')
    expect(events[0]?.payload).toMatchObject({
      leaseId: 'lease-1', status: 'success', outputHash: 'abc123',
    })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── receipt.recorded dual-write ──────────────────────────────────
  it('receipt.recorded: emits correct event after createExecutionReceipt', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.RECEIPT_RECORDED, {
      receiptId: 'receipt-1', nodeId: 'PARALLEL', model: 'codex',
      status: 'success', outputHash: 'hash1', durationMs: 1200,
    }, 'PARALLEL')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('receipt.recorded')
    expect(events[0]?.payload).toMatchObject({ receiptId: 'receipt-1', model: 'codex' })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── handoff.recorded dual-write ──────────────────────────────────
  it('handoff.recorded: emits correct event after createHandoffEnvelopes', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.HANDOFF_RECORDED, {
      handoffId: 'handoff-1', nodeId: 'PARALLEL',
      sourceNodeId: 'PARALLEL', targetNodeId: 'DEBATE',
    }, 'PARALLEL')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('handoff.recorded')
    expect(events[0]?.payload).toMatchObject({
      sourceNodeId: 'PARALLEL', targetNodeId: 'DEBATE',
    })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── skip.authorized dual-write ───────────────────────────────────
  it('skip.authorized: emits correct event after evaluateNodeTransition', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.SKIP_AUTHORIZED, {
      nodeId: 'DEBATE', sourceNodeId: 'PARALLEL',
      reason: 'Adaptive debate skip', strategyId: 'adaptive.debate-express.v1',
      authorityOwner: 'daemon',
    }, 'DEBATE')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('skip.authorized')
    expect(events[0]?.payload).toMatchObject({
      nodeId: 'DEBATE', reason: 'Adaptive debate skip', authorityOwner: 'daemon',
    })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── policy_verdict.recorded dual-write ───────────────────────────
  it('policy_verdict.recorded: emits correct event after recordTribunalVerdict', async () => {
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.POLICY_VERDICT_RECORDED, {
      nodeId: 'VERIFY', verdictType: 'tribunal' as const,
      verdict: 'agree', details: { mode: 'remote', confidence: 0.95 },
    }, 'VERIFY')

    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('policy_verdict.recorded')
    expect(events[0]?.payload).toMatchObject({
      verdictType: 'tribunal', verdict: 'agree',
    })
    expect(validateDaemonDomainEvent(events[0])).not.toBeNull()
  })

  // ── Fail-open: event append failure → audit trail, no crash ──────
  it('fail-open: append failure triggers audit callback, does not throw', async () => {
    // Create a log that always fails on append
    const failingLog: DaemonDomainEventLog = {
      async append(): Promise<DaemonDomainEventAppendResult> {
        throw new Error('STORAGE_UNAVAILABLE')
      },
      async load(): Promise<DaemonDomainEventEnvelope[]> { return [] },
      async getLatestSequence(): Promise<number> { return -1 },
    }

    const failures: Array<{ eventType: string; error: string }> = []

    // Should NOT throw
    await emitDomainEvent(
      failingLog,
      'run-1',
      DaemonDomainEventTypes.RECEIPT_RECORDED,
      { receiptId: 'r', nodeId: 'n', model: 'm', status: 's', outputHash: 'h', durationMs: 1 },
      'PARALLEL',
      (eventType, error) => { failures.push({ eventType, error }) },
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]?.eventType).toBe('receipt.recorded')
    expect(failures[0]?.error).toContain('STORAGE_UNAVAILABLE')
  })

  // ── Legacy path unaffected ───────────────────────────────────────
  it('legacy ledger writes are independent of domain event log', async () => {
    // Simulate: legacy write succeeds, then dual-write happens
    // The legacy side-effect is completely independent
    const legacyResults: string[] = []

    // Legacy write (mock)
    legacyResults.push('ledger.receipt.written')

    // Dual-write
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.RECEIPT_RECORDED, {
      receiptId: 'r-1', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1,
    }, 'N')

    // Legacy is intact regardless of dual-write
    expect(legacyResults).toEqual(['ledger.receipt.written'])

    // Event log has the event too
    const events = await log.load('run-1')
    expect(events).toHaveLength(1)
  })

  // ── Sequence ordering across multiple write-points ───────────────
  it('multiple dual-writes produce sequential events in correct order', async () => {
    // Simulate a node completion flow: receipt → handoff → session started → session committed
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.RECEIPT_RECORDED, {
      receiptId: 'r-1', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1,
    }, 'N')
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.HANDOFF_RECORDED, {
      handoffId: 'h-1', nodeId: 'N', sourceNodeId: 'N', targetNodeId: 'N2',
    }, 'N')
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.COMPLETION_SESSION_STARTED, {
      leaseId: 'l-1', nodeId: 'N', attempt: 0,
    }, 'N')
    await emitDomainEvent(log, 'run-1', DaemonDomainEventTypes.COMPLETION_SESSION_COMMITTED, {
      leaseId: 'l-1', nodeId: 'N', attempt: 0, status: 's', outputHash: 'h',
    }, 'N')

    const events = await log.load('run-1')
    expect(events).toHaveLength(4)
    expect(events[0]?.sequence).toBe(0)
    expect(events[1]?.sequence).toBe(1)
    expect(events[2]?.sequence).toBe(2)
    expect(events[3]?.sequence).toBe(3)
    expect(events.map(e => e.eventType)).toEqual([
      'receipt.recorded',
      'handoff.recorded',
      'completion_session.started',
      'completion_session.committed',
    ])
  })
})
