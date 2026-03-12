import type {
  PolicyReportArtifactSummary,
  PolicyVerdict,
  RunDetails,
} from './schema.js'
import type { HmacSignatureEnvelope } from './trust-registry.js'
import { canonicalJsonStringify, sha256Hex } from './trace-bundle-integrity.js'

export const POLICY_REPORT_VERSION = '1.0.0' as const

export interface PolicyReportPayload {
  run: {
    runId: string
    workflowId: string
    workflowVersion: string
    workflowTemplate: string
    status: string
    verdict?: string
    completedAt?: string
  }
  verdicts: Array<{
    verdictId: string
    scope: string
    effect: string
    evidenceIds: string[]
    rationale: string[]
    evaluatedAt: string
  }>
  summary: {
    verdictCount: number
    blockCount: number
    warnCount: number
    allowCount: number
    blockedScopes: string[]
  }
}

export interface PolicyReportDocument {
  version: string
  generatedAt: string
  payload: PolicyReportPayload
  payloadDigest: string
  signaturePolicyId?: string
  signature?: HmacSignatureEnvelope
}

export interface PolicyReportVerificationReport {
  ok: boolean
  payloadDigestOk: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  signaturePolicyId?: string
  signatureKeyId?: string
  signatureIssuer?: string
  issues: string[]
}

function summarizeVerdicts(verdicts: readonly PolicyVerdict[]): PolicyReportPayload['summary'] {
  const blockCount = verdicts.filter(verdict => verdict.effect === 'block').length
  const warnCount = verdicts.filter(verdict => verdict.effect === 'warn').length
  const allowCount = verdicts.filter(verdict => verdict.effect === 'allow').length
  return {
    verdictCount: verdicts.length,
    blockCount,
    warnCount,
    allowCount,
    blockedScopes: verdicts.filter(verdict => verdict.effect === 'block').map(verdict => verdict.scope),
  }
}

export function buildPolicyReportPayload(input: {
  run: RunDetails
  verdicts: PolicyVerdict[]
}): PolicyReportPayload {
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
    verdicts: input.verdicts.map(verdict => ({
      verdictId: verdict.verdictId,
      scope: verdict.scope,
      effect: verdict.effect,
      evidenceIds: verdict.evidenceIds,
      rationale: verdict.rationale,
      evaluatedAt: verdict.evaluatedAt,
    })),
    summary: summarizeVerdicts(input.verdicts),
  }
}

export function serializePolicyReportSignable(document: {
  version: string
  generatedAt: string
  payload: PolicyReportPayload
  payloadDigest: string
}): string {
  return canonicalJsonStringify({
    version: document.version,
    generatedAt: document.generatedAt,
    payload: document.payload,
    payloadDigest: document.payloadDigest,
  })
}

export function createPolicyReportDocument(payload: PolicyReportPayload, generatedAt: string): PolicyReportDocument {
  const payloadDigest = sha256Hex(canonicalJsonStringify(payload))
  return {
    version: POLICY_REPORT_VERSION,
    generatedAt,
    payload,
    payloadDigest,
  }
}

export function verifyPolicyReportDocument(
  document: PolicyReportDocument,
  run: RunDetails,
  verdicts: PolicyVerdict[],
): PolicyReportVerificationReport {
  const issues: string[] = []
  const payloadDigest = sha256Hex(canonicalJsonStringify(document.payload))
  const payloadDigestOk = payloadDigest === document.payloadDigest
  if (!payloadDigestOk) {
    issues.push('payloadDigest')
  }
  if (document.payload.run.runId !== run.snapshot.runId) {
    issues.push('runId')
  }
  const documentVerdictIds = new Set(document.payload.verdicts.map(verdict => verdict.verdictId))
  const relevantVerdicts = verdicts.filter(verdict => documentVerdictIds.has(verdict.verdictId))
  const expectedVerdicts = relevantVerdicts.map(verdict => ({
    verdictId: verdict.verdictId,
    scope: verdict.scope,
    effect: verdict.effect,
    evidenceIds: verdict.evidenceIds,
    rationale: verdict.rationale,
    evaluatedAt: verdict.evaluatedAt,
  }))
  if (canonicalJsonStringify(document.payload.verdicts) !== canonicalJsonStringify(expectedVerdicts)) {
    issues.push('verdicts')
  }
  if (canonicalJsonStringify(document.payload.summary) !== canonicalJsonStringify(summarizeVerdicts(relevantVerdicts))) {
    issues.push('summary')
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

export function summarizePolicyReportArtifact(input: {
  path: string
  report: PolicyReportVerificationReport
}): PolicyReportArtifactSummary {
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
