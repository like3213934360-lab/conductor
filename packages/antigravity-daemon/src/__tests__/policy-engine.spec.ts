import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DaemonPolicyEngine } from '../policy-engine.js'

describe('daemon policy engine', () => {
  let tempDir: string | undefined
  const engine = new DaemonPolicyEngine()

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = undefined
  })

  it('exports a daemon-owned policy pack', () => {
    const pack = engine.exportPack()
    expect(pack.packId).toBe('antigravity-daemon-policy-pack')
    expect(pack.authorityOwner).toBe('antigravity-daemon')
    expect(pack.rules.length).toBeGreaterThanOrEqual(6)
    expect(pack.rules.some(rule => rule.ruleId === 'release.evidence-gate-block')).toBe(true)
  })

  it('blocks preflight when governance denies execution', () => {
    const verdict = engine.evaluatePreflight({
      runId: 'run-1',
      governance: {
        allowed: false,
        worstStatus: 'block',
        findings: [{ ruleId: 'g-1', ruleName: 'test', status: 'block', message: 'blocked by policy' }],
        evaluatedAt: '2026-03-11T00:00:00.000Z',
      },
      drScore: 0.8,
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })

    expect(verdict.scope).toBe('preflight')
    expect(verdict.effect).toBe('block')
    expect(verdict.rationale).toContain('blocked by policy')
  })

  it('warns when a human gate is still required', () => {
    const verdict = engine.evaluateHumanGate({
      runId: 'run-2',
      requirement: {
        required: true,
        reason: 'manual review required',
      },
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })

    expect(verdict.scope).toBe('human-gate')
    expect(verdict.effect).toBe('warn')
    expect(verdict.rationale).toContain('manual review required')
  })

  it('records skip authorization with deterministic node scope', () => {
    const verdict = engine.evaluateSkip({
      runId: 'run-3',
      nodeId: 'DEBATE',
      strategyId: 'adaptive.debate-express.v1',
      triggerCondition: 'PARALLEL.disagreementScore <= 0.5',
      reason: 'parallel consensus is strong enough',
      evidenceIds: ['e-1', 'e-2'],
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })

    expect(verdict.scope).toBe('skip:DEBATE')
    expect(verdict.effect).toBe('allow')
    expect(verdict.evidenceIds).toEqual(['e-1', 'e-2'])
    expect(verdict.rationale[0]).toContain('adaptive.debate-express.v1')
    expect(verdict.rationale[0]).toContain('triggerCondition=PARALLEL.disagreementScore <= 0.5')
  })

  it('blocks when trace bundle integrity or signature verification fails', () => {
    const verdict = engine.evaluateTraceBundle({
      runId: 'run-trace',
      evaluatedAt: '2026-03-12T00:00:00.000Z',
      report: {
        runId: 'run-trace',
        bundlePath: '/tmp/run-trace.trace.json',
        ok: false,
        algorithm: 'sha256',
        actualBundleDigest: 'abc',
        expectedBundleDigest: 'def',
        mismatchedEntries: ['timeline'],
        missingEntries: [],
        signatureVerified: false,
        signatureRequired: true,
        signaturePolicyId: 'trace-bundle-strict',
        signatureKeyId: 'trace-bundle-signing',
        signatureIssuer: 'antigravity-lab',
        failedSignatureChecks: ['trace-bundle.signature.verify'],
        verifiedAt: '2026-03-12T00:00:00.000Z',
      },
    })

    expect(verdict.scope).toBe('trace-bundle')
    expect(verdict.effect).toBe('block')
    expect(verdict.rationale[0]).toContain('timeline')
  })

  it('blocks when release dossier verification fails', () => {
    const verdict = engine.evaluateReleaseDossier({
      runId: 'run-dossier',
      dossierPath: '/tmp/run-dossier.release-dossier.json',
      ok: false,
      signatureVerified: false,
      signatureRequired: true,
      issues: ['releaseArtifacts', 'release-dossier.signature.verify'],
      evaluatedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(verdict.scope).toBe('release-dossier')
    expect(verdict.effect).toBe('block')
    expect(verdict.rationale[0]).toContain('releaseArtifacts')
  })

  it('blocks when release bundle verification fails', () => {
    const verdict = engine.evaluateReleaseBundle({
      runId: 'run-bundle',
      bundlePath: '/tmp/run-bundle.release-bundle.json',
      ok: false,
      signatureVerified: false,
      signatureRequired: true,
      issues: ['releaseDossier', 'release-bundle.signature.verify'],
      evaluatedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(verdict.scope).toBe('release-bundle')
    expect(verdict.effect).toBe('block')
    expect(verdict.rationale[0]).toContain('releaseDossier')
  })

  it('reloads workspace policy-pack.json and changes evaluation behavior', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-policy-pack-'))
    const policyPackPath = path.join(tempDir, 'policy-pack.json')
    fs.writeFileSync(policyPackPath, JSON.stringify({
      packId: 'workspace-policy-pack',
      version: '2026.03.11',
      rules: [
        {
          ruleId: 'preflight.high-disagreement-warning',
          when: { kind: 'gte', fact: 'drScore', value: 0.5 },
          message: 'Initial disagreement score {{drScore}} reached threshold 0.50.',
        },
        {
          ruleId: 'preflight.normal-disagreement',
          when: { kind: 'lt', fact: 'drScore', value: 0.5 },
        },
        {
          ruleId: 'skip.evidence-required',
          enabled: true,
        },
        {
          ruleId: 'resume.actor-required',
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const fileBackedEngine = new DaemonPolicyEngine({ policyPackPath })
    const pack = fileBackedEngine.exportPack()
    expect(pack.packId).toBe('workspace-policy-pack')
    expect(pack.sourcePath).toBe(policyPackPath)
    expect(pack.loadedAt).toBeTypeOf('string')

    const preflightVerdict = fileBackedEngine.evaluatePreflight({
      runId: 'run-4',
      governance: {
        allowed: true,
        worstStatus: 'pass',
        findings: [],
        evaluatedAt: '2026-03-11T00:00:00.000Z',
      },
      drScore: 0.6,
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })
    expect(preflightVerdict.effect).toBe('warn')

    const skipVerdict = fileBackedEngine.evaluateSkip({
      runId: 'run-4',
      nodeId: 'DEBATE',
      strategyId: 'adaptive.debate-express.v1',
      triggerCondition: 'PARALLEL.disagreementScore <= 0.5',
      reason: 'parallel consensus is strong enough',
      evidenceIds: [],
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })
    expect(skipVerdict.effect).toBe('block')

    const resumeVerdict = fileBackedEngine.evaluateResume({
      runId: 'run-4',
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })
    expect(resumeVerdict.effect).toBe('block')
  })
})
