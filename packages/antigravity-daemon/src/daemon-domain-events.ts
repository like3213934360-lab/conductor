/**
 * PR-06: Daemon Domain Event v1 — Taxonomy, Schema, Append Contract
 *
 * This module defines the daemon-level domain event model that sits above the
 * low-level WorkflowEventEnvelope execution events. It captures higher-semantic
 * daemon authority decisions: completion sessions, receipts, handoffs, skip
 * authorizations, policy/tribunal verdicts, and artifact lifecycle.
 *
 * Design constraints:
 * - Schema-only: no write-point wiring (that's PR-07)
 * - No ledger replacement (that's PR-08+)
 * - schemaVersion field enables future upcasting (PR-18)
 * - sequence field is per-run monotonic for ordering
 *
 * References:
 * - Greg Young: domain events as facts
 * - Kurrent: append with expected revision
 * - ARCHITECTURE_AUDIT_AND_REMEDIATION.md §event-sourcing
 */
import { z } from 'zod'
import * as crypto from 'node:crypto'

// ─── Schema Version Baseline ─────────────────────────────────────────────────
export const DAEMON_DOMAIN_EVENT_SCHEMA_VERSION = 1
/** PR-18D: v2 envelope schema version */
export const DAEMON_DOMAIN_EVENT_SCHEMA_VERSION_V2 = 2

/** PR-18D: known producer identifiers for v2 events */
export type DaemonDomainEventProducer = 'runtime' | 'governance' | 'policy' | 'tribunal'

// ─── Event Type Taxonomy ─────────────────────────────────────────────────────

/**
 * Daemon domain event types — v1 taxonomy.
 *
 * Naming convention: `{aggregate}.{verb_past_tense}`
 * Categories serve PR-07 (dual-write), PR-08 (projection), PR-18 (upcasting).
 */
export const DaemonDomainEventTypes = {
  // Completion session lifecycle
  COMPLETION_SESSION_STARTED: 'completion_session.started',
  COMPLETION_SESSION_COMMITTED: 'completion_session.committed',
  // Execution evidence
  RECEIPT_RECORDED: 'receipt.recorded',
  HANDOFF_RECORDED: 'handoff.recorded',
  // Authority decisions
  SKIP_AUTHORIZED: 'skip.authorized',
  // Governance
  POLICY_VERDICT_RECORDED: 'policy_verdict.recorded',
  // Artifact lifecycle
  ARTIFACT_EXPORTED: 'artifact.exported',
} as const

export type DaemonDomainEventType = typeof DaemonDomainEventTypes[keyof typeof DaemonDomainEventTypes]

/** All known event types as an array (for validation) */
export const ALL_DAEMON_DOMAIN_EVENT_TYPES: DaemonDomainEventType[] = Object.values(DaemonDomainEventTypes)

// ─── Typed Payloads ──────────────────────────────────────────────────────────

export interface CompletionSessionStartedPayload {
  leaseId: string
  nodeId: string
  attempt: number
}

export interface CompletionSessionCommittedPayload {
  leaseId: string
  nodeId: string
  attempt: number
  status: string
  outputHash: string
  model?: string
  durationMs?: number
}

export interface ReceiptRecordedPayload {
  receiptId: string
  nodeId: string
  model: string
  status: string
  outputHash: string
  durationMs: number
}

export interface HandoffRecordedPayload {
  handoffId: string
  nodeId: string
  sourceNodeId: string
  targetNodeId: string
}

export interface SkipAuthorizedPayload {
  nodeId: string
  sourceNodeId: string
  reason: string
  strategyId?: string
  triggerCondition?: string
  authorityOwner: string
}

export interface PolicyVerdictRecordedPayload {
  nodeId?: string
  verdictType: 'tribunal' | 'compliance' | 'risk' | 'hitl'
  verdict: string
  details?: Record<string, unknown>
}

export interface ArtifactExportedPayload {
  artifactType: string
  artifactId: string
  path?: string
  status: 'exported' | 'verified' | 'failed'
}

// ─── Discriminated Union ─────────────────────────────────────────────────────

export type DaemonDomainEvent =
  | { eventType: 'completion_session.started'; payload: CompletionSessionStartedPayload }
  | { eventType: 'completion_session.committed'; payload: CompletionSessionCommittedPayload }
  | { eventType: 'receipt.recorded'; payload: ReceiptRecordedPayload }
  | { eventType: 'handoff.recorded'; payload: HandoffRecordedPayload }
  | { eventType: 'skip.authorized'; payload: SkipAuthorizedPayload }
  | { eventType: 'policy_verdict.recorded'; payload: PolicyVerdictRecordedPayload }
  | { eventType: 'artifact.exported'; payload: ArtifactExportedPayload }

