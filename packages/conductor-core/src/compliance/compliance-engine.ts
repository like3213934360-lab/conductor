/**
 * Conductor AGC — 合规引擎
 *
 * 洋葱管道模式: 按序执行所有规则，遇到 BLOCK 可提前终止。
 *
 * Phase 3 优化:
 * - 每条规则 try/catch + 超时保护
 * - 支持优先级排序
 * - 规则异常不炸出引擎
 */
import type { ComplianceRule, ComplianceContext, ComplianceRuleResult } from './compliance-rule.js'
import type { ComplianceDecision, ComplianceFinding } from '@anthropic/conductor-shared'
import { createISODateTime } from '@anthropic/conductor-shared'

/** 合规引擎配置 */
export interface ComplianceEngineOptions {
  /** 遇到第一个 BLOCK 时是否立即停止 */
  failFast: boolean
  /** 规则默认超时毫秒数 */
  ruleTimeoutMs: number
}

/**
 * 合规引擎
 *
 * 设计:
 * 1. 规则集合可动态注册（支持插件注入新规则）
 * 2. 洋葱管道顺序执行
 * 3. 支持 failFast 模式
 * 4. Phase 3: 每条规则独立 try/catch + 超时
 */
export class ComplianceEngine {
  private rules: ComplianceRule[]
  private readonly options: ComplianceEngineOptions

  constructor(
    rules: ComplianceRule[],
    options?: Partial<ComplianceEngineOptions>,
  ) {
    this.rules = [...rules]
    this.options = {
      failFast: true,
      ruleTimeoutMs: 5000,
      ...options,
    }
  }

  /** 动态注册新规则 */
  registerRule(rule: ComplianceRule): void {
    this.rules.push(rule)
  }

  /** 批量注册规则（插件贡献） */
  registerRules(rules: ComplianceRule[]): void {
    this.rules.push(...rules)
  }

  /** 动态移除规则 */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId)
  }

  /** 获取当前规则数量 */
  getRuleCount(): number {
    return this.rules.length
  }

  /**
   * 执行全部规则评估
   *
   * Phase 3 优化: 每条规则带 try/catch + 超时保护
   */
  async evaluate(ctx: ComplianceContext): Promise<ComplianceDecision> {
    const findings: ComplianceFinding[] = []
    let worstStatus: ComplianceFinding['status'] = 'pass'
    let allowed = true

    for (const rule of this.rules) {
      let result: ComplianceRuleResult

      try {
        // Phase 3: 超时保护 + clearTimeout 防止 timer 泄漏
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          result = await Promise.race([
            Promise.resolve(rule.evaluate(ctx)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`合规规则 [${rule.id}] 超时 (${this.options.ruleTimeoutMs}ms)`)),
                this.options.ruleTimeoutMs,
              )
            }),
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      } catch (err) {
        // Phase 3: 异常不炸出引擎，降级为 warn
        result = {
          ruleId: rule.id,
          ruleName: rule.name,
          status: 'warn',
          message: `规则执行异常: ${String(err)}`,
        }
      }

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
