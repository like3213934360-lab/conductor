import { z } from 'zod'

export const TaskJobModeSchema = z.enum(['analysis', 'write'])
export type TaskJobMode = z.infer<typeof TaskJobModeSchema>

export const TaskJobStatusSchema = z.enum([
  'queued',
  'planning',
  'running',
  'verifying',
  'writing',
  'completed',
  'failed',
  'cancelled',
])
export type TaskJobStatus = z.infer<typeof TaskJobStatusSchema>

export const TaskStageIdSchema = z.enum([
  'SCOUT',
  'SHARD_ANALYZE',
  'AGGREGATE',
  'VERIFY',
  'WRITE',
  'FINALIZE',
])
export type TaskStageId = z.infer<typeof TaskStageIdSchema>

export const TaskStageStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped'])
export type TaskStageStatus = z.infer<typeof TaskStageStatusSchema>

export const WorkerBackendSchema = z.enum(['codex', 'gemini', 'ollama'])
export type WorkerBackend = z.infer<typeof WorkerBackendSchema>

export const WorkerRoleSchema = z.enum(['scout', 'analyzer', 'reviewer', 'aggregator', 'writer'])
export type WorkerRole = z.infer<typeof WorkerRoleSchema>

export const WorkerStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>

export const WorkerPhaseSchema = z.enum([
  'queued',
  'thinking',
  'working',
  'tool_use',
  'finalizing',
  'done',
  'error',
])
export type WorkerPhase = z.infer<typeof WorkerPhaseSchema>

export const TaskJobEventTypeSchema = z.enum([
  'job.created',
  'plan.ready',
  'shard.started',
  'worker.progress',
  'worker.tool_use',
  'worker.tool_result',
  'worker.file_change',
  'worker.diff_update',
  'shard.completed',
  'aggregate.completed',
  'verify.completed',
  'write.started',
  'write.completed',
  'job.completed',
  'job.failed',
  'job.cancelled',
])
export type TaskJobEventType = z.infer<typeof TaskJobEventTypeSchema>

export const TaskBudgetSchema = z.object({
  softBudgetMs: z.number().int().positive(),
  hardBudgetMs: z.number().int().positive(),
})
export type TaskBudget = z.infer<typeof TaskBudgetSchema>

export const TaskGraphStageSchema = z.object({
  id: TaskStageIdSchema,
  status: TaskStageStatusSchema,
  softBudgetMs: z.number().int().positive(),
  hardBudgetMs: z.number().int().positive(),
  shardIds: z.array(z.string()).default([]),
  detail: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
})
export type TaskGraphStage = z.infer<typeof TaskGraphStageSchema>

export const WorkerSnapshotSchema = z.object({
  workerId: z.string(),
  backend: WorkerBackendSchema,
  role: WorkerRoleSchema,
  status: WorkerStatusSchema,
  phase: WorkerPhaseSchema,
  message: z.string(),
  progress: z.number().min(0).max(1),
  currentShardId: z.string().optional(),
  lastEventAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  targetFiles: z.array(z.string()).default([]),
})
export type WorkerSnapshot = z.infer<typeof WorkerSnapshotSchema>

export const TaskJobSummarySchema = z.object({
  goalSummary: z.string().optional(),
  globalSummary: z.string().optional(),
  verdict: z.string().optional(),
  finalAnswer: z.string().optional(),
  coverageGaps: z.array(z.string()).default([]),
  riskFindings: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
})
export type TaskJobSummary = z.infer<typeof TaskJobSummarySchema>

export const TaskJobArtifactsSchema = z.object({
  snapshotPath: z.string(),
  eventsPath: z.string(),
  latestDiff: z.string().optional(),
  changedFiles: z.array(z.string()).default([]),
  shardCount: z.number().int().nonnegative().default(0),
})
export type TaskJobArtifacts = z.infer<typeof TaskJobArtifactsSchema>

export const TaskJobEventSchema = z.object({
  eventId: z.string(),
  jobId: z.string(),
  sequence: z.number().int().nonnegative(),
  type: TaskJobEventTypeSchema,
  timestamp: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
})
export type TaskJobEvent = z.infer<typeof TaskJobEventSchema>

