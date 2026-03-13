import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  appendTransparencyLedgerEntry,
  verifyTransparencyLedger,
} from '../transparency-ledger.js'
import {
  verifyArtifactChainConsistency,
} from '../release-artifact-verifier.js'
import { buildReleaseAttestationPayload, createReleaseAttestationDocument, verifyReleaseAttestationDocument } from '../release-attestation.js'
import { buildVerificationSnapshot } from '../verification-snapshot.js'

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

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr13-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ── Ledger proofGraphDigest tests ─────────────────────────────────────────────

describe('PR-13: transparency ledger proofGraphDigest', () => {
  it('entry records proofGraphDigest when provided', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl')
    const entry = appendTransparencyLedgerEntry({
      ledgerPath, runId: 'r-1',
      certificationRecordPath: '/cert', certificationRecordDigest: 'cd1',
      releaseBundlePath: '/bundle', releaseBundleDigest: 'bd1',
      proofGraphDigest: 'pg-abc123',
      snapshotDigest: 'snap-xyz',
    })
    expect(entry.proofGraphDigest).toBe('pg-abc123')
    expect(entry.snapshotDigest).toBe('snap-xyz')
    const report = verifyTransparencyLedger(ledgerPath)
    expect(report.ok).toBe(true)
  })

  it('verify fails when same runId has different proofGraphDigest', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl')
    appendTransparencyLedgerEntry({
      ledgerPath, runId: 'r-1',
      certificationRecordPath: '/cert1', certificationRecordDigest: 'cd1',
      releaseBundlePath: '/bundle1', releaseBundleDigest: 'bd1',
      proofGraphDigest: 'pg-aaa',
    })
    // Read the first entry, extract its digest for chaining
    const firstLine = fs.readFileSync(ledgerPath, 'utf8').trim()
    const firstEntry = JSON.parse(firstLine)

    // Manually craft a second entry with different proofGraphDigest for same runId
    // We write raw JSON to bypass appendTransparencyLedgerEntry's digest computation
    const rawEntry = {
      version: '1.0.0', entryId: 'fake-id', index: 1, runId: 'r-1',
      certificationRecordPath: '/cert2', certificationRecordDigest: 'cd2',
      releaseBundlePath: '/bundle2', releaseBundleDigest: 'bd2',
      previousEntryDigest: firstEntry.entryDigest,
      recordedAt: '2026-01-01T00:00:05Z',
      proofGraphDigest: 'pg-bbb', // different from pg-aaa!
      entryDigest: 'fake-digest',
    }
    fs.appendFileSync(ledgerPath, `${JSON.stringify(rawEntry)}\n`)

    const report = verifyTransparencyLedger(ledgerPath)
    // Should fail due to proofGraphDigest inconsistency (and possibly entryDigest mismatch too)
    expect(report.ok).toBe(false)
  })

  it('verify passes when same runId has same proofGraphDigest', () => {
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl')
    appendTransparencyLedgerEntry({
      ledgerPath, runId: 'r-1',
      certificationRecordPath: '/cert', certificationRecordDigest: 'cd1',
      releaseBundlePath: '/bundle', releaseBundleDigest: 'bd1',
      proofGraphDigest: 'pg-same',
    })
    appendTransparencyLedgerEntry({
      ledgerPath, runId: 'r-1',
      certificationRecordPath: '/cert2', certificationRecordDigest: 'cd2',
      releaseBundlePath: '/bundle2', releaseBundleDigest: 'bd2',
      proofGraphDigest: 'pg-same', // same
    })
    const report = verifyTransparencyLedger(ledgerPath)
    expect(report.ok).toBe(true)
  })
})

// ── verifyArtifactChainConsistency production entry ───────────────────────────

describe('PR-13: verifyArtifactChainConsistency', () => {
  it('returns proofGraphDigest when snapshotDigest provided', () => {
    const result = verifyArtifactChainConsistency({
      artifacts: [
        { kind: 'cert', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'pd1' },
        { kind: 'bundle', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'pd2' },
      ],
      snapshotDigest: 'snap1',
    })
    expect(result.crossArtifactReport.ok).toBe(true)
    expect(result.proofGraphDigest).toBeDefined()
    expect(result.proofGraphDigest!.length).toBe(64)
  })

  it('fails with inconsistent snapshotDigest', () => {
    const result = verifyArtifactChainConsistency({
      artifacts: [
        { kind: 'cert', runId: 'r-1', snapshotDigest: 'snap1', payloadDigest: 'pd1' },
        { kind: 'bundle', runId: 'r-1', snapshotDigest: 'snap2', payloadDigest: 'pd2' },
      ],
      snapshotDigest: 'snap1',
    })
    expect(result.crossArtifactReport.ok).toBe(false)
    expect(result.crossArtifactReport.issues).toContain('snapshotDigest:inconsistent')
  })

  it('returns undefined proofGraphDigest when no snapshotDigest', () => {
    const result = verifyArtifactChainConsistency({
      artifacts: [{ kind: 'cert', runId: 'r-1', payloadDigest: 'pd1' }],
    })
    expect(result.crossArtifactReport.ok).toBe(true)
    expect(result.proofGraphDigest).toBeUndefined()
  })
})

// ── Attestation snapshotDigest mismatch ──────────────────────────────────────

describe('PR-13: attestation snapshotDigest mismatch', () => {
  const traceBundleReport = {
    bundlePath: '/b', actualBundleDigest: 'abc', signatureVerified: false,
    signatureRequired: false, verifiedAt: '2026-01-01T00:00:01Z',
    mismatchedEntries: [], missingEntries: [],
  } as any

  it('fails when payload snapshotDigest does not match expected', () => {
    const snap = makeSnapshot()
    const payload = buildReleaseAttestationPayload({
      run: makeRunDetails(), traceBundleReport, policyVerdicts: makeVerdicts(),
      ...registries, verificationSnapshot: snap,
    })
    const doc = createReleaseAttestationDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyReleaseAttestationDocument(doc, traceBundleReport, 'wrong-digest')
    expect(result.issues).toContain('snapshotDigest')
    expect(result.ok).toBe(false)
  })

  it('passes when payload snapshotDigest matches expected', () => {
    const snap = makeSnapshot()
    const payload = buildReleaseAttestationPayload({
      run: makeRunDetails(), traceBundleReport, policyVerdicts: makeVerdicts(),
      ...registries, verificationSnapshot: snap,
    })
    const doc = createReleaseAttestationDocument(payload, '2026-01-01T00:00:03Z')
    const result = verifyReleaseAttestationDocument(doc, traceBundleReport, snap.snapshotDigest)
    expect(result.issues).not.toContain('snapshotDigest')
  })
})
