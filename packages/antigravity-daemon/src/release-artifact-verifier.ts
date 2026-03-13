import * as fs from 'node:fs'
import { createISODateTime } from '@anthropic/antigravity-shared'
import type {
  InvariantReportDocument,
  PolicyVerdict,
  PolicyReportDocument,
  CertificationRecordDocument,
  CertificationRecordPayload,
  VerifyCertificationRecordReport,
  RunSnapshot,
  VerifyInvariantReport,
  VerifyPolicyReport,
  ReleaseBundleDocument,
  VerifyReleaseBundleReport,
  ReleaseDossierDocument,
  VerifyReleaseDossierReport,
  VerifyRunReport,
  ReleaseAttestationDocument,
  RunDetails,
  VerifyReleaseAttestationReport,
  VerifyTraceBundleReport,
} from './schema.js'
import { CertificationRecordDocumentSchema, InvariantReportDocumentSchema, PolicyReportDocumentSchema, ReleaseAttestationDocumentSchema, ReleaseBundleDocumentSchema, ReleaseDossierDocumentSchema } from './schema.js'
import type { TrustRegistryStore } from './trust-registry.js'
import { serializePolicyReportSignable, verifyPolicyReportDocument } from './policy-report.js'
import { serializeInvariantReportSignable, verifyInvariantReportDocument } from './invariant-report.js'
import { serializeReleaseAttestationSignable, verifyReleaseAttestationDocument } from './release-attestation.js'
import { serializeReleaseDossierSignable, verifyReleaseDossierDocument } from './release-dossier.js'
import { serializeReleaseBundleSignable, verifyReleaseBundleDocument } from './release-bundle.js'
import { serializeCertificationRecordSignable, verifyCertificationRecordDocument } from './certification-record.js'
import {
  canonicalJsonStringify,
  TRACE_BUNDLE_SECTIONS,
  verifyTraceBundleIntegrity,
} from './trace-bundle-integrity.js'
import { verifyCrossArtifactConsistency, computeProofGraphDigest } from './cross-artifact-verifier.js'
import type { CrossArtifactInput, CrossArtifactVerificationReport } from './cross-artifact-verifier.js'

export interface ArtifactSignatureEvaluator {
  evaluateHmacSignatureEnvelope: TrustRegistryStore['evaluateHmacSignatureEnvelope']
}

export function verifyPolicyReportArtifact(
  run: RunDetails,
  reportPath: string,
  verdicts: PolicyVerdict[],
  trustRegistry: TrustRegistryStore,
): { report: VerifyPolicyReport; document: PolicyReportDocument } {
  return verifyPolicyReportArtifactWithEvaluator(run, reportPath, verdicts, trustRegistry)
}

