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
import { compileWorkflowDefinition, createRunRequest, resolveWorkflowDefinition } from '../workflow-definition.js'

type SeededStatus = 'completed' | 'paused_for_human' | 'failed' | 'cancelled'

interface SeededRuntime {
  workspaceRoot: string
  runtime: AntigravityDaemonRuntime
  runId: string
}

describe('Antigravity daemon runtime mainline evidence', () => {
  const active: SeededRuntime[] = []

  afterEach(() => {
    for (const item of active.splice(0)) {
      item.runtime.close()
      fs.rmSync(item.workspaceRoot, { recursive: true, force: true })
    }
  })

  async function seedRuntime(status: SeededStatus): Promise<SeededRuntime> {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-runtime-mainline-'))
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
      goal: `Runtime mainline evidence (${status})`,
      files: [],
      initiator: 'runtime-mainline-test',
      workspaceRoot,
      hostSessionId: `runtime-mainline-${status}`,
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
      completedAt: status === 'completed' || status === 'failed' || status === 'cancelled'
        ? seededAt
        : undefined,
      explicitStatus: status,
      verdict: status,
      timelineCursor: 0,
      skipDecisions: [],
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertRun(invocation, definition, snapshot)
    seedClient.close()

    const runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()

    const seeded = { workspaceRoot, runtime, runId: start.runId }
    active.push(seeded)
    return seeded
  }

  async function finalizeArtifacts(runtime: AntigravityDaemonRuntime, runId: string): Promise<void> {
    await (runtime as any).ensureTerminalArtifactsFinalized(runId)
  }

  it('completed path generates 6 snapshot-bound terminal artifacts plus proof graph binding', async () => {
    const { runtime, runId } = await seedRuntime('completed')

    await finalizeArtifacts(runtime, runId)

    const policy = await runtime.getPolicyReport(runId)
    const invariant = await runtime.getInvariantReport(runId)
    const attestation = await runtime.getReleaseAttestation(runId)
    const dossier = await runtime.getReleaseDossier(runId)
    const bundle = await runtime.getReleaseBundle(runId)
    const certification = await runtime.getCertificationRecord(runId)
    const transparency = await runtime.getTransparencyLedger()

    const snapshotDigests = [
      policy.document.payload.snapshotDigest,
      invariant.document.payload.snapshotDigest,
      attestation.document.payload.snapshotDigest,
      dossier.document.payload.snapshotDigest,
      bundle.document.payload.snapshotDigest,
      certification.document.payload.snapshotDigest,
    ]

    expect(snapshotDigests.every(Boolean)).toBe(true)
    expect(new Set(snapshotDigests).size).toBe(1)
    expect(certification.document.proofGraphDigest).toBeTruthy()
    expect(transparency.headEntry?.proofGraphDigest).toBe(certification.document.proofGraphDigest)
    expect(transparency.headEntry?.snapshotDigest).toBe(snapshotDigests[0])
  })

  it('paused_for_human path freezes snapshot before snapshot-aware artifact generation', async () => {
    const { runtime, runId } = await seedRuntime('paused_for_human')

    await finalizeArtifacts(runtime, runId)

    const verificationSnapshot = (runtime as any).verificationSnapshots.get(runId)
    const policy = await runtime.getPolicyReport(runId)
    const invariant = await runtime.getInvariantReport(runId)

    expect(verificationSnapshot?.run.status).toBe('paused_for_human')
    expect(policy.document.payload.run.status).toBe('paused_for_human')
    expect(invariant.document.payload.run.status).toBe('paused_for_human')
    expect(policy.document.payload.snapshotDigest).toBe(verificationSnapshot?.snapshotDigest)
    expect(invariant.document.payload.snapshotDigest).toBe(verificationSnapshot?.snapshotDigest)
  })

  it('failed and cancelled paths still build snapshot-aware artifacts without falling back to legacy empty digests', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const { runtime, runId } = await seedRuntime(status)
      await finalizeArtifacts(runtime, runId)

      const verificationSnapshot = (runtime as any).verificationSnapshots.get(runId)
      const bundle = await runtime.getReleaseBundle(runId)
      const certification = await runtime.getCertificationRecord(runId)

      expect(verificationSnapshot?.run.status).toBe(status)
      expect(bundle.document.payload.snapshotDigest).toBe(verificationSnapshot?.snapshotDigest)
      expect(certification.document.payload.snapshotDigest).toBe(verificationSnapshot?.snapshotDigest)
      expect(certification.document.proofGraphDigest).toBeTruthy()
    }
  })

  it('terminal artifact finalization is idempotent for the same run', async () => {
    const { runtime, runId } = await seedRuntime('completed')

    await finalizeArtifacts(runtime, runId)
    await finalizeArtifacts(runtime, runId)

    const transparency = await runtime.getTransparencyLedger()
    expect(transparency.entryCount).toBe(1)
  })
})
