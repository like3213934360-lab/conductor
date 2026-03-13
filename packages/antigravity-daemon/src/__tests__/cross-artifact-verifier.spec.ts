import { describe, it, expect } from 'vitest'
import {
  verifyCrossArtifactConsistency,
  computeProofGraphDigest,
} from '../cross-artifact-verifier.js'
import { buildVerificationSnapshot } from '../verification-snapshot.js'
import { buildPolicyReportPayload, createPolicyReportDocument, verifyPolicyReportDocument } from '../policy-report.js'
import { buildInvariantReportPayload, createInvariantReportDocument, verifyInvariantReportDocument } from '../invariant-report.js'
import { verifyReleaseDossierDocument } from '../release-dossier.js'

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

// ── Cross-artifact verifier ──────────────────────────────────────────────────

describe('PR-13: verifyCrossArtifactConsistency', () => {
  it('passes with consistent artifacts', () => {
    const snap = makeSnapshot()
    const result = verifyCrossArtifactConsistency([
      { kind: 'policy-report', runId: 'r-1', snapshotDigest: snap.snapshotDigest, payloadDigest: 'a' },
      { kind: 'invariant-report', runId: 'r-1', snapshotDigest: snap.snapshotDigest, payloadDigest: 'b' },
      { kind: 'release-bundle', runId: 'r-1', snapshotDigest: snap.snapshotDigest, payloadDigest: 'c' },
    ])
    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('fails with inconsistent runId', () => {
    const result = verifyCrossArtifactConsistency([
      { kind: 'policy-report', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'a' },
      { kind: 'invariant-report', runId: 'r-2', snapshotDigest: 'snap1', payloadDigest: 'b' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('runId:inconsistent')
  })

  it('fails with inconsistent snapshotDigest', () => {
    const result = verifyCrossArtifactConsistency([
      { kind: 'policy-report', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'a' },
      { kind: 'invariant-report', runId: 'r-1', snapshotDigest: 'snap2', payloadDigest: 'b' },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('snapshotDigest:inconsistent')
  })

  it('passes when some artifacts lack snapshotDigest (legacy)', () => {
    const result = verifyCrossArtifactConsistency([
      { kind: 'policy-report', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'a' },
      { kind: 'invariant-report', runId: 'r-1', payloadDigest: 'b' }, // legacy, no snapshot
    ])
    expect(result.ok).toBe(true)
  })

  it('empty artifacts list is valid', () => {
    expect(verifyCrossArtifactConsistency([]).ok).toBe(true)
  })
})

// ── Proof graph digest ───────────────────────────────────────────────────────

describe('PR-13: computeProofGraphDigest', () => {
  it('produces a deterministic digest', () => {
    const d1 = computeProofGraphDigest({
      snapshotDigest: 'snap1',
      artifactDigests: [{ kind: 'policy-report', payloadDigest: 'a' }, { kind: 'bundle', payloadDigest: 'b' }],
    })
    const d2 = computeProofGraphDigest({
      snapshotDigest: 'snap1',
      artifactDigests: [{ kind: 'policy-report', payloadDigest: 'a' }, { kind: 'bundle', payloadDigest: 'b' }],
    })
    expect(d1).toBe(d2)
    expect(d1.length).toBe(64)
  })

  it('different inputs produce different digests', () => {
    const d1 = computeProofGraphDigest({
      snapshotDigest: 'snap1',
      artifactDigests: [{ kind: 'a', payloadDigest: 'x' }],
    })
    const d2 = computeProofGraphDigest({
      snapshotDigest: 'snap2',
      artifactDigests: [{ kind: 'a', payloadDigest: 'x' }],
    })
    expect(d1).not.toBe(d2)
  })

  it('order-independent (sorted by kind)', () => {
    const d1 = computeProofGraphDigest({
      snapshotDigest: 's',
      artifactDigests: [{ kind: 'b', payloadDigest: '2' }, { kind: 'a', payloadDigest: '1' }],
    })
    const d2 = computeProofGraphDigest({
      snapshotDigest: 's',
      artifactDigests: [{ kind: 'a', payloadDigest: '1' }, { kind: 'b', payloadDigest: '2' }],
    })
    expect(d1).toBe(d2)
  })
})

// ── Individual verifier snapshotDigest checks ────────────────────────────────

describe('PR-13: verifier snapshotDigest checks', () => {
  it('policy report: passes with matching snapshotDigest', () => {
    const snap = makeSnapshot()
    const payload = buildPolicyReportPayload({
      run: makeRunDetails(), verdicts: makeVerdicts(), verificationSnapshot: snap,
    })
    const doc = createPolicyReportDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyPolicyReportDocument(doc, makeRunDetails(), makeVerdicts(), snap.snapshotDigest)
    expect(result.ok).toBe(true)
    expect(result.issues).not.toContain('snapshotDigest')
  })

  it('policy report: fails with mismatched snapshotDigest', () => {
    const snap = makeSnapshot()
    const payload = buildPolicyReportPayload({
      run: makeRunDetails(), verdicts: makeVerdicts(), verificationSnapshot: snap,
    })
    const doc = createPolicyReportDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyPolicyReportDocument(doc, makeRunDetails(), makeVerdicts(), 'wrong-digest')
    expect(result.ok).toBe(false)
    expect(result.issues).toContain('snapshotDigest')
  })

  it('policy report: no snapshotDigest = legacy compatibility (passes)', () => {
    const payload = buildPolicyReportPayload({ run: makeRunDetails(), verdicts: makeVerdicts() })
    const doc = createPolicyReportDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyPolicyReportDocument(doc, makeRunDetails(), makeVerdicts(), 'any-digest')
    expect(result.issues).not.toContain('snapshotDigest')
  })

  it('invariant report: fails with mismatched snapshotDigest', () => {
    const snap = makeSnapshot()
    const payload = buildInvariantReportPayload({
      run: makeRunDetails(), releaseArtifacts: {}, invariantFailures: [], verificationSnapshot: snap,
    })
    const doc = createInvariantReportDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyInvariantReportDocument(doc, makeRunDetails(), {}, [], 'wrong-digest')
    expect(result.issues).toContain('snapshotDigest')
  })
})
