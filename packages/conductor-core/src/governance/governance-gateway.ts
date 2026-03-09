/**
 * Conductor AGC — 治理网关 (Governance Gateway)
 *
 * AGC v8.0: 从 ComplianceEngine (洋葱管道) 进化为 GaaS PDP/PEP 模式。
 *
 * 设计参考:
 * - OPA (Open Policy Agent): Policy Decision Point
 * - NIST AI RMF: Govern 函数
 * - NeMo Guardrails: 拦截器管道
 *
 * 变更:
 * - ComplianceEngine → GovernanceGateway
 * - ComplianceRule → GovernanceControl (按阶段分组)
 * - 新增 4 个拦截点: preflight / authorize / observe / release
 * - AssuranceEngine 集成到 release 管道
 */

import type {
  GovernanceContext,
  GovernanceDecision,
  GovernanceControl,
  GovernanceControlResult,
  ControlStage,
  TrustFactor,
  ModelCandidate,
  ReleaseDecision,
  ActionOutcome,
} from './governance-types.js'
import type { TrustFactorService } from './trust-factor.js'
import type { AssuranceEngine } from './assurance-engine.js'

// ── 配置 ──────────────────────────────────────────────────────────────────────

export interface GovernanceGatewayConfig {
  /** 遇到第一个 block 时是否立即停止 */
  failFast: boolean
  /** 控制默认超时 (ms) */
  controlTimeoutMs: number
  /** 释放决策的候选分数阈值 (低于此值不释放) */
  releaseScoreThreshold: number
  /** top-2 分差 < ε 时触发 challenger */
  challengerEpsilon: number
}

const DEFAULT_CONFIG: GovernanceGatewayConfig = {
  failFast: true,
  controlTimeoutMs: 5000,
  releaseScoreThreshold: 0.4,
  challengerEpsilon: 0.05,
}

// ── 治理网关 ──────────────────────────────────────────────────────────────────

/**
 * GovernanceGateway — GaaS 策略决策点 (PDP)
 *
 * 4 个拦截点:
 * 1. preflight: 运行前全局筛查 (input 控制)
 * 2. authorize: 每个动作前授权 (execution/routing 控制)
 * 3. observe: 每个动作后观察 + 更新信任因子 (assurance 控制)
 * 4. release: 最终输出释放决策 (output 控制)
 */
export class GovernanceGateway {
  private readonly controls: GovernanceControl[] = []
  private readonly config: GovernanceGatewayConfig
  private readonly trustService: TrustFactorService
  private assuranceEngine?: AssuranceEngine

  constructor(
    trustService: TrustFactorService,
    controls?: GovernanceControl[],
    config?: Partial<GovernanceGatewayConfig>,
  ) {
    this.trustService = trustService
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (controls) {
      this.controls.push(...controls)
      this.sortByPriority()
    }
  }

  /** 注册控制 */
  register(control: GovernanceControl): void {
    this.controls.push(control)
    this.sortByPriority()
  }

  /** 批量注册 */
  registerAll(controls: GovernanceControl[]): void {
    this.controls.push(...controls)
    this.sortByPriority()
  }

  /** 移除控制 */
  remove(controlId: string): void {
    const idx = this.controls.findIndex(c => c.id === controlId)
    if (idx >= 0) this.controls.splice(idx, 1)
  }

  /** 设置保证引擎 (集成到 release 管道) */
  setAssuranceEngine(engine: AssuranceEngine): void {
    this.assuranceEngine = engine
  }

  // ── 4 个拦截点 ────────────────────────────────────────────────────────────

  /**
   * 拦截点 1: Preflight — 运行前全局筛查
   *
   * 执行 stage=input 的控制
   */
  async preflight(ctx: GovernanceContext): Promise<GovernanceDecision> {
    return this.evaluateStage('input', ctx)
  }

