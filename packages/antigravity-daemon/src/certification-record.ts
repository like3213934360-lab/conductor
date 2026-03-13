import type {
  BenchmarkSourceRegistrySnapshot,
  CertificationRecordArtifactSummary,
  CertificationRecordPayload,
  RunDetails,
  TrustRegistrySnapshot,
  VerifyReleaseBundleReport,
} from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'
import type { VerificationSnapshot } from './verification-snapshot.js'
import { extractRunIdentity } from './verification-snapshot.js'

export const CERTIFICATION_RECORD_VERSION = '1.0.0' as const

export interface CertificationRecordDocument {
  version: string
  generatedAt: string
  payload: CertificationRecordPayload
  payloadDigest: string
  proofGraphDigest?: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface CertificationRecordVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

export function buildCertificationRecordPayload(input: {
  run: RunDetails
  releaseBundle: {
    path: string
    payloadDigest: string
    signaturePolicyId?: string
    signatureKeyId?: string
    signatureIssuer?: string
  }
  trustRegistry: TrustRegistrySnapshot
  benchmarkSourceRegistry: BenchmarkSourceRegistrySnapshot
  blockedScopes: string[]
  remoteWorkers: Array<{
    workerId: string
    agentCardSha256?: string
    verificationSummary?: 'verified' | 'warning'
  }>
  /** PR-12: optional verification snapshot for unified source */
  verificationSnapshot?: VerificationSnapshot
}): CertificationRecordPayload {
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
    releaseBundle: input.releaseBundle,
    releaseDossier: input.run.snapshot.releaseDossier,
    releaseArtifacts: input.run.snapshot.releaseArtifacts,
    policyReport: input.run.snapshot.policyReport,
    invariantReport: input.run.snapshot.invariantReport,
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
    remoteWorkers: input.remoteWorkers,
    governance: {
      finalVerdict: input.run.snapshot.verdict ?? input.run.snapshot.status,
      releaseGateEffect: input.blockedScopes.length > 0 ? 'block' : 'allow',
      blockedScopes: input.blockedScopes,
    },
    snapshotDigest: input.verificationSnapshot?.snapshotDigest,
  }
}

export function serializeCertificationRecordSignable(document: {
  version: string
  generatedAt: string
  payload: CertificationRecordPayload
  payloadDigest: string
  proofGraphDigest?: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
    proofGraphDigest: document.proofGraphDigest,
  })
}

export function createCertificationRecordDocument(payload: CertificationRecordPayload, generatedAt: string): CertificationRecordDocument {
  const payloadDigest = sha256Hex(canonicalJsonStringify(payload))
  return {
    version: CERTIFICATION_RECORD_VERSION,
    generatedAt,
    payload,
    payloadDigest,
  }
}

export function verifyCertificationRecordDocument(
  document: CertificationRecordDocument,
  run: RunDetails,
  expectedPayload: CertificationRecordPayload,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): CertificationRecordVerificationReport {
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
  if (canonicalJsonStringify(document.payload) !== canonicalJsonStringify(expectedPayload)) {
    issues.push('payload')
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

export function summarizeCertificationRecordArtifact(input: {
  path: string
  report: CertificationRecordVerificationReport
}): CertificationRecordArtifactSummary {
  return {
    path: input.path,
    verified: input.report.ok,
    payloadDigestOk: input.report.payloadDigestOk,
    signatureVerified: input.report.signatureVerified,
    signatureRequired: input.report.signatureRequired,
    signaturePolicyId: input.report.signaturePolicyId,
    signatureKeyId: input.report.signatureKeyId,
    signatureIssuer: input.report.signatureIssuer,
    issues: input.report.issues,
  }
}
