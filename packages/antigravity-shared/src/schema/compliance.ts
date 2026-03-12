/**
 * Antigravity Workflow Runtime — 治理决策记录 Schema (Event Wire Format)
 *
 * 新架构统一使用 GovernanceFinding / GovernanceDecisionRecord。
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
