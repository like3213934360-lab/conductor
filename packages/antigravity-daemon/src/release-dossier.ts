import type {
  BenchmarkSourceRegistrySnapshot,
  PolicyVerdict,
  ReleaseArtifacts,
  RunDetails,
  TrustRegistrySnapshot,
  VerifyRunReport,
} from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'
import type { VerificationSnapshot } from './verification-snapshot.js'
import { extractRunIdentity } from './verification-snapshot.js'

export const RELEASE_DOSSIER_VERSION = '1.0.0' as const

export interface ReleaseDossierVerificationSummary {
  ok: boolean
  status: VerifyRunReport['status']
  releaseGateEffect: VerifyRunReport['releaseGateEffect']
  rationale: string[]
  receiptCount: number
  handoffCount: number
  skipDecisionCount: number
  missingReceiptNodes: string[]
  missingSkipDecisionNodes: string[]
  missingSkipReceiptNodes: string[]
  invariantFailures: string[]
}

export interface ReleaseDossierPayload {
  run: {
    runId: string
    workflowId: string
    workflowVersion: string
    workflowTemplate: string
    status: string
    verdict?: string
    completedAt?: string
  }
  releaseArtifacts: ReleaseArtifacts
  verification: ReleaseDossierVerificationSummary
  policyVerdicts: Array<{
    verdictId: string
    scope: string
    effect: string
    evidenceIds: string[]
    rationale: string[]
    evaluatedAt: string
  }>
  trustRegistry: {
    registryId: string
    version: string
  }
  benchmarkSourceRegistry: {
    registryId: string
    version: string
    trustPolicyId: string
    digestSha256?: string
  }
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest?: string
}

export interface ReleaseDossierDocument {
  version: string
  generatedAt: string
  payload: ReleaseDossierPayload
  payloadDigest: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface ReleaseDossierVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

function buildVerificationSummary(report: VerifyRunReport): ReleaseDossierVerificationSummary {
  return {
    ok: report.ok,
    status: report.status,
    releaseGateEffect: report.releaseGateEffect,
    rationale: report.rationale,
    receiptCount: report.receiptCount,
    handoffCount: report.handoffCount,
    skipDecisionCount: report.skipDecisionCount,
    missingReceiptNodes: report.missingReceiptNodes,
    missingSkipDecisionNodes: report.missingSkipDecisionNodes,
    missingSkipReceiptNodes: report.missingSkipReceiptNodes,
    invariantFailures: report.invariantFailures,
  }
}

export function buildReleaseDossierPayload(input: {
  run: RunDetails
  verifyRunReport: VerifyRunReport
  policyVerdicts: PolicyVerdict[]
  trustRegistry: TrustRegistrySnapshot
  benchmarkSourceRegistry: BenchmarkSourceRegistrySnapshot
  /** PR-12: optional verification snapshot for unified source */
  verificationSnapshot?: VerificationSnapshot
}): ReleaseDossierPayload {
  const run = input.verificationSnapshot
    ? extractRunIdentity(input.verificationSnapshot)
    : {
        runId: input.run.snapshot.runId,
        workflowId: input.run.snapshot.workflowId,
        workflowVersion: input.run.snapshot.workflowVersion,
        workflowTemplate: input.run.snapshot.workflowTemplate,
        status: input.run.snapshot.status,
        verdict: input.run.snapshot.verdict,
        completedAt: input.run.snapshot.completedAt,
      }
  return {
    run,
    releaseArtifacts: input.verifyRunReport.releaseArtifacts,
    verification: buildVerificationSummary(input.verifyRunReport),
    policyVerdicts: input.policyVerdicts.map(verdict => ({
      verdictId: verdict.verdictId,
      scope: verdict.scope,
      effect: verdict.effect,
      evidenceIds: verdict.evidenceIds,
      rationale: verdict.rationale,
      evaluatedAt: verdict.evaluatedAt,
    })),
    trustRegistry: {
      registryId: input.trustRegistry.registryId,
      version: input.trustRegistry.version,
    },
    benchmarkSourceRegistry: {
      registryId: input.benchmarkSourceRegistry.registryId,
      version: input.benchmarkSourceRegistry.version,
      trustPolicyId: input.benchmarkSourceRegistry.trustPolicyId,
      digestSha256: input.benchmarkSourceRegistry.digestSha256,
    },
    snapshotDigest: input.verificationSnapshot?.snapshotDigest,
  }
}

export function serializeReleaseDossierSignable(document: {
  version: string
  generatedAt: string
  payload: ReleaseDossierPayload
  payloadDigest: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
  })
}

export function createReleaseDossierDocument(payload: ReleaseDossierPayload, generatedAt: string): ReleaseDossierDocument {
  const payloadDigest = sha256Hex(canonicalJsonStringify(payload))
  return {
    version: RELEASE_DOSSIER_VERSION,
    generatedAt,
    payload,
    payloadDigest,
  }
}

export function verifyReleaseDossierDocument(
  document: ReleaseDossierDocument,
  run: RunDetails,
  verifyRunReport: VerifyRunReport,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): ReleaseDossierVerificationReport {
  const issues: string[] = []
  const payloadDigest = sha256Hex(canonicalJsonStringify(document.payload))
  const payloadDigestOk = payloadDigest === document.payloadDigest
  if (!payloadDigestOk) {
    issues.push('payloadDigest')
  }

  if (document.payload.run.runId !== run.snapshot.runId) {
    issues.push('runId')
  }

  // PR-13: snapshotDigest consistency check
  if (expectedSnapshotDigest && document.payload.snapshotDigest && document.payload.snapshotDigest !== expectedSnapshotDigest) {
    issues.push('snapshotDigest')
  }

  const expectedReleaseArtifacts = canonicalJsonStringify(verifyRunReport.releaseArtifacts)
  if (canonicalJsonStringify(document.payload.releaseArtifacts) !== expectedReleaseArtifacts) {
    issues.push('releaseArtifacts')
  }

  const expectedVerification = canonicalJsonStringify(buildVerificationSummary(verifyRunReport))
  if (canonicalJsonStringify(document.payload.verification) !== expectedVerification) {
    issues.push('verificationSummary')
  }

  return {
    ok: payloadDigestOk && issues.length === 0,
    payloadDigestOk,
    signatureVerified: false,
    signatureRequired: false,
    signaturePolicyId: document.signaturePolicyId,
    signatureKeyId: document.signature?.keyId,
    signatureIssuer: document.signature?.issuer,
    issues,
  }
}