export const TaskJobSnapshotSchema = z.object({
  jobId: z.string(),
  status: TaskJobStatusSchema,
  mode: TaskJobModeSchema,
  workspaceRoot: z.string(),
  goal: z.string(),
  currentStageId: TaskStageIdSchema.optional(),
  graph: z.array(TaskGraphStageSchema),
  workers: z.array(WorkerSnapshotSchema),
  summary: TaskJobSummarySchema,
  artifacts: TaskJobArtifactsSchema,
  recentEvents: z.array(TaskJobEventSchema).default([]),
  fileHints: z.array(z.string()).default([]),
  totalTokensUsed: z.number().int().nonnegative().default(0),
  updatedAt: z.string(),
  createdAt: z.string(),
})
export type TaskJobSnapshot = z.infer<typeof TaskJobSnapshotSchema>

export const CreateTaskJobRequestSchema = z.object({
  goal: z.string().min(1),
  mode: TaskJobModeSchema.default('analysis'),
  workspaceRoot: z.string().min(1),
  fileHints: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional(),
})
export type CreateTaskJobRequest = z.infer<typeof CreateTaskJobRequestSchema>

export const CreateTaskJobResponseSchema = z.object({
  jobId: z.string(),
})
export type CreateTaskJobResponse = z.infer<typeof CreateTaskJobResponseSchema>

export const ListTaskJobsResponseSchema = z.object({
  jobs: z.array(TaskJobSnapshotSchema),
})
export type ListTaskJobsResponse = z.infer<typeof ListTaskJobsResponseSchema>

export const CancelTaskJobResponseSchema = z.object({
  jobId: z.string(),
  cancelled: z.boolean(),
})
export type CancelTaskJobResponse = z.infer<typeof CancelTaskJobResponseSchema>

export const WorkerEventSchema = z.object({
  type: z.enum([
    'started',
    'progress',
    'tool_use',
    'tool_result',
    'file_change',
    'diff_update',
    'message',
    'completed',
    'failed',
  ]),
  timestamp: z.number().int().nonnegative(),
  phase: WorkerPhaseSchema.optional(),
  message: z.string().optional(),
  progress: z.number().min(0).max(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type WorkerEvent = z.infer<typeof WorkerEventSchema>

export interface WorkerRunRequest {
  workerId: string
  prompt: string
  cwd: string
  filePaths: string[]
  mode: TaskJobMode
  role: WorkerRole
  hardBudgetMs: number
  softBudgetMs?: number  // 软超时预算，adapter 可用来做优雅降级
  swarmPeers?: import('./cognitive/swarm-mesh.js').PeerDescriptor[]
}

export interface WorkerRunResult {
  backend: WorkerBackend
  workerId: string
  text: string
  diff?: string
  changedFiles: string[]
}

export interface WorkerAdapter {
  readonly backend: WorkerBackend
  run(
    request: WorkerRunRequest,
    onEvent: (event: WorkerEvent) => void,
    signal: AbortSignal,
    softSignal?: AbortSignal,  // 软超时信号：收到后应尽快输出已有结果
  ): Promise<WorkerRunResult>
}

export interface ScoutShard {
  shardId: string
  filePaths: string[]
  sharedFiles: string[]
}

export interface ScoutManifest {
  goalSummary: string
  relevantPaths: string[]
  shards: ScoutShard[]
  unknowns: string[]
  riskFlags: string[]
}

export interface ShardAnalysis {
  shardId: string
  backend: WorkerBackend
  summary: string
  evidence: string[]
  symbols: string[]
  dependencies: string[]
  openQuestions: string[]
  confidence: number
}

export interface AggregateAnalysis {
  globalSummary: string
  agreements: string[]
  conflicts: string[]
  missingCoverage: string[]
}

export interface VerifyAnalysis {
  verdict: string
  coverageGaps: string[]
  riskFindings: string[]
  followups: string[]
}

export interface WriteAnalysis {
  changePlan: string
  targetFiles: string[]
  executionLog: string[]
  diffSummary: string
}
