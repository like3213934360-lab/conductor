import * as crypto from 'node:crypto'
import { z } from 'zod'
import {
  type AggregateAnalysis,
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
import { listWorkspaceFiles, pickSharedFiles, totalBytes, type WorkspaceFileEntry } from './file-context.js'
import { buildFinalAnswer } from './prompts.js'
import { parseStructuredJson } from './parsing.js'
import { createWorkerAdapters } from './workers.js'
import type { TaskdPaths } from './runtime-contract.js'
import { JobLifecycleService } from './job-lifecycle.js'

// ── Enterprise Capabilities ─────────────────────────────────────
import { FileJournalStore, type JournalStore, type ShardOutcomeRef } from './journal.js'
import { Ed25519Identity, type CryptoIdentity } from './crypto-identity.js'
import { DefaultProvenanceCollector, type ProvenanceCollector } from './provenance.js'
import { DefaultGovernanceGateway, type GovernanceGateway } from './governance.js'

// ── Cognitive Architecture ────────────────────────────────────────
import {
  InMemoryMcpBlackboard,
  DefaultRouterPolicy,
  DefaultRacingExecutor,
  InMemoryVirtualFileSystem,
  NoopLspDiagnosticsProvider,
  type McpBlackboard,
  type RouterPolicy,
  type RacingExecutor,
  type VirtualFileSystem,
  type LspDiagnosticsProvider,
  type RedTeamCritic,
  type SwarmMesh,
  DynamicRouterPolicy,
  EpisodicMemoryStore,
  InMemorySwarmMesh,
  LlmRedTeamCritic,
} from './cognitive/index.js'

// ── Pipeline Architecture (V1.1.0 Strategy Pattern) ──────────────
import type { PipelineContext, CognitiveJobContext, ShardOutcome, WorkerResult } from './pipeline-context.js'
import { PipelineOrchestrator } from './pipeline-orchestrator.js'
import { ScoutStage } from './stages/scout-stage.js'
import { ShardStage } from './stages/shard-stage.js'
import { AggregateStage } from './stages/aggregate-stage.js'
import { VerifyStage } from './stages/verify-stage.js'
import { WriteStage } from './stages/write-stage.js'

// ── Stage Budgets ───────────────────────────────────────────────
const STAGE_BUDGETS: Record<TaskStageId, { softBudgetMs: number; hardBudgetMs: number }> = {
  SCOUT: { softBudgetMs: 60_000, hardBudgetMs: 120_000 },
  SHARD_ANALYZE: { softBudgetMs: 1_800_000, hardBudgetMs: 2_100_000 },
  AGGREGATE: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  VERIFY: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  WRITE: { softBudgetMs: 900_000, hardBudgetMs: 1_200_000 },
  FINALIZE: { softBudgetMs: 240_000, hardBudgetMs: 300_000 },
}

// ── 全局常量 ──────────────────────────────────────────────────────
const GLOBAL_JOB_TIMEOUT_MS = 60 * 60 * 1000  // 60 min
const GLOBAL_TOKEN_LIMIT = 2_000_000

// ── Utility Functions ────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════
// 🏛️ AntigravityTaskdRuntime — Pure Facade
// 负责组装 Services + Stages，不包含任何业务逻辑
// ══════════════════════════════════════════════════════════════════

export class AntigravityTaskdRuntime {
  private readonly lifecycle: JobLifecycleService
  private readonly adapters: Record<WorkerBackend, WorkerAdapter>

  // ── Enterprise Capabilities ────────────────────────────────────
  private readonly journal: JournalStore
  private readonly identity: CryptoIdentity
  private readonly governance: GovernanceGateway
  private readonly memoryStore: EpisodicMemoryStore
  private readonly swarmMesh: SwarmMesh

  // ── Pipeline ──────────────────────────────────────────────────
  private readonly pipeline: PipelineOrchestrator

  constructor(
    private readonly paths: TaskdPaths,
    adapters: Record<WorkerBackend, WorkerAdapter> = createWorkerAdapters(),
  ) {
    this.lifecycle = new JobLifecycleService(paths)
    this.adapters = adapters
    this.identity = new Ed25519Identity()
    this.journal = new FileJournalStore(paths.jobsDir)
    this.governance = new DefaultGovernanceGateway(this.identity)
    this.memoryStore = new EpisodicMemoryStore(paths.jobsDir)
    this.swarmMesh = new InMemorySwarmMesh()

    // 🏗️ 组装五段式管线（Strategy Pattern）
    this.pipeline = new PipelineOrchestrator([
      new ScoutStage(),
      new ShardStage(),
      new AggregateStage(),
      new VerifyStage(),
      new WriteStage(),
    ])
  }

  async initialize(): Promise<void> {
    this.lifecycle.initialize()
  }

  // ── Cognitive Context Factory ──────────────────────────────────
  private buildCognitiveContext(snapshot: TaskJobSnapshot, signal: AbortSignal): CognitiveJobContext {
    const routerPolicy = new DynamicRouterPolicy()

    const verifyRoutes = routerPolicy.routeMulti('verify', 0, undefined, 2)
    const redBackend = verifyRoutes.find(r => r.backend !== 'codex')?.backend ?? verifyRoutes[0]?.backend ?? 'gemini'

    const self = this
    const redTeamCritic = new LlmRedTeamCritic(redBackend, {
      async runWorker(backend, prompt, workerSignal) {
        const result = await self.runWorker(snapshot, backend, 'reviewer', prompt, [], 'VERIFY', undefined)
        return {
          backend: result.backend,
          workerId: result.workerId,
          text: result.text,
          changedFiles: result.changedFiles,
        }
      },
    })

    return {
      blackboard: new InMemoryMcpBlackboard(),
      routerPolicy,
      racingExecutor: new DefaultRacingExecutor({
        onRaceComplete: (telemetry) => {
          if (routerPolicy instanceof DynamicRouterPolicy) {
            routerPolicy.ingestTelemetry(telemetry)
          }
        },
      }),
      vfs: new InMemoryVirtualFileSystem(snapshot.workspaceRoot),
      lsp: new NoopLspDiagnosticsProvider(),
      memoryStore: this.memoryStore,
      redTeamCritic,
      swarmMesh: this.swarmMesh,
    }
  }

  // ── Delegations to JobLifecycleService (V1.1.0) ─────────────────

  async shutdown(): Promise<void> {
    await this.lifecycle.shutdown()
    this.swarmMesh.dispose()
  }

  createJob(input: z.input<typeof CreateTaskJobRequestSchema>): TaskJobSnapshot {
    return this.lifecycle.createJob(input, (jobId, signal) => this.executeJob(jobId, signal))
  }

  listJobs(): TaskJobSnapshot[] {
    return this.lifecycle.listJobs()
  }

  getJob(jobId: string): TaskJobSnapshot | null {
    return this.lifecycle.getJob(jobId)
  }

  cancelJob(jobId: string): { jobId: string; cancelled: boolean } {
    return this.lifecycle.cancelJob(jobId)
  }

  subscribe(jobId: string, listener: (event: TaskJobEvent) => void): () => void {
    return this.lifecycle.subscribe(jobId, listener)
  }

  private emitJobEvent(jobId: string, type: TaskJobEventType, data: Record<string, unknown>): void {
    this.lifecycle.emitJobEvent(jobId, type, data)
  }

  // ── Internal Helpers (供 Stage Handlers 通过 ctx 委托) ─────────

  private markStageStarted(snapshot: TaskJobSnapshot, stageId: TaskStageId, detail?: string): void {
    const stage = findStage(snapshot, stageId)
    stage.status = 'running'
    stage.startedAt = nowIso()
    stage.detail = detail
    snapshot.currentStageId = stageId
    snapshot.status = updateJobStatusFromStage(stageId)
    snapshot.updatedAt = nowIso()
    this.lifecycle.persistence.saveSnapshot(snapshot)
  }

  private markStageCompleted(snapshot: TaskJobSnapshot, stageId: TaskStageId, detail?: string): void {
    const stage = findStage(snapshot, stageId)
    stage.status = 'completed'
    stage.completedAt = nowIso()
    stage.detail = detail
    snapshot.updatedAt = nowIso()
    this.lifecycle.persistence.saveSnapshot(snapshot)
  }

  private upsertWorker(snapshot: TaskJobSnapshot, nextWorker: WorkerSnapshot): void {
    const existingIndex = snapshot.workers.findIndex(worker => worker.workerId === nextWorker.workerId)
    if (existingIndex >= 0) {
      snapshot.workers[existingIndex] = nextWorker
    } else {
      snapshot.workers.push(nextWorker)
    }
    snapshot.updatedAt = nowIso()
    this.lifecycle.persistence.saveSnapshot(snapshot)
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

  // ── 两阶段超时 runWorker ─────────────────────────────────────────
  private async runWorker(
    snapshot: TaskJobSnapshot,
    backend: WorkerBackend,
    role: WorkerRole,
    prompt: string,
    filePaths: string[],
    stageId: TaskStageId,
    currentShardId?: string,
  ): Promise<WorkerResult> {
    const adapter = this.adapters[backend]
    const workerId = `${backend}-${role}-${crypto.randomUUID().slice(0, 8)}`
    const worker = this.createWorkerSnapshot(workerId, backend, role, currentShardId)
    this.upsertWorker(snapshot, worker)

    const budget = STAGE_BUDGETS[stageId]
    const controller = this.lifecycle.getController(snapshot.jobId)

    const softController = new AbortController()
    const hardController = new AbortController()

    const softTimeout = setTimeout(() => {
      console.warn(`[taskd] soft budget reached for ${workerId} (${budget.softBudgetMs}ms) — sending wrap-up signal`)
      softController.abort()
      this.emitJobEvent(snapshot.jobId, 'worker.progress', {
        workerId, backend, role, currentShardId,
        phase: 'finalizing',
        message: `Soft budget reached (${Math.round(budget.softBudgetMs / 1000)}s), wrapping up`,
        progress: 0.95,
      })
    }, budget.softBudgetMs)

    const hardTimeout = setTimeout(() => {
      console.warn(`[taskd] hard budget reached for ${workerId} (${budget.hardBudgetMs}ms) — force killing`)
      hardController.abort()
    }, budget.hardBudgetMs)

    const abort = () => hardController.abort()
    controller?.signal.addEventListener('abort', abort, { once: true })

    try {
      const result = await adapter.run(
        {
          workerId,
          prompt,
          cwd: snapshot.workspaceRoot,
          filePaths,
          mode: snapshot.mode,
          role,
          hardBudgetMs: budget.hardBudgetMs,
          softBudgetMs: budget.softBudgetMs,
        },
        (event: WorkerEvent) => {
          this.applyWorkerEvent(snapshot, worker, event)
          this.emitJobEvent(snapshot.jobId, this.mapWorkerEventType(event), {
            workerId,
            backend,
            role,
            currentShardId,
            ...event,
          })
        },
        hardController.signal,
        softController.signal,
      )

      worker.status = 'completed'
      worker.phase = 'done'
      worker.progress = 1
      worker.completedAt = nowIso()
      this.upsertWorker(snapshot, worker)

      const tokenDelta = result.tokensUsed ? (result.tokensUsed.input + result.tokensUsed.output) : 0
      snapshot.totalTokensUsed += tokenDelta

      this.emitJobEvent(snapshot.jobId, 'worker.progress', {
        workerId, backend, role, currentShardId,
        tokensUsed: tokenDelta,
        changedFiles: result.changedFiles,
      })

      if (snapshot.totalTokensUsed > GLOBAL_TOKEN_LIMIT) {
        throw new Error(`[Economic OOM] Global token circuit breaker triggered! Job consumed ${snapshot.totalTokensUsed} tokens, exceeding the limit of ${GLOBAL_TOKEN_LIMIT}.`)
      }

      return result
    } catch (error) {
      worker.status = hardController.signal.aborted && !controller?.signal.aborted ? 'failed' : 'cancelled'
      worker.phase = 'error'
      worker.completedAt = nowIso()
      worker.message = error instanceof Error ? error.message : String(error)
      this.upsertWorker(snapshot, worker)
      throw error
    } finally {
      clearTimeout(softTimeout)
      clearTimeout(hardTimeout)
      controller?.signal.removeEventListener('abort', abort)
    }
  }

  // ── Shard 级安全执行 ─────────────────────────────────────────────
  private async runWorkerSafe(
    snapshot: TaskJobSnapshot,
    backend: WorkerBackend,
    role: WorkerRole,
    prompt: string,
    filePaths: string[],
    stageId: TaskStageId,
    currentShardId?: string,
  ): Promise<ShardOutcome> {
    const shardId = currentShardId ?? 'unknown'
    const startMs = Date.now()
    try {
      const result = await this.runWorker(snapshot, backend, role, prompt, filePaths, stageId, currentShardId)
      const analysis = this.coerceShardAnalysis(shardId, backend, result.text)
      const durationMs = Date.now() - startMs
      return {
        status: 'success',
        shardId,
        result: analysis,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - startMs
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.warn(`[taskd] Worker safe-wrapped failure for shard ${shardId}: ${errorMessage}`)
      return {
        status: 'failed',
        shardId,
        error: errorMessage,
        durationMs,
      }
    }
  }

  private coerceShardAnalysis(shardId: string, backend: WorkerBackend, raw: string): ShardAnalysis {
    const parsed = parseStructuredJson<any>(raw)
    const asStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) return []
      return value.filter((item): item is string => typeof item === 'string')
    }
    const asNumber = (value: unknown, fallback: number): number => {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }
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

  // ══════════════════════════════════════════════════════════════════
  // 🚀 executeJob — 纯粹的管线启动器（Strategy Pattern）
  // 构建 PipelineContext → 调用 PipelineOrchestrator.run()
  // 所有业务逻辑已抽离到 stages/ 目录下的独立 Handler 中
  // ══════════════════════════════════════════════════════════════════

  private async executeJob(jobId: string, signal: AbortSignal): Promise<void> {
    const snapshot = this.lifecycle.jobs.get(jobId)
    if (!snapshot) return

    const workspaceFiles = listWorkspaceFiles(snapshot.workspaceRoot)
    const fileHintEntries = snapshot.fileHints.length > 0
      ? workspaceFiles.filter(file => snapshot.fileHints.includes(file.path))
      : workspaceFiles

    // ── Journal Replay: 断点恢复 ────────────────────────────────
    let resumedManifest: ScoutManifest | undefined
    let resumedShardResults: ShardAnalysis[] | undefined
    let resumedShardOutcomes: Array<{ status: string; shardId: string; error?: string; durationMs: number }> | undefined
    let resumedMerkleRoot: string | undefined
    let resumedAggregate: AggregateAnalysis | undefined
    let resumedVerify: VerifyAnalysis | undefined
    let resumedVfsPendingPaths: string[] = []

    const resumePoint = await this.journal.getResumePoint(jobId)
    if (resumePoint) {
      console.warn(`[taskd] Resuming job ${jobId} from after ${resumePoint}`)
      const stageIndex = ['SCOUT', 'SHARD_ANALYZE', 'AGGREGATE', 'VERIFY', 'WRITE', 'FINALIZE'].indexOf(resumePoint)

      if (stageIndex >= 0) {
        const scoutCp = await this.journal.loadCheckpoint(jobId, 'SCOUT')
        if (scoutCp) resumedManifest = scoutCp.payload.manifest
      }
      if (stageIndex >= 1) {
        const shardCp = await this.journal.loadCheckpoint(jobId, 'SHARD_ANALYZE')
        if (shardCp) {
          resumedShardResults = shardCp.payload.results
          resumedShardOutcomes = shardCp.payload.outcomes
        }
      }
      if (stageIndex >= 2) {
        const aggCp = await this.journal.loadCheckpoint(jobId, 'AGGREGATE')
        if (aggCp) {
          resumedAggregate = aggCp.payload.aggregate
          resumedMerkleRoot = aggCp.payload.merkleRoot
        }
      }
      if (stageIndex >= 3) {
        const verifyCp = await this.journal.loadCheckpoint(jobId, 'VERIFY')
        if (verifyCp) {
          resumedVerify = verifyCp.payload.verify
          const pendingPaths = verifyCp.payload.vfsPendingPaths
          if (Array.isArray(pendingPaths) && pendingPaths.length > 0) {
            resumedVfsPendingPaths = pendingPaths as string[]
          }
        }
      }
    }

    // 构建认知上下文
    const cogCtx = this.buildCognitiveContext(snapshot, signal)
    const provenance = new DefaultProvenanceCollector(this.identity, `taskd-${jobId.slice(0, 8)}`)

    // 构建 PipelineContext — 阶段间共享的数据总线
    const ctx: PipelineContext = {
      snapshot,
      signal,
      jobId,
      cogCtx,
      workspaceFiles,
      fileHintEntries,
      journal: this.journal,
      provenance,
      governance: this.governance,

      // 阶段间中间产物
      shardResults: [],
      shardOutcomes: [],
      pendingFiles: {},

      // Journal 恢复数据
      resumedManifest,
      resumedShardResults,
      resumedShardOutcomes,
      resumedMerkleRoot,
      resumedAggregate,
      resumedVerify,
      resumedVfsPendingPaths,

      // 委托方法（绑定到 runtime 实例）
      runWorker: (snapshot, backend, role, prompt, filePaths, stageId, shardId?) =>
        this.runWorker(snapshot, backend, role, prompt, filePaths, stageId, shardId),
      runWorkerSafe: (snapshot, backend, role, prompt, filePaths, stageId, shardId?) =>
        this.runWorkerSafe(snapshot, backend, role, prompt, filePaths, stageId, shardId),
      markStageStarted: (stageId, detail?) =>
        this.markStageStarted(snapshot, stageId, detail),
      markStageCompleted: (stageId, detail?) =>
        this.markStageCompleted(snapshot, stageId, detail),
      emitJobEvent: (type, data) =>
        this.emitJobEvent(jobId, type, data),
    }

    // 🚀 启动五段式管线
    await this.pipeline.run(ctx)

    // 持久化最终状态
    this.lifecycle.persistence.saveSnapshot(snapshot)
  }
}
