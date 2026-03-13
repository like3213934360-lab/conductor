import type {
  BenchmarkSourceRegistrySnapshot,
  PolicyVerdict,
  RunDetails,
  TrustRegistrySnapshot,
  VerifyTraceBundleReport,
} from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'
import type { VerificationSnapshot } from './verification-snapshot.js'
import { extractRunIdentity } from './verification-snapshot.js'

export const RELEASE_ATTESTATION_VERSION = '1.0.0' as const

export interface ReleaseAttestationPayload {
  runId: string
  workflowId: string
  workflowVersion: string
  workflowTemplate: string
  status: string
  verdict?: string
  completedAt?: string
  traceBundle: {
    bundlePath: string
    actualBundleDigest: string
    expectedBundleDigest?: string
    signatureVerified: boolean
    signatureRequired: boolean
    signaturePolicyId?: string
    signatureKeyId?: string
    signatureIssuer?: string
    verifiedAt: string
  }
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

export interface ReleaseAttestationDocument {
  version: string
  generatedAt: string
  payload: ReleaseAttestationPayload
  payloadDigest: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface ReleaseAttestationVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

export function buildReleaseAttestationPayload(input: {
  run: RunDetails
  traceBundleReport: VerifyTraceBundleReport
  policyVerdicts: PolicyVerdict[]
  trustRegistry: TrustRegistrySnapshot
  benchmarkSourceRegistry: BenchmarkSourceRegistrySnapshot
  /** PR-12: optional verification snapshot for unified source */
  verificationSnapshot?: VerificationSnapshot
}): ReleaseAttestationPayload {
  const runIdentity = input.verificationSnapshot
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
    runId: runIdentity.runId,
    workflowId: runIdentity.workflowId,
    workflowVersion: runIdentity.workflowVersion,
    workflowTemplate: runIdentity.workflowTemplate,
    status: runIdentity.status,
    verdict: runIdentity.verdict,
    completedAt: runIdentity.completedAt,
    traceBundle: {
      bundlePath: input.traceBundleReport.bundlePath,
      actualBundleDigest: input.traceBundleReport.actualBundleDigest,
      expectedBundleDigest: input.traceBundleReport.expectedBundleDigest,
      signatureVerified: input.traceBundleReport.signatureVerified,
      signatureRequired: input.traceBundleReport.signatureRequired,
      signaturePolicyId: input.traceBundleReport.signaturePolicyId,
      signatureKeyId: input.traceBundleReport.signatureKeyId,
      signatureIssuer: input.traceBundleReport.signatureIssuer,
      verifiedAt: input.traceBundleReport.verifiedAt,
    },
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

export function serializeReleaseAttestationSignable(document: {
  version: string
  generatedAt: string
  payload: ReleaseAttestationPayload
  payloadDigest: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
  })
}

export function createReleaseAttestationDocument(payload: ReleaseAttestationPayload, generatedAt: string): ReleaseAttestationDocument {
  const payloadDigest = sha256Hex(canonicalJsonStringify(payload))
  return {
    version: RELEASE_ATTESTATION_VERSION,
    generatedAt,
    payload,
    payloadDigest,
  }
}

export function verifyReleaseAttestationDocument(
  document: ReleaseAttestationDocument,
  traceBundleReport: VerifyTraceBundleReport,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): ReleaseAttestationVerificationReport {
  const issues: string[] = []
  const payloadDigest = sha256Hex(canonicalJsonStringify(document.payload))
  const payloadDigestOk = payloadDigest === document.payloadDigest
  if (!payloadDigestOk) {
    issues.push('payloadDigest')
  }
  // PR-13: snapshotDigest consistency check
  if (expectedSnapshotDigest && document.payload.snapshotDigest && document.payload.snapshotDigest !== expectedSnapshotDigest) {
    issues.push('snapshotDigest')
  }
  if (document.payload.traceBundle.actualBundleDigest !== traceBundleReport.actualBundleDigest) {
    issues.push('traceBundleDigest')
  }
  if (document.payload.traceBundle.signatureVerified !== traceBundleReport.signatureVerified) {
    issues.push('traceBundleSignatureVerified')
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
