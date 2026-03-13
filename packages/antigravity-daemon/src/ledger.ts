import type Database from 'better-sqlite3'
import type {
  CompletionSessionRecord,
  ExecutionReceipt,
  HandoffEnvelope,
  PolicyVerdict,
  RunDetails,
  RunSnapshot,
  SkipDecision,
  TimelineEntry,
  TribunalVerdictRecord,
  WorkflowDefinition,
  WorkflowInvocation,
} from './schema.js'

function ensureDaemonSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const hasVersion = db.prepare(
    'SELECT version FROM daemon_schema_migrations WHERE version = ?',
  )

  const apply = (version: number, sql: string): void => {
    const row = hasVersion.get(version) as { version: number } | undefined
    if (row) {
      return
    }
    db.transaction(() => {
      db.exec(sql)
      db.prepare(
        'INSERT INTO daemon_schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(version, new Date().toISOString())
    })()
  }

  apply(1, `
    CREATE TABLE IF NOT EXISTS workflowDefinitions (
      workflowId TEXT NOT NULL,
      workflowVersion TEXT NOT NULL,
      definitionJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      PRIMARY KEY (workflowId, workflowVersion)
    );

    CREATE TABLE IF NOT EXISTS daemonRuns (
      runId TEXT PRIMARY KEY,
      workflowId TEXT NOT NULL,
      workflowVersion TEXT NOT NULL,
      invocationJson TEXT NOT NULL,
      definitionJson TEXT NOT NULL,
      snapshotJson TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL,
      verdict TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daemonTimeline (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      runId TEXT NOT NULL,
      kind TEXT NOT NULL,
      nodeId TEXT,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonTimeline_run_sequence ON daemonTimeline(runId, sequence);

    CREATE TABLE IF NOT EXISTS daemonExecutionReceipts (
      receiptId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonExecutionReceipts_run_createdAt ON daemonExecutionReceipts(runId, createdAt);

    CREATE TABLE IF NOT EXISTS daemonSkipDecisions (
      skipDecisionId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonSkipDecisions_run_createdAt ON daemonSkipDecisions(runId, createdAt);

    CREATE TABLE IF NOT EXISTS daemonPolicyVerdicts (
      verdictId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      scope TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonPolicyVerdicts_run_createdAt ON daemonPolicyVerdicts(runId, createdAt);
  `)

  apply(2, `
    CREATE TABLE IF NOT EXISTS daemonHandoffEnvelopes (
      handoffId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      sourceNodeId TEXT NOT NULL,
      targetNodeId TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonHandoffEnvelopes_run_createdAt ON daemonHandoffEnvelopes(runId, createdAt);
  `)

  apply(3, `
    CREATE TABLE IF NOT EXISTS daemonTribunalVerdicts (
      tribunalId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daemonTribunalVerdicts_run_createdAt ON daemonTribunalVerdicts(runId, createdAt);

    CREATE TABLE IF NOT EXISTS daemonCompletionSessions (
      sessionId TEXT PRIMARY KEY,
      runId TEXT NOT NULL,
      leaseId TEXT NOT NULL,
      nodeId TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      phase TEXT NOT NULL,
      payloadJson TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_daemonCompletionSessions_identity
      ON daemonCompletionSessions(runId, leaseId, nodeId, attempt);
    CREATE INDEX IF NOT EXISTS idx_daemonCompletionSessions_run_updatedAt
      ON daemonCompletionSessions(runId, updatedAt);
  `)

  apply(4, `
    CREATE TABLE IF NOT EXISTS daemonActiveGates (
      runId TEXT PRIMARY KEY,
      gateId TEXT NOT NULL,
      pauseReason TEXT NOT NULL,
      pausedAt TEXT NOT NULL
    );
  `)
}

interface ActiveGateRow {
  runId: string
  gateId: string
  pauseReason: string
  pausedAt: string
}

interface RunRow {
  invocationJson: string
  definitionJson: string
  snapshotJson: string
}

