import * as crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import {
  type AggregateAnalysis,
  CancelTaskJobResponseSchema,
  type CreateTaskJobRequest,
  CreateTaskJobRequestSchema,
  type ScoutManifest,
  type ShardAnalysis,
  type TaskGraphStage,
  type TaskJobEvent,
  type TaskJobEventType,
  type TaskJobSnapshot,
  type TaskJobStatus,
  type TaskStageId,
  type VerifyAnalysis,
  type WorkerAdapter,
  type WorkerBackend,
  type WorkerEvent,
  type WorkerPhase,
  type WorkerRole,
  type WorkerSnapshot,
  type WriteAnalysis,
} from './schema.js'
import { TaskPersistenceStore } from './persistence.js'
import { chunkShardFiles, listWorkspaceFiles, pickSharedFiles, totalBytes, type WorkspaceFileEntry } from './file-context.js'
import { buildAggregatePrompt, buildFinalAnswer, buildScoutPrompt, buildShardPrompt, buildVerifyPrompt, buildWritePrompt } from './prompts.js'
import { parseStructuredJson } from './parsing.js'
import { createWorkerAdapters } from './workers.js'
import type { TaskdPaths } from './runtime-contract.js'

interface ExecutionProfile {
  kind: 'single' | 'dual' | 'sharded'
}

const STAGE_BUDGETS: Record<TaskStageId, { softBudgetMs: number; hardBudgetMs: number }> = {
  SCOUT: { softBudgetMs: 60_000, hardBudgetMs: 120_000 },
  SHARD_ANALYZE: { softBudgetMs: 1_800_000, hardBudgetMs: 2_100_000 },
  AGGREGATE: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  VERIFY: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  WRITE: { softBudgetMs: 900_000, hardBudgetMs: 1_200_000 },
  FINALIZE: { softBudgetMs: 240_000, hardBudgetMs: 300_000 },
}

function nowIso(): string {
  return new Date().toISOString()
}

function isTerminalStatus(status: TaskJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function createGraph(): TaskGraphStage[] {
  return (Object.keys(STAGE_BUDGETS) as TaskStageId[]).map((id) => ({
    id,
    status: id === 'WRITE' ? 'skipped' : 'pending',
    softBudgetMs: STAGE_BUDGETS[id].softBudgetMs,
    hardBudgetMs: STAGE_BUDGETS[id].hardBudgetMs,
    shardIds: [],
  }))
}

function findStage(snapshot: TaskJobSnapshot, stageId: TaskStageId): TaskGraphStage {
  const stage = snapshot.graph.find(candidate => candidate.id === stageId)
  if (!stage) throw new Error(`Missing stage ${stageId}`)
  return stage
}

function updateJobStatusFromStage(stageId: TaskStageId): TaskJobStatus {
  switch (stageId) {
    case 'SCOUT':
      return 'planning'
    case 'VERIFY':
      return 'verifying'
    case 'WRITE':
      return 'writing'
    default:
      return 'running'
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function createFallbackScoutManifest(goal: string, relevantFiles: WorkspaceFileEntry[]): ScoutManifest {
  const sharedFiles = pickSharedFiles(relevantFiles.map(file => file.path))
  const shards = chunkShardFiles(relevantFiles).map((filePaths, index) => ({
    shardId: `shard-${index + 1}`,
    filePaths,
    sharedFiles,
  }))
  return {
    goalSummary: goal,
    relevantPaths: relevantFiles.map(file => file.path),
    shards,
    unknowns: [],
    riskFlags: [],
  }
}

function coerceScoutManifest(goal: string, raw: string, workspaceFiles: WorkspaceFileEntry[]): ScoutManifest {
  const parsed = parseStructuredJson<any>(raw)
  if (!parsed) return createFallbackScoutManifest(goal, workspaceFiles)
  const relevantPaths = unique(
    asStringArray(parsed.relevantPaths).filter(path => workspaceFiles.some(file => file.path === path)),
  )
  const shards = Array.isArray(parsed.shards)
    ? parsed.shards.map((shard: any, index: number) => ({
      shardId: typeof shard?.shardId === 'string' ? shard.shardId : `shard-${index + 1}`,
      filePaths: asStringArray(shard?.filePaths).filter(path => relevantPaths.includes(path)),
      sharedFiles: asStringArray(shard?.sharedFiles).slice(0, 5),
    })).filter((shard: any) => shard.filePaths.length > 0)
    : []
  if (relevantPaths.length === 0 || shards.length === 0) {
    return createFallbackScoutManifest(goal, workspaceFiles)
  }
  return {
    goalSummary: typeof parsed.goalSummary === 'string' ? parsed.goalSummary : goal,
    relevantPaths,
    shards,
    unknowns: asStringArray(parsed.unknowns),
    riskFlags: asStringArray(parsed.riskFlags),
  }
}

function coerceShardAnalysis(shardId: string, backend: WorkerBackend, raw: string): ShardAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    shardId,
    backend,
    summary: typeof parsed?.summary === 'string' ? parsed.summary : raw.trim().slice(0, 800),
    evidence: asStringArray(parsed?.evidence),
    symbols: asStringArray(parsed?.symbols),
    dependencies: asStringArray(parsed?.dependencies),
    openQuestions: asStringArray(parsed?.openQuestions),
    confidence: Math.max(0, Math.min(1, asNumber(parsed?.confidence, 0.65))),
  }
}

function coerceAggregate(raw: string): AggregateAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    globalSummary: typeof parsed?.globalSummary === 'string' ? parsed.globalSummary : raw.trim().slice(0, 1200),
    agreements: asStringArray(parsed?.agreements),
    conflicts: asStringArray(parsed?.conflicts),
    missingCoverage: asStringArray(parsed?.missingCoverage),
  }
}

