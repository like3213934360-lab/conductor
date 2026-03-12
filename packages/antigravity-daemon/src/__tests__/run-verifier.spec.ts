import { describe, expect, it } from 'vitest'
import { buildReleaseArtifactsSummary, createVerifyRunReport } from '../run-verifier.js'

describe('run verifier', () => {
  it('merges trace bundle and release attestation reports into releaseArtifacts', () => {
    const releaseArtifacts = buildReleaseArtifactsSummary({
      existing: {},
      traceBundleReport: {
        runId: 'run-1',
        bundlePath: '/tmp/run-1.trace.json',
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
      releaseAttestationReport: {
        runId: 'run-1',
        attestationPath: '/tmp/run-1.release-attestation.json',
        ok: true,
        payloadDigestOk: true,
        signatureVerified: true,
        signatureRequired: true,
        signaturePolicyId: 'release-attestation-strict',
        signatureKeyId: 'release-attestation-signing',
        signatureIssuer: 'antigravity-lab',
        issues: [],
        verifiedAt: '2026-03-12T00:00:01.000Z',
      },
    })

    expect(releaseArtifacts.traceBundle?.path).toBe('/tmp/run-1.trace.json')
    expect(releaseArtifacts.traceBundle?.integrityOk).toBe(false)
    expect(releaseArtifacts.traceBundle?.issues).toContain('timeline')
    expect(releaseArtifacts.releaseAttestation?.path).toBe('/tmp/run-1.release-attestation.json')
    expect(releaseArtifacts.releaseAttestation?.verified).toBe(true)
  })

  it('fails verification when invariants or release artifact issues exist', () => {
    const report = createVerifyRunReport({
      run: {
        invocation: {
          workflowId: 'antigravity.strict-full',
          workflowVersion: '1.0.0',
          goal: 'test',
          files: [],
          initiator: 'test',
          workspaceRoot: '/tmp/project',
          triggerSource: 'command',
          forceFullPath: true,
          options: {},
          metadata: {},
        },
        definition: {
          workflowId: 'antigravity.strict-full',
          version: '1.0.0',
          templateName: 'antigravity.strict-full.v1',
          authorityMode: 'daemon-owned',
          generatedAt: '2026-03-12T00:00:00.000Z',
          description: 'test',
          steps: [],
        },
        snapshot: {
          runId: 'run-1',
          goal: 'test',
          workflowId: 'antigravity.strict-full',
          workflowVersion: '1.0.0',
          workflowTemplate: 'antigravity.strict-full.v1',
          authorityOwner: 'antigravity-daemon',
          authorityHost: 'antigravity',
          workspaceRoot: '/tmp/project',
          status: 'completed',
          phase: 'COMPLETED',
          nodes: {},
          runtimeState: null,
          releaseArtifacts: {},
          timelineCursor: 0,
          createdAt: '2026-03-12T00:00:00.000Z',
          updatedAt: '2026-03-12T00:00:00.000Z',
        },
      },
      releaseDecision: { effect: 'allow', rationale: [], evidenceIds: [] },
      receiptCount: 0,
      handoffCount: 0,
      skipDecisionCount: 0,
      missingReceiptNodes: [],
      missingTribunalNodes: [],
      tribunalFailures: [],
      missingSkipDecisionNodes: [],
      missingSkipReceiptNodes: [],
      releaseArtifacts: {
        traceBundle: {
          path: '/tmp/run-1.trace.json',
          integrityOk: false,
          issues: ['timeline'],
        },
      },
      timeline: [],
      verifiedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(report.ok).toBe(false)
    expect(report.invariantFailures).toContain('terminal.completedAt')
    expect(report.releaseArtifacts.traceBundle?.issues).toContain('timeline')
  })
})
