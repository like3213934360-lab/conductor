import type {
  InvariantReportArtifactSummary,
  InvariantReportPayload,
  ReleaseArtifacts,
  RunDetails,
} from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'

export const INVARIANT_REPORT_VERSION = '1.0.0' as const

export interface InvariantReportDocument {
  version: string
  generatedAt: string
  payload: InvariantReportPayload
  payloadDigest: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface InvariantReportVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

export function buildInvariantReportPayload(input: {
  run: RunDetails
  releaseArtifacts: ReleaseArtifacts
  invariantFailures: string[]
}): InvariantReportPayload {
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
    releaseArtifacts: input.releaseArtifacts,
    invariantFailures: input.invariantFailures,
  }
}

export function serializeInvariantReportSignable(document: {
  version: string
  generatedAt: string
  payload: InvariantReportPayload
  payloadDigest: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
  })
}

export function createInvariantReportDocument(payload: InvariantReportPayload, generatedAt: string): InvariantReportDocument {
  const payloadDigest = sha256Hex(canonicalJsonStringify(payload))
  return {
    version: INVARIANT_REPORT_VERSION,
    generatedAt,
    payload,
    payloadDigest,
  }
}

export function verifyInvariantReportDocument(
  document: InvariantReportDocument,
  run: RunDetails,
  releaseArtifacts: ReleaseArtifacts,
  invariantFailures: string[],
): InvariantReportVerificationReport {
  const issues: string[] = []
  const payloadDigest = sha256Hex(canonicalJsonStringify(document.payload))
  const payloadDigestOk = payloadDigest === document.payloadDigest
  if (!payloadDigestOk) {
    issues.push('payloadDigest')
  }
  if (document.payload.run.runId !== run.snapshot.runId) {
    issues.push('runId')
  }
  if (canonicalJsonStringify(document.payload.releaseArtifacts) !== canonicalJsonStringify(releaseArtifacts)) {
    issues.push('releaseArtifacts')
  }
  if (canonicalJsonStringify(document.payload.invariantFailures) !== canonicalJsonStringify(invariantFailures)) {
    issues.push('invariantFailures')
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

export function summarizeInvariantReportArtifact(input: {
  path: string
  report: InvariantReportVerificationReport
}): InvariantReportArtifactSummary {
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
