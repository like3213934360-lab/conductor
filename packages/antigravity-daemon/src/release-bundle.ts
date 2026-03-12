import type {
  BenchmarkSourceRegistrySnapshot,
  CertificationRecordArtifactSummary,
  InvariantReportArtifactSummary,
  PolicyReportArtifactSummary,
  ReleaseArtifacts,
  ReleaseBundleArtifactSummary,
  ReleaseDossierArtifactSummary,
  RunDetails,
  TrustRegistrySnapshot,
  VerifyRunReport,
} from './schema.js'
import { ReleaseBundlePayloadSchema } from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'

export const RELEASE_BUNDLE_VERSION = '1.0.0' as const

export interface ReleaseBundlePayload {
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
  policyReport?: PolicyReportArtifactSummary
  invariantReport?: InvariantReportArtifactSummary
  releaseDossier?: ReleaseDossierArtifactSummary
  certificationRecord?: CertificationRecordArtifactSummary
  verification: {
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
}

export interface ReleaseBundleDocument {
  version: string
  generatedAt: string
  payload: ReleaseBundlePayload
  payloadDigest: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface ReleaseBundleVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

function normalizeReleaseArtifactsForBundle(releaseArtifacts: ReleaseArtifacts) {
  return {
    traceBundle: releaseArtifacts.traceBundle
      ? { path: releaseArtifacts.traceBundle.path, issues: [] as string[] }
      : undefined,
    releaseAttestation: releaseArtifacts.releaseAttestation
      ? { path: releaseArtifacts.releaseAttestation.path, issues: [] as string[] }
      : undefined,
  }
}

function normalizeArtifactRefSummary<T extends { path: string } | undefined>(value: T) {
  return value ? { path: value.path, issues: [] as string[] } : undefined
}

function buildVerificationSummary(report: VerifyRunReport): ReleaseBundlePayload['verification'] {
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

export function buildReleaseBundlePayload(input: {
  run: RunDetails
  verifyRunReport: VerifyRunReport
  policyReport?: PolicyReportArtifactSummary
  invariantReport?: InvariantReportArtifactSummary
  releaseDossier?: ReleaseDossierArtifactSummary
  certificationRecord?: CertificationRecordArtifactSummary
  trustRegistry: TrustRegistrySnapshot
  benchmarkSourceRegistry: BenchmarkSourceRegistrySnapshot
}): ReleaseBundlePayload {
  return {
    run: {
      runId: input.run.snapshot.runId,
      workflowId: input.run.snapshot.workflowId,
      workflowVersion: input.run.snapshot.workflowVersion,
      workflowTemplate: input.run.snapshot.workflowTemplate,
      status: input.run.snapshot.status,
      verdict: input.run.snapshot.verdict,
      completedAt: input.run.snapshot.completedAt,
    },
    releaseArtifacts: normalizeReleaseArtifactsForBundle(input.verifyRunReport.releaseArtifacts),
    policyReport: normalizeArtifactRefSummary(input.policyReport),
    invariantReport: normalizeArtifactRefSummary(input.invariantReport),
    releaseDossier: normalizeArtifactRefSummary(input.releaseDossier),
    certificationRecord: normalizeArtifactRefSummary(input.certificationRecord),
    verification: buildVerificationSummary(input.verifyRunReport),
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
  }
}

export function serializeReleaseBundleSignable(document: {
  version: string
  generatedAt: string
  payload: ReleaseBundlePayload
  payloadDigest: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
  })
}

export function createReleaseBundleDocument(payload: ReleaseBundlePayload, generatedAt: string): ReleaseBundleDocument {
  const normalizedPayload = ReleaseBundlePayloadSchema.parse(payload)
  const payloadDigest = sha256Hex(canonicalJsonStringify(normalizedPayload))
  return {
    version: RELEASE_BUNDLE_VERSION,
    generatedAt,
    payload: normalizedPayload,
    payloadDigest,
  }
}

export function verifyReleaseBundleDocument(
  document: ReleaseBundleDocument,
  run: RunDetails,
  verifyRunReport: VerifyRunReport,
  policyReport?: PolicyReportArtifactSummary,
  invariantReport?: InvariantReportArtifactSummary,
  releaseDossier?: ReleaseDossierArtifactSummary,
  certificationRecord?: CertificationRecordArtifactSummary,
): ReleaseBundleVerificationReport {
  const issues: string[] = []
  const payloadDigest = sha256Hex(canonicalJsonStringify(document.payload))
  const payloadDigestOk = payloadDigest === document.payloadDigest
  if (!payloadDigestOk) {
    issues.push('payloadDigest')
  }
  if (document.payload.run.runId !== run.snapshot.runId) {
    issues.push('runId')
  }
  if (
    canonicalJsonStringify(document.payload.releaseArtifacts) !==
    canonicalJsonStringify(normalizeReleaseArtifactsForBundle(verifyRunReport.releaseArtifacts))
  ) {
    issues.push('releaseArtifacts')
  }
  if (
    canonicalJsonStringify(document.payload.policyReport ?? null) !==
    canonicalJsonStringify(normalizeArtifactRefSummary(policyReport) ?? null)
  ) {
    issues.push('policyReport')
  }
  if (
    canonicalJsonStringify(document.payload.invariantReport ?? null) !==
    canonicalJsonStringify(normalizeArtifactRefSummary(invariantReport) ?? null)
  ) {
    issues.push('invariantReport')
  }
  if (canonicalJsonStringify(document.payload.verification) !== canonicalJsonStringify(buildVerificationSummary(verifyRunReport))) {
    issues.push('verificationSummary')
  }
  if (
    canonicalJsonStringify(document.payload.releaseDossier ?? null) !==
    canonicalJsonStringify(normalizeArtifactRefSummary(releaseDossier) ?? null)
  ) {
    issues.push('releaseDossier')
  }
  if (
    canonicalJsonStringify(document.payload.certificationRecord ?? null) !==
    canonicalJsonStringify(normalizeArtifactRefSummary(certificationRecord) ?? null)
  ) {
    issues.push('certificationRecord')
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
