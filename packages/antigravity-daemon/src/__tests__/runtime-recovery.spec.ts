import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { JsonlEventStore, SqliteCheckpointStore, SqliteClient, runMigrations } from '@anthropic/antigravity-persistence'
import { createEventId, createISODateTime } from '@anthropic/antigravity-shared'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveAntigravityDaemonPaths } from '../client.js'
import { DaemonLedger } from '../ledger.js'
import { buildRunSnapshot } from '../projection.js'
import { bootstrapDaemonRun, loadRunStateFromEvents } from '../run-bootstrap.js'
import { AntigravityDaemonRuntime } from '../runtime.js'
import { createExecutionReceipt } from '../evidence-policy.js'
import { compileWorkflowDefinition, createRunRequest, resolveWorkflowDefinition } from '../workflow-definition.js'

describe('Antigravity daemon runtime recovery', () => {
  let workspaceRoot: string | undefined
  let runtime: AntigravityDaemonRuntime | undefined

  afterEach(() => {
    runtime?.close()
    runtime = undefined
    if (workspaceRoot) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
    workspaceRoot = undefined
  })

  it('recovers interrupted running runs from the ledger on initialize', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-recovery-'))
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
      goal: 'Recover this run after a daemon restart',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'recover-test',
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

    const recoveredRunIds: string[] = []
    ;(runtime as any).drainRun = async (runId: string) => {
      recoveredRunIds.push(runId)
      ;(runtime as any).activeRuns.delete(runId)
    }

    await runtime.initialize()

    expect(recoveredRunIds).toEqual([start.runId])
    const timeline = (runtime as any).ledger.listTimeline(start.runId)
    expect(timeline.some((entry: { kind: string }) => entry.kind === 'run.recovered')).toBe(true)

    const recovered = await runtime.getRun(start.runId)
    expect(recovered?.snapshot.status).toBe('running')
  })

  it('replays committed completion sessions before resuming drain', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-committed-recovery-'))
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
      goal: 'Recover a committed completion session',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'recover-committed',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const start = await bootstrapDaemonRun(
      createRunRequest(invocation, compileWorkflowDefinition(definition)),
      { eventStore, checkpointStore },
    )
    const leaseId = 'lease-committed'
    const startedAt = createISODateTime()
    const version = await eventStore.getCurrentVersion(start.runId)
    await eventStore.append({
      runId: start.runId,
      expectedVersion: version,
      events: [{
        eventId: createEventId(),
        runId: start.runId,
        type: 'NODE_STARTED',
        payload: {
          nodeId: 'ANALYZE',
          model: 'analysis-model',
          leaseId,
          attempt: 0,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          requiredEvidence: ['goal'],
          allowedModelPool: ['analysis'],
          inputDigest: 'digest-committed',
        },
        timestamp: startedAt,
        version: version + 1,
      }],
    })
    const runningState = await loadRunStateFromEvents(eventStore, start.runId)
    const completionTime = createISODateTime()
    const result = {
      output: {
        taskType: 'analysis',
        taskAnalysis: 'Recovered committed completion',
        riskAssessment: 'medium' as const,
        routePath: 'debate' as const,
        tokenBudget: 'M' as const,
        taskClass: 'text' as const,
        verifiabilityClass: 'medium' as const,
        fileList: [],
        keyConstraints: ['Recover completion before resuming drain'],
      },
      durationMs: 10,
      model: 'analysis-model',
    }
    const receipt = createExecutionReceipt({
      runId: start.runId,
      nodeId: 'ANALYZE',
      result,
      invocation,
      definition,
      capturedAt: completionTime,
      traceId: 'trace-committed',
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertCompletionSession({
      sessionId: `${start.runId}:${leaseId}:ANALYZE:0`,
      runId: start.runId,
      leaseId,
      nodeId: 'ANALYZE',
      attempt: 0,
      phase: 'committed',
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
      preparedAt: completionTime,
      committedAt: completionTime,
    })
    const snapshot = buildRunSnapshot({
      runId: start.runId,
      invocation,
      definition,
      state: runningState,
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
      explicitStatus: 'running',
      timelineCursor: 0,
      skipDecisions: [],
      completionSessions: ledger.listCompletionSessions(start.runId),
    })
    ledger.upsertRun(invocation, definition, snapshot)
    seedClient.close()

    runtime = new AntigravityDaemonRuntime({
      workspaceRoot,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    ;(runtime as any).drainRun = async (runId: string) => {
      ;(runtime as any).activeRuns.delete(runId)
    }

    await runtime.initialize()

    const recovered = await runtime.getRun(start.runId)
    expect(recovered?.snapshot.nodes.ANALYZE?.status).toBe('completed')
    expect((runtime as any).ledger.listExecutionReceipts(start.runId)).toHaveLength(1)
    expect((runtime as any).ledger.listTimeline(start.runId).some((entry: { kind: string }) => entry.kind === 'session.completion-receipt.recovered')).toBe(true)
  })

  it('requeues stale active leases without staged completion bundles', async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-stale-lease-'))
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
      goal: 'Recover a stale active lease',
      files: [],
      initiator: 'test',
      workspaceRoot,
      hostSessionId: 'recover-stale-lease',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const start = await bootstrapDaemonRun(
      createRunRequest(invocation, compileWorkflowDefinition(definition)),
      { eventStore, checkpointStore },
    )
    const startedAt = createISODateTime()
    const version = await eventStore.getCurrentVersion(start.runId)
    await eventStore.append({
      runId: start.runId,
      expectedVersion: version,
      events: [{
        eventId: createEventId(),
        runId: start.runId,
        type: 'NODE_STARTED',
        payload: {
          nodeId: 'ANALYZE',
          model: 'analysis-model',
          leaseId: 'lease-stale',
          attempt: 0,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          requiredEvidence: ['goal'],
          allowedModelPool: ['analysis'],
          inputDigest: 'digest-stale',
        },
        timestamp: startedAt,
        version: version + 1,
      }],
    })
    const runningState = await loadRunStateFromEvents(eventStore, start.runId)
    const snapshot = buildRunSnapshot({
      runId: start.runId,
      invocation,
      definition,
      state: runningState,
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
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
    ;(runtime as any).drainRun = async (runId: string) => {
      ;(runtime as any).activeRuns.delete(runId)
    }

    await runtime.initialize()

    const recovered = await runtime.getRun(start.runId)
    expect(recovered?.snapshot.nodes.ANALYZE?.status).toBe('queued')
    expect((runtime as any).ledger.listTimeline(start.runId).some((entry: { kind: string }) => entry.kind === 'session.lease.recovered')).toBe(true)
  })
})