interface TimelineRow {
  sequence: number
  runId: string
  kind: string
  nodeId: string | null
  payloadJson: string
  createdAt: string
}

interface PayloadRow {
  payloadJson: string
}

export class DaemonLedger {
  private readonly db: Database.Database
  private readonly upsertWorkflowStmt: Database.Statement
  private readonly upsertRunStmt: Database.Statement
  private readonly getRunStmt: Database.Statement
  private readonly insertTimelineStmt: Database.Statement
  private readonly listTimelineStmt: Database.Statement
  private readonly latestTimelineStmt: Database.Statement
  private readonly latestTimelineByKindStmt: Database.Statement
  private readonly insertReceiptStmt: Database.Statement
  private readonly listReceiptsStmt: Database.Statement
  private readonly insertSkipStmt: Database.Statement
  private readonly listSkipsStmt: Database.Statement
  private readonly insertVerdictStmt: Database.Statement
  private readonly listVerdictsStmt: Database.Statement
  private readonly insertHandoffStmt: Database.Statement
  private readonly listHandoffsStmt: Database.Statement
  private readonly insertTribunalStmt: Database.Statement
  private readonly listTribunalsStmt: Database.Statement
  private readonly latestTribunalStmt: Database.Statement
  private readonly upsertCompletionSessionStmt: Database.Statement
  private readonly getCompletionSessionStmt: Database.Statement
  private readonly listCompletionSessionsStmt: Database.Statement
  private readonly upsertActiveGateStmt: Database.Statement
  private readonly deleteActiveGateStmt: Database.Statement
  private readonly listActiveGatesStmt: Database.Statement