// ─── Envelope ────────────────────────────────────────────────────────────────

/**
 * DaemonDomainEventEnvelope — the durable envelope for daemon domain events.
 *
 * Fields:
 * - domainEventId: globally unique event identifier
 * - runId: owning run
 * - nodeId: relevant node (optional, omitted for run-level events)
 * - eventType: discriminator from DaemonDomainEventType
 * - schemaVersion: v1 baseline, enables future upcasting
 * - timestamp: ISO-8601 creation time
 * - sequence: per-run monotonic counter for ordering
 * - payload: typed per eventType
 *
 * PR-18D v2 optional fields (present when schemaVersion >= 2):
 * - correlationId: links events in the same causal chain
 * - causationId: domainEventId of the event that caused this one
 * - producer: which subsystem emitted this event
 */
export interface DaemonDomainEventEnvelope {
  domainEventId: string
  runId: string
  nodeId?: string
  eventType: DaemonDomainEventType
  schemaVersion: number
  timestamp: string
  sequence: number
  payload: Record<string, unknown>
  /** PR-18D v2: links events in the same causal chain (e.g. run-level correlation) */
  correlationId?: string
  /** PR-18D v2: domainEventId of the event that triggered this one */
  causationId?: string
  /** PR-18D v2: subsystem that emitted this event */
  producer?: DaemonDomainEventProducer
}

/** Fully typed envelope — envelope + discriminated union */
export type TypedDaemonDomainEventEnvelope = DaemonDomainEventEnvelope & DaemonDomainEvent

// ─── Zod Validation Schemas ──────────────────────────────────────────────────

export const DaemonDomainEventEnvelopeSchema = z.object({
  domainEventId: z.string().min(1),
  runId: z.string().min(1),
  nodeId: z.string().optional(),
  eventType: z.enum(ALL_DAEMON_DOMAIN_EVENT_TYPES as [DaemonDomainEventType, ...DaemonDomainEventType[]]),
  schemaVersion: z.number().int().positive(),
  timestamp: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
  // PR-18D v2 optional fields
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  producer: z.enum(['runtime', 'governance', 'policy', 'tribunal']).optional(),
})

// Per-type payload schemas for strict validation
const CompletionSessionStartedPayloadSchema = z.object({
  leaseId: z.string().min(1),
  nodeId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
})

const CompletionSessionCommittedPayloadSchema = z.object({
  leaseId: z.string().min(1),
  nodeId: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  status: z.string().min(1),
  outputHash: z.string().min(1),
  model: z.string().optional(),
  durationMs: z.number().optional(),
})

const ReceiptRecordedPayloadSchema = z.object({
  receiptId: z.string().min(1),
  nodeId: z.string().min(1),
  model: z.string().min(1),
  status: z.string().min(1),
  outputHash: z.string().min(1),
  durationMs: z.number(),
})

const HandoffRecordedPayloadSchema = z.object({
  handoffId: z.string().min(1),
  nodeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
})

const SkipAuthorizedPayloadSchema = z.object({
  nodeId: z.string().min(1),
  sourceNodeId: z.string().min(1),
  reason: z.string().min(1),
  strategyId: z.string().optional(),
  triggerCondition: z.string().optional(),
  authorityOwner: z.string().min(1),
})

