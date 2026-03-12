/**
 * Antigravity Workflow Runtime — WorkflowState 聚合根
 *
 * Event Sourcing 的 Read Model：
 * 由 projector.ts 的 reduceEvent 从事件流投影而来。
 *
 * capturedContext 采用强类型 schema，而不是松散 unknown
 */
import { z } from 'zod'
import { RunGraphSchema } from '../schema/graph.js'
import { RunMetadataSchema } from '../schema/run.js'

/** 节点运行时状态 */
export const NodeRuntimeStateSchema = z.object({
  /** 节点 ID */
  nodeId: z.string(),
  /** 执行状态 */
  status: z.enum(['pending', 'queued', 'running', 'completed', 'failed', 'skipped']),
  /** 节点输出（完成后填充） */
  output: z.record(z.string(), z.unknown()).optional(),
  /** 错误信息（失败后填充） */
  error: z.string().optional(),
  /** 开始时间 */
  startedAt: z.string().optional(),
  /** 完成时间 */
  completedAt: z.string().optional(),
  /** 分配的模型 */
  model: z.string().optional(),
  /** 当前执行租约 */
  leaseId: z.string().optional(),
  leaseAttempt: z.number().int().nonnegative().optional(),
  leaseExpiresAt: z.string().optional(),
  requiredEvidence: z.array(z.string()).optional(),
  allowedModelPool: z.array(z.string()).optional(),
  inputDigest: z.string().optional(),
  lastHeartbeatAt: z.string().optional(),
  /** 执行耗时(毫秒) — 复查修复 #8 */
  durationMs: z.number().optional(),
  /** 是否降级执行 — 复查修复 #8 */
  degraded: z.boolean().optional(),
})

export type NodeRuntimeState = z.infer<typeof NodeRuntimeStateSchema>

/** 运行选项 Schema（内联定义，避免循环引用） */
const CapturedOptionsSchema = z.object({
  plugins: z.array(z.string()).default([]),
  debug: z.boolean().default(false),
  riskHint: z.string().optional(),
  tokenBudget: z.number().optional(),
  forceFullPath: z.boolean().optional(),
})

/**
 * 捕获的运行上下文
 *
 * 采用强类型 schema，避免插件和校验逻辑反复做类型断言。
 */
export const CapturedContextSchema = z.object({
  /** 完整 DAG 图定义（强类型） */
  graph: RunGraphSchema,
  /** 完整运行元数据（强类型） */
  metadata: RunMetadataSchema,
  /** 完整运行选项（强类型） */
  options: CapturedOptionsSchema,
  /** 捕获时间 */
  capturedAt: z.string(),
})

export type CapturedContext = z.infer<typeof CapturedContextSchema>

/** WorkflowState — 运行聚合根 */
export const WorkflowStateSchema = z.object({
  /** 运行 ID */
  runId: z.string(),
  /** 状态版本号（随事件单调递增） */
  version: z.number().int().nonnegative(),
  /** 整体执行状态 */
  status: z.enum(['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']),
  /** 各节点的运行时状态 */
  nodes: z.record(z.string(), NodeRuntimeStateSchema),
  /** 最新风险评估 */
  latestRisk: z.object({
    drScore: z.number(),
    level: z.string(),
    factors: z.record(z.string(), z.number()),
    assessedAt: z.string(),
  }).optional(),
  /** 最新合规决策 */
  latestCompliance: z.object({
    allowed: z.boolean(),
    worstStatus: z.string(),
    findingCount: z.number(),
    evaluatedAt: z.string(),
  }).optional(),
  /** 路由决策 */
  routeDecision: z.object({
    lane: z.string(),
    nodePath: z.array(z.string()),
    skippedCount: z.number(),
    confidence: z.number(),
  }).optional(),
  /** 捕获的完整运行上下文 — Phase 3 强类型化 */
  capturedContext: CapturedContextSchema.optional(),
  /** 最后一个检查点 ID */
  lastCheckpointId: z.string().optional(),
  /** 最后一个检查点版本 */
  lastCheckpointVersion: z.number().optional(),
  /** 审查修复 #12: 验证结果 (RUN_VERIFIED 投影) */
  verificationResult: z.object({
    ok: z.boolean(),
    driftDetected: z.boolean(),
    verifiedAt: z.string(),
  }).optional(),
})

export type WorkflowState = z.infer<typeof WorkflowStateSchema>