  /**
   * 拦截点 2: Authorize — 每个动作前授权
   *
   * 执行 stage=execution 和 stage=routing 的控制
   */
  async authorize(ctx: GovernanceContext): Promise<GovernanceDecision> {
    const execResult = await this.evaluateStage('execution', ctx)
    if (execResult.effect === 'block' || execResult.effect === 'escalate') return execResult

    const routeResult = await this.evaluateStage('routing', ctx)
    // 合并: 取更严重的决策
    const merged = this.mergeDecisions(execResult, routeResult)
    // 基于信任等级生成路由建议
    merged.route = this.trustBandToRoute(merged.trust.band)
    return merged
  }

  /**
   * 拦截点 3: Observe — 每个动作后观察
   *
   * 更新信任因子 + 执行 stage=assurance 的控制
   */
  async observe(ctx: GovernanceContext, outcome: ActionOutcome): Promise<GovernanceDecision> {
    // 先评估合规, 再根据结果更新信任 (修复: 避免先记录信任再评估)
    const assuranceResult = await this.evaluateStage('assurance', ctx)
    const passed = assuranceResult.effect === 'allow'

    // 更新合规历史
    this.trustService.recordCompliance(passed)

    // 更新模型可靠性 (仅在合规通过时记录成功)
    if (ctx.action.type === 'model.invoke') {
      this.trustService.recordModelCall(ctx.action.provider, passed && outcome.success, outcome.durationMs)
    }

    return assuranceResult
  }

  /**
   * 拦截点 4: Release — 最终输出释放决策
   *
   * Trust-Weighted Release:
   * candidateScore = (confidence / 100) × trustFactor.score
   * 其中 trustFactor.score = Σ(riskScore × w₁ + complianceRate × w₂ + modelReliability × w₃ + evidenceQuality × w₄)
   *
   * 替代固定权重 (0.30/0.35/0.35)
   * 集成 AssuranceEngine: 在评分后对 top 候选执行保证验证
   */
  async release(
    ctx: GovernanceContext,
    candidates: ModelCandidate[],
    dreadScore: number,
  ): Promise<ReleaseDecision> {
    if (candidates.length === 0) {
      return {
        effect: 'escalate',
        rationale: ['No candidates available'],
        score: 0,
      }
    }

    // 计算每个候选的综合分数
    const scored = candidates.map(c => {
      const trust = this.trustService.compute({
        dreadScore,
        provider: c.provider,
        citationCount: c.citations?.length ?? 0,
        contentLength: c.summary.length,
      })

      const score = (c.confidence / 100) * trust.score
      return { candidate: c, trust, score }
    })

    // 按分数排序
    scored.sort((a, b) => b.score - a.score)

    const best = scored[0]!

    // 集成 AssuranceEngine: 对 top 候选执行保证验证
    if (this.assuranceEngine) {
      const verdict = await this.assuranceEngine.verify(best.candidate, ctx)
      if (!verdict.passed) {
        // 尝试下一个候选
        for (let i = 1; i < scored.length; i++) {
          const fallback = scored[i]!
          const fbVerdict = await this.assuranceEngine.verify(fallback.candidate, ctx)
          if (fbVerdict.passed) {
            return {
              selectedCandidateId: fallback.candidate.id,
              effect: 'release' as const,
              rationale: [
                `Primary candidate failed assurance: ${verdict.findings.map(f => f.message).join('; ')}`,
                `Fallback to candidate ${fallback.candidate.id} (score=${fallback.score.toFixed(3)})`,
              ],
              score: fallback.score,
            }
          }
        }
        return {
          effect: 'escalate' as const,
          rationale: [`All candidates failed assurance: ${verdict.findings.map(f => f.message).join('; ')}`],
          score: best.score,
        }
      }
    }

    // 执行 output 阶段控制
    const outputCtx: GovernanceContext = {
      ...ctx,
      action: { type: 'answer.release', candidateId: best.candidate.id },
      candidate: best.candidate,
    }
    const outputDecision = await this.evaluateStage('output', outputCtx)

    if (outputDecision.effect === 'block' || outputDecision.effect === 'escalate') {
      return {
        effect: 'escalate',
        rationale: [...outputDecision.rationale, 'Output controls blocked release'],
        score: best.score,
      }
    }

    // 分数低于阈值 → degrade
    if (best.score < this.config.releaseScoreThreshold) {
      return {
        selectedCandidateId: best.candidate.id,
        effect: 'degrade',
        rationale: [`Best score ${best.score.toFixed(3)} below threshold ${this.config.releaseScoreThreshold}`],
        score: best.score,
      }
    }

    // top-2 差距过小 → revise (需要 challenger)
    if (scored.length >= 2) {
      const gap = best.score - scored[1]!.score
      if (gap < this.config.challengerEpsilon) {
        return {
          selectedCandidateId: best.candidate.id,
          effect: 'revise',
          rationale: [`Top-2 gap ${gap.toFixed(4)} < ε ${this.config.challengerEpsilon}, challenger needed`],
          score: best.score,
        }
      }
    }

    return {
      selectedCandidateId: best.candidate.id,
      effect: 'release',
      rationale: [`Trust-weighted release: score=${best.score.toFixed(3)}, band=${best.trust.band}`],
      score: best.score,
    }
  }

