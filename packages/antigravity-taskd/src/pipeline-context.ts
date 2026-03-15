/**
 * Pipeline Context & Stage Interface — V1.1.0 Strategy Pattern
 *
 * PipelineContext 是五段式管线的数据通信总线。
 * 每个 Stage 通过读写 ctx 上的字段传递中间产物，
 * 避免了 God Method 中不可见的局部变量耦合。
 */
import type {
  AggregateAnalysis,
  ScoutManifest,
  ShardAnalysis,
  TaskJobEvent,
  TaskJobEventType,
  TaskJobSnapshot,
  TaskStageId,
  VerifyAnalysis,
  WorkerBackend,
  WorkerRole,
  WriteAnalysis,
} from './schema.js'
import type { WorkspaceFileEntry } from './file-context.js'
import type { JournalStore } from './journal.js'
import type { ProvenanceCollector } from './provenance.js'
import type { GovernanceGateway } from './governance.js'
import type {
  McpBlackboard,
  RouterPolicy,
  RacingExecutor,
  VirtualFileSystem,
  LspDiagnosticsProvider,
  RedTeamCritic,
  SwarmMesh,
} from './cognitive/index.js'
import type { EpisodicMemoryStore } from './cognitive/index.js'

// ── Shard 级失败容忍 ──────────────────────────────────────────────
export type ShardOutcomeStatus = 'success' | 'degraded' | 'failed'

export interface ShardOutcome {
  status: ShardOutcomeStatus
  shardId: string
  result?: ShardAnalysis
  error?: string
  durationMs: number
}

// ── 认知携带器 ────────────────────────────────────────────────────
export interface CognitiveJobContext {
  blackboard: McpBlackboard
  routerPolicy: RouterPolicy
  racingExecutor: RacingExecutor
  vfs: VirtualFileSystem
  lsp: LspDiagnosticsProvider
  memoryStore: EpisodicMemoryStore
  redTeamCritic: RedTeamCritic
  swarmMesh: SwarmMesh
}

// ── Worker 执行委托 ──────────────────────────────────────────────
export interface WorkerResult {
  backend: WorkerBackend
  workerId: string
  text: string
  changedFiles: string[]
  diff?: string
}

export type RunWorkerFn = (
  snapshot: TaskJobSnapshot,
  backend: WorkerBackend,
  role: WorkerRole,
  prompt: string,
  filePaths: string[],
  stageId: TaskStageId,
  currentShardId?: string,
) => Promise<WorkerResult>

export type RunWorkerSafeFn = (
  snapshot: TaskJobSnapshot,
  backend: WorkerBackend,
  role: WorkerRole,
  prompt: string,
  filePaths: string[],
  stageId: TaskStageId,
  currentShardId?: string,
) => Promise<ShardOutcome>

// ── Pipeline Context ─────────────────────────────────────────────
export interface PipelineContext {
  // 固定输入
  readonly snapshot: TaskJobSnapshot
  readonly signal: AbortSignal
  readonly jobId: string
  readonly cogCtx: CognitiveJobContext
  readonly workspaceFiles: WorkspaceFileEntry[]
  readonly fileHintEntries: WorkspaceFileEntry[]
  readonly journal: JournalStore
  readonly provenance: ProvenanceCollector
  readonly governance: GovernanceGateway

  // 阶段间中间产物（可读写）
  manifest?: ScoutManifest
  shardResults: ShardAnalysis[]
  shardOutcomes: ShardOutcome[]
  merkleRoot?: string
  aggregate?: AggregateAnalysis
  verify?: VerifyAnalysis
  writeAnalysis?: WriteAnalysis
  pendingFiles: Record<string, string>

  // Journal Replay 恢复数据
  resumedManifest?: ScoutManifest
  resumedShardResults?: ShardAnalysis[]
  resumedShardOutcomes?: Array<{ status: string; shardId: string; error?: string; durationMs: number }>
  resumedMerkleRoot?: string
  resumedAggregate?: AggregateAnalysis
  resumedVerify?: VerifyAnalysis
  resumedVfsPendingPaths: string[]

  // 委托方法（由 runtime 绑定）
  runWorker: RunWorkerFn
  runWorkerSafe: RunWorkerSafeFn
  markStageStarted(stageId: TaskStageId, detail?: string): void
  markStageCompleted(stageId: TaskStageId, detail?: string): void
  emitJobEvent(type: TaskJobEventType, data: Record<string, unknown>): void
}

// ── Pipeline Stage 接口 ──────────────────────────────────────────
export interface PipelineStage {
  readonly stageId: TaskStageId
  execute(ctx: PipelineContext): Promise<void>
}