function coerceVerify(raw: string): VerifyAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    verdict: typeof parsed?.verdict === 'string' ? parsed.verdict : 'warn',
    coverageGaps: asStringArray(parsed?.coverageGaps),
    riskFindings: asStringArray(parsed?.riskFindings),
    followups: asStringArray(parsed?.followups),
  }
}

function coerceWrite(raw: string): WriteAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    changePlan: typeof parsed?.changePlan === 'string' ? parsed.changePlan : raw.trim().slice(0, 800),
    targetFiles: asStringArray(parsed?.targetFiles),
    executionLog: asStringArray(parsed?.executionLog),
    diffSummary: typeof parsed?.diffSummary === 'string' ? parsed.diffSummary : raw.trim().slice(0, 800),
  }
}

function chooseExecutionProfile(files: WorkspaceFileEntry[]): ExecutionProfile {
  const count = files.length
  const bytes = totalBytes(files)
  if (count <= 6 && bytes <= 300 * 1024) {
    return { kind: 'single' }
  }
  if (count <= 20 && bytes <= 900 * 1024) {
    return { kind: 'dual' }
  }
  return { kind: 'sharded' }
}

export class AntigravityTaskdRuntime {
  private readonly persistence: TaskPersistenceStore
  private readonly adapters: Record<WorkerBackend, WorkerAdapter>
  private readonly jobs = new Map<string, TaskJobSnapshot>()
  private readonly listeners = new EventEmitter()
  private readonly controllers = new Map<string, AbortController>()
  private readonly sequenceByJob = new Map<string, number>()

  constructor(
    private readonly paths: TaskdPaths,
    adapters: Record<WorkerBackend, WorkerAdapter> = createWorkerAdapters(),
  ) {
    this.persistence = new TaskPersistenceStore(paths.jobsDir)
    this.adapters = adapters
  }

