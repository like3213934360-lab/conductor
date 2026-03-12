/**
 * Antigravity Workflow Runtime — 风险评估 Schema
 */
import { z } from 'zod'

/** 风险信号 */
export const RiskSignalSchema = z.object({
  /** 信号来源 */
  source: z.string(),
  /** 信号类型 */
  type: z.enum(['complexity', 'sensitivity', 'novelty', 'scope', 'external']),
  /** 数值（0-100） */
  value: z.number().min(0).max(100),
  /** 说明 */
  description: z.string().optional(),
})

export type RiskSignal = z.infer<typeof RiskSignalSchema>

/** DR 分歧率评分 */
export const DRScoreSchema = z.object({
  /** 分歧率分数（0-100） */
  score: z.number().min(0).max(100),
  /** 各因子分数明细 */
  factors: z.record(z.string(), z.number()),
  /** 综合风险等级 */
  level: z.enum(['low', 'medium', 'high', 'critical']),
})

export type DRScore = z.infer<typeof DRScoreSchema>

/** 风险评估结果 */
export const RiskAssessmentSchema = z.object({
  /** DR 评分 */
  drScore: DRScoreSchema,
  /** 原始风险信号列表 */
  signals: z.array(RiskSignalSchema),
  /** 评估时间 */
  assessedAt: z.string(),
})

export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>

/** 路由决策 */
export const RouteDecisionSchema = z.object({
  /** 选定的路由通道 */
  lane: z.enum(['express', 'standard', 'full', 'escalated']),
  /** 实际要执行的节点路径 */
  nodePath: z.array(z.string()),
  /** 跳过的节点及原因 */
  skippedNodes: z.array(z.object({
    nodeId: z.string(),
    reason: z.string(),
  })).default([]),
  /** 置信度（0-100） */
  confidence: z.number().min(0).max(100),
})

export type RouteDecision = z.infer<typeof RouteDecisionSchema>
