import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonlEventStore, SqliteCheckpointStore, SqliteClient, runMigrations } from '@anthropic/antigravity-persistence'
import { createISODateTime } from '@anthropic/antigravity-shared'
import { resolveAntigravityDaemonPaths } from '../client.js'
import { DaemonLedger } from '../ledger.js'
import { buildRunSnapshot } from '../projection.js'
import { bootstrapDaemonRun } from '../run-bootstrap.js'
import { AntigravityDaemonRuntime } from '../runtime.js'
import { createExecutionReceipt } from '../evidence-policy.js'
import { compileWorkflowDefinition, createRunRequest, resolveWorkflowDefinition } from '../workflow-definition.js'

describe('Antigravity daemon verifyRun', () => {
  let workspaceRoot: string | undefined
  let runtime: AntigravityDaemonRuntime | undefined

  async function seedRun(
    goal: string,
    hostSessionId: string,
    prepareDataDir?: (dataDir: string) => void,
  ) {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-verify-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
    fs.mkdirSync(paths.dataDir, { recursive: true })
    prepareDataDir?.(paths.dataDir)

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
      goal,
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId,
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

    return { start, paths }
  }

  afterEach(() => {
    runtime?.close()
    runtime = undefined
    if (workspaceRoot) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
    workspaceRoot = undefined
  })

  it('reports missing receipts when a run snapshot exists without daemon evidence', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-verify-'))
    const paths = resolveAntigravityDaemonPaths(workspaceRoot)
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
      goal: 'Verify daemon report shape',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'verify-test',
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
    const state = start.state
    const snapshot = buildRunSnapshot({
      runId: start.runId,
      invocation,
      definition,
      state,
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

    const report = await runtime.verifyRun(start.runId)

    expect(report.ok).toBe(false)
    expect(report.releaseGateEffect).toBe('block')
    expect(report.missingReceiptNodes).toContain('ANALYZE')
    expect(report.missingReceiptNodes).toContain('HITL')
  })

  it('verifies exported trace bundle integrity and detects tampering', async () => {
    process.env.ANTIGRAVITY_TRUST_KEY_TRACE_BUNDLE = 'trace-bundle-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_INVARIANT_REPORT = 'invariant-report-secret'
    process.env.ANTIGRAVITY_TRUST_KEY_RELEASE_BUNDLE = 'release-bundle-secret'
    const { start } = await seedRun(
      'Verify trace bundle integrity',
      'verify-trace-test',
      (dataDir) => {
        fs.writeFileSync(path.join(dataDir, 'trust-registry.json'), JSON.stringify({
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
              keyId: 'invariant-report-signing',
              issuer: 'antigravity-lab',
              envVar: 'ANTIGRAVITY_TRUST_KEY_INVARIANT_REPORT',
              scopes: ['invariant-report'],
              status: 'active',
              rotationGroup: 'invariant-reports.primary',
            },
            {
              keyId: 'release-bundle-signing',
              issuer: 'antigravity-lab',
              envVar: 'ANTIGRAVITY_TRUST_KEY_RELEASE_BUNDLE',
              scopes: ['release-bundle'],
              status: 'active',
              rotationGroup: 'release-bundles.primary',
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
              policyId: 'invariant-report-strict',
              scope: 'invariant-report',
              requireSignature: true,
              allowedKeyStatuses: ['active'],
              allowedRotationGroups: ['invariant-reports.primary'],
              allowedKeyIds: ['invariant-report-signing'],
              allowedIssuers: ['antigravity-lab'],
              enabled: true,
            },
            {
              policyId: 'release-bundle-strict',
              scope: 'release-bundle',
              requireSignature: true,
              allowedKeyStatuses: ['active'],
              allowedRotationGroups: ['release-bundles.primary'],
              allowedKeyIds: ['release-bundle-signing'],
              allowedIssuers: ['antigravity-lab'],
              enabled: true,
            },
          ],
        }, null, 2), 'utf8')
      },
    )
    const daemon = runtime!

    ;(daemon as any).ledger.recordTribunalVerdict({
      tribunalId: `${start.runId}:VERIFY:tribunal`,
      runId: start.runId,
      nodeId: 'VERIFY',
      mode: 'remote',
      verdict: 'agree',
      confidence: 0.9,
      quorumSatisfied: true,
      remoteJurorCount: 2,
      totalJurorCount: 2,
      rationale: 'Remote tribunal accepted the verification result.',
      evidenceIds: ['tribunal-evidence-1'],
      jurorReportIds: ['juror-1', 'juror-2'],
      createdAt: createISODateTime(),
      subjectOutputHash: 'tribunal-output-hash',
      fallbackUsed: false,
      jurorReports: [],
    })

    const exported = await daemon.exportTraceBundle(start.runId)
    const verified = await daemon.verifyTraceBundle(start.runId)
    await (daemon as any).finalizeTraceBundle(start.runId)
    await (daemon as any).finalizeInvariantReport(start.runId)
    await (daemon as any).finalizeReleaseDossier(start.runId)
    await (daemon as any).finalizeReleaseBundle(start.runId)
    const initialRunReport = await daemon.verifyRun(start.runId)
    const invariantReport = await daemon.verifyInvariantReport(start.runId)
    const dossierReport = await daemon.verifyReleaseDossier(start.runId)
    const bundleReport = await daemon.verifyReleaseBundle(start.runId)

    expect(exported.integrity.bundleDigest).toBe(verified.expectedBundleDigest)
    expect(exported.signature?.keyId).toBe('trace-bundle-signing')
    expect(exported.signaturePolicyId).toBe('trace-bundle-strict')
    expect(verified.ok).toBe(true)
    expect(verified.signatureVerified).toBe(true)
    expect(verified.signatureRequired).toBe(true)
    expect(verified.signatureKeyId).toBe('trace-bundle-signing')
    expect(verified.mismatchedEntries).toEqual([])
    expect(initialRunReport.releaseArtifacts.releaseAttestation?.path).toBeDefined()
    expect(initialRunReport.releaseArtifacts.releaseAttestation?.verified).toBe(true)
    expect(initialRunReport.releaseArtifacts.releaseAttestation?.signatureVerified).toBe(true)
    expect(invariantReport.ok).toBe(true)
    expect(invariantReport.signatureVerified).toBe(true)
    expect(dossierReport.ok).toBe(true)
    expect(bundleReport.ok).toBe(true)
    expect(bundleReport.signatureVerified).toBe(true)
    const currentRun = await daemon.getRun(start.runId)
    expect(currentRun?.snapshot.invariantReport?.path).toBeDefined()
    expect(currentRun?.snapshot.releaseDossier?.path).toBeDefined()
    expect(currentRun?.snapshot.releaseBundle?.path).toBeDefined()

    const bundle = JSON.parse(fs.readFileSync(exported.bundlePath, 'utf8')) as Record<string, unknown>
    expect(Array.isArray(bundle['tribunals'])).toBe(true)
    expect((bundle['tribunals'] as Array<Record<string, unknown>>)[0]?.['nodeId']).toBe('VERIFY')
    bundle['timeline'] = []
    fs.writeFileSync(exported.bundlePath, JSON.stringify(bundle, null, 2), 'utf8')

    const tampered = await daemon.verifyTraceBundle(start.runId)
    expect(tampered.ok).toBe(false)
    expect(tampered.mismatchedEntries).toContain('timeline')

    const runReport = await daemon.verifyRun(start.runId)
    expect(runReport.releaseArtifacts.traceBundle?.integrityOk).toBe(false)
    expect(runReport.releaseArtifacts.traceBundle?.issues).toContain('timeline')

    const tamperedDossier = await daemon.verifyReleaseDossier(start.runId)
    expect(tamperedDossier.ok).toBe(false)
    expect(tamperedDossier.issues).toContain('releaseArtifacts')

    const tamperedInvariantReport = await daemon.verifyInvariantReport(start.runId)
    expect(tamperedInvariantReport.ok).toBe(false)
    expect(tamperedInvariantReport.issues).toContain('releaseArtifacts')

    const tamperedBundle = await daemon.verifyReleaseBundle(start.runId)
    expect(tamperedBundle.ok).toBe(false)
    expect(tamperedBundle.issues).toContain('verificationSummary')
  })
})