  async initialize(): Promise<void> {
    for (const snapshot of this.persistence.readAllSnapshots()) {
      if (!isTerminalStatus(snapshot.status)) {
        snapshot.status = 'failed'
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          'taskd restarted before the job reached a terminal state',
        ])
        snapshot.updatedAt = nowIso()
        this.persistence.saveSnapshot(snapshot)
      }
      const lastSequence = snapshot.recentEvents.at(-1)?.sequence ?? 0
      this.sequenceByJob.set(snapshot.jobId, lastSequence)
      this.jobs.set(snapshot.jobId, snapshot)
    }
  }

  createJob(input: CreateTaskJobRequest): TaskJobSnapshot {
    const request = CreateTaskJobRequestSchema.parse(input)
    const createdAt = nowIso()
    const jobId = crypto.randomUUID()
    const snapshot: TaskJobSnapshot = {
      jobId,
      status: 'queued',
      mode: request.mode,
      workspaceRoot: request.workspaceRoot,
      goal: request.goal,
      currentStageId: 'SCOUT',
      graph: createGraph(),
      workers: [],
      summary: {
        goalSummary: request.goal,
        globalSummary: '',
        verdict: '',
        finalAnswer: '',
        coverageGaps: [],
        riskFindings: [],
        openQuestions: [],
      },
      artifacts: {
        snapshotPath: this.persistence.snapshotPath(jobId),
        eventsPath: this.persistence.eventsPath(jobId),
        latestDiff: undefined,
        changedFiles: [],
        shardCount: 0,
      },
      recentEvents: [],
      fileHints: request.fileHints ?? [],
      createdAt,
      updatedAt: createdAt,
    }
    this.sequenceByJob.set(jobId, 0)
    this.jobs.set(jobId, snapshot)
    this.persistence.saveSnapshot(snapshot)
    this.emitJobEvent(jobId, 'job.created', {
      goal: request.goal,
      mode: request.mode,
    })

    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    void this.executeJob(jobId, controller.signal).catch((error) => {
      const current = this.jobs.get(jobId)
      if (!current || current.status === 'cancelled') return
      current.status = 'failed'
      current.updatedAt = nowIso()
      current.summary.riskFindings = unique([
        ...current.summary.riskFindings,
        error instanceof Error ? error.message : String(error),
      ])
      this.emitJobEvent(jobId, 'job.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    return snapshot
  }

  listJobs(): TaskJobSnapshot[] {
    return [...this.jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  getJob(jobId: string): TaskJobSnapshot | null {
    return this.jobs.get(jobId) ?? this.persistence.readSnapshot(jobId)
  }

  cancelJob(jobId: string): { jobId: string; cancelled: boolean } {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot || isTerminalStatus(snapshot.status)) {
      return CancelTaskJobResponseSchema.parse({ jobId, cancelled: false })
    }
    snapshot.status = 'cancelled'
    snapshot.updatedAt = nowIso()
    this.controllers.get(jobId)?.abort()
    this.emitJobEvent(jobId, 'job.cancelled', {
      reason: 'Cancelled by user',
    })
    return CancelTaskJobResponseSchema.parse({ jobId, cancelled: true })
  }

  subscribe(jobId: string, listener: (event: TaskJobEvent) => void): () => void {
    this.listeners.on(jobId, listener)
    return () => {
      this.listeners.off(jobId, listener)
    }
  }

  private emitJobEvent(jobId: string, type: TaskJobEventType, data: Record<string, unknown>): void {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot) return
    const sequence = (this.sequenceByJob.get(jobId) ?? 0) + 1
    this.sequenceByJob.set(jobId, sequence)
    const event: TaskJobEvent = {
      eventId: crypto.randomUUID(),
      jobId,
      type,
      sequence,
      timestamp: nowIso(),
      data,
    }
    snapshot.recentEvents = [...snapshot.recentEvents, event].slice(-100)
    snapshot.updatedAt = event.timestamp
    this.persistence.appendEvent(jobId, event)
    this.persistence.saveSnapshot(snapshot)
    this.listeners.emit(jobId, event)
  }

  private markStageStarted(snapshot: TaskJobSnapshot, stageId: TaskStageId, detail?: string): void {
    const stage = findStage(snapshot, stageId)
    stage.status = 'running'
    stage.startedAt = nowIso()
    stage.detail = detail
    snapshot.currentStageId = stageId
    snapshot.status = updateJobStatusFromStage(stageId)
    snapshot.updatedAt = nowIso()
    this.persistence.saveSnapshot(snapshot)
  }

  private markStageCompleted(snapshot: TaskJobSnapshot, stageId: TaskStageId, detail?: string): void {
    const stage = findStage(snapshot, stageId)
    stage.status = 'completed'
    stage.completedAt = nowIso()
    stage.detail = detail
    snapshot.updatedAt = nowIso()
    this.persistence.saveSnapshot(snapshot)
  }

  private upsertWorker(snapshot: TaskJobSnapshot, nextWorker: WorkerSnapshot): void {
    const existingIndex = snapshot.workers.findIndex(worker => worker.workerId === nextWorker.workerId)
    if (existingIndex >= 0) {
      snapshot.workers[existingIndex] = nextWorker
    } else {
      snapshot.workers.push(nextWorker)
    }
    snapshot.updatedAt = nowIso()
    this.persistence.saveSnapshot(snapshot)
  }

  private createWorkerSnapshot(
    workerId: string,
    backend: WorkerBackend,
    role: WorkerRole,
    currentShardId: string | undefined,
  ): WorkerSnapshot {
    const timestamp = nowIso()
    return {
      workerId,
      backend,
      role,
      status: 'queued',
      phase: 'queued',
      message: 'Queued',
      progress: 0,
      currentShardId,
      lastEventAt: timestamp,
      targetFiles: [],
    }
  }

  private applyWorkerEvent(
    snapshot: TaskJobSnapshot,
    worker: WorkerSnapshot,
    event: WorkerEvent,
  ): void {
    worker.phase = event.phase ?? worker.phase
    worker.message = event.message ?? worker.message
    worker.progress = event.progress ?? worker.progress
    worker.lastEventAt = nowIso()
    if (event.type === 'started') {
      worker.status = 'running'
      worker.startedAt = worker.startedAt ?? worker.lastEventAt
    }
    if (event.type === 'completed') {
      worker.status = 'completed'
      worker.phase = 'done'
      worker.progress = 1
      worker.completedAt = worker.lastEventAt
    }
    if (event.type === 'failed') {
      worker.status = 'failed'
      worker.phase = 'error'
      worker.completedAt = worker.lastEventAt
    }
    if (event.type === 'file_change') {
      const changedFiles = Array.isArray(event.details?.changes)
        ? (event.details?.changes as any[]).map(change =>
          typeof change?.path === 'string' ? change.path : typeof change?.newPath === 'string' ? change.newPath : undefined,
        ).filter((value): value is string => Boolean(value))
        : []
      worker.targetFiles = unique([...worker.targetFiles, ...changedFiles])
      snapshot.artifacts.changedFiles = unique([...snapshot.artifacts.changedFiles, ...changedFiles])
    }
    if (event.type === 'diff_update' && typeof event.details?.diff === 'string') {
      snapshot.artifacts.latestDiff = event.details.diff
    }
    this.upsertWorker(snapshot, worker)
  }

  private mapWorkerEventType(event: WorkerEvent): TaskJobEventType {
    switch (event.type) {
      case 'tool_use':
        return 'worker.tool_use'
      case 'tool_result':
        return 'worker.tool_result'
      case 'file_change':
        return 'worker.file_change'
      case 'diff_update':
        return 'worker.diff_update'
      default:
        return 'worker.progress'
    }
  }

  private async runWorker(
    snapshot: TaskJobSnapshot,
    backend: WorkerBackend,
    role: WorkerRole,
    prompt: string,
    filePaths: string[],
    stageId: TaskStageId,
    currentShardId?: string,
  ) {
    const adapter = this.adapters[backend]
    const workerId = `${backend}-${role}-${crypto.randomUUID().slice(0, 8)}`
    const worker = this.createWorkerSnapshot(workerId, backend, role, currentShardId)
    this.upsertWorker(snapshot, worker)

    const parentController = this.controllers.get(snapshot.jobId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), STAGE_BUDGETS[stageId].hardBudgetMs)
    const abort = () => controller.abort()
    parentController?.signal.addEventListener('abort', abort, { once: true })

    try {
      const result = await adapter.run({
        workerId,
        prompt,
        cwd: snapshot.workspaceRoot,
        filePaths,
        mode: role === 'writer' ? 'write' : 'analysis',
        role,
        hardBudgetMs: STAGE_BUDGETS[stageId].hardBudgetMs,
      }, (event) => {
        this.applyWorkerEvent(snapshot, worker, event)
        this.emitJobEvent(snapshot.jobId, this.mapWorkerEventType(event), {
          workerId,
          backend,
          role,
          currentShardId,
          phase: event.phase,
          message: event.message,
          progress: event.progress,
          details: event.details,
        })
      }, controller.signal)

      worker.status = 'completed'
      worker.phase = 'done'
      worker.progress = 1
      worker.completedAt = nowIso()
      worker.message = worker.message || 'Completed'
      worker.targetFiles = unique([...worker.targetFiles, ...result.changedFiles])
      this.upsertWorker(snapshot, worker)
      snapshot.artifacts.changedFiles = unique([...snapshot.artifacts.changedFiles, ...result.changedFiles])
      if (result.diff) {
        snapshot.artifacts.latestDiff = result.diff
      }
      return result
    } catch (error) {
      worker.status = controller.signal.aborted && !parentController?.signal.aborted ? 'failed' : 'cancelled'
      worker.phase = 'error'
      worker.completedAt = nowIso()
      worker.message = error instanceof Error ? error.message : String(error)
      this.upsertWorker(snapshot, worker)
      throw error
    } finally {
      clearTimeout(timeout)
      parentController?.signal.removeEventListener('abort', abort)
    }
  }

  private async executeJob(jobId: string, signal: AbortSignal): Promise<void> {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot) return

    const workspaceFiles = listWorkspaceFiles(snapshot.workspaceRoot)
    const fileHintEntries = snapshot.fileHints.length > 0
      ? workspaceFiles.filter(file => snapshot.fileHints.includes(file.path))
      : workspaceFiles

    this.markStageStarted(snapshot, 'SCOUT', 'Planning shard graph')
    const scoutPrompt = buildScoutPrompt(
      snapshot.goal,
      snapshot.mode,
      snapshot.fileHints,
      fileHintEntries.map(file => `${file.path} (${file.size} bytes)`),
    )
    const scoutResult = await this.runWorker(snapshot, 'codex', 'scout', scoutPrompt, [], 'SCOUT')
    const manifest = coerceScoutManifest(snapshot.goal, scoutResult.text, fileHintEntries)
    snapshot.summary.goalSummary = manifest.goalSummary
    snapshot.summary.openQuestions = manifest.unknowns
    snapshot.summary.riskFindings = manifest.riskFlags
    snapshot.artifacts.shardCount = manifest.shards.length
    findStage(snapshot, 'SCOUT').shardIds = manifest.shards.map(shard => shard.shardId)
    this.markStageCompleted(snapshot, 'SCOUT', `Prepared ${manifest.shards.length} shards`)
    this.emitJobEvent(jobId, 'plan.ready', {
      shardCount: manifest.shards.length,
      relevantPaths: manifest.relevantPaths,
      profile: chooseExecutionProfile(
        workspaceFiles.filter(file => manifest.relevantPaths.includes(file.path)),
      ).kind,
    })

    if (signal.aborted) return

    this.markStageStarted(snapshot, 'SHARD_ANALYZE', 'Running shard analyzers')
    const relevantEntries = workspaceFiles.filter(file => manifest.relevantPaths.includes(file.path))
    const profile = chooseExecutionProfile(relevantEntries)
    const shardResults: ShardAnalysis[] = []

    if (profile.kind === 'single') {
      const shard = manifest.shards[0] ?? createFallbackScoutManifest(snapshot.goal, relevantEntries).shards[0]
      if (!shard) throw new Error('No shard available for analysis')
      this.emitJobEvent(jobId, 'shard.started', { shardId: shard.shardId, backends: ['codex'] })
      const result = await this.runWorker(
        snapshot,
        'codex',
        'analyzer',
        buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths),
        unique([...shard.sharedFiles, ...shard.filePaths]),
        'SHARD_ANALYZE',
        shard.shardId,
      )
      shardResults.push(coerceShardAnalysis(shard.shardId, 'codex', result.text))
      this.emitJobEvent(jobId, 'shard.completed', { shardId: shard.shardId, backend: 'codex' })
    } else if (profile.kind === 'dual') {
      const shardFilePaths = manifest.relevantPaths.length > 0 ? manifest.relevantPaths : relevantEntries.map(file => file.path)
      const sharedFiles = pickSharedFiles(shardFilePaths)
      const shardId = 'shard-1'
      this.emitJobEvent(jobId, 'shard.started', { shardId, backends: ['codex', 'gemini'] })
      const [codexResult, geminiResult] = await Promise.all([
        this.runWorker(
          snapshot,
          'codex',
          'analyzer',
          buildShardPrompt(snapshot.goal, shardId, shardFilePaths),
          unique([...sharedFiles, ...shardFilePaths]),
          'SHARD_ANALYZE',
          shardId,
        ),
        this.runWorker(
          snapshot,
          'gemini',
          'reviewer',
          buildShardPrompt(snapshot.goal, shardId, shardFilePaths),
          unique([...sharedFiles, ...shardFilePaths]),
          'SHARD_ANALYZE',
          shardId,
        ),
      ])
      shardResults.push(coerceShardAnalysis(`${shardId}:codex`, 'codex', codexResult.text))
      shardResults.push(coerceShardAnalysis(`${shardId}:gemini`, 'gemini', geminiResult.text))
      this.emitJobEvent(jobId, 'shard.completed', { shardId, backend: 'codex' })
      this.emitJobEvent(jobId, 'shard.completed', { shardId, backend: 'gemini' })
    } else {
      const shards = manifest.shards.length > 0 ? manifest.shards : createFallbackScoutManifest(snapshot.goal, relevantEntries).shards
      const queue = [...shards]
      const workerPool = Array.from({ length: 2 }, async (_value, index) => {
        while (queue.length > 0) {
          const shard = queue.shift()
          if (!shard) return
          this.emitJobEvent(jobId, 'shard.started', { shardId: shard.shardId, backends: [`codex-${index + 1}`] })
          const result = await this.runWorker(
            snapshot,
            'codex',
            'analyzer',
            buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths),
            unique([...shard.sharedFiles, ...shard.filePaths]),
            'SHARD_ANALYZE',
            shard.shardId,
          )
          shardResults.push(coerceShardAnalysis(shard.shardId, 'codex', result.text))
          this.emitJobEvent(jobId, 'shard.completed', { shardId: shard.shardId, backend: 'codex' })
        }
      })
      await Promise.all(workerPool)
    }

    this.markStageCompleted(snapshot, 'SHARD_ANALYZE', `Completed ${shardResults.length} shard analyses`)

    if (signal.aborted) return

    this.markStageStarted(snapshot, 'AGGREGATE', 'Aggregating shard outputs')
    const aggregateResult = await this.runWorker(
      snapshot,
      'codex',
      'aggregator',
      buildAggregatePrompt(snapshot.goal, shardResults),
      [],
      'AGGREGATE',
    )
    const aggregate = coerceAggregate(aggregateResult.text)
    snapshot.summary.globalSummary = aggregate.globalSummary
    this.markStageCompleted(snapshot, 'AGGREGATE', 'Aggregate ready')
    this.emitJobEvent(jobId, 'aggregate.completed', {
      conflicts: aggregate.conflicts,
      missingCoverage: aggregate.missingCoverage,
    })

    if (signal.aborted) return

    this.markStageStarted(snapshot, 'VERIFY', 'Running reviewer')
    const verifyBackend: WorkerBackend = profile.kind === 'single' ? 'codex' : 'gemini'
    const verifyResult = await this.runWorker(
      snapshot,
      verifyBackend,
      'reviewer',
      buildVerifyPrompt(snapshot.goal, aggregate, shardResults),
      [],
      'VERIFY',
    )
    const verify = coerceVerify(verifyResult.text)
    snapshot.summary.verdict = verify.verdict
    snapshot.summary.coverageGaps = verify.coverageGaps
    snapshot.summary.riskFindings = unique([...snapshot.summary.riskFindings, ...verify.riskFindings])
    snapshot.summary.openQuestions = unique([...snapshot.summary.openQuestions, ...verify.followups])
    this.markStageCompleted(snapshot, 'VERIFY', verify.verdict)
    this.emitJobEvent(jobId, 'verify.completed', {
      verdict: verify.verdict,
      coverageGaps: verify.coverageGaps,
      riskFindings: verify.riskFindings,
    })

    let writeAnalysis: WriteAnalysis | undefined
    if (snapshot.mode === 'write') {
      findStage(snapshot, 'WRITE').status = 'pending'
      this.markStageStarted(snapshot, 'WRITE', 'Running single writer')
      this.emitJobEvent(jobId, 'write.started', {})
      const writeTargetFiles = unique([
        ...snapshot.artifacts.changedFiles,
        ...manifest.relevantPaths.slice(0, 12),
      ])
      const writeResult = await this.runWorker(
        snapshot,
        'codex',
        'writer',
        buildWritePrompt(snapshot.goal, aggregate, verify, writeTargetFiles),
        writeTargetFiles,
        'WRITE',
      )
      writeAnalysis = coerceWrite(writeResult.text)
      snapshot.artifacts.changedFiles = unique([...snapshot.artifacts.changedFiles, ...writeAnalysis.targetFiles, ...writeResult.changedFiles])
      if (writeResult.diff) {
        snapshot.artifacts.latestDiff = writeResult.diff
      }
      this.markStageCompleted(snapshot, 'WRITE', writeAnalysis.diffSummary)
      this.emitJobEvent(jobId, 'write.completed', {
        targetFiles: writeAnalysis.targetFiles,
        diffSummary: writeAnalysis.diffSummary,
      })
    }

    if (signal.aborted) return

    this.markStageStarted(snapshot, 'FINALIZE', 'Composing final answer')
    snapshot.summary.finalAnswer = buildFinalAnswer(
      manifest,
      aggregate,
      verify,
      writeAnalysis ? { targetFiles: writeAnalysis.targetFiles, diffSummary: writeAnalysis.diffSummary } : undefined,
    )
    this.markStageCompleted(snapshot, 'FINALIZE', 'Completed')
    snapshot.status = 'completed'
    snapshot.updatedAt = nowIso()
    this.persistence.saveSnapshot(snapshot)
    this.emitJobEvent(jobId, 'job.completed', {
      verdict: snapshot.summary.verdict,
      changedFiles: snapshot.artifacts.changedFiles,
    })
  }
}
