/**
 * PR-08: Event-derived projection and shadow-compare path.
 *
 * This module provides:
 * 1. EventDerivedProjection — the subset of run state derivable from domain events
 * 2. buildEventDerivedProjection() — folds daemon domain events into projection
 * 3. ShadowCompareResult — structured mismatch diagnostics
 * 4. shadowCompare() — legacy vs event-derived structured comparison
 * 5. ShadowCompareReadMode — read mode abstraction for progressive cutover
 *
 * Read modes:
 * - legacy: ledger only, event log not read (pre-migration)
 * - shadow: dual-read, ledger authoritative, event-derived compared (default)
 * - primary: event-derived authoritative, ledger compared (requires parity gate pass)
 */
import type { DaemonDomainEventEnvelope } from './daemon-domain-events.js'

// ─── Read Mode ───────────────────────────────────────────────────────────────

/**
 * Shadow compare read mode — controls which projection source is authoritative.
 */
export type ShadowCompareReadMode = 'legacy' | 'shadow' | 'primary'

export const DEFAULT_SHADOW_COMPARE_READ_MODE: ShadowCompareReadMode = 'shadow'

// ─── Event-Derived Projection ────────────────────────────────────────────────

export interface EventDerivedCompletionSession {
  leaseId: string
  nodeId: string
  attempt: number
  status?: string
  outputHash?: string
  model?: string
  durationMs?: number
  phase: 'started' | 'committed'
}

export interface EventDerivedReceipt {
  receiptId: string
  nodeId: string
  model: string
  status: string
  outputHash: string
  durationMs: number
}

export interface EventDerivedHandoff {
  handoffId: string
  nodeId: string
  sourceNodeId: string
  targetNodeId: string
}

export interface EventDerivedSkip {
  nodeId: string
  sourceNodeId: string
  reason: string
  strategyId?: string
  authorityOwner: string
}

export interface EventDerivedVerdict {
  nodeId?: string
  verdictType: string
  verdict: string
}

export interface EventDerivedProjection {
  completionSessions: Map<string, EventDerivedCompletionSession>
  receipts: Map<string, EventDerivedReceipt>
  handoffs: EventDerivedHandoff[]
  skips: Map<string, EventDerivedSkip>
  verdicts: EventDerivedVerdict[]
}

/**
 * Fold daemon domain events into an event-derived projection.
 *
 * Each event type maps to a specific projection category.
 * Unknown event types are silently skipped (forward-compat).
 */
export function buildEventDerivedProjection(
  events: DaemonDomainEventEnvelope[],
): EventDerivedProjection {
  const projection: EventDerivedProjection = {
    completionSessions: new Map(),
    receipts: new Map(),
    handoffs: [],
    skips: new Map(),
    verdicts: [],
  }

  for (const event of events) {
    const p = event.payload
    switch (event.eventType) {
      case 'completion_session.started':
        projection.completionSessions.set(
          `${p.nodeId}:${p.leaseId}`,
          {
            leaseId: p.leaseId as string,
            nodeId: p.nodeId as string,
            attempt: p.attempt as number,
            phase: 'started',
          },
        )
        break

      case 'completion_session.committed': {
        const key = `${p.nodeId}:${p.leaseId}`
        const existing = projection.completionSessions.get(key)
        projection.completionSessions.set(key, {
          leaseId: p.leaseId as string,
          nodeId: p.nodeId as string,
          attempt: p.attempt as number,
          status: p.status as string | undefined,
          outputHash: p.outputHash as string | undefined,
          model: p.model as string | undefined,
          durationMs: p.durationMs as number | undefined,
          phase: 'committed',
          ...existing ? {} : {},
        })
        break
      }

      case 'receipt.recorded':
        projection.receipts.set(
          p.receiptId as string,
          {
            receiptId: p.receiptId as string,
            nodeId: p.nodeId as string,
            model: p.model as string,
            status: p.status as string,
            outputHash: p.outputHash as string,
            durationMs: p.durationMs as number,
          },
        )
        break

      case 'handoff.recorded':
        projection.handoffs.push({
          handoffId: p.handoffId as string,
          nodeId: p.nodeId as string,
          sourceNodeId: p.sourceNodeId as string,
          targetNodeId: p.targetNodeId as string,
        })
        break

      case 'skip.authorized':
        projection.skips.set(
          p.nodeId as string,
          {
            nodeId: p.nodeId as string,
            sourceNodeId: p.sourceNodeId as string,
            reason: p.reason as string,
            strategyId: p.strategyId as string | undefined,
            authorityOwner: p.authorityOwner as string,
          },
        )
        break

      case 'policy_verdict.recorded':
        projection.verdicts.push({
          nodeId: p.nodeId as string | undefined,
          verdictType: p.verdictType as string,
          verdict: p.verdict as string,
        })
        break

      // artifact.exported and unknown types are silently skipped
      default:
        break
    }
  }

  return projection
}

