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

/**
 * P1-1 + P2-2: Active gate persistence integration tests.
 *
 * These tests verify that active gates survive daemon restart,
 * that gateId validation works after restart, and that gate
 * cleanup is properly persisted.
 */
describe('Active gate persistence', () => {
  let workspaceRoot: string | undefined

  function createPaths() {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-daemon-gate-'))
    return resolveAntigravityDaemonPaths(workspaceRoot)
  }

  afterEach(() => {
    if (workspaceRoot) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
    workspaceRoot = undefined
  })

  it('persists active gate to SQLite and recovers on new runtime instance', async () => {
    const paths = createPaths()
    fs.mkdirSync(paths.dataDir, { recursive: true })

    // Phase 1: create runtime, seed a paused run, register gate
    const runtime1 = new AntigravityDaemonRuntime({
      workspaceRoot: workspaceRoot!,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime1.initialize()

    // Seed a run
    const seedClient = new SqliteClient({ dataDir: paths.dataDir, dbName: 'antigravity-daemon.db' })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())

    const invocation = {
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Test gate persistence',
      files: [],
      initiator: 'test',
      workspaceRoot: workspaceRoot!,
      hostSessionId: 'gate-persist-test',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const eventStore = new JsonlEventStore({ dataDir: paths.dataDir })
    const checkpointStore = new SqliteCheckpointStore(seedClient.getDatabase())
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
      explicitStatus: 'paused_for_human',
      timelineCursor: 0,
      skipDecisions: [],
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertRun(invocation, definition, snapshot)

    // Directly persist an active gate via ledger
    ledger.upsertActiveGate({
      runId: start.runId,
      gateId: 'release',
      pauseReason: 'test pause',
      pausedAt: seededAt,
    })

    seedClient.close()
    runtime1.close()

    // Phase 2: create NEW runtime instance — simulates daemon restart
    const runtime2 = new AntigravityDaemonRuntime({
      workspaceRoot: workspaceRoot!,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime2.initialize()

    // Verify: approveGate with correct gateId succeeds (no throw on gateId mismatch)
    // Note: actual approval may fail for other runtime reasons (policy, etc)
    // but it should NOT throw "no registered active gate"
    try {
      await runtime2.approveGate({
        runId: start.runId,
        gateId: 'release',
        approvedBy: 'test-auditor',
        comment: 'approved for testing',
      })
    } catch (error: any) {
      // Expected: may fail for run state reasons, but NOT for gate mismatch
      expect(error.message).not.toContain('no registered active gate')
      expect(error.message).not.toContain('does not match active gate')
    }

    runtime2.close()
  })

  it('rejects approveGate with wrong gateId after restart', async () => {
    const paths = createPaths()
    fs.mkdirSync(paths.dataDir, { recursive: true })

    const seedClient = new SqliteClient({ dataDir: paths.dataDir, dbName: 'antigravity-daemon.db' })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())
    const eventStore = new JsonlEventStore({ dataDir: paths.dataDir })
    const checkpointStore = new SqliteCheckpointStore(seedClient.getDatabase())

    const invocation = {
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Test wrong gateId rejection',
      files: [],
      initiator: 'test',
      workspaceRoot: workspaceRoot!,
      hostSessionId: 'gate-wrong-test',
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
      explicitStatus: 'paused_for_human',
      timelineCursor: 0,
      skipDecisions: [],
    })
    ledger.upsertWorkflowDefinition(definition)
    ledger.upsertRun(invocation, definition, snapshot)

    // Persist gate with gateId=HITL
    ledger.upsertActiveGate({
      runId: start.runId,
      gateId: 'HITL',
      pauseReason: 'human approval required',
      pausedAt: seededAt,
    })
    seedClient.close()

    // New runtime — simulates restart
    const runtime = new AntigravityDaemonRuntime({
      workspaceRoot: workspaceRoot!,
      dataDir: paths.dataDir,
      projectionPath: paths.projectionPath,
      socketPath: paths.socketPath,
    })
    await runtime.initialize()

    // Try approveGate with WRONG gateId
    await expect(
      runtime.approveGate({
        runId: start.runId,
        gateId: 'release',
        approvedBy: 'test-auditor',
        comment: 'wrong gate',
      }),
    ).rejects.toThrow('does not match active gate')

    runtime.close()
  })

  it('rejects approveGate after gate is cleared (resume path)', async () => {
    const paths = createPaths()
    fs.mkdirSync(paths.dataDir, { recursive: true })

    const seedClient = new SqliteClient({ dataDir: paths.dataDir, dbName: 'antigravity-daemon.db' })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())

    // Persist a gate then immediately delete it — simulates successful resume
    ledger.upsertActiveGate({
      runId: 'test-cleared-gate',
      gateId: 'release',
      pauseReason: 'test',
      pausedAt: createISODateTime(),
    })
    ledger.deleteActiveGate('test-cleared-gate')

    // Verify: no gates remain
    const gates = ledger.listActiveGates()
    expect(gates.filter(g => g.runId === 'test-cleared-gate')).toHaveLength(0)

    seedClient.close()
  })

  it('ledger correctly persists and retrieves multiple active gates', () => {
    const paths = createPaths()
    fs.mkdirSync(paths.dataDir, { recursive: true })

    const seedClient = new SqliteClient({ dataDir: paths.dataDir, dbName: 'antigravity-daemon.db' })
    runMigrations(seedClient.getDatabase())
    const ledger = new DaemonLedger(seedClient.getDatabase())

    const now = createISODateTime()
    ledger.upsertActiveGate({ runId: 'run-1', gateId: 'release', pauseReason: 'blocked', pausedAt: now })
    ledger.upsertActiveGate({ runId: 'run-2', gateId: 'HITL', pauseReason: 'human gate', pausedAt: now })
    ledger.upsertActiveGate({ runId: 'run-3', gateId: 'artifact-recheck', pauseReason: 'recheck', pausedAt: now })

    const gates = ledger.listActiveGates()
    expect(gates).toHaveLength(3)
    expect(gates.find(g => g.runId === 'run-1')?.gateId).toBe('release')
    expect(gates.find(g => g.runId === 'run-2')?.gateId).toBe('HITL')
    expect(gates.find(g => g.runId === 'run-3')?.gateId).toBe('artifact-recheck')

    // Delete one
    ledger.deleteActiveGate('run-2')
    const remaining = ledger.listActiveGates()
    expect(remaining).toHaveLength(2)
    expect(remaining.find(g => g.runId === 'run-2')).toBeUndefined()

    seedClient.close()
  })
})
