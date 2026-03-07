/**
 * Conductor AGC — 合规规则接口
 *
 * 策略模式: 每条规则是独立的策略实现。
 * 洋葱管道: ComplianceEngine 按序执行所有规则。
 */
import type { AGCState, RunGraph, RunMetadata } from '@anthropic/conductor-shared'

/** 合规评估上下文 */
export interface ComplianceContext {
  /** 当前 AGC 状态 */
  state: AGCState
  /** DAG 图定义 */
  graph: RunGraph
  /** 运行元数据 */
  metadata: RunMetadata
  /** 当前正在评估的节点 ID（可选） */
  currentNodeId?: string
}

/** 规则评估结果 */
export interface ComplianceRuleResult {
  /** 规则 ID */
  ruleId: string
  /** 规则名称 */
  ruleName: string
  /** 决策 */
  status: 'pass' | 'warn' | 'block' | 'degrade'
  /** 详情 */
  message: string
  /** 关联节点 */
  nodeId?: string
}

/**
 * ComplianceRule 接口 — 单条合规规则
 *
 * 遵循开闭原则:
 * - 新增 S14、S15 只需实现此接口
 * - 核心引擎代码不需要修改
 */
export interface ComplianceRule {
  /** 规则 ID（如 'S1', 'S2', ..., 'S13'） */
  readonly id: string
  /** 规则名称 */
  readonly name: string
  /** 默认级别 */
  readonly defaultLevel: 'block' | 'warn' | 'degrade'
  /** 三模型审计: 规则优先级 (数值越大越先执行, 默认 0) */
  readonly priority?: number
  /** 三模型审计: 规则严重度 (block 级规则异常时 fail-closed) */
  readonly severity?: 'block' | 'warn' | 'degrade'
  /** 评估规则 */
  evaluate(ctx: ComplianceContext): ComplianceRuleResult | Promise<ComplianceRuleResult>
}