// ─── Shadow Compare ──────────────────────────────────────────────────────────

export interface ShadowCompareMismatch {
  /** Which semantic category has the mismatch */
  category: 'completion_session' | 'receipt' | 'handoff' | 'skip' | 'verdict'
  /** What kind of mismatch */
  kind: 'missing_in_legacy' | 'missing_in_events' | 'field_drift' | 'count_mismatch'
  /** Related node (if applicable) */
  nodeId?: string
  /** Structured details about the mismatch */
  details: Record<string, unknown>
}

export interface ShadowCompareResult {
  /** True if no mismatches detected */
  match: boolean
  /** All detected mismatches */
  mismatches: ShadowCompareMismatch[]
  /** Counts from legacy source */
  legacyCounts: {
    completionSessions: number
    receipts: number
    handoffs: number
    skips: number
    verdicts: number
  }
  /** Counts from event-derived source */
  eventDerivedCounts: {
    completionSessions: number
    receipts: number
    handoffs: number
    skips: number
    verdicts: number
  }
}

/**
 * Legacy snapshot shape — the subset of legacy state needed for comparison.
 * This mirrors what buildRunSnapshot() produces from ledger side tables.
 */
export interface LegacyProjectionInput {
  receipts: Array<{ receiptId: string; nodeId: string; model?: string; status: string; outputHash: string; durationMs?: number }>
  completionSessions: Array<{ leaseId: string; nodeId: string; attempt: number; phase: string; status?: string; outputHash?: string }>
  handoffs: Array<{ handoffId?: string; nodeId: string; sourceNodeId?: string; targetNodeId?: string }>
  skips: Array<{ nodeId: string; reason: string; strategyId?: string }>
  verdicts: Array<{ nodeId?: string; verdictType?: string; verdict: string }>
}

/**
 * Structured shadow compare between legacy snapshot and event-derived projection.
 *
 * Detects:
 * - count_mismatch: different number of items per category
 * - missing_in_legacy: item exists in events but not in legacy
 * - missing_in_events: item exists in legacy but not in events
 * - field_drift: item exists in both but fields differ
 */
