import { describe, it, expect } from 'vitest'
import { buildVerificationSnapshot } from '../verification-snapshot.js'
import { buildPolicyReportPayload } from '../policy-report.js'
import { buildInvariantReportPayload } from '../invariant-report.js'
import { buildReleaseAttestationPayload } from '../release-attestation.js'
import { buildReleaseDossierPayload } from '../release-dossier.js'
import { buildReleaseBundlePayload } from '../release-bundle.js'
import { buildCertificationRecordPayload } from '../certification-record.js'

function makeRunDetails() {
  return {
    invocation: { goal: 'test', hostSessionId: 'h1' } as any,
    definition: { workflowId: 'wf-1', version: '1.0', templateName: 'test-wf' } as any,
    snapshot: {
      runId: 'r-1', workflowId: 'wf-1', workflowVersion: '1.0', workflowTemplate: 'test-wf',
      status: 'completed', verdict: 'ok', completedAt: '2026-01-01T00:00:00Z',
      releaseArtifacts: {}, releaseDossier: undefined, policyReport: undefined, invariantReport: undefined,
    } as any,
  }
}

function makeVerifyReport() {
  return {
    runId: 'r-1', ok: true, status: 'completed' as const,
    releaseGateEffect: 'allow' as const, rationale: ['ok'],
    receiptCount: 2, handoffCount: 1, skipDecisionCount: 0,
    missingReceiptNodes: [], missingTribunalNodes: [], tribunalFailures: [],
    missingSkipDecisionNodes: [], missingSkipReceiptNodes: [],
    invariantFailures: [], releaseArtifacts: {}, verifiedAt: '2026-01-01T00:00:01Z',
  }
}

function makeVerdicts() {
  return [
    { verdictId: 'v1', runId: 'r-1', scope: 'preflight', effect: 'allow' as const,
      rationale: ['ok'], evidenceIds: [], evaluatedAt: '2026-01-01T00:00:00Z' },
  ]
}

function makeSnapshot() {
  return buildVerificationSnapshot({
    run: makeRunDetails(), verifyReport: makeVerifyReport(),
    verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
  })
}

const registries = {
  trustRegistry: { registryId: 'tr-1', version: '1.0' } as any,
  benchmarkSourceRegistry: { registryId: 'bsr-1', version: '1.0', trustPolicyId: 'tp-1' } as any,
}

describe('PR-12: builder dual-path — policy-report', () => {
  it('with snapshot: run identity from snapshot + snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildPolicyReportPayload({ run: makeRunDetails(), verdicts: makeVerdicts(), verificationSnapshot: snap })
    expect(payload.run.runId).toBe('r-1')
    expect(payload.run.workflowId).toBe('wf-1')
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
    expect(payload.snapshotDigest!.length).toBe(64)
  })

  it('without snapshot: run identity from run.snapshot + snapshotDigest undefined', () => {
    const payload = buildPolicyReportPayload({ run: makeRunDetails(), verdicts: makeVerdicts() })
    expect(payload.run.runId).toBe('r-1')
    expect(payload.snapshotDigest).toBeUndefined()
  })

  it('both paths produce same run identity', () => {
    const snap = makeSnapshot()
    const withSnap = buildPolicyReportPayload({ run: makeRunDetails(), verdicts: makeVerdicts(), verificationSnapshot: snap })
    const without = buildPolicyReportPayload({ run: makeRunDetails(), verdicts: makeVerdicts() })
    expect(withSnap.run).toEqual(without.run)
  })
})

describe('PR-12: builder dual-path — invariant-report', () => {
  it('with snapshot: snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildInvariantReportPayload({
      run: makeRunDetails(), releaseArtifacts: {}, invariantFailures: [], verificationSnapshot: snap,
    })
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
    expect(payload.run.runId).toBe('r-1')
  })

  it('without snapshot: snapshotDigest undefined', () => {
    const payload = buildInvariantReportPayload({ run: makeRunDetails(), releaseArtifacts: {}, invariantFailures: [] })
    expect(payload.snapshotDigest).toBeUndefined()
  })
})

describe('PR-12: builder dual-path — release-attestation', () => {
  const traceBundleReport = {
    bundlePath: '/b', actualBundleDigest: 'abc', signatureVerified: false,
    signatureRequired: false, verifiedAt: '2026-01-01T00:00:01Z',
    mismatchedEntries: [], missingEntries: [],
  } as any

  it('with snapshot: snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildReleaseAttestationPayload({
      run: makeRunDetails(), traceBundleReport, policyVerdicts: makeVerdicts(),
      ...registries, verificationSnapshot: snap,
    })
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
    expect(payload.runId).toBe('r-1')
  })

  it('without snapshot: snapshotDigest undefined', () => {
    const payload = buildReleaseAttestationPayload({
      run: makeRunDetails(), traceBundleReport, policyVerdicts: makeVerdicts(), ...registries,
    })
    expect(payload.snapshotDigest).toBeUndefined()
  })
})

describe('PR-12: builder dual-path — release-dossier', () => {
  it('with snapshot: snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildReleaseDossierPayload({
      run: makeRunDetails(), verifyRunReport: makeVerifyReport(), policyVerdicts: makeVerdicts(),
      ...registries, verificationSnapshot: snap,
    })
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
  })

  it('without snapshot: snapshotDigest undefined', () => {
    const payload = buildReleaseDossierPayload({
      run: makeRunDetails(), verifyRunReport: makeVerifyReport(), policyVerdicts: makeVerdicts(), ...registries,
    })
    expect(payload.snapshotDigest).toBeUndefined()
  })
})

describe('PR-12: builder dual-path — release-bundle', () => {
  it('with snapshot: snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildReleaseBundlePayload({
      run: makeRunDetails(), verifyRunReport: makeVerifyReport(),
      ...registries, verificationSnapshot: snap,
    })
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
  })

  it('without snapshot: snapshotDigest undefined', () => {
    const payload = buildReleaseBundlePayload({
      run: makeRunDetails(), verifyRunReport: makeVerifyReport(), ...registries,
    })
    expect(payload.snapshotDigest).toBeUndefined()
  })
})

describe('PR-12: builder dual-path — certification-record', () => {
  const releaseBundle = { path: '/rb', payloadDigest: 'xyz' }

  it('with snapshot: snapshotDigest present', () => {
    const snap = makeSnapshot()
    const payload = buildCertificationRecordPayload({
      run: makeRunDetails(), releaseBundle, ...registries,
      blockedScopes: [], remoteWorkers: [], verificationSnapshot: snap,
    })
    expect(payload.snapshotDigest).toBe(snap.snapshotDigest)
    expect(payload.run.runId).toBe('r-1')
  })

  it('without snapshot: snapshotDigest undefined', () => {
    const payload = buildCertificationRecordPayload({
      run: makeRunDetails(), releaseBundle, ...registries,
      blockedScopes: [], remoteWorkers: [],
    })
    expect(payload.snapshotDigest).toBeUndefined()
  })
})
