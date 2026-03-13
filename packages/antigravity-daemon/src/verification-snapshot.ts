/**
 * PR-12: Verification Snapshot and Artifact Reference Model.
 *
 * Provides a frozen verification snapshot that all terminal artifacts
 * can reference as their common source of truth for run identity,
 * verification summary, and policy verdicts.
 *
 * Also provides ArtifactReference for standardized cross-artifact binding.
 */

import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'
import type { PolicyVerdict, VerifyRunReport, RunDetails } from './schema.js'

export const VERIFICATION_SNAPSHOT_VERSION = '1.0.0' as const

// ── Verification Snapshot ────────────────────────────────────────────────────

/**
 * VerificationSnapshot — frozen run identity + verification summary.
 *
 * Built once after verifyRun completes. All terminal artifact builders
 * should read from this instead of independently extracting fields
 * from RunDetails.
 */
export interface VerificationSnapshot {
  /** Schema version */
  version: typeof VERIFICATION_SNAPSHOT_VERSION
  /** When this snapshot was frozen */
  generatedAt: string

  /** Run identity — single source of truth */
  run: {
    runId: string
    workflowId: string
    workflowVersion: string
    workflowTemplate: string
    status: string
    verdict?: string
    completedAt?: string
  }

  /** Verification summary from verifyRun */
  verification: {
    ok: boolean
    releaseGateEffect: string
    rationale: string[]
    receiptCount: number
    handoffCount: number
    skipDecisionCount: number
    missingReceiptNodes: string[]
    missingSkipDecisionNodes: string[]
    missingSkipReceiptNodes: string[]
    invariantFailures: string[]
    verifiedAt: string
  }

  /** Policy verdicts active at snapshot time */
  verdicts: Array<{
    verdictId: string
    scope: string
    effect: string
    rationale: string[]
    evaluatedAt: string
  }>

  /** Canonical digest of this snapshot (sha256 of canonical JSON minus this field) */
  snapshotDigest: string
}

// ── Artifact Reference ───────────────────────────────────────────────────────

/**
 * ArtifactKind — all terminal artifact types in the system.
 */
export type ArtifactKind =
  | 'policy-report'
  | 'invariant-report'
  | 'release-attestation'
  | 'release-dossier'
  | 'release-bundle'
  | 'certification-record'
  | 'trace-bundle'

/**
 * ArtifactReference — standardized reference from one artifact to another.
 *
 * Provides a minimal binding structure that downstream artifacts and
 * verifiers can use to check provenance without re-parsing full payloads.
 */
export interface ArtifactReference {
  /** What kind of artifact this references */
  kind: ArtifactKind
  /** Payload digest of the referenced artifact */
  payloadDigest: string
  /** Version of the referenced artifact */
  version: string
  /** Digest of the verification snapshot this artifact was built from */
  snapshotDigest: string
}

// ── Builders ─────────────────────────────────────────────────────────────────

export interface BuildVerificationSnapshotInput {
  run: RunDetails
  verifyReport: VerifyRunReport
  verdicts: readonly PolicyVerdict[]
  generatedAt: string
}

/**
 * Build a frozen VerificationSnapshot from run details and verification output.
 *
 * The snapshot digest is computed from the canonical JSON of all fields
 * except `snapshotDigest` itself.
 */
export function buildVerificationSnapshot(input: BuildVerificationSnapshotInput): VerificationSnapshot {
  const snapshot = input.run.snapshot
  const run = {
    runId: snapshot.runId,
    workflowId: input.run.definition.workflowId,
    workflowVersion: input.run.definition.version,
    workflowTemplate: input.run.definition.templateName,
    status: snapshot.status,
    verdict: snapshot.verdict,
    completedAt: snapshot.completedAt,
  }
  const verification = {
    ok: input.verifyReport.ok,
    releaseGateEffect: input.verifyReport.releaseGateEffect,
    rationale: input.verifyReport.rationale,
    receiptCount: input.verifyReport.receiptCount,
    handoffCount: input.verifyReport.handoffCount,
    skipDecisionCount: input.verifyReport.skipDecisionCount,
    missingReceiptNodes: input.verifyReport.missingReceiptNodes,
    missingSkipDecisionNodes: input.verifyReport.missingSkipDecisionNodes,
    missingSkipReceiptNodes: input.verifyReport.missingSkipReceiptNodes,
    invariantFailures: input.verifyReport.invariantFailures,
    verifiedAt: input.verifyReport.verifiedAt,
  }
  const verdicts = input.verdicts.map(v => ({
    verdictId: v.verdictId,
    scope: v.scope,
    effect: v.effect,
    rationale: v.rationale,
    evaluatedAt: v.evaluatedAt,
  }))

  // Compute digest from all fields except snapshotDigest
  const digestInput = {
    version: VERIFICATION_SNAPSHOT_VERSION,
    generatedAt: input.generatedAt,
    run,
    verification,
    verdicts,
  }
  const snapshotDigest = computeSnapshotDigest(digestInput)

  return {
    version: VERIFICATION_SNAPSHOT_VERSION,
    generatedAt: input.generatedAt,
    run,
    verification,
    verdicts,
    snapshotDigest,
  }
}

/**
 * Compute the canonical digest of a snapshot's content.
 */
export function computeSnapshotDigest(content: Record<string, unknown>): string {
  return sha256Hex(canonicalJsonStringify(content))
}

/**
 * Build an ArtifactReference for a terminal artifact.
 */
export function buildArtifactReference(
  kind: ArtifactKind,
  payloadDigest: string,
  version: string,
  snapshotDigest: string,
): ArtifactReference {
  return { kind, payloadDigest, version, snapshotDigest }
}

/**
 * Extract the run identity block from a VerificationSnapshot.
 *
 * Artifact builders that previously constructed their own `run:` block
 * from RunDetails can now call this instead for consistency.
 */
export function extractRunIdentity(snapshot: VerificationSnapshot): VerificationSnapshot['run'] {
  return { ...snapshot.run }
}