export function verifyPolicyReportArtifactWithEvaluator(
  run: RunDetails,
  reportPath: string,
  verdicts: PolicyVerdict[],
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyPolicyReport; document: PolicyReportDocument } {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Policy report not found: ${reportPath}`)
  }

  const document = PolicyReportDocumentSchema.parse(
    JSON.parse(fs.readFileSync(reportPath, 'utf8')),
  )
  const payloadVerification = verifyPolicyReportDocument(document, run, verdicts, expectedSnapshotDigest)
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'policy-report',
    payload: serializePolicyReportSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Policy report ${run.snapshot.runId}`,
    checkPrefix: 'policy-report.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId: run.snapshot.runId,
      reportPath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyInvariantReportArtifact(
  run: RunDetails,
  reportPath: string,
  releaseArtifacts: RunSnapshot['releaseArtifacts'],
  invariantFailures: string[],
  trustRegistry: TrustRegistryStore,
): { report: VerifyInvariantReport; document: InvariantReportDocument } {
  return verifyInvariantReportArtifactWithEvaluator(run, reportPath, releaseArtifacts, invariantFailures, trustRegistry)
}

export function verifyInvariantReportArtifactWithEvaluator(
  run: RunDetails,
  reportPath: string,
  releaseArtifacts: RunSnapshot['releaseArtifacts'],
  invariantFailures: string[],
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyInvariantReport; document: InvariantReportDocument } {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Invariant report not found: ${reportPath}`)
  }

  const document = InvariantReportDocumentSchema.parse(
    JSON.parse(fs.readFileSync(reportPath, 'utf8')),
  )
  const payloadVerification = verifyInvariantReportDocument(document, run, releaseArtifacts, invariantFailures, expectedSnapshotDigest)
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'invariant-report',
    payload: serializeInvariantReportSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Invariant report ${run.snapshot.runId}`,
    checkPrefix: 'invariant-report.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId: run.snapshot.runId,
      reportPath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyTraceBundleArtifact(
  runId: string,
  bundlePath: string,
  trustRegistry: TrustRegistryStore,
): { report: VerifyTraceBundleReport; bundle: Record<string, unknown> } {
  return verifyTraceBundleArtifactWithEvaluator(runId, bundlePath, trustRegistry)
}

export function verifyTraceBundleArtifactWithEvaluator(
  runId: string,
  bundlePath: string,
  signatureEvaluator: ArtifactSignatureEvaluator,
): { report: VerifyTraceBundleReport; bundle: Record<string, unknown> } {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Trace bundle not found: ${bundlePath}`)
  }

  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as Record<string, unknown>
  const sections = Object.fromEntries(
    TRACE_BUNDLE_SECTIONS.map(section => [section, bundle[section]]),
  ) as Partial<Record<(typeof TRACE_BUNDLE_SECTIONS)[number], unknown>>
  const verification = verifyTraceBundleIntegrity(
    sections,
    bundle['integrity'] as {
      algorithm: 'sha256'
      generatedAt: string
      entryDigests: Record<string, string>
      bundleDigest: string
    } | undefined,
  )
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'trace-bundle',
    payload: canonicalJsonStringify(bundle['integrity']),
    signature: bundle['signature'] as {
      scheme: 'hmac-sha256'
      keyId: string
      issuer?: string
      signedAt: string
      signature: string
    } | undefined,
    policyId: typeof bundle['signaturePolicyId'] === 'string' ? bundle['signaturePolicyId'] : undefined,
    subjectLabel: `Trace bundle ${runId}`,
    checkPrefix: 'trace-bundle.signature',
  })

  return {
    bundle,
    report: {
      runId,
      bundlePath,
      ok: verification.ok && signatureVerification.ok,
      algorithm: verification.algorithm,
      actualBundleDigest: verification.actualBundleDigest,
      expectedBundleDigest: verification.expectedBundleDigest,
      mismatchedEntries: verification.mismatchedEntries,
      missingEntries: verification.missingEntries,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId,
      signatureKeyId: signatureVerification.key?.keyId ?? (bundle['signature'] as { keyId?: string } | undefined)?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? (bundle['signature'] as { issuer?: string } | undefined)?.issuer,
      failedSignatureChecks: signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyReleaseAttestationArtifact(
  runId: string,
  attestationPath: string,
  traceBundleReport: VerifyTraceBundleReport,
  trustRegistry: TrustRegistryStore,
): { report: VerifyReleaseAttestationReport; document: ReleaseAttestationDocument } {
  return verifyReleaseAttestationArtifactWithEvaluator(runId, attestationPath, traceBundleReport, trustRegistry)
}

export function verifyReleaseAttestationArtifactWithEvaluator(
  runId: string,
  attestationPath: string,
  traceBundleReport: VerifyTraceBundleReport,
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyReleaseAttestationReport; document: ReleaseAttestationDocument } {
  if (!fs.existsSync(attestationPath)) {
    throw new Error(`Release attestation not found: ${attestationPath}`)
  }

  const document = ReleaseAttestationDocumentSchema.parse(
    JSON.parse(fs.readFileSync(attestationPath, 'utf8')),
  )
  const payloadVerification = verifyReleaseAttestationDocument(document, traceBundleReport, expectedSnapshotDigest)
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'release-attestation',
    payload: serializeReleaseAttestationSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Release attestation ${runId}`,
    checkPrefix: 'release-attestation.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId,
      attestationPath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyReleaseDossierArtifact(
  run: RunDetails,
  dossierPath: string,
  verifyRunReport: VerifyRunReport,
  trustRegistry: TrustRegistryStore,
): { report: VerifyReleaseDossierReport; document: ReleaseDossierDocument } {
  return verifyReleaseDossierArtifactWithEvaluator(run, dossierPath, verifyRunReport, trustRegistry)
}

export function verifyReleaseDossierArtifactWithEvaluator(
  run: RunDetails,
  dossierPath: string,
  verifyRunReport: VerifyRunReport,
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyReleaseDossierReport; document: ReleaseDossierDocument } {
  if (!fs.existsSync(dossierPath)) {
    throw new Error(`Release dossier not found: ${dossierPath}`)
  }

  const document = ReleaseDossierDocumentSchema.parse(
    JSON.parse(fs.readFileSync(dossierPath, 'utf8')),
  )
  const payloadVerification = verifyReleaseDossierDocument(document, run, verifyRunReport, expectedSnapshotDigest)
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'release-dossier',
    payload: serializeReleaseDossierSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Release dossier ${run.snapshot.runId}`,
    checkPrefix: 'release-dossier.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId: run.snapshot.runId,
      dossierPath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyReleaseBundleArtifact(
  run: RunDetails,
  bundlePath: string,
  verifyRunReport: VerifyRunReport,
  policyReport: RunSnapshot['policyReport'],
  invariantReport: RunSnapshot['invariantReport'],
  certificationRecord: RunSnapshot['certificationRecord'],
  trustRegistry: TrustRegistryStore,
): { report: VerifyReleaseBundleReport; document: ReleaseBundleDocument } {
  return verifyReleaseBundleArtifactWithEvaluator(run, bundlePath, verifyRunReport, policyReport, invariantReport, certificationRecord, trustRegistry)
}

export function verifyReleaseBundleArtifactWithEvaluator(
  run: RunDetails,
  bundlePath: string,
  verifyRunReport: VerifyRunReport,
  policyReport: RunSnapshot['policyReport'],
  invariantReport: RunSnapshot['invariantReport'],
  certificationRecord: RunSnapshot['certificationRecord'],
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyReleaseBundleReport; document: ReleaseBundleDocument } {
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`Release bundle not found: ${bundlePath}`)
  }

  const document = ReleaseBundleDocumentSchema.parse(
    JSON.parse(fs.readFileSync(bundlePath, 'utf8')),
  )
  const payloadVerification = verifyReleaseBundleDocument(
    document,
    run,
    verifyRunReport,
    policyReport,
    invariantReport,
    run.snapshot.releaseDossier,
    certificationRecord,
    expectedSnapshotDigest,
  )
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'release-bundle',
    payload: serializeReleaseBundleSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Release bundle ${run.snapshot.runId}`,
    checkPrefix: 'release-bundle.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId: run.snapshot.runId,
      bundlePath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

export function verifyCertificationRecordArtifact(
  run: RunDetails,
  recordPath: string,
  expectedPayload: CertificationRecordPayload,
  trustRegistry: TrustRegistryStore,
): { report: VerifyCertificationRecordReport; document: CertificationRecordDocument } {
  return verifyCertificationRecordArtifactWithEvaluator(run, recordPath, expectedPayload, trustRegistry)
}

export function verifyCertificationRecordArtifactWithEvaluator(
  run: RunDetails,
  recordPath: string,
  expectedPayload: CertificationRecordPayload,
  signatureEvaluator: ArtifactSignatureEvaluator,
  /** PR-13: expected snapshot digest for cross-artifact binding */
  expectedSnapshotDigest?: string,
): { report: VerifyCertificationRecordReport; document: CertificationRecordDocument } {
  if (!fs.existsSync(recordPath)) {
    throw new Error(`Certification record not found: ${recordPath}`)
  }

  const document = CertificationRecordDocumentSchema.parse(
    JSON.parse(fs.readFileSync(recordPath, 'utf8')),
  )
  const payloadVerification = verifyCertificationRecordDocument(document, run, expectedPayload, expectedSnapshotDigest)
  const signatureVerification = signatureEvaluator.evaluateHmacSignatureEnvelope({
    scope: 'certification-record',
    payload: serializeCertificationRecordSignable(document),
    signature: document.signature,
    policyId: document.signaturePolicyId,
    subjectLabel: `Certification record ${run.snapshot.runId}`,
    checkPrefix: 'certification-record.signature',
  })
  const issues = [
    ...payloadVerification.issues,
    ...signatureVerification.checks.filter(check => !check.ok).map(check => check.checkId),
  ]

  return {
    document,
    report: {
      runId: run.snapshot.runId,
      recordPath,
      ok: payloadVerification.ok && signatureVerification.ok,
      payloadDigestOk: payloadVerification.payloadDigestOk,
      signatureVerified: signatureVerification.ok,
      signatureRequired: signatureVerification.signatureRequired,
      signaturePolicyId: signatureVerification.policy?.policyId ?? document.signaturePolicyId,
      signatureKeyId: signatureVerification.key?.keyId ?? document.signature?.keyId,
      signatureIssuer: signatureVerification.key?.issuer ?? document.signature?.issuer,
      issues,
      verifiedAt: createISODateTime(),
    },
  }
}

/**
 * PR-13: Verify cross-artifact consistency and compute proof graph digest.
 *
 * This is the production entry point for cross-artifact verification.
 * It takes artifact payloads from a completed verification pass and:
 * 1. Checks all artifacts share the same runId and snapshotDigest
 * 2. Computes a proofGraphDigest binding all artifacts + snapshot
 *
 * Returns the cross-artifact report and the computed proofGraphDigest
 * (undefined if no snapshotDigest is available).
 */
export function verifyArtifactChainConsistency(input: {
  artifacts: CrossArtifactInput[]
  snapshotDigest?: string
}): { crossArtifactReport: CrossArtifactVerificationReport; proofGraphDigest?: string } {
  const crossArtifactReport = verifyCrossArtifactConsistency(input.artifacts)
  let proofGraphDigest: string | undefined
  if (input.snapshotDigest) {
    proofGraphDigest = computeProofGraphDigest({
      snapshotDigest: input.snapshotDigest,
      artifactDigests: input.artifacts.map(a => ({ kind: a.kind, payloadDigest: a.payloadDigest })),
    })
  }
  return { crossArtifactReport, proofGraphDigest }
}
