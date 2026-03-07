/**
 * Conductor AGC — 合规 Schema
 */
import { z } from 'zod'

/** 合规检查发现项 */
export const ComplianceFindingSchema = z.object({
  /** 规则 ID（如 S1, S2, ..., S13） */
  ruleId: z.string(),
  /** 规则名称 */
  ruleName: z.string(),
  /** 决策: 通过 / 警告 / 阻断 / 降级 */
  status: z.enum(['pass', 'warn', 'block', 'degrade']),
  /** 详情描述 */
  message: z.string(),
  /** 关联的节点 ID（可选） */
  nodeId: z.string().optional(),
})

export type ComplianceFinding = z.infer<typeof ComplianceFindingSchema>

/** 合规引擎综合决策 */
export const ComplianceDecisionSchema = z.object({
  /** 是否允许继续 */
  allowed: z.boolean(),
  /** 最严重的状态 */
  worstStatus: z.enum(['pass', 'warn', 'block', 'degrade']),
  /** 所有发现项 */
  findings: z.array(ComplianceFindingSchema),
  /** 评估时间 */
  evaluatedAt: z.string(),
})

export type ComplianceDecision = z.infer<typeof ComplianceDecisionSchema>
