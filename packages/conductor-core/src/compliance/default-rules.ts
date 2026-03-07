/**
 * Conductor AGC — 默认合规规则 (S1-S13)
 *
 * Phase 1 实现: 基础骨架规则，后续 Phase 补充完整逻辑。
 */
import type { ComplianceRule, ComplianceContext, ComplianceRuleResult } from './compliance-rule.js'

/** S1: 状态一致性检查 */
export class StateConsistencyRule implements ComplianceRule {
  readonly id = 'S1'
  readonly name = '状态一致性'
  readonly defaultLevel = 'block' as const

  evaluate(ctx: ComplianceContext): ComplianceRuleResult {
    // 检查 AGCState 版本号是否单调递增
    if (ctx.state.version < 0) {
      return { ruleId: this.id, ruleName: this.name, status: 'block', message: '状态版本号为负' }
    }
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: '状态一致性通过' }
  }
}

/** S2: 权重顺序检查 */
export class WeightOrderRule implements ComplianceRule {
  readonly id = 'S2'
  readonly name = '权重顺序'
  readonly defaultLevel = 'warn' as const

  evaluate(_ctx: ComplianceContext): ComplianceRuleResult {
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: '权重顺序通过' }
  }
}

/** S3: Schema 完整性检查 */
export class SchemaIntegrityRule implements ComplianceRule {
  readonly id = 'S3'
  readonly name = 'Schema 完整性'
  readonly defaultLevel = 'block' as const

  evaluate(ctx: ComplianceContext): ComplianceRuleResult {
    if (ctx.graph.nodes.length === 0) {
      return { ruleId: this.id, ruleName: this.name, status: 'block', message: 'DAG 图为空' }
    }
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: 'Schema 完整性通过' }
  }
}

/** S11: 状态链接（State Linkage） */
export class StateLinkageRule implements ComplianceRule {
  readonly id = 'S11'
  readonly name = '状态链接'
  readonly defaultLevel = 'block' as const

  evaluate(ctx: ComplianceContext): ComplianceRuleResult {
    // 检查所有已开始的节点都有前序检查点
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: '状态链接通过' }
  }
}

/** S12: 无检查点无结果（No CP No Result） */
export class NoCheckpointNoResultRule implements ComplianceRule {
  readonly id = 'S12'
  readonly name = '无检查点无结果'
  readonly defaultLevel = 'block' as const

  evaluate(ctx: ComplianceContext): ComplianceRuleResult {
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: '检查点规则通过' }
  }
}

/** S13: Schema 强制（Schema Enforcement） */
export class SchemaEnforcementRule implements ComplianceRule {
  readonly id = 'S13'
  readonly name = 'Schema 强制'
  readonly defaultLevel = 'block' as const

  evaluate(_ctx: ComplianceContext): ComplianceRuleResult {
    return { ruleId: this.id, ruleName: this.name, status: 'pass', message: 'Schema 强制通过' }
  }
}

/** 所有默认规则的集合 */
export const DefaultComplianceRules: ComplianceRule[] = [
  new StateConsistencyRule(),
  new WeightOrderRule(),
  new SchemaIntegrityRule(),
  new StateLinkageRule(),
  new NoCheckpointNoResultRule(),
  new SchemaEnforcementRule(),
]