export function shadowCompare(
  legacy: LegacyProjectionInput,
  eventDerived: EventDerivedProjection,
): ShadowCompareResult {
  const mismatches: ShadowCompareMismatch[] = []

  // ── Receipt comparison ─────────────────────────────────────────────
  const legacyReceiptIds = new Set(legacy.receipts.map(r => r.receiptId))
  const eventReceiptIds = new Set(eventDerived.receipts.keys())

  if (legacy.receipts.length !== eventDerived.receipts.size) {
    mismatches.push({
      category: 'receipt',
      kind: 'count_mismatch',
      details: { legacy: legacy.receipts.length, events: eventDerived.receipts.size },
    })
  }

  for (const [receiptId, eventReceipt] of eventDerived.receipts) {
    if (!legacyReceiptIds.has(receiptId)) {
      mismatches.push({
        category: 'receipt',
        kind: 'missing_in_legacy',
        nodeId: eventReceipt.nodeId,
        details: { receiptId },
      })
    } else {
      const legacyReceipt = legacy.receipts.find(r => r.receiptId === receiptId)
      if (legacyReceipt && legacyReceipt.status !== eventReceipt.status) {
        mismatches.push({
          category: 'receipt',
          kind: 'field_drift',
          nodeId: eventReceipt.nodeId,
          details: {
            receiptId,
            field: 'status',
            legacy: legacyReceipt.status,
            events: eventReceipt.status,
          },
        })
      }
    }
  }

  for (const legacyReceipt of legacy.receipts) {
    if (!eventReceiptIds.has(legacyReceipt.receiptId)) {
      mismatches.push({
        category: 'receipt',
        kind: 'missing_in_events',
        nodeId: legacyReceipt.nodeId,
        details: { receiptId: legacyReceipt.receiptId },
      })
    }
  }

  // ── Skip comparison ────────────────────────────────────────────────
  const legacySkipNodeIds = new Set(legacy.skips.map(s => s.nodeId))
  const eventSkipNodeIds = new Set(eventDerived.skips.keys())

  if (legacy.skips.length !== eventDerived.skips.size) {
    mismatches.push({
      category: 'skip',
      kind: 'count_mismatch',
      details: { legacy: legacy.skips.length, events: eventDerived.skips.size },
    })
  }

  for (const [nodeId, eventSkip] of eventDerived.skips) {
    if (!legacySkipNodeIds.has(nodeId)) {
      mismatches.push({
        category: 'skip',
        kind: 'missing_in_legacy',
        nodeId,
        details: { reason: eventSkip.reason },
      })
    } else {
      const legacySkip = legacy.skips.find(s => s.nodeId === nodeId)
      if (legacySkip && legacySkip.reason !== eventSkip.reason) {
        mismatches.push({
          category: 'skip',
          kind: 'field_drift',
          nodeId,
          details: { field: 'reason', legacy: legacySkip.reason, events: eventSkip.reason },
        })
      }
    }
  }

  for (const legacySkip of legacy.skips) {
    if (!eventSkipNodeIds.has(legacySkip.nodeId)) {
      mismatches.push({
        category: 'skip',
        kind: 'missing_in_events',
        nodeId: legacySkip.nodeId,
        details: { reason: legacySkip.reason },
      })
    }
  }

  // ── Completion session comparison ──────────────────────────────────
  const legacyCommitted = legacy.completionSessions.filter(s => s.phase === 'committed')
  const eventCommitted = [...eventDerived.completionSessions.values()].filter(s => s.phase === 'committed')

  if (legacyCommitted.length !== eventCommitted.length) {
    mismatches.push({
      category: 'completion_session',
      kind: 'count_mismatch',
      details: { legacy: legacyCommitted.length, events: eventCommitted.length },
    })
  }

  // ── Handoff comparison ─────────────────────────────────────────────
  if (legacy.handoffs.length !== eventDerived.handoffs.length) {
    mismatches.push({
      category: 'handoff',
      kind: 'count_mismatch',
      details: { legacy: legacy.handoffs.length, events: eventDerived.handoffs.length },
    })
  }

  // ── Verdict comparison ─────────────────────────────────────────────
  if (legacy.verdicts.length !== eventDerived.verdicts.length) {
    mismatches.push({
      category: 'verdict',
      kind: 'count_mismatch',
      details: { legacy: legacy.verdicts.length, events: eventDerived.verdicts.length },
    })
  }

  for (let i = 0; i < Math.min(legacy.verdicts.length, eventDerived.verdicts.length); i++) {
    const lv = legacy.verdicts[i]!
    const ev = eventDerived.verdicts[i]!
    if (lv.verdict !== ev.verdict) {
      mismatches.push({
        category: 'verdict',
        kind: 'field_drift',
        nodeId: ev.nodeId,
        details: { field: 'verdict', legacy: lv.verdict, events: ev.verdict },
      })
    }
  }

  return {
    match: mismatches.length === 0,
    mismatches,
    legacyCounts: {
      completionSessions: legacy.completionSessions.length,
      receipts: legacy.receipts.length,
      handoffs: legacy.handoffs.length,
      skips: legacy.skips.length,
      verdicts: legacy.verdicts.length,
    },
    eventDerivedCounts: {
      completionSessions: eventDerived.completionSessions.size,
      receipts: eventDerived.receipts.size,
      handoffs: eventDerived.handoffs.length,
      skips: eventDerived.skips.size,
      verdicts: eventDerived.verdicts.length,
    },
  }
}
