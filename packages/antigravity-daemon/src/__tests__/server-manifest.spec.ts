import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryManager, SqliteClient, runMigrations } from '@anthropic/antigravity-persistence'
import { createEventId, createISODateTime } from '@anthropic/antigravity-shared'
import { signBenchmarkSourceRegistryPayload } from '../benchmark-source-registry.js'
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '../client.js'
import { createExecutionReceipt } from '../evidence-policy.js'
import { DaemonLedger } from '../ledger.js'
import { DAEMON_API_CONTRACT } from '../manifest.js'
import { buildRunSnapshot } from '../projection.js'
import { bootstrapDaemonRun } from '../run-bootstrap.js'
import { AntigravityDaemonRuntime } from '../runtime.js'
import { createInMemoryAntigravityDaemonTransport } from '../server.js'
import { compileWorkflowDefinition, createRunRequest, resolveWorkflowDefinition } from '../workflow-definition.js'
import { JsonlEventStore, SqliteCheckpointStore } from '@anthropic/antigravity-persistence'

describe('Antigravity daemon manifest endpoint', () => {
  let workspaceRoot: string | undefined
  let socketPath: string | undefined
  let runtime: AntigravityDaemonRuntime | undefined

  afterEach(async () => {
    runtime?.close()
    runtime = undefined
    if (socketPath && socketPath.startsWith('/') && fs.existsSync(socketPath)) {
      fs.rmSync(socketPath, { force: true })
    }
    if (workspaceRoot) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTIGRAVITY_TRUST_KEY')) {
        delete process.env[key]
      }
    }
    workspaceRoot = undefined
    socketPath = undefined
  })

  it('serves the canonical daemon contract over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-manifest-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    const callbackIngressBaseUrl = 'http://127.0.0.1:45123'
    runtime.setCallbackIngressBaseUrl(callbackIngressBaseUrl)

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const manifest = await client.getManifest()

    expect(manifest).toMatchObject({
      ...DAEMON_API_CONTRACT,
      callbackIngressBaseUrl,
    })
  })

  it('reloads the workspace policy pack over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-policy-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    fs.mkdirSync(paths.dataDir, { recursive: true })
    fs.writeFileSync(path.join(paths.dataDir, 'policy-pack.json'), JSON.stringify({
      packId: 'workspace-policy-pack',
      version: '2026.03.11',
      rules: [
        {
          ruleId: 'skip.evidence-required',
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')
    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    runtime.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const pack = await client.reloadPolicyPack()

    expect(pack.packId).toBe('workspace-policy-pack')
    expect(pack.sourcePath).toBe(path.join(paths.dataDir, 'policy-pack.json'))
    expect(pack.rules.some(rule => rule.ruleId === 'skip.evidence-required' && rule.enabled === true)).toBe(true)
  })

  it('loads and reloads the benchmark source registry over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-benchmark-registry-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    fs.mkdirSync(paths.dataDir, { recursive: true })
    const registrySecret = 'registry-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_SERVER_TEST = registrySecret
    fs.writeFileSync(path.join(paths.dataDir, 'trust-registry.json'), JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'server-test',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_SERVER_TEST',
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
          allowedKeyIds: ['server-test'],
          allowedIssuers: ['antigravity-lab'],
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
          location: 'fixtures/external/gaia-lite-dataset.json',
          expectedDatasetId: 'gaia-lite',
          expectedVersion: '2026.03.11',
          locked: true,
        },
      ],
    }
    fs.writeFileSync(path.join(paths.dataDir, 'benchmark-source-registry.json'), JSON.stringify({
      ...registryFile,
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'server-test',
        issuer: 'antigravity-lab',
        signedAt: '2026-03-11T00:00:00.000Z',
        signature: signBenchmarkSourceRegistryPayload(registryFile, registrySecret),
      },
    }, null, 2), 'utf8')
    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    runtime.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const registry = await client.getBenchmarkSourceRegistry()
    const reloaded = await client.reloadBenchmarkSourceRegistry()

    expect(registry.registryId).toBe('workspace-source-registry')
    expect(registry.sourcePath).toBe(path.join(paths.dataDir, 'benchmark-source-registry.json'))
    expect(registry.sources[0]?.sourceId).toBe('gaia-lite')
    expect(registry.sources[0]?.locked).toBe(true)
    expect(registry.trustPolicyId).toBe('benchmark-registry-strict')
    expect(registry.digestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(registry.signature?.keyId).toBe('server-test')
    expect(registry.verification.summary).toBe('verified')
    expect(reloaded.version).toBe('2026.03.11')
    expect(reloaded.sources).toHaveLength(1)
    expect(reloaded.signature?.keyId).toBe('server-test')
    expect(reloaded.verification.summary).toBe('verified')
  })

  it('loads and reloads the trust registry over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-trust-registry-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    fs.mkdirSync(paths.dataDir, { recursive: true })
    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'
    fs.writeFileSync(path.join(paths.dataDir, 'trust-registry.json'), JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'remote-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING',
          scopes: ['remote-worker-advertisement'],
          status: 'active',
        },
      ],
      signerPolicies: [
        {
          policyId: 'remote-advertisement-strict',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedKeyIds: ['remote-signing'],
          allowedIssuers: ['antigravity-lab'],
          maxSignatureAgeMs: 300_000,
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')
    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    runtime.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const registry = await client.getTrustRegistry()
    const reloaded = await client.reloadTrustRegistry()

    expect(registry.registryId).toBe('workspace-trust-registry')
    expect(registry.keys[0]?.keyId).toBe('remote-signing')
    expect(registry.keys[0]?.status).toBe('active')
    expect(registry.keys[0]?.hasSecret).toBe(true)
    expect(registry.signerPolicies.some(policy => policy.policyId === 'remote-advertisement-strict')).toBe(true)
    expect(registry.verification.summary).toBe('verified')
    expect(reloaded.version).toBe('2026.03.11')
  })

  it('searches daemon-owned workflow memory over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-memory-search-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    runtime.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const seedClient = new SqliteClient({
      dataDir: paths.dataDir,
      dbName: 'antigravity-daemon.db',
    })
    runMigrations(seedClient.getDatabase())
    const memoryManager = new MemoryManager({
      db: seedClient.getDatabase(),
    })
    memoryManager.recordRun(
      {
        runId: 'memory-run-1',
        goal: 'Mitigate auth timeout regressions',
        repoRoot: workspaceRoot,
        files: ['src/auth.ts'],
        riskLevel: 'high',
        worstStatus: 'completed',
        nodeCount: 7,
        createdAt: '2026-03-11T00:00:00.000Z',
        completedAt: '2026-03-11T00:02:00.000Z',
        summary: 'Auth timeout mitigation completed successfully.',
      },
      'high',
      {
        runId: 'memory-run-1',
        goal: 'Mitigate auth timeout regressions',
        outcome: 'completed',
        riskLevel: 'high',
        keyInsights: ['auth timeout mitigated'],
        failureReasons: [],
        nodeCount: 7,
        files: ['src/auth.ts'],
        createdAt: '2026-03-11T00:00:00.000Z',
      },
    )
    seedClient.close()

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const recall = await client.searchMemory({
      query: 'auth timeout mitigation',
      files: ['src/auth.ts'],
      topK: 3,
    })

    expect(recall.promptCount).toBeGreaterThanOrEqual(0)
    expect(recall.factCount).toBeGreaterThan(0)
    expect(recall.budgetStatus.maxSemanticFacts).toBeGreaterThan(0)
  })

  it('reads and verifies the exported release attestation over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-attestation-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    fs.mkdirSync(paths.dataDir, { recursive: true })
    process.env.ANTIGRAVITY_TRUST_KEY_TRACE_BUNDLE = 'trace-bundle-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_RELEASE_ATTESTATION = 'release-attestation-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_INVARIANT_REPORT = 'invariant-report-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_RELEASE_DOSSIER = 'release-dossier-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_RELEASE_BUNDLE = 'release-bundle-secret'
    fs.writeFileSync(path.join(paths.dataDir, 'trust-registry.json'), JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.12',
      keys: [
        {
          keyId: 'trace-bundle-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_TRACE_BUNDLE',
          scopes: ['trace-bundle'],
          status: 'active',
          rotationGroup: 'trace-bundle.primary',
        },
        {
          keyId: 'release-attestation-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_RELEASE_ATTESTATION',
          scopes: ['release-attestation'],
          status: 'active',
          rotationGroup: 'release-attestation.primary',
        },
        {
          keyId: 'invariant-report-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_INVARIANT_REPORT',
          scopes: ['invariant-report'],
          status: 'active',
          rotationGroup: 'invariant-report.primary',
        },
        {
          keyId: 'release-dossier-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_RELEASE_DOSSIER',
          scopes: ['release-dossier'],
          status: 'active',
          rotationGroup: 'release-dossier.primary',
        },
        {
          keyId: 'release-bundle-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_RELEASE_BUNDLE',
          scopes: ['release-bundle'],
          status: 'active',
          rotationGroup: 'release-bundle.primary',
        },
      ],
      signerPolicies: [
        {
          policyId: 'trace-bundle-strict',
          scope: 'trace-bundle',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['trace-bundle.primary'],
          allowedKeyIds: ['trace-bundle-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
        {
          policyId: 'release-attestation-strict',
          scope: 'release-attestation',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['release-attestation.primary'],
          allowedKeyIds: ['release-attestation-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
        {
          policyId: 'invariant-report-strict',
          scope: 'invariant-report',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['invariant-report.primary'],
          allowedKeyIds: ['invariant-report-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
        {
          policyId: 'release-dossier-strict',
          scope: 'release-dossier',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['release-dossier.primary'],
          allowedKeyIds: ['release-dossier-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
        {
          policyId: 'release-bundle-strict',
          scope: 'release-bundle',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['release-bundle.primary'],
          allowedKeyIds: ['release-bundle-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const seedClient = new SqliteClient({
      dataDir: paths.dataDir,
      dbName: 'antigravity-daemon.db',
    })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())
    const eventStore = new JsonlEventStore({ dataDir: paths.dataDir })
    const checkpointStore = new SqliteCheckpointStore(seedClient.getDatabase())
    const invocation = {
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Seed attestation route test',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'attestation-test',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const seededAt = createISODateTime()
    const start = await bootstrapDaemonRun(
      createRunRequest(invocation, compileWorkflowDefinition(definition)),
      { eventStore, checkpointStore },
    )
    const snapshot = buildRunSnapshot({
      runId: start.runId,
      invocation,
      definition,
      state: start.state,
      createdAt: seededAt,
      updatedAt: seededAt,
      startedAt: seededAt,
      explicitStatus: 'running',
      timelineCursor: 0,
      skipDecisions: [],
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertRun(invocation, definition, snapshot)
    seedClient.close()

    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()
    await (runtime as any).finalizeTraceBundle(start.runId)
    await (runtime as any).finalizePolicyReport(start.runId)
    await (runtime as any).finalizeInvariantReport(start.runId)
    await (runtime as any).finalizeReleaseDossier(start.runId)
    await (runtime as any).finalizeReleaseBundle(start.runId)

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const session = await client.getRunSession(start.runId)
    const attestation = await client.getReleaseAttestation(start.runId)
    const releaseArtifacts = await client.getReleaseArtifacts(start.runId)
    const releaseArtifactsVerification = await client.verifyReleaseArtifacts(start.runId)
    const policyReport = await client.getPolicyReport(start.runId)
    const policyVerification = await client.verifyPolicyReport(start.runId)
    const invariantReport = await client.getInvariantReport(start.runId)
    const invariantVerification = await client.verifyInvariantReport(start.runId)
    const verification = await client.verifyReleaseAttestation(start.runId)
    const releaseBundle = await client.getReleaseBundle(start.runId)
    const releaseBundleVerification = await client.verifyReleaseBundle(start.runId)
    const dossier = await client.getReleaseDossier(start.runId)
    const dossierVerification = await client.verifyReleaseDossier(start.runId)

    expect(session.runId).toBe(start.runId)
    expect(session.authorityOwner).toBe('antigravity-daemon')
    expect(attestation.attestationPath).toMatch(/release-attestation\.json$/)
    expect(attestation.document.signaturePolicyId).toBe('default:release-attestation')
    expect(attestation.document.signature?.keyId).toBe('release-attestation-signing')
    expect(releaseArtifacts.releaseArtifacts.traceBundle?.path).toMatch(/\.trace\.json$/)
    expect(releaseArtifacts.releaseArtifacts.releaseAttestation?.path).toMatch(/release-attestation\.json$/)
    expect(releaseArtifactsVerification.ok).toBe(true)
    expect(releaseArtifactsVerification.releaseArtifacts.releaseAttestation?.verified).toBe(true)
    expect(policyReport.reportPath).toMatch(/policy-report\.json$/)
    expect(policyVerification.ok).toBe(true)
    expect(invariantReport.reportPath).toMatch(/invariant-report\.json$/)
    expect(invariantReport.document.signaturePolicyId).toBe('default:invariant-report')
    expect(invariantReport.document.signature?.keyId).toBe('invariant-report-signing')
    expect(invariantVerification.ok).toBe(true)
    expect(invariantVerification.signatureVerified).toBe(true)
    expect(verification.ok).toBe(true)
    expect(verification.signatureVerified).toBe(true)
    expect(verification.signaturePolicyId).toBe('default:release-attestation')
    expect(releaseBundle.bundlePath).toMatch(/release-bundle\.json$/)
    expect(releaseBundle.document.signaturePolicyId).toBe('default:release-bundle')
    expect(releaseBundle.document.signature?.keyId).toBe('release-bundle-signing')
    expect(releaseBundleVerification.ok).toBe(true)
    expect(releaseBundleVerification.signatureVerified).toBe(true)
    expect(dossier.dossierPath).toMatch(/release-dossier\.json$/)
    expect(dossier.document.signaturePolicyId).toBe('default:release-dossier')
    expect(dossier.document.signature?.keyId).toBe('release-dossier-signing')
    expect(dossierVerification.ok).toBe(true)
    expect(dossierVerification.signatureVerified).toBe(true)
  })

  it('accepts session heartbeat and matching completion receipt over local IPC', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-session-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    socketPath = paths.socketPath
    fs.mkdirSync(paths.dataDir, { recursive: true })

    const seedClient = new SqliteClient({
      dataDir: paths.dataDir,
      dbName: 'antigravity-daemon.db',
    })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())
    const eventStore = new JsonlEventStore({ dataDir: paths.dataDir })
    const checkpointStore = new SqliteCheckpointStore(seedClient.getDatabase())
    const invocation = {
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Seed run session protocol test',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'session-test',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const seededAt = createISODateTime()
    const start = await bootstrapDaemonRun(
      createRunRequest(invocation, compileWorkflowDefinition(definition)),
      { eventStore, checkpointStore },
    )
    const snapshot = buildRunSnapshot({
      runId: start.runId,
      invocation,
      definition,
      state: start.state,
      createdAt: seededAt,
      updatedAt: seededAt,
      startedAt: seededAt,
      explicitStatus: 'running',
      timelineCursor: 0,
      skipDecisions: [],
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertRun(invocation, definition, snapshot)

    const leaseId = 'lease-session-1'
    const startedAt = createISODateTime()
    const currentVersion = await eventStore.getCurrentVersion(start.runId)
    await eventStore.append({
      runId: start.runId,
      expectedVersion: currentVersion,
      events: [
        {
          eventId: createEventId(),
          runId: start.runId,
          type: 'NODE_STARTED',
          payload: {
            nodeId: 'ANALYZE',
            model: 'analysis-model',
            leaseId,
            attempt: 0,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            requiredEvidence: ['goal', 'workspace-root'],
            allowedModelPool: ['analysis'],
            inputDigest: 'digest-1',
          },
          timestamp: startedAt,
          version: currentVersion + 1,
        },
      ],
    })
    seedClient.close()

    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()

    const client = new AntigravityDaemonClient(createInMemoryAntigravityDaemonTransport(runtime))
    const session = await client.getRunSession(start.runId)
    expect(session.activeLease?.leaseId).toBe(leaseId)

    const heartbeat = await client.recordStepHeartbeat(start.runId, {
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
    })
    expect(heartbeat.activeHeartbeat?.leaseId).toBe(leaseId)

    const result = {
      output: {
        taskType: 'analysis',
        taskAnalysis: 'This task requires a structured audit of the workspace with explicit evidence collection and daemon-owned release control.',
        riskAssessment: 'medium' as const,
        routePath: 'debate' as const,
        tokenBudget: 'M' as const,
        taskClass: 'text' as const,
        verifiabilityClass: 'medium' as const,
        fileList: ['/tmp/project/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      },
      durationMs: 12,
      model: 'analysis-model',
    }
    const completionTime = createISODateTime()
    const completionVersion = await eventStore.getCurrentVersion(start.runId)
    await eventStore.append({
      runId: start.runId,
      expectedVersion: completionVersion,
      events: [
        {
          eventId: createEventId(),
          runId: start.runId,
          type: 'NODE_COMPLETED',
          payload: {
            nodeId: 'ANALYZE',
            leaseId,
            output: result.output,
            model: result.model,
            durationMs: result.durationMs,
            degraded: false,
          },
          timestamp: completionTime,
          version: completionVersion + 1,
        },
      ],
    })
    const receipt = createExecutionReceipt({
      runId: start.runId,
      nodeId: 'ANALYZE',
      result,
      invocation,
      definition,
      capturedAt: completionTime,
      traceId: 'trace-analyze',
    })
    ;(runtime as any).ledger.recordExecutionReceipt(receipt)
    ;(runtime as any).ledger.upsertCompletionSession({
      sessionId: `${start.runId}:${leaseId}:ANALYZE:0`,
      runId: start.runId,
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      phase: 'pending',
      receipt: {
        leaseId,
        runId: start.runId,
        nodeId: 'ANALYZE',
        attempt: 0,
        status: receipt.status,
        outputHash: receipt.outputHash,
        model: receipt.model,
        durationMs: receipt.durationMs,
        completedAt: completionTime,
      },
      stagedBundleRef: `completion://${start.runId}:${leaseId}:ANALYZE:0`,
      stagedBundle: {
        bundleRef: `completion://${start.runId}:${leaseId}:ANALYZE:0`,
        result: {
          output: result.output,
          model: result.model,
          durationMs: result.durationMs,
        },
        receipt,
        handoffs: [],
        stagedAt: completionTime,
      },
      createdAt: completionTime,
      updatedAt: completionTime,
    })
    await (runtime as any).refreshSnapshot(start.runId, undefined)

    const prepared = await client.prepareStepCompletionReceipt(start.runId, {
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      status: receipt.status,
      outputHash: receipt.outputHash,
      model: receipt.model,
      durationMs: receipt.durationMs,
      completedAt: completionTime,
    })
    expect(prepared.pendingCompletionReceipt).toBeUndefined()
    expect(prepared.preparedCompletionReceipt?.leaseId).toBe(leaseId)
    expect(prepared.preparedCompletionReceipt?.nodeId).toBe('ANALYZE')
    const preparedAgain = await client.prepareStepCompletionReceipt(start.runId, {
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      status: receipt.status,
      outputHash: receipt.outputHash,
      model: receipt.model,
      durationMs: receipt.durationMs,
      completedAt: completionTime,
    })
    expect(preparedAgain.preparedCompletionReceipt?.preparedAt).toBe(prepared.preparedCompletionReceipt?.preparedAt)

    const acknowledged = await client.commitStepCompletionReceipt(start.runId, {
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      status: receipt.status,
      outputHash: receipt.outputHash,
      model: receipt.model,
      durationMs: receipt.durationMs,
      completedAt: completionTime,
      preparedAt: prepared.preparedCompletionReceipt?.preparedAt,
    })
    expect(acknowledged.pendingCompletionReceipt).toBeUndefined()
    expect(acknowledged.preparedCompletionReceipt).toBeUndefined()
    expect(acknowledged.acknowledgedCompletionReceipt?.leaseId).toBe(leaseId)
    expect(acknowledged.acknowledgedCompletionReceipt?.nodeId).toBe('ANALYZE')
    const acknowledgedAgain = await client.commitStepCompletionReceipt(start.runId, {
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      status: receipt.status,
      outputHash: receipt.outputHash,
      model: receipt.model,
      durationMs: receipt.durationMs,
      completedAt: completionTime,
      preparedAt: prepared.preparedCompletionReceipt?.preparedAt,
    })
    expect(acknowledgedAgain.acknowledgedCompletionReceipt?.leaseId).toBe(leaseId)
    expect(acknowledgedAgain.preparedCompletionReceipt).toBeUndefined()
  })
})
