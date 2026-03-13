import { describe, it, expect } from 'vitest'
import {
  buildEventDerivedProjection,
  shadowCompare,
  type LegacyProjectionInput,
} from '../event-derived-projection.js'
import {
  createDaemonDomainEvent,
  DaemonDomainEventTypes,
  type DaemonDomainEventEnvelope,
} from '../daemon-domain-events.js'

/**
 * PR-08: Event-derived projection and shadow compare tests.
 */
describe('PR-08: buildEventDerivedProjection', () => {
  function makeEvent(
    seq: number,
    eventType: string,
    payload: Record<string, unknown>,
    nodeId?: string,
  ): DaemonDomainEventEnvelope {
    return createDaemonDomainEvent('run-1', eventType as any, seq, payload, nodeId)
  }

  it('folds completion_session.started event', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'completion_session.started', { leaseId: 'l-1', nodeId: 'N', attempt: 0 }, 'N'),
    ])
    expect(proj.completionSessions.size).toBe(1)
    const session = proj.completionSessions.get('N:l-1')
    expect(session?.phase).toBe('started')
    expect(session?.leaseId).toBe('l-1')
  })

  it('folds completion_session.committed event (upgrades started)', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'completion_session.started', { leaseId: 'l-1', nodeId: 'N', attempt: 0 }, 'N'),
      makeEvent(1, 'completion_session.committed', { leaseId: 'l-1', nodeId: 'N', attempt: 0, status: 'success', outputHash: 'h1' }, 'N'),
    ])
    const session = proj.completionSessions.get('N:l-1')
    expect(session?.phase).toBe('committed')
    expect(session?.status).toBe('success')
    expect(session?.outputHash).toBe('h1')
  })

  it('folds receipt.recorded event', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'receipt.recorded', {
        receiptId: 'r-1', nodeId: 'N', model: 'codex', status: 'success', outputHash: 'h', durationMs: 1000,
      }, 'N'),
    ])
    expect(proj.receipts.size).toBe(1)
    expect(proj.receipts.get('r-1')?.model).toBe('codex')
  })

  it('folds handoff.recorded event', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'handoff.recorded', {
        handoffId: 'hf-1', nodeId: 'N', sourceNodeId: 'N', targetNodeId: 'N2',
      }, 'N'),
    ])
    expect(proj.handoffs).toHaveLength(1)
    expect(proj.handoffs[0]?.targetNodeId).toBe('N2')
  })

  it('folds skip.authorized event', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'skip.authorized', {
        nodeId: 'DEBATE', sourceNodeId: 'PARALLEL', reason: 'Adaptive', authorityOwner: 'daemon',
      }, 'DEBATE'),
    ])
    expect(proj.skips.size).toBe(1)
    expect(proj.skips.get('DEBATE')?.reason).toBe('Adaptive')
  })

  it('folds policy_verdict.recorded event', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'policy_verdict.recorded', {
        nodeId: 'VERIFY', verdictType: 'tribunal', verdict: 'agree',
      }, 'VERIFY'),
    ])
    expect(proj.verdicts).toHaveLength(1)
    expect(proj.verdicts[0]?.verdict).toBe('agree')
  })

  it('silently skips unknown event types', () => {
    const proj = buildEventDerivedProjection([
      makeEvent(0, 'artifact.exported', { artifactType: 'x', artifactId: 'a', status: 'exported' }),
    ])
    expect(proj.receipts.size).toBe(0)
    expect(proj.handoffs.length).toBe(0)
  })

  it('handles empty event list', () => {
    const proj = buildEventDerivedProjection([])
    expect(proj.completionSessions.size).toBe(0)
    expect(proj.receipts.size).toBe(0)
    expect(proj.handoffs.length).toBe(0)
    expect(proj.skips.size).toBe(0)
    expect(proj.verdicts.length).toBe(0)
  })
})

