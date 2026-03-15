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

// ── Enterprise Capabilities ─────────────────────────────────────
import { FileJournalStore, type JournalStore, type ShardOutcomeRef } from './journal.js'
import { Ed25519Identity, type CryptoIdentity } from './crypto-identity.js'
import { computeMerkleRoot } from './merkle.js'
import { DefaultProvenanceCollector, type ProvenanceCollector } from './provenance.js'
import { DefaultGovernanceGateway, type GovernanceGateway } from './governance.js'

// ── Cognitive Architecture ────────────────────────────────────────
import {
  InMemoryMcpBlackboard,
  DefaultRouterPolicy,
  DefaultRacingExecutor,
  InMemoryVirtualFileSystem,
  NoopLspDiagnosticsProvider,
  DefaultReflexionStateMachine,
  ReflexionFailedError,
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

/** 认知携带器：贯穿单次 Job 全生命周期，通过 buildCognitiveContext() 工厂构建 */
interface CognitiveJobContext {
  blackboard: McpBlackboard
  routerPolicy: RouterPolicy
  racingExecutor: RacingExecutor
  vfs: VirtualFileSystem
  lsp: LspDiagnosticsProvider
  memoryStore: EpisodicMemoryStore
  redTeamCritic: RedTeamCritic
  swarmMesh: SwarmMesh
}

interface ExecutionProfile {
  kind: 'single' | 'dual' | 'sharded'
}

// ── Shard 级失败容忍 ──────────────────────────────────────────────
// 单个 shard worker 的结果枚举：成功 / 降级（超时但有部分输出）/ 失败
type ShardOutcomeStatus = 'success' | 'degraded' | 'failed'

interface ShardOutcome {
  status: ShardOutcomeStatus
  shardId: string
  result?: ShardAnalysis    // success 或 degraded 时可用
  error?: string            // degraded 或 failed 时记录原因
  durationMs: number
}

// ── WRITE 阶段 Shard 化 ─────────────────────────────────────────
const WRITE_BATCH_SIZE = 3

// ── 全局 Job 超时 ───────────────────────────────────────────────
// 所有 stage 的硬上限总和约 82 分钟；全局安全网设为 60 分钟
const GLOBAL_JOB_TIMEOUT_MS = 60 * 60 * 1000  // 60 min

const STAGE_BUDGETS: Record<TaskStageId, { softBudgetMs: number; hardBudgetMs: number }> = {
  SCOUT: { softBudgetMs: 60_000, hardBudgetMs: 120_000 },
  SHARD_ANALYZE: { softBudgetMs: 1_800_000, hardBudgetMs: 2_100_000 },
  AGGREGATE: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  VERIFY: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
  WRITE: { softBudgetMs: 900_000, hardBudgetMs: 1_200_000 },
  FINALIZE: { softBudgetMs: 240_000, hardBudgetMs: 300_000 },
}

// ── 瞬时失败重试（信号感知） ──────────────────────────────────────
// 对网络/IO 抖动提供有限次重试，避免一次瞬断直接降级整个 stage。
// 修复：
// 1. 传入 AbortSignal — job 被取消时立即停止重试，不会空跑 backoff
// 2. backoff 等待本身可被 signal 中断
// 注意：runWorker 不是幂等的（每次重试会创建新 worker snapshot），
// 但 finally 块保证子进程被 kill，不会产生真正的孤儿进程。
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = 2,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 重试前检查：job 已取消则直接抛出，不再浪费资源
    if (signal?.aborted) {
      throw lastError ?? new Error(`${label} aborted before attempt ${attempt}`)
    }
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxAttempts) {
        const backoffMs = attempt * 2000
        console.warn(`[taskd] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}, retrying in ${backoffMs}ms`)
        // 可中断的 backoff：signal abort → clearTimeout + 立即 reject
        // { once: true } 保证 listener 在触发后自动移除；
        // 正常 resolve 时手动 removeEventListener 防止 listener 残留。
        let backoffAbortHandler: (() => void) | undefined
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            // 正常超时 → 清理 abort listener 后 resolve
            if (backoffAbortHandler && signal) {
              signal.removeEventListener('abort', backoffAbortHandler)
            }
            resolve()
          }, backoffMs)

          if (signal) {
            backoffAbortHandler = () => {
              clearTimeout(timer)
              reject(lastError)
            }
            signal.addEventListener('abort', backoffAbortHandler, { once: true })
          }
        }).catch(() => {
          // backoff 被 signal 中断 — 直接抛出
          throw lastError!
        })
      }
    }
  }
  throw lastError!
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

  // ── Enterprise Capabilities（通过构造函数注入，不硬编码）────────
  private readonly journal: JournalStore
  private readonly identity: CryptoIdentity
  private readonly governance: GovernanceGateway
  private readonly memoryStore: EpisodicMemoryStore
  private readonly swarmMesh: SwarmMesh

  constructor(
    private readonly paths: TaskdPaths,
    adapters: Record<WorkerBackend, WorkerAdapter> = createWorkerAdapters(),
  ) {
    this.persistence = new TaskPersistenceStore(paths.jobsDir)
    this.adapters = adapters
    this.identity = new Ed25519Identity()
    this.journal = new FileJournalStore(paths.jobsDir)
    this.governance = new DefaultGovernanceGateway(this.identity)
    this.memoryStore = new EpisodicMemoryStore(paths.jobsDir)
    this.swarmMesh = new InMemorySwarmMesh()
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

  /**
   * 认知上下文工厂 (Dependency Injection Factory)
   * 实例化四大认知能力，注入到 CognitiveJobContext。
   * runtime.ts 只依赖接口，具体实现可在测试中替换为 mock。
   */
  private buildCognitiveContext(snapshot: TaskJobSnapshot, signal: AbortSignal): CognitiveJobContext {
    const routerPolicy = new DynamicRouterPolicy()

    // 🛡️ RFC-026 Phase 2: 初始化红方审查器（异源模型：优先选择 reasoning最高且与蓝方不同的模型）
    const verifyRoutes = routerPolicy.routeMulti('verify', 0, undefined, 2)
    const redBackend = verifyRoutes.find(r => r.backend !== 'codex')?.backend ?? verifyRoutes[0]?.backend ?? 'gemini'

    const self = this
    const redTeamCritic = new LlmRedTeamCritic(redBackend, {
      async runWorker(backend, prompt, workerSignal) {
        // 执行真正的红方审查
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
      racingExecutor: new DefaultRacingExecutor(),
      vfs: new InMemoryVirtualFileSystem(snapshot.workspaceRoot),
      lsp: new NoopLspDiagnosticsProvider(),
      memoryStore: this.memoryStore,
      redTeamCritic,
      swarmMesh: this.swarmMesh,
    }
  }

  /**
   * K8s Graceful Shutdown：
   *   1. 触发所有运行中 Job 的 AbortController
   *   2. 等待它们的 executeJob Promise 结算（Journal 会在 catch 中 flush）
   *   3. 清理状态
   */
  async shutdown(): Promise<void> {
    console.log(`[taskd] Shutting down ${this.controllers.size} active job(s)...`)
    // 触发所有 AbortController → runWorker 内部的 signal.aborted 检查
    for (const [jobId, controller] of this.controllers) {
      console.log(`[taskd] Aborting job ${jobId}`)
      controller.abort()
    }
    // 等待所有 Job 自行结束（它们的 executeJob catch 会保存快照）
    // 给最多 20s 等待（留 5s 余量给 main.ts 的 25s 安全阀）
    await Promise.race([
      Promise.allSettled(
        [...this.controllers.keys()].map(
          jobId => new Promise<void>(resolve => {
            const check = () => {
              const snap = this.jobs.get(jobId)
              if (!snap || isTerminalStatus(snap.status)) {
                resolve()
              } else {
                setTimeout(check, 200)
              }
            }
            check()
          })
        )
      ),
      new Promise(resolve => setTimeout(resolve, 20_000)),
    ])
    this.controllers.clear()
    this.swarmMesh.dispose()
    console.log('[taskd] Shutdown complete')
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
      totalTokensUsed: 0, // Initialize token counter
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

    // ── 全局 Job 超时安全网 ─────────────────────────────────────
    // 无论各 stage 超时如何设置，到达全局上限后无条件终止整个 worker 树
    const globalTimeout = setTimeout(() => {
      console.warn(`[taskd] GLOBAL JOB TIMEOUT reached (${GLOBAL_JOB_TIMEOUT_MS}ms) for job ${jobId} — force aborting`)
      controller.abort()
    }, GLOBAL_JOB_TIMEOUT_MS)

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
    }).finally(() => {
      clearTimeout(globalTimeout)
      this.controllers.delete(jobId)
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

  // ── 两阶段超时 runWorker ─────────────────────────────────────────
  // soft budget → 发 SIGINT（CLI 有机会输出已有结果）
  // hard budget → 发 abort/SIGTERM（无情终止）
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

    const budget = STAGE_BUDGETS[stageId]
    const parentController = this.controllers.get(snapshot.jobId)

    // soft signal: 通知 CLI "请尽快收尾"，adapter 层将其映射为 SIGINT
    const softController = new AbortController()
    // hard signal: 真正终止进程
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

    // 父级取消时同步 abort（用户主动取消）
    const abort = () => hardController.abort()
    parentController?.signal.addEventListener('abort', abort, { once: true })

    try {
      const result = await adapter.run({
        workerId,
        prompt,
        cwd: snapshot.workspaceRoot,
        filePaths,
        mode: role === 'writer' ? 'write' : 'analysis',
        role,
        hardBudgetMs: budget.hardBudgetMs,
        softBudgetMs: budget.softBudgetMs,   // 透传给 adapter 做 SIGINT 映射
        swarmPeers: this.swarmMesh.discoverPeers(workerId),
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
      }, hardController.signal, softController.signal)  // 双 signal 传递

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

      // 🛡️ 全局大模型经济学断路器 (Global Token Budget)
      const chars = prompt.length + result.text.length + (result.diff?.length || 0)
      const estimatedTokens = Math.ceil(chars / 4)
      snapshot.totalTokensUsed += estimatedTokens

      const GLOBAL_TOKEN_LIMIT = 2_000_000 // 200 万 Token 硬上限（约 $5~10）
      if (snapshot.totalTokensUsed > GLOBAL_TOKEN_LIMIT) {
        throw new Error(`[Economic OOM] Global token circuit breaker triggered! Job consumed ${snapshot.totalTokensUsed} tokens, exceeding the limit of ${GLOBAL_TOKEN_LIMIT}.`)
      }

      return result
    } catch (error) {
      worker.status = hardController.signal.aborted && !parentController?.signal.aborted ? 'failed' : 'cancelled'
      worker.phase = 'error'
      worker.completedAt = nowIso()
      worker.message = error instanceof Error ? error.message : String(error)
      this.upsertWorker(snapshot, worker)
      throw error
    } finally {
      clearTimeout(softTimeout)
      clearTimeout(hardTimeout)
      parentController?.signal.removeEventListener('abort', abort)
    }
  }

  // ── Shard 级安全执行 ─────────────────────────────────────────────
  // 捕获单个 shard 的超时/崩溃，返回 ShardOutcome 而非直接抛出；
  // 允许系统带着部分成功的结果继续进入 AGGREGATE 阶段。
  private async runWorkerSafe(
    snapshot: TaskJobSnapshot,
    backend: WorkerBackend,
    role: WorkerRole,
    prompt: string,
    filePaths: string[],
    stageId: TaskStageId,
    shardId: string,
  ): Promise<ShardOutcome> {
    const startTime = performance.now()  // 单调时钟，免疫 NTP 跳变
    try {
      const result = await this.runWorker(
        snapshot, backend, role, prompt, filePaths, stageId, shardId,
      )
      return {
        status: 'success',
        shardId,
        result: coerceShardAnalysis(shardId, backend, result.text),
        durationMs: Math.round(performance.now() - startTime),
      }
    } catch (error) {
      const durationMs = Math.round(performance.now() - startTime)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const budget = STAGE_BUDGETS[stageId]

      // 判定是超时导致的降级还是真正的错误
      const isDegraded = durationMs >= budget.softBudgetMs * 0.9

      // 尝试从 worker snapshot 中抢救部分输出
      const workerSnap = snapshot.workers.find(w =>
        w.currentShardId === shardId && w.backend === backend,
      )
      // worker.message 中可能包含 CLI 在被 SIGINT 时输出的部分结果
      const partialText = workerSnap?.message || ''

      if (isDegraded && partialText.length > 50) {
        // 有足够的部分输出 → 降级结果（可用但不完整）
        console.warn(`[taskd] shard ${shardId} degraded after ${durationMs}ms: ${errorMessage}`)
        return {
          status: 'degraded',
          shardId,
          result: coerceShardAnalysis(`${shardId}:degraded`, backend, partialText),
          error: errorMessage,
          durationMs,
        }
      }

      // 没有可用输出 → 完全失败
      console.warn(`[taskd] shard ${shardId} failed after ${durationMs}ms: ${errorMessage}`)
      return {
        status: 'failed',
        shardId,
        error: errorMessage,
        durationMs,
      }
    }
  }

  private async executeJob(jobId: string, signal: AbortSignal): Promise<void> {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot) return

    const workspaceFiles = listWorkspaceFiles(snapshot.workspaceRoot)
    const fileHintEntries = snapshot.fileHints.length > 0
      ? workspaceFiles.filter(file => snapshot.fileHints.includes(file.path))
      : workspaceFiles

    // ── Journal Replay: 断点恢复 ────────────────────────────────
    // 如果之前崩溃过，从 journal 恢复已完成阶段的输出，跳过重复计算
    let resumedManifest: ScoutManifest | undefined
    let resumedShardResults: ShardAnalysis[] | undefined
    let resumedShardOutcomes: ShardOutcomeRef[] | undefined
    let resumedMerkleRoot: string | undefined
    let resumedAggregate: AggregateAnalysis | undefined
    let resumedVerify: VerifyAnalysis | undefined
    /** 脑裂修复：记录崩溃前 VFS 里尚未落盘的文件路径 */
    let resumedVfsPendingPaths: string[] = []

    const resumePoint = await this.journal.getResumePoint(jobId)
    if (resumePoint) {
      console.warn(`[taskd] Resuming job ${jobId} from after ${resumePoint}`)
      const stageIndex = ['SCOUT', 'SHARD_ANALYZE', 'AGGREGATE', 'VERIFY', 'WRITE', 'FINALIZE'].indexOf(resumePoint)

      // 恢复 SCOUT 数据
      if (stageIndex >= 0) {
        const scoutCp = await this.journal.loadCheckpoint(jobId, 'SCOUT')
        if (scoutCp) resumedManifest = scoutCp.payload.manifest
      }
      // 恢复 SHARD 数据
      if (stageIndex >= 1) {
        const shardCp = await this.journal.loadCheckpoint(jobId, 'SHARD_ANALYZE')
        if (shardCp) {
          resumedShardResults = shardCp.payload.results
          resumedShardOutcomes = shardCp.payload.outcomes
        }
      }
      // 恢复 AGGREGATE 数据（含 merkle root）
      if (stageIndex >= 2) {
        const aggCp = await this.journal.loadCheckpoint(jobId, 'AGGREGATE')
        if (aggCp) {
          resumedAggregate = aggCp.payload.aggregate
          resumedMerkleRoot = aggCp.payload.merkleRoot
        }
      }
      // 恢复 VERIFY 数据
      if (stageIndex >= 3) {
        const verifyCp = await this.journal.loadCheckpoint(jobId, 'VERIFY')
        if (verifyCp) {
          resumedVerify = verifyCp.payload.verify
          // 恢复 VFS 脑裂检测标记：若崩溃发生在 Reflexion 期间，
          // vfsPendingPaths 记录了哪些文件尚未成功落盘，需要重跑 Reflexion
          const pendingPaths = verifyCp.payload.vfsPendingPaths
          if (Array.isArray(pendingPaths) && pendingPaths.length > 0) {
            resumedVfsPendingPaths = pendingPaths as string[]
          }
        }
      }
    }


    // 构建认知上下文（轻量工厂，< 1ms 开销）— 贯穿全流水线
    const cogCtx = this.buildCognitiveContext(snapshot, signal)

    // ── SCOUT 阶段：超时/崩溃时用 fallback manifest 兜底 ─────────
    let manifest: ScoutManifest
    if (resumedManifest) {
      // 📀 Journal Replay: 跳过 SCOUT，使用持久化数据
      manifest = resumedManifest
      this.markStageCompleted(snapshot, 'SCOUT', 'Resumed from journal')
    } else {
      this.markStageStarted(snapshot, 'SCOUT', 'Planning shard graph')
      const scoutPrompt = buildScoutPrompt(
        snapshot.goal,
        snapshot.mode,
        snapshot.fileHints,
        fileHintEntries.map(file => `${file.path} (${file.size} bytes)`),
      )
      try {
        const scoutDecision = cogCtx.routerPolicy.route('scout')
        const scoutResult = await this.runWorker(snapshot, scoutDecision.backend, 'scout', scoutPrompt, [], 'SCOUT')
        manifest = coerceScoutManifest(snapshot.goal, scoutResult.text, fileHintEntries)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] SCOUT failed, falling back to auto-shard: ${msg}`)
        manifest = createFallbackScoutManifest(snapshot.goal, fileHintEntries)
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `SCOUT failed (${msg}), using fallback shard plan`,
        ])
      }
    }
    snapshot.summary.goalSummary = manifest.goalSummary
    snapshot.summary.openQuestions = manifest.unknowns
    snapshot.summary.riskFindings = unique([...snapshot.summary.riskFindings, ...manifest.riskFlags])
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

    // 🏗️ Journal: SCOUT checkpoint + Provenance: record input hashes
    await this.journal.saveCheckpoint(jobId, 'SCOUT', {
      manifest,
      fileHintEntries: fileHintEntries.map(f => ({ path: f.path, size: f.size })),
    })
    const provenance = new DefaultProvenanceCollector(this.identity, `taskd-${jobId.slice(0, 8)}`)
    provenance.recordInputFiles(fileHintEntries.map(f => f.path))

    if (signal.aborted) return

    this.markStageStarted(snapshot, 'SHARD_ANALYZE', 'Running shard analyzers')
    const relevantEntries = workspaceFiles.filter(file => manifest.relevantPaths.includes(file.path))
    const profile = chooseExecutionProfile(relevantEntries)
    const shardResults: ShardAnalysis[] = []
    const shardOutcomes: ShardOutcome[] = []

    if (resumedShardResults && resumedShardOutcomes) {
      // 📀 Journal Replay: 跳过 SHARD，使用持久化数据
      shardResults.push(...resumedShardResults)
      for (const o of resumedShardOutcomes) {
        shardOutcomes.push({ status: o.status, shardId: o.shardId, error: o.error, durationMs: o.durationMs })
      }
      this.markStageCompleted(snapshot, 'SHARD_ANALYZE', 'Resumed from journal')
    } else if (profile.kind === 'single') {
      const shard = manifest.shards[0] ?? createFallbackScoutManifest(snapshot.goal, relevantEntries).shards[0]
      if (!shard) throw new Error('No shard available for analysis')
      const singleDecision = cogCtx.routerPolicy.route('analyze')
      this.emitJobEvent(jobId, 'shard.started', { shardId: shard.shardId, backends: [singleDecision.backend] })
      const outcome = await this.runWorkerSafe(
        snapshot, singleDecision.backend, 'analyzer',
        buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths),
        unique([...shard.sharedFiles, ...shard.filePaths]),
        'SHARD_ANALYZE', shard.shardId,
      )
      shardOutcomes.push(outcome)
      if (outcome.result) shardResults.push(outcome.result)
      this.emitJobEvent(jobId, 'shard.completed', {
        shardId: shard.shardId, backend: singleDecision.backend, outcome: outcome.status,
      })
    } else if (profile.kind === 'dual') {
      const shardFilePaths = manifest.relevantPaths.length > 0 ? manifest.relevantPaths : relevantEntries.map(file => file.path)
      const sharedFiles = pickSharedFiles(shardFilePaths)
      const shardId = 'shard-1'
      // dual 模式：Router 选出两个互补后端，推测性赛马
      const analyzerDecision = cogCtx.routerPolicy.route('analyze')
      const reviewerDecision = cogCtx.routerPolicy.route('verify')
      this.emitJobEvent(jobId, 'shard.started', { shardId, backends: [analyzerDecision.backend, reviewerDecision.backend] })
      const [analyzerOutcome, reviewerOutcome] = await Promise.all([
        this.runWorkerSafe(
          snapshot, analyzerDecision.backend, 'analyzer',
          buildShardPrompt(snapshot.goal, shardId, shardFilePaths),
          unique([...sharedFiles, ...shardFilePaths]),
          'SHARD_ANALYZE', `${shardId}:${analyzerDecision.backend}`,
        ),
        this.runWorkerSafe(
          snapshot, reviewerDecision.backend, 'reviewer',
          buildShardPrompt(snapshot.goal, shardId, shardFilePaths),
          unique([...sharedFiles, ...shardFilePaths]),
          'SHARD_ANALYZE', `${shardId}:${reviewerDecision.backend}`,
        ),
      ])
      shardOutcomes.push(analyzerOutcome, reviewerOutcome)
      if (analyzerOutcome.result) shardResults.push(analyzerOutcome.result)
      if (reviewerOutcome.result) shardResults.push(reviewerOutcome.result)
      this.emitJobEvent(jobId, 'shard.completed', { shardId, backend: analyzerDecision.backend, outcome: analyzerOutcome.status })
      this.emitJobEvent(jobId, 'shard.completed', { shardId, backend: reviewerDecision.backend, outcome: reviewerOutcome.status })
    } else {
      // sharded 模式：2 个 worker 并行消费 shard 队列，单个失败不影响其余
      const shards = manifest.shards.length > 0 ? manifest.shards : createFallbackScoutManifest(snapshot.goal, relevantEntries).shards
      const queue = [...shards]
      const workerPool = Array.from({ length: 2 }, async (_value, index) => {
        while (queue.length > 0) {
          const shard = queue.shift()
          if (!shard) return
          const poolDecision = cogCtx.routerPolicy.route('analyze')
          this.emitJobEvent(jobId, 'shard.started', { shardId: shard.shardId, backends: [`${poolDecision.backend}-${index + 1}`] })
          const outcome = await this.runWorkerSafe(
            snapshot, poolDecision.backend, 'analyzer',
            buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths),
            unique([...shard.sharedFiles, ...shard.filePaths]),
            'SHARD_ANALYZE', shard.shardId,
          )
          shardOutcomes.push(outcome)
          if (outcome.result) shardResults.push(outcome.result)
          this.emitJobEvent(jobId, 'shard.completed', {
            shardId: shard.shardId, backend: poolDecision.backend, outcome: outcome.status,
          })
        }
      })
      await Promise.all(workerPool)
    }

    // 统计 shard 执行结果
    const succeeded = shardOutcomes.filter(o => o.status === 'success').length
    const degraded = shardOutcomes.filter(o => o.status === 'degraded').length
    const failed = shardOutcomes.filter(o => o.status === 'failed').length

    // 至少要有 1 个 shard 产出结果才值得继续
    if (shardResults.length === 0) {
      throw new Error(`All ${shardOutcomes.length} shards failed — no results to aggregate`)
    }

    // 🚨 降级阈值防线：如果失败+降级的比例超过 80%，拒绝产出虚假聚合结果
    const MAX_DEGRADATION_RATIO = 0.8
    const unhealthyCount = degraded + failed
    const unhealthyRatio = shardOutcomes.length > 0 ? unhealthyCount / shardOutcomes.length : 0
    if (unhealthyRatio > MAX_DEGRADATION_RATIO) {
      throw new Error(
        `Shard health below threshold: ${succeeded} success, ${degraded} degraded, ${failed} failed ` +
        `out of ${shardOutcomes.length} (${Math.round(unhealthyRatio * 100)}% unhealthy, max allowed ${MAX_DEGRADATION_RATIO * 100}%). ` +
        `Refusing to produce a misleading aggregate from insufficient data.`
      )
    }

    // 🌳 Merkle Tree: 用 shard 结果构建完整性证明
    const merkleRoot = resumedMerkleRoot ?? computeMerkleRoot(shardResults, jobId)
    // 🔒 TOCTOU 防御: 深冻结 shard 结果，防止 Merkle Root 计算后被修改
    for (const result of shardResults) {
      Object.freeze(result)
    }
    Object.freeze(shardResults)
    // 🏗️ Journal: SHARD checkpoint（仅非恢复路径时写入）
    if (!resumedShardResults) {
      await this.journal.saveCheckpoint(jobId, 'SHARD_ANALYZE', {
        outcomes: shardOutcomes.map(o => ({ status: o.status, shardId: o.shardId, error: o.error, durationMs: o.durationMs })),
        results: shardResults,
      })
    }

    // 有降级 shard 时记录到 riskFindings
    if (degraded > 0 || failed > 0) {
      snapshot.summary.riskFindings = unique([
        ...snapshot.summary.riskFindings,
        `Shard analysis: ${succeeded} success, ${degraded} degraded, ${failed} failed out of ${shardOutcomes.length}`,
      ])
    }

    this.markStageCompleted(snapshot, 'SHARD_ANALYZE',
      `${shardResults.length}/${shardOutcomes.length} shards produced results (${degraded} degraded, ${failed} failed)`,
    )

    if (signal.aborted) return

    // ── AGGREGATE 阶段：超时时用 shard 结果简单拼接降级 ──────────
    let aggregate: AggregateAnalysis
    if (resumedAggregate) {
      // 📀 Journal Replay: 跳过 AGGREGATE
      aggregate = resumedAggregate
      this.markStageCompleted(snapshot, 'AGGREGATE', 'Resumed from journal')
    } else {
      this.markStageStarted(snapshot, 'AGGREGATE', 'Aggregating shard outputs')
      try {
        const aggregateDecision = cogCtx.routerPolicy.route('analyze')
        const aggregateResult = await withRetry(
          () => this.runWorker(
            snapshot, aggregateDecision.backend, 'aggregator',
            buildAggregatePrompt(snapshot.goal, shardResults as ShardAnalysis[]),
            [], 'AGGREGATE',
          ),
          'AGGREGATE',
          2,
          signal,
        )
        aggregate = coerceAggregate(aggregateResult.text)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] AGGREGATE failed, using concat fallback: ${msg}`)
        aggregate = {
          globalSummary: (shardResults as ShardAnalysis[]).map(s => `[${s.shardId}] ${s.summary}`).join('\n\n'),
          agreements: [],
          conflicts: [],
          missingCoverage: [`DEGRADED_AGGREGATION: ${msg}`],
        }
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `AGGREGATE failed (${msg}), using degraded concat fallback`,
        ])
      }
    }
    snapshot.summary.globalSummary = aggregate.globalSummary
    this.markStageCompleted(snapshot, 'AGGREGATE',
      aggregate.missingCoverage.some(s => s.startsWith('DEGRADED_AGGREGATION')) ? 'Degraded aggregate' : 'Aggregate ready',
    )
    this.emitJobEvent(jobId, 'aggregate.completed', {
      conflicts: aggregate.conflicts,
      missingCoverage: aggregate.missingCoverage,
    })
    // 🏗️ Journal: AGGREGATE checkpoint（仅非恢复路径）
    if (!resumedAggregate) {
      await this.journal.saveCheckpoint(jobId, 'AGGREGATE', { aggregate, merkleRoot })
    }

    if (signal.aborted) return

    // ── VERIFY 阶段：ReflexionStateMachine 闭环（最多 MAX_STEPS=2 轮）────
    this.markStageStarted(snapshot, 'VERIFY', 'Running reviewer with LSP reflexion')
    const verifyDecision = cogCtx.routerPolicy.route('verify')
    let verify: VerifyAnalysis

    const reflexion = new DefaultReflexionStateMachine()

    // 当前生成文件（write 模式时从 aggregate 结果中提取）
    let pendingFiles: Record<string, string> = {}

    // 脑裂恢复：若上次崩溃发生在 Reflexion 期间（vfsPendingPaths 有记录），
    // 且 verdict 为 unverified（Reflexion 未完成），强制从 AGGREGATE 重建 pendingFiles
    // 并重新进入 Reflexion 循环，确保脏代码不会被静默放行。
    if (
      resumedVfsPendingPaths.length > 0 &&
      resumedVerify?.verdict === 'unverified' &&
      snapshot.mode === 'write'
    ) {
      console.warn(
        `[taskd] Detected VFS-Journal desync: ${resumedVfsPendingPaths.length} file(s) ` +
        `were pending commit at last crash. Re-entering Reflexion.`,
      )
      // 从 AGGREGATE 结果中重建需要落盘的文件内容。
      // AggregateAnalysis.suggestedEdits 保存了生成的代码片段（路径 → 内容）。
      const suggestedEdits = (aggregate as any)?.suggestedEdits as Record<string, string> | undefined
      if (suggestedEdits) {
        for (const p of resumedVfsPendingPaths) {
          if (suggestedEdits[p]) {
            pendingFiles[p] = suggestedEdits[p]
          }
        }
      }
      // 重置 resumedVerify 为 undefined，强制重跑 VERIFY Worker + Reflexion
      resumedVerify = undefined
    }

    try {
      const verifyResult = await withRetry(
        () => this.runWorker(
          snapshot, verifyDecision.backend, 'reviewer',
          buildVerifyPrompt(snapshot.goal, aggregate, shardResults),
          [], 'VERIFY',
        ),
        'VERIFY',
        2,
        signal,
      )
      verify = coerceVerify(verifyResult.text)

      // ── LSP Reflexion loop（仅 write 模式且有生成文件时触发） ──
      if (snapshot.mode === 'write' && Object.keys(pendingFiles).length > 0) {
        while (!reflexion.exhausted) {
          const step = await reflexion.step(
            cogCtx.vfs,
            pendingFiles,
            snapshot.goal,
            cogCtx.lsp,
          )

          if (step.verdict === 'pass') {
            // LSP 通过 → 将 VFS 内容提交到物理磁盘
            await cogCtx.vfs.commit()
            console.info(`[taskd] Reflexion passed after ${step.attempt} step(s)`)
            break
          }

          if (step.verdict === 'retry' && step.patchPrompt) {
            // 用 LSP 精准 patch prompt 要求 Codex 修复
            console.warn(`[taskd] Reflexion retry ${step.attempt}/${reflexion.MAX_STEPS}: ${step.diagnostics.length} errors`)
            const generateDecision = cogCtx.routerPolicy.route('generate')
            const patchResult = await this.runWorker(
              snapshot, generateDecision.backend, 'writer',
              step.patchPrompt,
              [], 'VERIFY',
            )
            // 将修复结果更新到 pendingFiles，下一轮 step() 重新诊断
            Object.assign(pendingFiles, { 'patch_result.ts': patchResult.text })
          }
        }
      }
    } catch (error) {
      if (error instanceof ReflexionFailedError) {
        // Reflexion 彻底失败：VFS 已回滚（不污染磁盘），降级为 unverified
        const msg = `Reflexion failed after ${error.steps.length} steps`
        console.warn(`[taskd] ${msg}`)
        verify = {
          verdict: 'unverified',
          coverageGaps: [`REFLEXION_FAILED: ${msg}`],
          riskFindings: [msg],
          followups: error.lastDiagnostics.map(d => `Fix: [${d.file}:${d.line}] ${d.message}`),
        }
      } else {
        // VERIFY 其他失败 → 跳过验证
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] VERIFY failed, skipping verification: ${msg}`)
        verify = {
          verdict: 'unverified',
          coverageGaps: [`VERIFY_SKIPPED: ${msg}`],
          riskFindings: [`Verification skipped: ${msg}`],
          followups: [],
        }
      }
      snapshot.summary.riskFindings = unique([
        ...snapshot.summary.riskFindings,
        verify.riskFindings[0] ?? 'VERIFY_SKIPPED',
      ])
    } finally {
      cogCtx.blackboard.dispose()
    }

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
    // 🏗️ Journal: VERIFY checkpoint
    // 包含 vfsPendingPaths：记录 VFS 里尚未 commit 的文件路径。
    // 若进程在 Reflexion 期间崩溃，恢复时可检测到脑裂并重新触发 Reflexion。
    await this.journal.saveCheckpoint(jobId, 'VERIFY', {
      verify,
      vfsPendingPaths: Object.keys(pendingFiles),
    })

    // ── WRITE 阶段 Shard 化：按 WRITE_BATCH_SIZE 分批串行执行 ───────
    let writeAnalysis: WriteAnalysis | undefined
    if (snapshot.mode === 'write') {
      // 🛡️ Governance Gate: VERIFY → WRITE 转换点的强制授权检查
      const govDecision = await this.governance.authorize({
        aggregate, verify, merkleRoot,
        shardCount: shardOutcomes.length,
        degradedShards: degraded,
        jobMode: snapshot.mode,
      })
      if (!govDecision.authorized) {
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `Governance BLOCKED write: ${govDecision.reason}`,
        ])
        throw new Error(`Governance rejected write: ${govDecision.reason}`)
      }
      if (govDecision.warnings.length > 0) {
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `Governance warnings: ${govDecision.warnings.join(', ')}`,
        ])
      }

      findStage(snapshot, 'WRITE').status = 'pending'
      this.markStageStarted(snapshot, 'WRITE', 'Running batched writer')
      this.emitJobEvent(jobId, 'write.started', {})

      const writeTargetFiles = unique([
        ...snapshot.artifacts.changedFiles,
        ...manifest.relevantPaths.slice(0, 12),
      ])

      // 将目标文件切分成 WRITE_BATCH_SIZE 大小的 batch
      const writeBatches: string[][] = []
      for (let i = 0; i < writeTargetFiles.length; i += WRITE_BATCH_SIZE) {
        writeBatches.push(writeTargetFiles.slice(i, i + WRITE_BATCH_SIZE))
      }

      // 串行执行每个 batch（避免并发写同一目录产生冲突）
      const batchResults: WriteAnalysis[] = []
      const allChangedFiles: string[] = []
      let lastDiff = ''

      for (let batchIdx = 0; batchIdx < writeBatches.length; batchIdx++) {
        const batch = writeBatches[batchIdx]
        if (signal.aborted) break

        this.emitJobEvent(jobId, 'worker.progress', {
          phase: 'working',
          message: `Write batch ${batchIdx + 1}/${writeBatches.length} (${batch.length} files)`,
          progress: batchIdx / writeBatches.length,
        })

        try {
          const writeResult = await this.runWorker(
            snapshot,
            'codex',
            'writer',
            buildWritePrompt(snapshot.goal, aggregate, verify, batch),
            batch,
            'WRITE',
          )
          const parsed = coerceWrite(writeResult.text)
          batchResults.push(parsed)
          allChangedFiles.push(...parsed.targetFiles, ...writeResult.changedFiles)
          if (writeResult.diff) lastDiff = writeResult.diff
        } catch (error) {
          // 单个 batch 写入失败不阻断后续 batch
          const msg = error instanceof Error ? error.message : String(error)
          console.warn(`[taskd] write batch ${batchIdx + 1} failed: ${msg}`)
          snapshot.summary.riskFindings = unique([
            ...snapshot.summary.riskFindings,
            `Write batch ${batchIdx + 1}/${writeBatches.length} failed: ${msg}`,
          ])
        }
      }

      // 合并所有 batch 结果
      writeAnalysis = {
        changePlan: batchResults.map(r => r.changePlan).filter(Boolean).join('\n---\n'),
        targetFiles: unique(batchResults.flatMap(r => r.targetFiles)),
        executionLog: batchResults.flatMap(r => r.executionLog),
        diffSummary: batchResults.map(r => r.diffSummary).filter(Boolean).join('\n'),
      }

      snapshot.artifacts.changedFiles = unique([...snapshot.artifacts.changedFiles, ...allChangedFiles])
      if (lastDiff) snapshot.artifacts.latestDiff = lastDiff

      this.markStageCompleted(snapshot, 'WRITE',
        `${batchResults.length}/${writeBatches.length} batches completed`,
      )
      this.emitJobEvent(jobId, 'write.completed', {
        targetFiles: writeAnalysis.targetFiles,
        diffSummary: writeAnalysis.diffSummary,
        batchCount: writeBatches.length,
        successCount: batchResults.length,
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

    // 📜 SLSA Provenance: record outputs + assemble signed attestation
    if (writeAnalysis) {
      provenance.recordOutputFiles(writeAnalysis.targetFiles)
    }
    const signedAttestation = provenance.assemble(snapshot)
    // 🏗️ Journal: WRITE checkpoint (if applicable)
    if (writeAnalysis) {
      await this.journal.saveCheckpoint(jobId, 'WRITE', { writeResults: [writeAnalysis] })
    }

    this.markStageCompleted(snapshot, 'FINALIZE', 'Completed')
    snapshot.status = 'completed'
    snapshot.updatedAt = nowIso()
    this.persistence.saveSnapshot(snapshot)
    // 🗑️ Journal 清理：job 成功完成后删除中间态 checkpoint 文件
    this.journal.purgeCheckpoints(jobId)
    this.emitJobEvent(jobId, 'job.completed', {
      verdict: snapshot.summary.verdict,
      changedFiles: snapshot.artifacts.changedFiles,
      slsaProvenance: signedAttestation,
    })
  }
}
