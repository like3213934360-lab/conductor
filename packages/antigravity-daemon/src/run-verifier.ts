import { createISODateTime } from '@anthropic/antigravity-shared'
import type {
  ReleaseArtifacts,
  ReleaseAttestationArtifactSummary,
  TraceBundleArtifactSummary,
  VerifyReleaseAttestationReport,
  VerifyRunReport,
  VerifyTraceBundleReport,
} from './schema.js'
import { evaluateRunInvariants } from './run-invariants.js'
import type { ReleaseGateDecision } from './evidence-policy.js'
import type { RunDetails, TimelineEntry } from './schema.js'

type ReleaseAttestationVerificationLike = VerifyReleaseAttestationReport & {
  attestationPath: string
}

export function buildReleaseArtifactsSummary(input: {
  existing: ReleaseArtifacts
  traceBundleReport?: VerifyTraceBundleReport
  traceBundleIssues?: string[]
  releaseAttestationReport?: ReleaseAttestationVerificationLike
  releaseAttestationIssues?: string[]
}): ReleaseArtifacts {
  const traceBundle: TraceBundleArtifactSummary | undefined =
    input.existing.traceBundle || input.traceBundleReport
      ? {
          path: input.existing.traceBundle?.path ?? input.traceBundleReport?.bundlePath ?? '',
          integrityOk: input.traceBundleReport
            ? input.traceBundleReport.mismatchedEntries.length === 0 && input.traceBundleReport.missingEntries.length === 0
            : input.existing.traceBundle?.integrityOk,
          signatureVerified: input.traceBundleReport?.signatureVerified ?? input.existing.traceBundle?.signatureVerified,
          signatureRequired: input.traceBundleReport?.signatureRequired ?? input.existing.traceBundle?.signatureRequired,
          signaturePolicyId: input.traceBundleReport?.signaturePolicyId ?? input.existing.traceBundle?.signaturePolicyId,
          signatureKeyId: input.traceBundleReport?.signatureKeyId ?? input.existing.traceBundle?.signatureKeyId,
          signatureIssuer: input.traceBundleReport?.signatureIssuer ?? input.existing.traceBundle?.signatureIssuer,
          issues: input.traceBundleReport
            ? [...input.traceBundleReport.mismatchedEntries, ...input.traceBundleReport.missingEntries, ...input.traceBundleReport.failedSignatureChecks]
            : input.traceBundleIssues ?? input.existing.traceBundle?.issues ?? [],
        }
      : undefined

  const releaseAttestation: ReleaseAttestationArtifactSummary | undefined =
    input.existing.releaseAttestation || input.releaseAttestationReport
      ? {
          path: input.existing.releaseAttestation?.path ?? input.releaseAttestationReport?.attestationPath ?? '',
          verified: input.releaseAttestationReport?.ok ?? input.existing.releaseAttestation?.verified,
          payloadDigestOk: input.releaseAttestationReport?.payloadDigestOk ?? input.existing.releaseAttestation?.payloadDigestOk,
          signatureVerified: input.releaseAttestationReport?.signatureVerified ?? input.existing.releaseAttestation?.signatureVerified,
          signatureRequired: input.releaseAttestationReport?.signatureRequired ?? input.existing.releaseAttestation?.signatureRequired,
          signaturePolicyId: input.releaseAttestationReport?.signaturePolicyId ?? input.existing.releaseAttestation?.signaturePolicyId,
          signatureKeyId: input.releaseAttestationReport?.signatureKeyId ?? input.existing.releaseAttestation?.signatureKeyId,
          signatureIssuer: input.releaseAttestationReport?.signatureIssuer ?? input.existing.releaseAttestation?.signatureIssuer,
          issues: input.releaseAttestationReport?.issues ?? input.releaseAttestationIssues ?? input.existing.releaseAttestation?.issues ?? [],
        }
      : undefined

  return {
    ...(traceBundle ? { traceBundle } : {}),
    ...(releaseAttestation ? { releaseAttestation } : {}),
  }
}

export function createVerifyRunReport(input: {
  run: RunDetails
  releaseDecision: ReleaseGateDecision
  receiptCount: number
  handoffCount: number
  skipDecisionCount: number
  missingReceiptNodes: string[]
  missingTribunalNodes: string[]
  tribunalFailures: string[]
  missingSkipDecisionNodes: string[]
  missingSkipReceiptNodes: string[]
  releaseArtifacts: ReleaseArtifacts
  timeline: readonly TimelineEntry[]
  verifiedAt?: string
}): VerifyRunReport {
  const verifiedAt = input.verifiedAt ?? createISODateTime()
  const invariantFailures = evaluateRunInvariants({
    snapshot: {
      ...input.run.snapshot,
      releaseArtifacts: input.releaseArtifacts,
    },
    timeline: input.timeline,
  })

  return {
    runId: input.run.snapshot.runId,
    ok: input.releaseDecision.effect === 'allow' &&
      input.missingReceiptNodes.length === 0 &&
      input.missingTribunalNodes.length === 0 &&
      input.tribunalFailures.length === 0 &&
      input.missingSkipDecisionNodes.length === 0 &&
      input.missingSkipReceiptNodes.length === 0 &&
      invariantFailures.length === 0 &&
      !input.releaseArtifacts.traceBundle?.issues?.length &&
      !input.releaseArtifacts.releaseAttestation?.issues?.length,
    status: input.run.snapshot.status,
    releaseGateEffect: input.releaseDecision.effect,
    rationale: input.releaseDecision.rationale,
    receiptCount: input.receiptCount,
    handoffCount: input.handoffCount,
    skipDecisionCount: input.skipDecisionCount,
    missingReceiptNodes: input.missingReceiptNodes,
    missingTribunalNodes: input.missingTribunalNodes,
    tribunalFailures: input.tribunalFailures,
    missingSkipDecisionNodes: input.missingSkipDecisionNodes,
    missingSkipReceiptNodes: input.missingSkipReceiptNodes,
    invariantFailures,
    releaseArtifacts: input.releaseArtifacts,
    verifiedAt,
  }
}
