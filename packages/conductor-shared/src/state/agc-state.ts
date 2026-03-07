/**
 * Conductor AGC — AGCState 聚合根
 *
 * Event Sourcing 的 Read Model：
 * 由 projector.ts 的 reduceEvent 从事件流投影而来。
 */
import { z } from 'zod'

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
})

export type NodeRuntimeState = z.infer<typeof NodeRuntimeStateSchema>

/** AGCState — 运行聚合根 */
export const AGCStateSchema = z.object({
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
  /** 捕获的完整运行上下文 — Phase 2 新增 */
  capturedContext: z.object({
    graph: z.unknown(),
    metadata: z.unknown(),
    options: z.unknown(),
    capturedAt: z.string(),
  }).optional(),
  /** 最后一个检查点 ID */
  lastCheckpointId: z.string().optional(),
  /** 最后一个检查点版本 */
  lastCheckpointVersion: z.number().optional(),
})

export type AGCState = z.infer<typeof AGCStateSchema>
