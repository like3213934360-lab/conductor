/**
 * Conductor AGC — 合规引擎
 *
 * 洋葱管道模式: 按序执行所有规则，遇到 BLOCK 可提前终止。
 */
import type { ComplianceRule, ComplianceContext, ComplianceRuleResult } from './compliance-rule.js'
import type { ComplianceDecision, ComplianceFinding } from '@anthropic/conductor-shared'
import { createISODateTime } from '@anthropic/conductor-shared'

/** 合规引擎配置 */
export interface ComplianceEngineOptions {
  /** 遇到第一个 BLOCK 时是否立即停止 */
  failFast: boolean
}

/**
 * 合规引擎
 *
 * 设计:
 * 1. 规则集合可动态注册（支持插件注入新规则）
 * 2. 洋葱管道顺序执行
 * 3. 支持 failFast 模式
 */
export class ComplianceEngine {
  private rules: ComplianceRule[]
  private readonly options: ComplianceEngineOptions

  constructor(
    rules: ComplianceRule[],
    options?: Partial<ComplianceEngineOptions>,
  ) {
    this.rules = [...rules]
    this.options = { failFast: true, ...options }
  }

  /** 动态注册新规则 */
  registerRule(rule: ComplianceRule): void {
    this.rules.push(rule)
  }

  /** 动态移除规则 */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId)
  }

  /** 执行全部规则评估 */
  async evaluate(ctx: ComplianceContext): Promise<ComplianceDecision> {
    const findings: ComplianceFinding[] = []
    let worstStatus: ComplianceFinding['status'] = 'pass'
    let allowed = true

    for (const rule of this.rules) {
      const result: ComplianceRuleResult = await Promise.resolve(rule.evaluate(ctx))

      const finding: ComplianceFinding = {
        ruleId: result.ruleId,
        ruleName: result.ruleName,
        status: result.status,
        message: result.message,
        nodeId: result.nodeId,
      }
      findings.push(finding)

      // 更新最严重状态
      if (isMoreSevere(result.status, worstStatus)) {
        worstStatus = result.status
      }

      if (result.status === 'block') {
        allowed = false
        if (this.options.failFast) break
      }
    }

    return {
      allowed,
      worstStatus,
      findings,
      evaluatedAt: createISODateTime(),
    }
  }
}

/** 严重度比较 */
function isMoreSevere(
  a: ComplianceFinding['status'],
  b: ComplianceFinding['status'],
): boolean {
  const order: Record<string, number> = { pass: 0, warn: 1, degrade: 2, block: 3 }
  return (order[a] ?? 0) > (order[b] ?? 0)
}