  // ── 内部方法 ────────────────────────────────────────────────────────────────

  /** 按阶段评估控制 */
  private async evaluateStage(
    stage: ControlStage,
    ctx: GovernanceContext,
  ): Promise<GovernanceDecision> {
    const stageControls = this.controls.filter(c => c.stage === stage)

    const results: GovernanceControlResult[] = []
    let worstStatus: GovernanceControlResult['status'] = 'pass'

    for (const control of stageControls) {
      let result: GovernanceControlResult
      try {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          result = await Promise.race([
            Promise.resolve(control.evaluate(ctx)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Control [${control.id}] timeout (${this.config.controlTimeoutMs}ms)`)),
                this.config.controlTimeoutMs,
              )
            }),
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      } catch (err) {
        const isBlockLevel = control.defaultLevel === 'block'
        result = {
          controlId: control.id,
          controlName: control.name,
          status: isBlockLevel ? 'block' : 'warn',
          message: `Control error (${isBlockLevel ? 'fail-closed→block' : 'fail-open→warn'}): ${String(err)}`,
        }
      }

      results.push(result)

      if (isSeverer(result.status, worstStatus)) {
        worstStatus = result.status
      }

      if (result.status === 'block' && this.config.failFast) break
    }

    const trust = this.trustService.compute({ dreadScore: 50 }) // 中性默认
    const effect = statusToEffect(worstStatus)

    return {
      effect,
      obligations: results.filter(r => r.status !== 'pass').map(r => r.message),
      trust,
      rationale: results.map(r => `[${r.controlId}] ${r.status}: ${r.message}`),
    }
  }

  /** 合并两个决策 (取更严重的) */
  private mergeDecisions(a: GovernanceDecision, b: GovernanceDecision): GovernanceDecision {
    const effectOrder: Record<string, number> = { allow: 0, warn: 1, degrade: 2, block: 3, escalate: 4 }
    if ((effectOrder[b.effect] ?? 0) > (effectOrder[a.effect] ?? 0)) {
      return { ...b, obligations: [...a.obligations, ...b.obligations], rationale: [...a.rationale, ...b.rationale] }
    }
    return { ...a, obligations: [...a.obligations, ...b.obligations], rationale: [...a.rationale, ...b.rationale] }
  }

  private trustBandToRoute(band: TrustFactor['band']): GovernanceDecision['route'] {
    switch (band) {
      case 'trusted': return 'express'
      case 'guarded': return 'standard'
      case 'restricted': return 'full'
      case 'escalated': return 'escalated'
    }
  }

  private sortByPriority(): void {
    this.controls.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function isSeverer(a: string, b: string): boolean {
  const order: Record<string, number> = { pass: 0, warn: 1, degrade: 2, block: 3 }
  return (order[a] ?? 0) > (order[b] ?? 0)
}

function statusToEffect(status: string): GovernanceDecision['effect'] {
  switch (status) {
    case 'block': return 'block'
    case 'degrade': return 'degrade'
    case 'warn': return 'warn'
    default: return 'allow'
  }
}
