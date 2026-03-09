/**
 * Conductor AGC — 治理决策记录 Schema (Event Wire Format)
 *
 * AGC v8.0: GovernanceDecisionRecord 取代原 ComplianceDecision
 * 保留 ComplianceFinding 名称因为它记录的是策略评估发现项（与治理/合规均相关）
 */
import { z } from 'zod'

/** 治理发现项 */
export const GovernanceFindingSchema = z.object({
  /** 规则/控制 ID */
  ruleId: z.string(),
  /** 规则/控制名称 */
  ruleName: z.string(),
  /** 决策: 通过 / 警告 / 阻断 / 降级 */
  status: z.enum(['pass', 'warn', 'block', 'degrade']),
  /** 详情描述 */
  message: z.string(),
  /** 关联的节点 ID（可选） */
  nodeId: z.string().optional(),
})

export type GovernanceFinding = z.infer<typeof GovernanceFindingSchema>

/** 治理引擎综合决策记录 */
export const GovernanceDecisionRecordSchema = z.object({
  /** 是否允许继续 */
  allowed: z.boolean(),
  /** 最严重的状态 */
  worstStatus: z.enum(['pass', 'warn', 'block', 'degrade']),
  /** 所有发现项 */
  findings: z.array(GovernanceFindingSchema),
  /** 评估时间 */
  evaluatedAt: z.string(),
})

export type GovernanceDecisionRecord = z.infer<typeof GovernanceDecisionRecordSchema>

// ── 向后兼容别名（v7.0 event wire format 兼容，不要在新代码中使用）──
/** @deprecated 使用 GovernanceFindingSchema */
export const ComplianceFindingSchema = GovernanceFindingSchema
/** @deprecated 使用 GovernanceFinding */
export type ComplianceFinding = GovernanceFinding
/** @deprecated 使用 GovernanceDecisionRecordSchema */
export const ComplianceDecisionSchema = GovernanceDecisionRecordSchema
/** @deprecated 使用 GovernanceDecisionRecord */
export type ComplianceDecision = GovernanceDecisionRecord
