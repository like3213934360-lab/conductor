/**
 * PR-13: Cross-artifact consistency verifier.
 *
 * Verifies that a set of terminal artifacts from the same run
 * share consistent snapshotDigest, runId, and proof graph binding.
 */

import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'

export interface CrossArtifactInput {
  /** Artifact kind for diagnostics */
  kind: string
  /** Run ID from the artifact payload */
  runId: string
  /** Snapshot digest from the artifact payload (may be undefined for legacy artifacts) */
  snapshotDigest?: string
  /** Payload digest of the artifact */
  payloadDigest: string
}

export interface CrossArtifactVerificationReport {
  ok: boolean
  issues: string[]
}

/**
 * Verify cross-artifact consistency for a set of terminal artifacts.
 *
 * Checks:
 * 1. All artifacts share the same runId
 * 2. All artifacts with snapshotDigest share the same snapshotDigest
 * 3. No "same runId but different snapshot" anomaly
 */
export function verifyCrossArtifactConsistency(
  artifacts: CrossArtifactInput[],
): CrossArtifactVerificationReport {
  const issues: string[] = []

  if (artifacts.length === 0) {
    return { ok: true, issues }
  }

  // Check runId consistency
  const runIds = new Set(artifacts.map(a => a.runId))
  if (runIds.size > 1) {
    issues.push('runId:inconsistent')
  }

  // Check snapshotDigest consistency — all artifacts with snapshotDigest must match
  const snapshotDigests = new Set(
    artifacts.filter(a => a.snapshotDigest).map(a => a.snapshotDigest),
  )
  if (snapshotDigests.size > 1) {
    issues.push('snapshotDigest:inconsistent')
  }

  // Check for individual artifacts with mismatched snapshot
  if (snapshotDigests.size === 1) {
    const expected = [...snapshotDigests][0]
    for (const artifact of artifacts) {
      if (artifact.snapshotDigest && artifact.snapshotDigest !== expected) {
        issues.push(`snapshotDigest:${artifact.kind}`)
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

/**
 * Compute a proof graph digest from a set of artifact payload digests
 * and a verification snapshot digest.
 *
 * The proof graph digest binds all terminal artifacts + snapshot
 * into a single integrity root that can be recorded in the
 * transparency ledger.
 */
export function computeProofGraphDigest(input: {
  snapshotDigest: string
  artifactDigests: Array<{ kind: string; payloadDigest: string }>
}): string {
  const sorted = [...input.artifactDigests].sort((a, b) => a.kind.localeCompare(b.kind))
  const content = {
    snapshotDigest: input.snapshotDigest,
    artifacts: sorted.map(a => ({ kind: a.kind, payloadDigest: a.payloadDigest })),
  }
  return sha256Hex(canonicalJsonStringify(content))
}