  constructor(db: Database.Database) {
    ensureDaemonSchema(db)
    this.db = db
    this.upsertWorkflowStmt = this.db.prepare(`
      INSERT INTO workflowDefinitions (workflowId, workflowVersion, definitionJson, createdAt)
      VALUES (@workflowId, @workflowVersion, @definitionJson, @createdAt)
      ON CONFLICT(workflowId, workflowVersion) DO UPDATE SET
        definitionJson = excluded.definitionJson
    `)
    this.upsertRunStmt = this.db.prepare(`
      INSERT INTO daemonRuns (
        runId, workflowId, workflowVersion, invocationJson, definitionJson,
        snapshotJson, status, phase, verdict, createdAt, updatedAt
      )
      VALUES (
        @runId, @workflowId, @workflowVersion, @invocationJson, @definitionJson,
        @snapshotJson, @status, @phase, @verdict, @createdAt, @updatedAt
      )
      ON CONFLICT(runId) DO UPDATE SET
        snapshotJson = excluded.snapshotJson,
        status = excluded.status,
        phase = excluded.phase,
        verdict = excluded.verdict,
        updatedAt = excluded.updatedAt
    `)
    this.getRunStmt = this.db.prepare(`
      SELECT invocationJson, definitionJson, snapshotJson
      FROM daemonRuns
      WHERE runId = ?
    `)
    this.insertTimelineStmt = this.db.prepare(`
      INSERT INTO daemonTimeline (runId, kind, nodeId, payloadJson, createdAt)
      VALUES (@runId, @kind, @nodeId, @payloadJson, @createdAt)
    `)
    this.listTimelineStmt = this.db.prepare(`
      SELECT sequence, runId, kind, nodeId, payloadJson, createdAt
      FROM daemonTimeline
      WHERE runId = ? AND sequence > ?
      ORDER BY sequence ASC
    `)
    this.latestTimelineStmt = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) as sequence
      FROM daemonTimeline
      WHERE runId = ?
    `)
    this.latestTimelineByKindStmt = this.db.prepare(`
      SELECT sequence, runId, kind, nodeId, payloadJson, createdAt
      FROM daemonTimeline
      WHERE runId = ? AND kind = ?
      ORDER BY sequence DESC
      LIMIT 1
    `)
    this.insertReceiptStmt = this.db.prepare(`
      INSERT OR REPLACE INTO daemonExecutionReceipts (receiptId, runId, nodeId, payloadJson, createdAt)
      VALUES (@receiptId, @runId, @nodeId, @payloadJson, @createdAt)
    `)
    this.listReceiptsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonExecutionReceipts
      WHERE runId = ?
      ORDER BY createdAt ASC
    `)
    this.insertSkipStmt = this.db.prepare(`
      INSERT OR REPLACE INTO daemonSkipDecisions (skipDecisionId, runId, nodeId, payloadJson, createdAt)
      VALUES (@skipDecisionId, @runId, @nodeId, @payloadJson, @createdAt)
    `)
    this.listSkipsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonSkipDecisions
      WHERE runId = ?
      ORDER BY createdAt ASC
    `)
    this.insertVerdictStmt = this.db.prepare(`
      INSERT OR REPLACE INTO daemonPolicyVerdicts (verdictId, runId, scope, payloadJson, createdAt)
      VALUES (@verdictId, @runId, @scope, @payloadJson, @createdAt)
    `)
    this.listVerdictsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonPolicyVerdicts
      WHERE runId = ?
      ORDER BY createdAt ASC
    `)
    this.insertHandoffStmt = this.db.prepare(`
      INSERT OR REPLACE INTO daemonHandoffEnvelopes (
        handoffId, runId, sourceNodeId, targetNodeId, payloadJson, createdAt
      )
      VALUES (
        @handoffId, @runId, @sourceNodeId, @targetNodeId, @payloadJson, @createdAt
      )
    `)
    this.listHandoffsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonHandoffEnvelopes
      WHERE runId = ?
      ORDER BY createdAt ASC
    `)
    this.insertTribunalStmt = this.db.prepare(`
      INSERT OR REPLACE INTO daemonTribunalVerdicts (tribunalId, runId, nodeId, payloadJson, createdAt)
      VALUES (@tribunalId, @runId, @nodeId, @payloadJson, @createdAt)
    `)
    this.listTribunalsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonTribunalVerdicts
      WHERE runId = ?
      ORDER BY createdAt ASC
    `)
    this.latestTribunalStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonTribunalVerdicts
      WHERE runId = ?
      ORDER BY createdAt DESC
      LIMIT 1
    `)
    this.upsertCompletionSessionStmt = this.db.prepare(`
      INSERT INTO daemonCompletionSessions (
        sessionId, runId, leaseId, nodeId, attempt, phase, payloadJson, createdAt, updatedAt
      )
      VALUES (
        @sessionId, @runId, @leaseId, @nodeId, @attempt, @phase, @payloadJson, @createdAt, @updatedAt
      )
      ON CONFLICT(sessionId) DO UPDATE SET
        phase = excluded.phase,
        payloadJson = excluded.payloadJson,
        updatedAt = excluded.updatedAt
    `)
    this.getCompletionSessionStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonCompletionSessions
      WHERE runId = ? AND leaseId = ? AND nodeId = ? AND attempt = ?
      LIMIT 1
    `)
    this.listCompletionSessionsStmt = this.db.prepare(`
      SELECT payloadJson
      FROM daemonCompletionSessions
      WHERE runId = ?
      ORDER BY updatedAt ASC
    `)
    this.upsertActiveGateStmt = this.db.prepare(`
      INSERT INTO daemonActiveGates (runId, gateId, pauseReason, pausedAt)
      VALUES (@runId, @gateId, @pauseReason, @pausedAt)
      ON CONFLICT(runId) DO UPDATE SET
        gateId = excluded.gateId,
        pauseReason = excluded.pauseReason,
        pausedAt = excluded.pausedAt
    `)
    this.deleteActiveGateStmt = this.db.prepare(`
      DELETE FROM daemonActiveGates WHERE runId = ?
    `)
    this.listActiveGatesStmt = this.db.prepare(`
      SELECT runId, gateId, pauseReason, pausedAt FROM daemonActiveGates
    `)
  }

  listRunsByStatuses(statuses: readonly string[]): RunDetails[] {
    if (statuses.length === 0) {
      return []
    }
    const placeholders = statuses.map(() => '?').join(', ')
    const stmt = this.db.prepare(`
      SELECT invocationJson, definitionJson, snapshotJson
      FROM daemonRuns
      WHERE status IN (${placeholders})
      ORDER BY createdAt ASC
    `)
    const rows = stmt.all(...statuses) as RunRow[]
    return rows.map(row => ({
      invocation: JSON.parse(row.invocationJson) as WorkflowInvocation,
      definition: JSON.parse(row.definitionJson) as WorkflowDefinition,
      snapshot: JSON.parse(row.snapshotJson) as RunSnapshot,
    }))
  }

  upsertWorkflowDefinition(definition: WorkflowDefinition): void {
    this.upsertWorkflowStmt.run({
      workflowId: definition.workflowId,
      workflowVersion: definition.version,
      definitionJson: JSON.stringify(definition),
      createdAt: definition.generatedAt,
    })
  }

  upsertRun(
    invocation: WorkflowInvocation,
    definition: WorkflowDefinition,
    snapshot: RunSnapshot,
  ): void {
    this.upsertRunStmt.run({
      runId: snapshot.runId,
      workflowId: definition.workflowId,
      workflowVersion: definition.version,
      invocationJson: JSON.stringify(invocation),
      definitionJson: JSON.stringify(definition),
      snapshotJson: JSON.stringify(snapshot),
      status: snapshot.status,
      phase: snapshot.phase,
      verdict: snapshot.verdict ?? null,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    })
  }

  getRun(runId: string): RunDetails | null {
    const row = this.getRunStmt.get(runId) as RunRow | undefined
    if (!row) {
      return null
    }
    return {
      invocation: JSON.parse(row.invocationJson) as WorkflowInvocation,
      definition: JSON.parse(row.definitionJson) as WorkflowDefinition,
      snapshot: JSON.parse(row.snapshotJson) as RunSnapshot,
    }
  }

  appendTimeline(
    runId: string,
    kind: string,
    nodeId: string | undefined,
    payload: Record<string, unknown>,
    createdAt: string,
  ): TimelineEntry {
    const result = this.insertTimelineStmt.run({
      runId,
      kind,
      nodeId: nodeId ?? null,
      payloadJson: JSON.stringify(payload),
      createdAt,
    })
    return {
      sequence: Number(result.lastInsertRowid),
      runId,
      kind,
      nodeId,
      payload,
      createdAt,
    }
  }

  listTimeline(runId: string, afterSequence = 0): TimelineEntry[] {
    const rows = this.listTimelineStmt.all(runId, afterSequence) as TimelineRow[]
    return rows.map(row => ({
      sequence: row.sequence,
      runId: row.runId,
      kind: row.kind,
      nodeId: row.nodeId ?? undefined,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      createdAt: row.createdAt,
    }))
  }

  getLatestTimelineCursor(runId: string): number {
    const row = this.latestTimelineStmt.get(runId) as { sequence: number } | undefined
    return row?.sequence ?? 0
  }

  getLatestTimelineByKind(runId: string, kind: string): TimelineEntry | undefined {
    const row = this.latestTimelineByKindStmt.get(runId, kind) as TimelineRow | undefined
    if (!row) {
      return undefined
    }
    return {
      sequence: row.sequence,
      runId: row.runId,
      kind: row.kind,
      nodeId: row.nodeId ?? undefined,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      createdAt: row.createdAt,
    }
  }

  recordExecutionReceipt(receipt: ExecutionReceipt): void {
    this.insertReceiptStmt.run({
      receiptId: receipt.receiptId,
      runId: receipt.runId,
      nodeId: receipt.nodeId,
      payloadJson: JSON.stringify(receipt),
      createdAt: receipt.capturedAt,
    })
  }

  listExecutionReceipts(runId: string): ExecutionReceipt[] {
    const rows = this.listReceiptsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as ExecutionReceipt)
  }

  recordSkipDecision(decision: SkipDecision): void {
    this.insertSkipStmt.run({
      skipDecisionId: decision.skipDecisionId,
      runId: decision.runId,
      nodeId: decision.nodeId,
      payloadJson: JSON.stringify(decision),
      createdAt: decision.decidedAt,
    })
  }

  listSkipDecisions(runId: string): SkipDecision[] {
    const rows = this.listSkipsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as SkipDecision)
  }

  recordPolicyVerdict(verdict: PolicyVerdict): void {
    this.insertVerdictStmt.run({
      verdictId: verdict.verdictId,
      runId: verdict.runId,
      scope: verdict.scope,
      payloadJson: JSON.stringify(verdict),
      createdAt: verdict.evaluatedAt,
    })
  }

  listPolicyVerdicts(runId: string): PolicyVerdict[] {
    const rows = this.listVerdictsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as PolicyVerdict)
  }

  recordHandoffEnvelope(envelope: HandoffEnvelope): void {
    this.insertHandoffStmt.run({
      handoffId: envelope.handoffId,
      runId: envelope.runId,
      sourceNodeId: envelope.sourceNodeId,
      targetNodeId: envelope.targetNodeId,
      payloadJson: JSON.stringify(envelope),
      createdAt: envelope.createdAt,
    })
  }

  listHandoffEnvelopes(runId: string): HandoffEnvelope[] {
    const rows = this.listHandoffsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as HandoffEnvelope)
  }

  recordTribunalVerdict(verdict: TribunalVerdictRecord): void {
    this.insertTribunalStmt.run({
      tribunalId: verdict.tribunalId,
      runId: verdict.runId,
      nodeId: verdict.nodeId,
      payloadJson: JSON.stringify(verdict),
      createdAt: verdict.createdAt,
    })
  }

  listTribunalVerdicts(runId: string): TribunalVerdictRecord[] {
    const rows = this.listTribunalsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as TribunalVerdictRecord)
  }

  getLatestTribunalVerdict(runId: string): TribunalVerdictRecord | undefined {
    const row = this.latestTribunalStmt.get(runId) as PayloadRow | undefined
    if (!row) {
      return undefined
    }
    return JSON.parse(row.payloadJson) as TribunalVerdictRecord
  }

  upsertCompletionSession(session: CompletionSessionRecord): void {
    this.upsertCompletionSessionStmt.run({
      sessionId: session.sessionId,
      runId: session.runId,
      leaseId: session.leaseId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      phase: session.phase,
      payloadJson: JSON.stringify(session),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    })
  }

  getCompletionSession(
    runId: string,
    leaseId: string,
    nodeId: string,
    attempt: number,
  ): CompletionSessionRecord | null {
    const row = this.getCompletionSessionStmt.get(runId, leaseId, nodeId, attempt) as PayloadRow | undefined
    if (!row) {
      return null
    }
    return JSON.parse(row.payloadJson) as CompletionSessionRecord
  }

  listCompletionSessions(runId: string): CompletionSessionRecord[] {
    const rows = this.listCompletionSessionsStmt.all(runId) as PayloadRow[]
    return rows.map(row => JSON.parse(row.payloadJson) as CompletionSessionRecord)
  }

  // ─── P1-1: active gate persistence ───────────────────────────

  upsertActiveGate(gate: { runId: string; gateId: string; pauseReason: string; pausedAt: string }): void {
    this.upsertActiveGateStmt.run({
      runId: gate.runId,
      gateId: gate.gateId,
      pauseReason: gate.pauseReason,
      pausedAt: gate.pausedAt,
    })
  }

  deleteActiveGate(runId: string): void {
    this.deleteActiveGateStmt.run(runId)
  }

  listActiveGates(): Array<{ runId: string; gateId: string; pauseReason: string; pausedAt: string }> {
    const rows = this.listActiveGatesStmt.all() as ActiveGateRow[]
    return rows.map(row => ({
      runId: row.runId,
      gateId: row.gateId,
      pauseReason: row.pauseReason,
      pausedAt: row.pausedAt,
    }))
  }
}
