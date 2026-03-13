import { describe, it, expect } from 'vitest'
import {
  buildVerificationSnapshot,
  buildArtifactReference,
  computeSnapshotDigest,
  extractRunIdentity,
  VERIFICATION_SNAPSHOT_VERSION,
  type VerificationSnapshot,
  type ArtifactReference,
  type ArtifactKind,
} from '../verification-snapshot.js'

function makeRunDetails() {
  return {
    invocation: { goal: 'test', hostSessionId: 'h1' } as any,
    definition: { workflowId: 'wf-1', version: '1.0', templateName: 'test-wf' } as any,
    snapshot: { runId: 'r-1', status: 'completed', verdict: 'ok', completedAt: '2026-01-01T00:00:00Z' } as any,
  }
}

function makeVerifyReport() {
  return {
    runId: 'r-1', ok: true, status: 'completed' as const,
    releaseGateEffect: 'allow' as const, rationale: ['all good'],
    receiptCount: 3, handoffCount: 1, skipDecisionCount: 0,
    missingReceiptNodes: [], missingTribunalNodes: [], tribunalFailures: [],
    missingSkipDecisionNodes: [], missingSkipReceiptNodes: [],
    invariantFailures: [], releaseArtifacts: {}, verifiedAt: '2026-01-01T00:00:01Z',
  }
}

function makeVerdicts() {
  return [
    { verdictId: 'v1', runId: 'r-1', scope: 'preflight', effect: 'allow' as const,
      rationale: ['ok'], evidenceIds: [], evaluatedAt: '2026-01-01T00:00:00Z' },
    { verdictId: 'v2', runId: 'r-1', scope: 'release', effect: 'allow' as const,
      rationale: ['released'], evidenceIds: ['e1'], evaluatedAt: '2026-01-01T00:00:01Z' },
  ]
}

describe('PR-12: VerificationSnapshot', () => {
  it('builds a valid snapshot with all fields', () => {
    const snap = buildVerificationSnapshot({
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    })
    expect(snap.version).toBe(VERIFICATION_SNAPSHOT_VERSION)
    expect(snap.run.runId).toBe('r-1')
    expect(snap.run.workflowId).toBe('wf-1')
    expect(snap.run.status).toBe('completed')
    expect(snap.verification.ok).toBe(true)
    expect(snap.verification.receiptCount).toBe(3)
    expect(snap.verdicts).toHaveLength(2)
    expect(snap.snapshotDigest).toBeTruthy()
    expect(snap.snapshotDigest.length).toBe(64) // sha256 hex
  })

  it('produces stable digest for same inputs', () => {
    const input = {
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    }
    const snap1 = buildVerificationSnapshot(input)
    const snap2 = buildVerificationSnapshot(input)
    expect(snap1.snapshotDigest).toBe(snap2.snapshotDigest)
  })

  it('produces different digest for different inputs', () => {
    const base = {
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    }
    const snap1 = buildVerificationSnapshot(base)
    const modified = { ...base, generatedAt: '2026-01-02T00:00:00Z' }
    const snap2 = buildVerificationSnapshot(modified)
    expect(snap1.snapshotDigest).not.toBe(snap2.snapshotDigest)
  })

  it('can be serialized to JSON and back', () => {
    const snap = buildVerificationSnapshot({
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    })
    const json = JSON.stringify(snap)
    const parsed = JSON.parse(json) as VerificationSnapshot
    expect(parsed.run.runId).toBe('r-1')
    expect(parsed.snapshotDigest).toBe(snap.snapshotDigest)
  })
})

describe('PR-12: ArtifactReference', () => {
  it('builds a valid reference', () => {
    const ref = buildArtifactReference('policy-report', 'abc123', '1.0.0', 'snap-digest')
    expect(ref.kind).toBe('policy-report')
    expect(ref.payloadDigest).toBe('abc123')
    expect(ref.version).toBe('1.0.0')
    expect(ref.snapshotDigest).toBe('snap-digest')
  })

  it('all artifact kinds are valid', () => {
    const kinds: ArtifactKind[] = [
      'policy-report', 'invariant-report', 'release-attestation',
      'release-dossier', 'release-bundle', 'certification-record', 'trace-bundle',
    ]
    const snap = buildVerificationSnapshot({
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    })
    const refs = kinds.map(k => buildArtifactReference(k, `digest-${k}`, '1.0.0', snap.snapshotDigest))
    expect(refs).toHaveLength(7)
    // All share same snapshot digest
    for (const ref of refs) {
      expect(ref.snapshotDigest).toBe(snap.snapshotDigest)
    }
  })
})

describe('PR-12: extractRunIdentity', () => {
  it('extracts run identity from snapshot', () => {
    const snap = buildVerificationSnapshot({
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    })
    const identity = extractRunIdentity(snap)
    expect(identity.runId).toBe('r-1')
    expect(identity.workflowId).toBe('wf-1')
    expect(identity.workflowVersion).toBe('1.0')
    expect(identity.workflowTemplate).toBe('test-wf')
  })

  it('returned identity is a copy (not aliased)', () => {
    const snap = buildVerificationSnapshot({
      run: makeRunDetails(), verifyReport: makeVerifyReport(),
      verdicts: makeVerdicts(), generatedAt: '2026-01-01T00:00:02Z',
    })
    const identity = extractRunIdentity(snap)
    identity.status = 'modified'
    expect(snap.run.status).toBe('completed') // unchanged
  })
})

describe('PR-12: computeSnapshotDigest', () => {
  it('produces deterministic hex digest', () => {
    const content = { a: 1, b: 'test' }
    const d1 = computeSnapshotDigest(content)
    const d2 = computeSnapshotDigest(content)
    expect(d1).toBe(d2)
    expect(d1.length).toBe(64)
  })
})