const PolicyVerdictRecordedPayloadSchema = z.object({
  nodeId: z.string().optional(),
  verdictType: z.enum(['tribunal', 'compliance', 'risk', 'hitl']),
  verdict: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

const ArtifactExportedPayloadSchema = z.object({
  artifactType: z.string().min(1),
  artifactId: z.string().min(1),
  path: z.string().optional(),
  status: z.enum(['exported', 'verified', 'failed']),
})

/** Map event type → payload schema for strict per-type validation */
const PAYLOAD_SCHEMAS: Record<DaemonDomainEventType, z.ZodTypeAny> = {
  'completion_session.started': CompletionSessionStartedPayloadSchema,
  'completion_session.committed': CompletionSessionCommittedPayloadSchema,
  'receipt.recorded': ReceiptRecordedPayloadSchema,
  'handoff.recorded': HandoffRecordedPayloadSchema,
  'skip.authorized': SkipAuthorizedPayloadSchema,
  'policy_verdict.recorded': PolicyVerdictRecordedPayloadSchema,
  'artifact.exported': ArtifactExportedPayloadSchema,
}

/**
 * Validate a daemon domain event — envelope + typed payload.
 *
 * @returns parsed envelope on success, null on validation failure
 */
export function validateDaemonDomainEvent(
  raw: unknown,
): DaemonDomainEventEnvelope | null {
  const envelope = DaemonDomainEventEnvelopeSchema.safeParse(raw)
  if (!envelope.success) return null

  const payloadSchema = PAYLOAD_SCHEMAS[envelope.data.eventType]
  if (!payloadSchema) return null

  const payloadResult = payloadSchema.safeParse(envelope.data.payload)
  if (!payloadResult.success) return null

  return envelope.data
}

// ─── Append Contract ─────────────────────────────────────────────────────────

/**
 * Input for appending daemon domain events.
 *
 * expectedSequence: the latest known sequence for this run.
 * Events in the array must have sequence values starting at expectedSequence + 1.
 * Set to -1 for the first append to a new run.
 */
export interface DaemonDomainEventAppendInput {
  runId: string
  events: DaemonDomainEventEnvelope[]
  expectedSequence: number
}

/**
 * Result of a successful append operation.
 */
export interface DaemonDomainEventAppendResult {
  /** The sequence of the last committed event */
  committedSequence: number
  /** Number of events appended */
  count: number
}

/**
 * DaemonDomainEventLog — append-only log interface for daemon domain events.
 *
 * This is the contract that PR-07 will implement. PR-06 only defines the interface.
 * Implementations must guarantee:
 * 1. append is atomic (all or none)
 * 2. load returns events ordered by sequence ascending
 * 3. expectedSequence mismatch throws SEQUENCE_CONFLICT
 */
export interface DaemonDomainEventLog {
  /** Append events to the run's domain event log */
  append(input: DaemonDomainEventAppendInput): Promise<DaemonDomainEventAppendResult>

  /** Load all domain events for a run, ordered by sequence */
  load(runId: string, fromSequence?: number): Promise<DaemonDomainEventEnvelope[]>

  /** Get the latest sequence for a run (-1 if no events exist) */
  getLatestSequence(runId: string): Promise<number>
}

// ─── Builder Utility ─────────────────────────────────────────────────────────

/**
 * Create a daemon domain event envelope with auto-generated id and timestamp.
 *
 * Usage:
 * ```ts
 * const event = createDaemonDomainEvent('run-1', 'receipt.recorded', 0, {
 *   receiptId: 'r-1', nodeId: 'PARALLEL', model: 'codex',
 *   status: 'success', outputHash: 'abc', durationMs: 1200,
 * })
 * ```
 */
export function createDaemonDomainEvent(
  runId: string,
  eventType: DaemonDomainEventType,
  sequence: number,
  payload: Record<string, unknown>,
  nodeId?: string,
): DaemonDomainEventEnvelope {
  return {
    domainEventId: crypto.randomUUID(),
    runId,
    nodeId,
    eventType,
    schemaVersion: DAEMON_DOMAIN_EVENT_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    sequence,
    payload,
  }
}

// ─── PR-18D: V2 Builder ──────────────────────────────────────────────────────

/** Options for v2 envelope metadata */
export interface DaemonDomainEventV2Options {
  correlationId?: string
  causationId?: string
  producer?: DaemonDomainEventProducer
}

/**
 * Create a daemon domain event envelope with v2 metadata.
 *
 * Same as createDaemonDomainEvent but accepts optional v2 fields.
 * Sets schemaVersion to 2.
 */
export function createDaemonDomainEventV2(
  runId: string,
  eventType: DaemonDomainEventType,
  sequence: number,
  payload: Record<string, unknown>,
  v2: DaemonDomainEventV2Options,
  nodeId?: string,
): DaemonDomainEventEnvelope {
  return {
    domainEventId: crypto.randomUUID(),
    runId,
    nodeId,
    eventType,
    schemaVersion: DAEMON_DOMAIN_EVENT_SCHEMA_VERSION_V2,
    timestamp: new Date().toISOString(),
    sequence,
    payload,
    correlationId: v2.correlationId,
    causationId: v2.causationId,
    producer: v2.producer,
  }
}