describe('PR-08: shadowCompare', () => {
  function emptyLegacy(): LegacyProjectionInput {
    return { receipts: [], completionSessions: [], handoffs: [], skips: [], verdicts: [] }
  }

  it('happy path: matching legacy and events → match: true', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'receipt.recorded', 0, {
        receiptId: 'r-1', nodeId: 'N', model: 'codex', status: 'success', outputHash: 'h', durationMs: 1000,
      }, 'N'),
    ])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      receipts: [{ receiptId: 'r-1', nodeId: 'N', model: 'codex', status: 'success', outputHash: 'h', durationMs: 1000 }],
    }

    const result = shadowCompare(legacy, events)
    expect(result.match).toBe(true)
    expect(result.mismatches).toHaveLength(0)
  })

  it('both empty → match: true', () => {
    const events = buildEventDerivedProjection([])
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.match).toBe(true)
  })

  it('receipt missing in legacy → missing_in_legacy mismatch', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'receipt.recorded', 0, {
        receiptId: 'r-1', nodeId: 'N', model: 'codex', status: 'success', outputHash: 'h', durationMs: 1000,
      }, 'N'),
    ])
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.match).toBe(false)
    expect(result.mismatches.some(m => m.category === 'receipt' && m.kind === 'missing_in_legacy')).toBe(true)
  })

  it('receipt missing in events → missing_in_events mismatch', () => {
    const events = buildEventDerivedProjection([])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      receipts: [{ receiptId: 'r-1', nodeId: 'N', status: 'success', outputHash: 'h' }],
    }
    const result = shadowCompare(legacy, events)
    expect(result.match).toBe(false)
    expect(result.mismatches.some(m => m.category === 'receipt' && m.kind === 'missing_in_events')).toBe(true)
  })

  it('receipt status drift → field_drift mismatch', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'receipt.recorded', 0, {
        receiptId: 'r-1', nodeId: 'N', model: 'codex', status: 'success', outputHash: 'h', durationMs: 1000,
      }, 'N'),
    ])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      receipts: [{ receiptId: 'r-1', nodeId: 'N', status: 'failed', outputHash: 'h' }],
    }
    const result = shadowCompare(legacy, events)
    expect(result.match).toBe(false)
    const drift = result.mismatches.find(m => m.kind === 'field_drift')
    expect(drift).toBeDefined()
    expect(drift!.details.field).toBe('status')
    expect(drift!.details.legacy).toBe('failed')
    expect(drift!.details.events).toBe('success')
  })

  it('skip missing in legacy → missing_in_legacy', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'skip.authorized', 0, {
        nodeId: 'DEBATE', sourceNodeId: 'PARALLEL', reason: 'Adaptive', authorityOwner: 'daemon',
      }, 'DEBATE'),
    ])
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.mismatches.some(m => m.category === 'skip' && m.kind === 'missing_in_legacy')).toBe(true)
  })

  it('skip reason drift → field_drift', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'skip.authorized', 0, {
        nodeId: 'DEBATE', sourceNodeId: 'PARALLEL', reason: 'Adaptive v2', authorityOwner: 'daemon',
      }, 'DEBATE'),
    ])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      skips: [{ nodeId: 'DEBATE', reason: 'Adaptive v1' }],
    }
    const result = shadowCompare(legacy, events)
    expect(result.mismatches.some(m => m.category === 'skip' && m.kind === 'field_drift')).toBe(true)
  })

  it('verdict count mismatch detected', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'policy_verdict.recorded', 0, {
        verdictType: 'tribunal', verdict: 'agree',
      }),
    ])
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.mismatches.some(m => m.category === 'verdict' && m.kind === 'count_mismatch')).toBe(true)
  })

  it('verdict field drift detected', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'policy_verdict.recorded', 0, {
        nodeId: 'V', verdictType: 'tribunal', verdict: 'agree',
      }, 'V'),
    ])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      verdicts: [{ nodeId: 'V', verdict: 'disagree' }],
    }
    const result = shadowCompare(legacy, events)
    expect(result.mismatches.some(m => m.category === 'verdict' && m.kind === 'field_drift')).toBe(true)
  })

  it('handoff count mismatch detected', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'handoff.recorded', 0, {
        handoffId: 'hf-1', nodeId: 'N', sourceNodeId: 'N', targetNodeId: 'N2',
      }, 'N'),
    ])
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.mismatches.some(m => m.category === 'handoff' && m.kind === 'count_mismatch')).toBe(true)
  })

  it('compare result includes correct counts', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'receipt.recorded', 0, {
        receiptId: 'r-1', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1,
      }, 'N'),
      createDaemonDomainEvent('r', 'skip.authorized', 1, {
        nodeId: 'D', sourceNodeId: 'N', reason: 'r', authorityOwner: 'daemon',
      }, 'D'),
    ])
    const legacy: LegacyProjectionInput = {
      ...emptyLegacy(),
      receipts: [{ receiptId: 'r-1', nodeId: 'N', status: 's', outputHash: 'h' }],
    }
    const result = shadowCompare(legacy, events)
    expect(result.legacyCounts.receipts).toBe(1)
    expect(result.eventDerivedCounts.receipts).toBe(1)
    expect(result.eventDerivedCounts.skips).toBe(1)
    expect(result.legacyCounts.skips).toBe(0)
  })

  it('mismatch does not silently swallow — all categories checked', () => {
    const events = buildEventDerivedProjection([
      createDaemonDomainEvent('r', 'receipt.recorded', 0, { receiptId: 'r', nodeId: 'N', model: 'm', status: 's', outputHash: 'h', durationMs: 1 }, 'N'),
      createDaemonDomainEvent('r', 'skip.authorized', 1, { nodeId: 'D', sourceNodeId: 'N', reason: 'r', authorityOwner: 'd' }, 'D'),
      createDaemonDomainEvent('r', 'handoff.recorded', 2, { handoffId: 'hf', nodeId: 'N', sourceNodeId: 'N', targetNodeId: 'D' }, 'N'),
      createDaemonDomainEvent('r', 'policy_verdict.recorded', 3, { verdictType: 'tribunal', verdict: 'agree' }),
    ])
    // Legacy is completely empty
    const result = shadowCompare(emptyLegacy(), events)
    expect(result.match).toBe(false)
    // Should detect mismatches across multiple categories
    const categories = new Set(result.mismatches.map(m => m.category))
    expect(categories.has('receipt')).toBe(true)
    expect(categories.has('skip')).toBe(true)
    expect(categories.has('handoff')).toBe(true)
    expect(categories.has('verdict')).toBe(true)
  })
})
