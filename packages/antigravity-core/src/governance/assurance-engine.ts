/**
 * Antigravity Workflow Runtime — 保证引擎 (Assurance Engine)
 *
 * Workflow Runtime vNext: 统一验证引擎，替代 DeepSeek-as-Judge 硬编码。
 *
 * 设计参考:
 * - AgentSpec (arXiv 2025): 可插拔运行时约束
 * - NeMo Guardrails: 输出语义验证
 * - NIST AI RMF: Measure + Manage 函数
 *
 * 验证层次:
 * 1. 确定性检查: schema / tool output / policy controls
 * 2. 语义挑战者: 可插拔模型 (不绑定 DeepSeek)
 * 3. 矛盾检测: 候选输出 vs 证据一致性
 * 4. 升级策略: allow | revise | degrade | escalate
 */

import type {
  GovernanceContext,
  ModelCandidate,
  AssuranceVerdict,
  AssuranceFinding,
} from './governance-types.js'

// ── 检查器接口 ────────────────────────────────────────────────────────────────

/**
 * AssuranceChecker — 可插拔的验证检查器
 *
 * 每个检查器负责一种验证维度。
 * 替代 DeepSeek 硬编码: 检查器可以是确定性的，也可以是模型驱动的。
 */
export interface AssuranceChecker {
  /** 检查器 ID */
  readonly id: string
  /** 检查器名称 */
  readonly name: string
  /** 检查类型 */
  readonly checkType: 'deterministic' | 'semantic' | 'contradiction' | 'policy'
  /** 是否可以跳过 (低风险时) */
  readonly skippable: boolean
  /** 执行检查 */
  check(candidate: ModelCandidate, ctx: GovernanceContext): Promise<AssuranceFinding[]>
}

// ── 默认确定性检查器 ──────────────────────────────────────────────────────────

/** 检查候选是否有内容 */
export class NonEmptyChecker implements AssuranceChecker {
  readonly id = 'assurance:non-empty'
  readonly name = '非空检查'
  readonly checkType = 'deterministic' as const
  readonly skippable = false

  async check(candidate: ModelCandidate): Promise<AssuranceFinding[]> {
    if (!candidate.summary || candidate.summary.trim().length === 0) {
      return [{
        checkType: 'deterministic',
        severity: 'critical',
        message: `Candidate "${candidate.id}" has empty content`,
      }]
    }
    return []
  }
}

/** 检查候选置信度是否合理 */
export class ConfidenceBoundsChecker implements AssuranceChecker {
  readonly id = 'assurance:confidence-bounds'
  readonly name = '置信度边界检查'
  readonly checkType = 'deterministic' as const
  readonly skippable = false

  async check(candidate: ModelCandidate): Promise<AssuranceFinding[]> {
    const findings: AssuranceFinding[] = []
    if (candidate.confidence < 0 || candidate.confidence > 100) {
      findings.push({
        checkType: 'deterministic',
        severity: 'critical',
        message: `Candidate "${candidate.id}" confidence ${candidate.confidence} out of [0, 100]`,
      })
    }
    if (candidate.confidence > 95) {
      findings.push({
        checkType: 'deterministic',
        severity: 'warning',
        message: `Candidate "${candidate.id}" confidence ${candidate.confidence} suspiciously high`,
      })
    }
    return findings
  }
}

/** 检查候选是否有引用 (高风险运行要求有证据) */
export class CitationPresenceChecker implements AssuranceChecker {
  readonly id = 'assurance:citation-presence'
  readonly name = '引用存在检查'
  readonly checkType = 'deterministic' as const
  readonly skippable = true

  async check(candidate: ModelCandidate, ctx: GovernanceContext): Promise<AssuranceFinding[]> {
    const riskHint = (ctx.state as any).capturedContext?.options?.riskHint
    const isHighRisk = riskHint === 'high' || riskHint === 'critical'

    if (isHighRisk && (!candidate.citations || candidate.citations.length === 0)) {
      return [{
        checkType: 'deterministic',
        severity: 'warning',
        message: `High-risk run but candidate "${candidate.id}" has no citations`,
      }]
    }
    return []
  }
}

// ── 保证引擎 ──────────────────────────────────────────────────────────────────

/**
 * AssuranceEngine — 统一验证引擎
 *
 * 替代 DeepSeek-as-Judge:
 * - 确定性检查不需要 LLM
 * - 语义挑战者可以使用任何模型 (按策略选择)
 * - 检查器可动态注册 (支持插件)
 */
export class AssuranceEngine {
  private readonly checkers: AssuranceChecker[] = []

  constructor(checkers?: AssuranceChecker[]) {
    if (checkers) {
      this.checkers.push(...checkers)
    } else {
      // 默认检查器
      this.checkers.push(
        new NonEmptyChecker(),
        new ConfidenceBoundsChecker(),
        new CitationPresenceChecker(),
      )
    }
  }

  /** 注册检查器 */
  register(checker: AssuranceChecker): void {
    this.checkers.push(checker)
  }

  /**
   * 验证候选答案
   *
   * @param candidate - 待验证候选
   * @param ctx - 治理上下文
   * @param skipSkippable - 是否跳过 skippable 检查器 (低风险快速通道)
   */
  async verify(
    candidate: ModelCandidate,
    ctx: GovernanceContext,
    skipSkippable: boolean = false,
  ): Promise<AssuranceVerdict> {
    const allFindings: AssuranceFinding[] = []

    const activeCheckers = skipSkippable
      ? this.checkers.filter(c => !c.skippable)
      : this.checkers

    for (const checker of activeCheckers) {
      try {
        const findings = await checker.check(candidate, ctx)
        allFindings.push(...findings)
      } catch (err) {
        allFindings.push({
          checkType: checker.checkType,
          severity: 'warning',
          message: `Checker "${checker.id}" failed: ${String(err)}`,
        })
      }
    }

    const hasCritical = allFindings.some(f => f.severity === 'critical')
    const hasWarning = allFindings.some(f => f.severity === 'warning')

    const passed = !hasCritical
    const confidence = hasCritical ? 0 : hasWarning ? candidate.confidence * 0.8 : candidate.confidence

    let suggestedEffect: AssuranceVerdict['suggestedEffect'] = 'allow'
    if (hasCritical) suggestedEffect = 'escalate'
    else if (hasWarning) suggestedEffect = 'revise'

    return {
      passed,
      confidence,
      findings: allFindings,
      suggestedEffect,
    }
  }

  /** 获取所有检查器 */
  getCheckers(): readonly AssuranceChecker[] {
    return this.checkers
  }
}
