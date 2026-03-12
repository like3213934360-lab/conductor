import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BenchmarkHarness } from '../benchmark-harness.js'
import { signBenchmarkSourceRegistryPayload } from '../benchmark-source-registry.js'
import { createCertificationRecordDocument, serializeCertificationRecordSignable } from '../certification-record.js'
import { createReleaseAttestationDocument, serializeReleaseAttestationSignable } from '../release-attestation.js'
import { buildTraceBundleIntegrity, canonicalJsonStringify } from '../trace-bundle-integrity.js'

const AGENT_CARD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('benchmark harness', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTIGRAVITY_TRUST_KEY')) {
        delete process.env[key]
      }
    }
    tempDir = undefined
  })

  it('runs the built-in benchmark suites with the default manifest', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-harness-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')
    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'default-pack', version: '1.0.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'stream', supportedResponseModes: ['stream', 'poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, path.join(dataDir, 'benchmark-manifest.json'))

    const report = await harness.run({ suiteIds: [], caseIds: [], datasetSources: [] })

    expect(report.harnessId).toBe('antigravity-daemon-benchmark-harness')
    expect(report.ok).toBe(true)
    expect(report.suites.length).toBeGreaterThanOrEqual(5)
    expect(report.totalCases).toBeGreaterThanOrEqual(3)
    expect(report.passedCases).toBe(report.totalCases)
    expect(report.totalChecks).toBe(report.passedChecks)
    expect(report.caseIds).toContain('strict-full-canonical-graph')
    expect(report.suiteIds).toContain('workflow-dataset-cases')
  })

  it('loads workspace benchmark datasets and limits execution to selected suites and cases', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-manifest-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')
    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [
        {
          suiteId: 'workflow-dataset-cases',
          name: 'Workspace Dataset Cases',
        },
      ],
    }, null, 2), 'utf8')
    const datasetPath = path.join(dataDir, 'benchmark-dataset.json')
    fs.writeFileSync(datasetPath, JSON.stringify({
      datasetId: 'workspace-dataset',
      version: '2026.03.11',
      cases: [
        {
          caseKind: 'compiledWorkflow',
          caseId: 'workspace-adaptive-case',
          name: 'Workspace Adaptive Case',
          workflowId: 'antigravity.adaptive',
          goal: 'Compile the adaptive workflow from the workspace dataset.',
          expectedTemplate: 'antigravity.adaptive.v1',
          requiredNodeIds: ['ANALYZE', 'VERIFY', 'HITL'],
          requiredApprovalGateIds: ['antigravity-final-gate'],
          expectDebateSkippable: true,
          expectedDebateStrategyId: 'adaptive.debate-express.v1',
          tags: ['workspace', 'adaptive'],
        },
      ],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0', sourcePath: path.join(dataDir, 'policy-pack.json') }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'poll', supportedResponseModes: ['poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['workspace-adaptive-case'],
      datasetSources: [],
    })

    expect(report.harnessId).toBe('workspace-harness')
    expect(report.manifestVersion).toBe('2026.03.11')
    expect(report.sourcePath).toBe(manifestPath)
    expect(report.suites).toHaveLength(1)
    expect(report.suites[0]?.name).toBe('Workspace Dataset Cases')
    expect(report.suites[0]?.suiteId).toBe('workflow-dataset-cases')
    expect(report.suites[0]?.totalCases).toBe(1)
    expect(report.suites[0]?.passedCases).toBe(1)
    expect(report.suites[0]?.cases).toHaveLength(1)
    expect(report.suites[0]?.cases[0]?.caseId).toBe('workspace-adaptive-case')
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetSourcePath']).toBe(datasetPath)
    expect(report.caseIds).toEqual(['workspace-adaptive-case'])
  })

  it('evaluates trace bundle dataset cases against exported daemon evidence', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-trace-bundle-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const traceBundlePath = path.join(tempDir, 'fixtures', 'trace-bundles', 'adaptive-run.trace.json')
    fs.mkdirSync(path.dirname(traceBundlePath), { recursive: true })
    const traceBundle = {
      run: {
        snapshot: {
          status: 'completed',
          workflowTemplate: 'antigravity.adaptive.v1',
          authorityOwner: 'antigravity-daemon',
          authorityHost: 'antigravity',
          nodes: {
            ANALYZE: { status: 'completed' },
            PARALLEL: { status: 'completed' },
            DEBATE: { status: 'policy_skipped' },
            VERIFY: { status: 'completed' },
            SYNTHESIZE: { status: 'completed' },
            PERSIST: { status: 'completed' },
            HITL: { status: 'completed' },
          },
        },
      },
      timeline: [
        { kind: 'run.started' },
        { kind: 'node.started' },
        { kind: 'run.completed' },
      ],
      receipts: [
        { nodeId: 'ANALYZE' },
        { nodeId: 'PARALLEL' },
        { nodeId: 'DEBATE' },
      ],
      tribunals: [
        {
          nodeId: 'PARALLEL',
          mode: 'remote',
          quorumSatisfied: true,
          verdict: 'agree',
          confidence: 0.92,
        },
        {
          nodeId: 'VERIFY',
          mode: 'remote',
          quorumSatisfied: true,
          verdict: 'agree',
          confidence: 0.9,
        },
      ],
      verdicts: [
        { scope: 'preflight' },
        { scope: 'release' },
      ],
      remoteWorkers: {
        workers: [
          {
            id: 'w-1',
            selectedResponseMode: 'stream',
            taskProtocolSource: 'agent-card',
            agentCardSha256: AGENT_CARD_SHA,
            agentCardSchemaVersion: 'a2a.agent-card.v1',
            agentCardAdvertisementSignatureKeyId: 'benchmark-signing',
            agentCardAdvertisementSignatureIssuer: 'antigravity-lab',
            agentCardAdvertisementSignedAt: '2026-03-11T00:00:00.000Z',
            verification: { summary: 'verified' },
          },
        ],
      },
    } as const
    const integrity = buildTraceBundleIntegrity({
      manifest: undefined,
      policyPack: undefined,
      trustRegistry: undefined,
      benchmarkSourceRegistry: undefined,
      remoteWorkers: traceBundle.remoteWorkers,
      run: traceBundle.run,
      events: undefined,
      checkpoints: undefined,
      timeline: traceBundle.timeline,
      receipts: traceBundle.receipts,
      tribunals: traceBundle.tribunals,
      handoffs: undefined,
      skips: undefined,
      verdicts: traceBundle.verdicts,
    }, '2026-03-11T00:00:00.000Z')
    const signatureSecret = 'trace-bundle-secret'
    const signature = crypto.createHmac('sha256', signatureSecret)
      .update(canonicalJsonStringify(integrity))
      .digest('hex')
    fs.writeFileSync(traceBundlePath, JSON.stringify({
      ...traceBundle,
      integrity,
      signaturePolicyId: 'trace-bundle-strict',
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'trace-bundle-signing',
        issuer: 'antigravity-lab',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature,
      },
    }, null, 2), 'utf8')
    const attestationPath = path.join(tempDir, 'fixtures', 'attestations', 'adaptive-run.release-attestation.json')
    fs.mkdirSync(path.dirname(attestationPath), { recursive: true })
    const attestationSecret = 'release-attestation-secret'
    const attestationBase = createReleaseAttestationDocument({
      runId: 'adaptive-run',
      workflowId: 'antigravity.adaptive',
      workflowVersion: '1.0.0',
      workflowTemplate: 'antigravity.adaptive.v1',
      status: 'completed',
      traceBundle: {
        bundlePath: traceBundlePath,
        actualBundleDigest: integrity.bundleDigest,
        expectedBundleDigest: integrity.bundleDigest,
        signatureVerified: true,
        signatureRequired: true,
        signaturePolicyId: 'trace-bundle-strict',
        signatureKeyId: 'trace-bundle-signing',
        signatureIssuer: 'antigravity-lab',
        verifiedAt: '2026-03-11T00:00:00.000Z',
      },
      policyVerdicts: [
        { verdictId: 'v1', scope: 'preflight', effect: 'allow', evidenceIds: [], rationale: ['ok'], evaluatedAt: '2026-03-11T00:00:00.000Z' },
        { verdictId: 'v2', scope: 'release', effect: 'allow', evidenceIds: [], rationale: ['ok'], evaluatedAt: '2026-03-11T00:00:00.000Z' },
      ],
      trustRegistry: { registryId: 'workspace-trust-registry', version: '2026.03.11' },
      benchmarkSourceRegistry: { registryId: 'workspace-source-registry', version: '2026.03.11', trustPolicyId: 'benchmark-registry-strict' },
    }, '2026-03-11T00:00:00.000Z')
    fs.writeFileSync(attestationPath, JSON.stringify({
      ...attestationBase,
      signaturePolicyId: 'release-attestation-strict',
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'release-attestation-signing',
        issuer: 'antigravity-lab',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature: crypto.createHmac('sha256', attestationSecret)
          .update(serializeReleaseAttestationSignable(attestationBase))
          .digest('hex'),
      },
    }, null, 2), 'utf8')
    const certificationPath = path.join(tempDir, 'fixtures', 'certifications', 'adaptive-run.certification-record.json')
    fs.mkdirSync(path.dirname(certificationPath), { recursive: true })
    const certificationSecret = 'certification-record-secret'
    const certificationBase = createCertificationRecordDocument({
      run: {
        runId: 'adaptive-run',
        workflowId: 'antigravity.adaptive',
        workflowVersion: '1.0.0',
        workflowTemplate: 'antigravity.adaptive.v1',
        status: 'completed',
        verdict: 'completed',
        completedAt: '2026-03-11T00:00:00.000Z',
      },
      releaseBundle: {
        path: 'fixtures/bundles/adaptive-run.release-bundle.json',
        payloadDigest: 'bundle-digest',
        signaturePolicyId: 'release-bundle-strict',
        signatureKeyId: 'release-bundle-signing',
        signatureIssuer: 'antigravity-lab',
      },
      releaseDossier: { path: 'fixtures/dossiers/adaptive-run.release-dossier.json', issues: [] },
      releaseArtifacts: {
        traceBundle: { path: 'fixtures/trace-bundles/adaptive-run.trace.json', issues: [] },
        releaseAttestation: { path: 'fixtures/attestations/adaptive-run.release-attestation.json', issues: [] },
      },
      policyReport: { path: 'fixtures/policy/adaptive-run.policy-report.json', issues: [] },
      invariantReport: { path: 'fixtures/invariants/adaptive-run.invariant-report.json', issues: [] },
      trustRegistry: { registryId: 'workspace-trust-registry', version: '2026.03.11' },
      benchmarkSourceRegistry: { registryId: 'workspace-source-registry', version: '2026.03.11', trustPolicyId: 'benchmark-registry-strict' },
      remoteWorkers: [{ workerId: 'w-1', agentCardSha256: AGENT_CARD_SHA, verificationSummary: 'verified' }],
      governance: { finalVerdict: 'completed', releaseGateEffect: 'allow', blockedScopes: [] },
    }, '2026-03-11T00:00:00.000Z')
    fs.writeFileSync(certificationPath, JSON.stringify({
      ...certificationBase,
      signaturePolicyId: 'certification-record-strict',
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'certification-record-signing',
        issuer: 'antigravity-lab',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature: crypto.createHmac('sha256', certificationSecret)
          .update(serializeCertificationRecordSignable(certificationBase))
          .digest('hex'),
      },
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [
        { suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' },
      ],
    }, null, 2), 'utf8')

    const datasetPath = path.join(dataDir, 'benchmark-dataset.json')
    fs.writeFileSync(datasetPath, JSON.stringify({
      datasetId: 'workspace-dataset',
      version: '2026.03.11',
      cases: [
        {
          caseKind: 'traceBundle',
          caseId: 'workspace-trace-bundle-case',
          name: 'Workspace Trace Bundle Case',
          sourcePath: 'fixtures/trace-bundles/adaptive-run.trace.json',
          releaseAttestationPath: 'fixtures/attestations/adaptive-run.release-attestation.json',
          certificationRecordPath: 'fixtures/certifications/adaptive-run.certification-record.json',
          expectedRunStatus: 'completed',
          expectedWorkflowTemplate: 'antigravity.adaptive.v1',
          minExecutionReceipts: 3,
          minTimelineEntries: 3,
          minPolicyVerdicts: 2,
          requiredTimelineKinds: ['run.started', 'run.completed'],
          requiredPolicyScopes: ['preflight', 'release'],
          requiredNodeStatuses: {
            DEBATE: 'policy_skipped',
            HITL: 'completed',
          },
          requiredRemoteWorkerResponseModes: ['stream'],
          requireTraceBundleIntegrity: true,
          requireSignedTraceBundle: true,
          requiredTraceBundleSignatureKeyIds: ['trace-bundle-signing'],
          requiredTraceBundleSignatureIssuers: ['antigravity-lab'],
          requiredTraceBundleSignaturePolicyId: 'trace-bundle-strict',
          requireReleaseAttestation: true,
          requireSignedReleaseAttestation: true,
          requiredReleaseAttestationSignatureKeyIds: ['release-attestation-signing'],
          requiredReleaseAttestationSignatureIssuers: ['antigravity-lab'],
          requiredReleaseAttestationSignaturePolicyId: 'release-attestation-strict',
          requireCertificationRecord: true,
          requireSignedCertificationRecord: true,
          requiredCertificationRecordSignatureKeyIds: ['certification-record-signing'],
          requiredCertificationRecordSignatureIssuers: ['antigravity-lab'],
          requiredCertificationRecordSignaturePolicyId: 'certification-record-strict',
          requireAgentCardDigests: true,
          requiredAgentCardSchemaVersions: ['a2a.agent-card.v1'],
          requireSignedAgentCardAdvertisements: true,
          requiredAgentCardAdvertisementKeyIds: ['benchmark-signing'],
          requiredAgentCardAdvertisementIssuers: ['antigravity-lab'],
          tags: ['workspace', 'trace-bundle'],
        },
      ],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '2.0.0', sourcePath: path.join(dataDir, 'policy-pack.json') }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'stream', supportedResponseModes: ['stream', 'poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
      verifyReleaseAttestationArtifact: () => ({
        ok: true,
        signatureVerified: true,
        signatureRequired: true,
        signaturePolicyId: 'release-attestation-strict',
        signatureKeyId: 'release-attestation-signing',
        signatureIssuer: 'antigravity-lab',
        issues: [],
      }),
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['workspace-trace-bundle-case'],
      datasetSources: [],
    })

    expect(report.ok).toBe(true)
    expect(report.suites[0]?.cases).toHaveLength(1)
    expect(report.suites[0]?.cases[0]?.caseId).toBe('workspace-trace-bundle-case')
    expect(report.suites[0]?.cases[0]?.metadata?.['sourcePath']).toBe(traceBundlePath)
    expect(report.suites[0]?.cases[0]?.metadata?.['caseKind']).toBe('traceBundle')
  })

  it('ingests manifest-configured external dataset files and namespaces colliding case ids', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-external-manifest-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    fs.writeFileSync(path.join(dataDir, 'benchmark-dataset.json'), JSON.stringify({
      datasetId: 'workspace-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'shared-case',
        name: 'Workspace Shared Case',
        workflowId: 'antigravity.strict-full',
        goal: 'Compile the strict workflow from the workspace dataset.',
      }],
    }, null, 2), 'utf8')

    const externalDatasetPath = path.join(fixturesDir, 'external-dataset.json')
    fs.writeFileSync(externalDatasetPath, JSON.stringify({
      datasetId: 'external-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'shared-case',
        name: 'External Shared Case',
        workflowId: 'antigravity.adaptive',
        goal: 'Compile the adaptive workflow from an external manifest dataset.',
      }],
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: [{ location: path.relative(tempDir, externalDatasetPath) }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'poll', supportedResponseModes: ['poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: [],
      datasetSources: [],
    })

    const cases = report.suites[0]?.cases ?? []
    expect(cases).toHaveLength(2)
    expect(cases.some(testCase => testCase.caseId === 'shared-case')).toBe(true)
    const externalCase = cases.find(testCase => testCase.caseId !== 'shared-case')
    expect(externalCase?.caseId).toMatch(/shared-case/)
    expect(externalCase?.metadata?.['sourceCaseId']).toBe('shared-case')
    expect(externalCase?.metadata?.['datasetSourceKind']).toBe('manifest-source')
  })

  it('resolves manifest dataset sources through the workspace source registry', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-registry-manifest-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const registryDatasetPath = path.join(fixturesDir, 'registry-dataset.json')
    fs.writeFileSync(registryDatasetPath, JSON.stringify({
      datasetId: 'registry-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'registry-case',
        name: 'Registry Case',
        workflowId: 'antigravity.adaptive',
        goal: 'Compile an adaptive workflow from the source registry.',
      }],
    }, null, 2), 'utf8')

    fs.writeFileSync(path.join(dataDir, 'benchmark-source-registry.json'), JSON.stringify({
      registryId: 'workspace-source-registry',
      version: '2026.03.11',
      sources: [{
        sourceId: 'catalog-adaptive',
        location: path.relative(tempDir, registryDatasetPath),
        expectedDatasetId: 'registry-dataset',
        expectedVersion: '2026.03.11',
      }],
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: ['registry:catalog-adaptive'],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'poll', supportedResponseModes: ['poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['registry-case'],
      datasetSources: [],
    })

    expect(report.ok).toBe(true)
    expect(report.suites[0]?.cases[0]?.caseId).toBe('registry-case')
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetSourceId']).toBe('catalog-adaptive')
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetSourceKind']).toBe('manifest-source')
  })

  it('ingests request-scoped remote dataset sources with version pinning and HTTP revalidation', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-remote-request-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const datasetBody = JSON.stringify({
      datasetId: 'remote-http-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'remote-http-case',
        name: 'Remote HTTP Case',
        workflowId: 'antigravity.adaptive',
        goal: 'Compile an adaptive workflow from a remote HTTP dataset.',
      }],
    })
    const datasetSha256 = crypto.createHash('sha256').update(datasetBody).digest('hex')
    const etag = '"remote-http-dataset-v1"'
    const seenRequestHeaders: string[] = []
    const remoteDatasetUrl = 'http://benchmark.local/benchmark-dataset.json'
    const datasetTransport = async (request: {
      conditionalHeaders?: { etag?: string }
    }) => {
      seenRequestHeaders.push(String(request.conditionalHeaders?.etag ?? ''))
      if (request.conditionalHeaders?.etag === etag) {
        return {
          statusCode: 304,
          headers: { etag },
          rawText: '',
        }
      }
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          etag,
          'last-modified': 'Wed, 11 Mar 2026 10:00:00 GMT',
        },
        rawText: datasetBody,
      }
    }

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'stream', supportedResponseModes: ['stream', 'poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
      getBenchmarkDatasetTransport: () => datasetTransport,
    }, manifestPath)

    const source = {
      sourceId: 'remote-http-source',
      location: remoteDatasetUrl,
      expectedDatasetId: 'remote-http-dataset',
      expectedVersion: '2026.03.11',
      expectedSha256: datasetSha256,
      cacheTtlMs: 0,
    }

    const firstReport = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['remote-http-case'],
      datasetSources: [source],
    })

    const secondReport = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['remote-http-case'],
      datasetSources: [source],
    })

    expect(firstReport.ok).toBe(true)
    expect(firstReport.caseIds).toEqual(['remote-http-case'])
    expect(firstReport.suites[0]?.cases[0]?.metadata?.['datasetSourceKind']).toBe('request-source')
    expect(firstReport.suites[0]?.cases[0]?.metadata?.['datasetSourceLocation']).toBe(remoteDatasetUrl)
    expect(firstReport.suites[0]?.cases[0]?.metadata?.['datasetSourceCacheStatus']).toBe('miss')
    expect(firstReport.suites[0]?.cases[0]?.metadata?.['datasetSourceIntegritySha256']).toBe(datasetSha256)
    expect(secondReport.ok).toBe(true)
    expect(secondReport.suites[0]?.cases[0]?.metadata?.['datasetSourceCacheStatus']).toBe('revalidated')
    expect(seenRequestHeaders.some(header => header === etag)).toBe(true)
  })

  it('surfaces optional external dataset failures as observable issue cases without failing the suite', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-optional-source-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: [{
        sourceId: 'missing-optional',
        location: 'fixtures/missing-dataset.json',
        required: false,
      }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['dataset-source:missing-optional'],
      datasetSources: [],
    })

    expect(report.ok).toBe(true)
    expect(report.suites[0]?.cases[0]?.ok).toBe(true)
    expect(report.suites[0]?.cases[0]?.checks[0]?.message).toMatch(/Optional dataset source/)
  })

  it('surfaces missing registry references as dataset issue cases with registry evidence', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-missing-registry-ref-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const registryPath = path.join(dataDir, 'benchmark-source-registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-source-registry',
      version: '2026.03.11',
      sources: [],
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: ['registry:missing-pack'],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['dataset-source:manifest-source:1-missing-pack'],
      datasetSources: [],
    })

    expect(report.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.metadata?.['registryRef']).toBe('missing-pack')
    expect(report.suites[0]?.cases[0]?.metadata?.['registryPath']).toBe(registryPath)
    expect(report.suites[0]?.cases[0]?.checks[0]?.message).toMatch(/registry entry not found/)
  })

  it('loads signed locked registry dataset sources when registry provenance is verified', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-signed-registry-ref-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const externalDatasetPath = path.join(fixturesDir, 'gaia-lite-dataset.json')
    fs.writeFileSync(externalDatasetPath, JSON.stringify({
      datasetId: 'gaia-lite',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'gaia-lite-case',
        name: 'GAIA Lite Case',
        workflowId: 'antigravity.strict-full',
        goal: 'Compile a strict workflow from a signed registry dataset source.',
      }],
    }, null, 2), 'utf8')

    const registrySecret = 'signed-registry-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_REGISTRY_TEST = registrySecret
    fs.writeFileSync(path.join(dataDir, 'trust-registry.json'), JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'registry-test',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REGISTRY_TEST',
          scopes: ['benchmark-source-registry'],
          status: 'active',
        },
      ],
      signerPolicies: [
        {
          policyId: 'benchmark-registry-strict',
          scope: 'benchmark-source-registry',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedKeyIds: ['registry-test'],
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')
    const registryFile = {
      registryId: 'workspace-source-registry',
      version: '2026.03.11',
      trustPolicyId: 'benchmark-registry-strict',
      sources: [
        {
          sourceId: 'gaia-lite',
          location: path.relative(tempDir, externalDatasetPath),
          expectedDatasetId: 'gaia-lite',
          expectedVersion: '2026.03.11',
          locked: true,
        },
      ],
    }
    const signature = signBenchmarkSourceRegistryPayload(registryFile, registrySecret)
    fs.writeFileSync(path.join(dataDir, 'benchmark-source-registry.json'), JSON.stringify({
      ...registryFile,
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'registry-test',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature,
      },
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: ['registry:gaia-lite'],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['gaia-lite-case'],
      datasetSources: [],
    })

    expect(report.ok).toBe(true)
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetSourceId']).toBe('gaia-lite')
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetId']).toBe('gaia-lite')
  })

  it('blocks unsigned locked registry dataset sources as dataset issue cases', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-unsigned-locked-registry-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const externalDatasetPath = path.join(fixturesDir, 'gaia-lite-dataset.json')
    fs.writeFileSync(externalDatasetPath, JSON.stringify({
      datasetId: 'gaia-lite',
      version: '2026.03.11',
      cases: [],
    }, null, 2), 'utf8')

    const registryPath = path.join(dataDir, 'benchmark-source-registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-source-registry',
      version: '2026.03.11',
      trustPolicyId: 'default:benchmark-source-registry',
      sources: [
        {
          sourceId: 'gaia-lite',
          location: path.relative(tempDir, externalDatasetPath),
          expectedDatasetId: 'gaia-lite',
          expectedVersion: '2026.03.11',
          locked: true,
        },
      ],
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
      datasetSources: ['registry:gaia-lite'],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['dataset-source:gaia-lite'],
      datasetSources: [],
    })

    expect(report.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.metadata?.['registryRef']).toBe('gaia-lite')
    expect(report.suites[0]?.cases[0]?.metadata?.['registryPath']).toBe(registryPath)
    expect(report.suites[0]?.cases[0]?.checks[0]?.message).toMatch(/requires a verified benchmark source registry/)
  })

  it('rejects forbidden overrides for locked registry dataset sources', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-locked-registry-overrides-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const externalDatasetPath = path.join(fixturesDir, 'gaia-lite-dataset.json')
    fs.writeFileSync(externalDatasetPath, JSON.stringify({
      datasetId: 'gaia-lite',
      version: '2026.03.11',
      cases: [],
    }, null, 2), 'utf8')

    const registrySecret = 'signed-registry-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_LOCKED_OVERRIDES = registrySecret
    fs.writeFileSync(path.join(dataDir, 'trust-registry.json'), JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'locked-overrides',
          envVar: 'ANTIGRAVITY_TRUST_KEY_LOCKED_OVERRIDES',
          scopes: ['benchmark-source-registry'],
          status: 'active',
        },
      ],
      signerPolicies: [
        {
          policyId: 'benchmark-registry-strict',
          scope: 'benchmark-source-registry',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedKeyIds: ['locked-overrides'],
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')
    const registryFile = {
      registryId: 'workspace-source-registry',
      version: '2026.03.11',
      trustPolicyId: 'benchmark-registry-strict',
      sources: [
        {
          sourceId: 'gaia-lite',
          location: path.relative(tempDir, externalDatasetPath),
          expectedDatasetId: 'gaia-lite',
          expectedVersion: '2026.03.11',
          locked: true,
        },
      ],
    }
    fs.writeFileSync(path.join(dataDir, 'benchmark-source-registry.json'), JSON.stringify({
      ...registryFile,
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'locked-overrides',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature: signBenchmarkSourceRegistryPayload(registryFile, registrySecret),
      },
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['dataset-source:gaia-lite'],
      datasetSources: [{
        registryRef: 'gaia-lite',
        expectedVersion: '2099.01.01',
      }],
    })

    expect(report.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.metadata?.['registryRef']).toBe('gaia-lite')
    expect(report.suites[0]?.cases[0]?.checks[0]?.message).toMatch(/does not allow overrides for expectedVersion/)
  })

  it('falls back to a stale cached dataset when a remote source becomes unavailable', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-stale-cache-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const datasetBody = JSON.stringify({
      datasetId: 'stale-cache-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'stale-cache-case',
        name: 'Stale Cache Case',
        workflowId: 'antigravity.strict-full',
        goal: 'Compile from a cached remote dataset after the source disappears.',
      }],
    })

    const remoteDatasetUrl = 'http://benchmark.local/stale-cache-dataset.json'
    let requestMode: 'serve' | 'fail' = 'serve'
    const datasetTransport = async () => {
      if (requestMode === 'fail') {
        throw new Error('Remote dataset source unavailable')
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        rawText: datasetBody,
      }
    }

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'stream', supportedResponseModes: ['stream', 'poll', 'inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
      getBenchmarkDatasetTransport: () => datasetTransport,
    }, manifestPath)

    await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['stale-cache-case'],
      datasetSources: [{
        sourceId: 'stale-cache-remote',
        location: remoteDatasetUrl,
        cacheTtlMs: 0,
        allowStaleOnError: true,
      }],
    })

    requestMode = 'fail'

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['stale-cache-case'],
      datasetSources: [{
        sourceId: 'stale-cache-remote',
        location: remoteDatasetUrl,
        cacheTtlMs: 0,
        allowStaleOnError: true,
      }],
    })

    expect(report.ok).toBe(true)
    expect(report.suites[0]?.cases[0]?.metadata?.['datasetSourceCacheStatus']).toBe('stale-fallback')
  })

  it('surfaces required version pin mismatches as failing dataset issue cases', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-benchmark-version-mismatch-'))
    const dataDir = path.join(tempDir, 'data')
    const fixturesDir = path.join(tempDir, 'fixtures')
    fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
    fs.mkdirSync(fixturesDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db', 'antigravity-daemon.db'), '', 'utf8')

    const mismatchDatasetPath = path.join(fixturesDir, 'versioned-dataset.json')
    fs.writeFileSync(mismatchDatasetPath, JSON.stringify({
      datasetId: 'versioned-dataset',
      version: '2026.03.11',
      cases: [{
        caseKind: 'compiledWorkflow',
        caseId: 'versioned-case',
        name: 'Versioned Case',
        workflowId: 'antigravity.strict-full',
        goal: 'Compile a versioned workflow dataset.',
      }],
    }, null, 2), 'utf8')

    const manifestPath = path.join(dataDir, 'benchmark-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-harness',
      manifestVersion: '2026.03.11',
      suites: [{ suiteId: 'workflow-dataset-cases', name: 'Workspace Dataset Cases' }],
    }, null, 2), 'utf8')

    const harness = new BenchmarkHarness({
      workspaceRoot: tempDir,
      dataDir,
      projectionPath: path.join(dataDir, 'run-projection.json'),
      socketPath: '/tmp/antigravity-daemon.sock',
      getManifestRouteCount: () => 15,
      getCallbackAuthScheme: () => 'hmac-sha256',
      hasManifestOperation: (operationId) => operationId === 'ReloadPolicyPack',
      getPolicyPack: () => ({ packId: 'workspace-pack', version: '1.1.0' }),
      listRemoteWorkers: () => ({ workers: [{ id: 'w-1', agentCardVersion: '1.0.0', agentCardSchemaVersion: 'a2a.agent-card.v1', agentCardPublishedAt: '2026-03-11T00:00:00.000Z', agentCardSha256: AGENT_CARD_SHA, selectedResponseMode: 'inline', supportedResponseModes: ['inline'], taskProtocolSource: 'agent-card', verification: { summary: 'verified' }, health: 'healthy' }], discoveryIssues: [] }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({
      suiteIds: ['workflow-dataset-cases'],
      caseIds: ['dataset-source:version-mismatch-source'],
      datasetSources: [{
        sourceId: 'version-mismatch-source',
        location: mismatchDatasetPath,
        expectedVersion: '2026.03.12',
      }],
    })

    expect(report.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.ok).toBe(false)
    expect(report.suites[0]?.cases[0]?.checks[0]?.message).toMatch(/Dataset version mismatch/)
    expect(report.suites[0]?.cases[0]?.metadata?.['expectedVersion']).toBe('2026.03.12')
  })
})
