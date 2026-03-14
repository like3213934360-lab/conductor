/**
 * Antigravity Workflow Runtime — 治理网关 (Governance Gateway)
 *
 * Workflow Runtime vNext: 从 ComplianceEngine (洋葱管道) 进化为 GaaS PDP/PEP 模式。
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
  DaemonLifecycleStage,
  DaemonStageVerdict,
  StageEvaluationRequest,
  StageDecisionTrace,
  StageFacts,
  UnifiedStageVerdict,
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
  // ★ P3-1 fix: 延迟排序 — 注册时设脏标志，评估时排序
  private sortDirty = false

  // ── Phase A: gateway-owned state ──────────────────────────────────────────
  /** Stage verdict history per run — enables cross-stage constraints */
  private readonly stageHistory = new Map<string, DaemonStageVerdict[]>()
  /** Circuit breaker: consecutive block counts per stage type */
  private readonly stageBlockCounts = new Map<DaemonLifecycleStage, number>()
  /** Circuit breaker threshold: consecutive blocks before hard-stop */
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 5

  // ── B2: Gateway-owned facts builder registry ─────────────────────────────
  /** Maps stage to a facts builder function. Callers register via registerFactsBuilder. */
  private readonly factsBuilders = new Map<DaemonLifecycleStage, (stageFacts: StageFacts) => Record<string, unknown>>()
  /** B2: Rules provider — set by runtime to supply policy rules without caller assembly */
  private rulesProvider?: () => { rules: readonly any[]; evaluator: (rules: readonly any[], context: any) => { verdictId: string; effect: string; rationale: string[]; scope: string; evaluatedAt: string } }

  constructor(
    trustService: TrustFactorService,
    controls?: GovernanceControl[],
    config?: Partial<GovernanceGatewayConfig>,
  ) {
    this.trustService = trustService
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (controls) {
      this.controls.push(...controls)
      this.sortDirty = true
    }
  }

  /** 注册控制 */
  register(control: GovernanceControl): void {
    this.controls.push(control)
    this.sortDirty = true // ★ P3-1 fix: 标记脏，不立即排序
  }

  /** 批量注册 */
  registerAll(controls: GovernanceControl[]): void {
    this.controls.push(...controls)
    this.sortDirty = true // ★ P3-1 fix
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

  /** Phase A: Read-only access to stage history for diagnostics */
  getStageHistory(runId: string): readonly DaemonStageVerdict[] {
    return this.stageHistory.get(runId) ?? []
  }

  /** Phase A: Read-only circuit breaker state */
  getCircuitBreakerState(): ReadonlyMap<DaemonLifecycleStage, number> {
    return this.stageBlockCounts
  }

  /** Phase A: Reset circuit breaker for a stage (e.g. after manual intervention) */
  resetCircuitBreaker(stage: DaemonLifecycleStage): void {
    this.stageBlockCounts.delete(stage)
  }

  // ── 4 个拦截点 ────────────────────────────────────────────────────────────

  /**
   * PR-11 + Phase A: Authoritative daemon lifecycle stage evaluation.
   *
   * This is the SINGLE ENTRY POINT for all daemon governance decisions.
   * The daemon runtime delegates all governance stages here instead of
   * calling evaluateRulesAgainstFacts directly.
   *
   * Phase A enhancements (gateway-owned logic, beyond pure forwarding):
   *  1. Circuit breaker — if a stage has had ≥ N consecutive blocks, gateway
   *     short-circuits to block without calling the evaluator.
   *  2. Cross-stage constraints — gateway checks stageHistory for conflict
   *     patterns (e.g. preflight block → resume/approval blocked).
   *  3. Audit envelope — every verdict carries gateway-produced metadata
   *     documenting what independent logic the gateway applied.
   *
   * Input contract unchanged. Output contract extended with optional auditEnvelope.
   */
  evaluateDaemonLifecycleStage(input: {
    stage: DaemonLifecycleStage
    runId: string
    ruleScope: string
    verdictScope: string
    evaluatedAt: string
    facts: Record<string, unknown>
    fallbackMessage: string
    rules: readonly { ruleId: string; scope: string; enabled?: boolean; effect: string; when?: unknown; message?: string; description?: string; evidenceFactKey?: string }[]
    evaluator: (rules: readonly any[], context: any) => { verdictId: string; effect: string; rationale: string[]; scope: string; evaluatedAt: string; evidenceIds?: string[]; runId?: string }
  }): DaemonStageVerdict {
    const gatewayTimestamp = new Date().toISOString()
    const inputFactsKeys = Object.keys(input.facts)

    // ── Phase A: Circuit breaker check ──────────────────────────────────
    const blockCount = this.stageBlockCounts.get(input.stage) ?? 0
    if (blockCount >= GovernanceGateway.CIRCUIT_BREAKER_THRESHOLD) {
      const cbVerdict: DaemonStageVerdict = {
        stage: input.stage,
        effect: 'block',
        rationale: [`gateway:circuit-breaker — stage ${input.stage} blocked ${blockCount} consecutive times, hard-stop active`],
        verdictId: `cb-${input.runId}-${input.stage}-${Date.now()}`,
        evaluatedAt: gatewayTimestamp,
        scope: input.verdictScope,
        auditEnvelope: {
          gatewayTimestamp,
          inputFactsKeys,
          crossStageConstraintApplied: false,
          circuitBreakerTriggered: true,
        },
      }
      this.recordStageVerdict(input.runId, cbVerdict)
      return cbVerdict
    }

    // ── Phase A: Cross-stage constraint check ───────────────────────────
    const crossStageBlock = this.checkCrossStageConstraints(input.runId, input.stage)
    if (crossStageBlock) {
      const csVerdict: DaemonStageVerdict = {
        stage: input.stage,
        effect: 'block',
        rationale: [crossStageBlock],
        verdictId: `cs-${input.runId}-${input.stage}-${Date.now()}`,
        evaluatedAt: gatewayTimestamp,
        scope: input.verdictScope,
        auditEnvelope: {
          gatewayTimestamp,
          inputFactsKeys,
          crossStageConstraintApplied: true,
          circuitBreakerTriggered: false,
        },
      }
      this.recordStageVerdict(input.runId, csVerdict)
      return csVerdict
    }

    // ── Existing: delegate to evaluator ─────────────────────────────────
    const context = {
      runId: input.runId,
      ruleScope: input.ruleScope,
      verdictScope: input.verdictScope,
      evaluatedAt: input.evaluatedAt,
      facts: input.facts,
      fallbackMessage: input.fallbackMessage,
    }
    const verdict = input.evaluator(input.rules as any, context)

    const result: DaemonStageVerdict = {
      stage: input.stage,
      effect: verdict.effect,
      rationale: verdict.rationale,
      verdictId: verdict.verdictId,
      evaluatedAt: verdict.evaluatedAt,
      scope: verdict.scope,
      auditEnvelope: {
        gatewayTimestamp,
        inputFactsKeys,
        crossStageConstraintApplied: false,
        circuitBreakerTriggered: false,
      },
    }

    // ── Phase A: Record verdict + update circuit breaker ────────────────
    this.recordStageVerdict(input.runId, result)
    if (verdict.effect === 'block') {
      this.stageBlockCounts.set(input.stage, blockCount + 1)
    } else {
      // Reset on non-block — circuit breaker tracks consecutive blocks only
      this.stageBlockCounts.set(input.stage, 0)
    }

    return result
  }

  // ── Phase A: Gateway-owned private methods ────────────────────────────────

  /**
   * Checks cross-stage constraints from stageHistory.
   * Returns a rationale string if the stage should be blocked, or null if clear.
   */
  private checkCrossStageConstraints(runId: string, stage: DaemonLifecycleStage): string | null {
    const history = this.stageHistory.get(runId)
    if (!history || history.length === 0) return null

    // Constraint 1: If preflight was blocked, block resume and approval
    if (stage === 'daemon:approval' || stage === 'daemon:lease-authorize') {
      const preflightBlock = history.find(
        v => v.stage === 'daemon:preflight' && v.effect === 'block',
      )
      if (preflightBlock) {
        return `gateway:cross-stage-constraint — ${stage} blocked because daemon:preflight was blocked (verdictId=${preflightBlock.verdictId})`
      }
    }

    // Constraint 2: If skip-authorize has accumulated >= 3 blocks, degrade terminal-release to block
    if (stage === 'daemon:terminal-release') {
      const skipBlocks = history.filter(
        v => v.stage === 'daemon:skip-authorize' && v.effect === 'block',
      )
      if (skipBlocks.length >= 3) {
        return `gateway:cross-stage-constraint — ${stage} blocked due to ${skipBlocks.length} accumulated daemon:skip-authorize blocks`
      }
    }

    return null
  }

  /** Records a verdict into stage history for future cross-stage constraint checks */
  private recordStageVerdict(runId: string, verdict: DaemonStageVerdict): void {
    let history = this.stageHistory.get(runId)
    if (!history) {
      history = []
      this.stageHistory.set(runId, history)
    }
    history.push(verdict)
  }

  // ── B2: Unified Stage Evaluation Pipeline ────────────────────────────────

  /**
   * B2: Register a facts builder for a specific stage.
   * The gateway will use this builder to assemble facts from StageFacts input.
   */
  registerFactsBuilder(
    stage: DaemonLifecycleStage,
    builder: (stageFacts: StageFacts) => Record<string, unknown>,
  ): void {
    this.factsBuilders.set(stage, builder)
  }

  /**
   * B2: Set the rules provider — runtime registers this so the gateway
   * can resolve rules + evaluator without caller assembly.
   */
  setRulesProvider(
    provider: () => { rules: readonly any[]; evaluator: (rules: readonly any[], context: any) => { verdictId: string; effect: string; rationale: string[]; scope: string; evaluatedAt: string } },
  ): void {
    this.rulesProvider = provider
  }

  /**
   * B2-1: evaluateStage — the NEW unified entry point for daemon governance.
   *
   * Key differences from evaluateDaemonLifecycleStage (old path):
   *  - Caller provides structured StageFacts, NOT pre-built facts dict
   *  - Caller does NOT provide rules or evaluator (gateway resolves internally)
   *  - Gateway produces a StageDecisionTrace for full audit chain
   *  - Circuit breaker + cross-stage constraints integrated into decision trace
   *
   * Falls back to old path if no rulesProvider or factsBuilder registered.
   */
  evaluateUnifiedStage(request: StageEvaluationRequest): UnifiedStageVerdict {
    const traceId = `st-${request.runId}-${request.stage}-${Date.now()}`
    const gatewayTimestamp = new Date().toISOString()

    // ── Circuit breaker (reuse existing logic) ────────────────────────
    const blockCount = this.stageBlockCounts.get(request.stage) ?? 0
    if (blockCount >= GovernanceGateway.CIRCUIT_BREAKER_THRESHOLD) {
      const trace: StageDecisionTrace = {
        traceId,
        stage: request.stage,
        runId: request.runId,
        evaluatedAt: gatewayTimestamp,
        resolvedFacts: request.stageFacts.parameters as Record<string, unknown>,
        circuitBreakerPreempted: true,
        crossStagePreempted: false,
        effect: 'block',
        rationale: [`gateway:circuit-breaker — stage ${request.stage} blocked ${blockCount} consecutive times, hard-stop active`],
        verdictId: `cb-${request.runId}-${request.stage}-${Date.now()}`,
        decisionPath: 'circuit-breaker',
      }
      const verdict: UnifiedStageVerdict = {
        stage: request.stage,
        effect: 'block',
        rationale: trace.rationale,
        verdictId: trace.verdictId,
        evaluatedAt: gatewayTimestamp,
        scope: request.stageSubScope ?? request.stage,
        auditEnvelope: {
          gatewayTimestamp,
          inputFactsKeys: Object.keys(request.stageFacts.parameters),
          crossStageConstraintApplied: false,
          circuitBreakerTriggered: true,
        },
        decisionTrace: trace,
      }
      this.recordStageVerdict(request.runId, verdict)
      return verdict
    }

    // ── Cross-stage constraints (reuse existing logic) ────────────────
    const crossStageBlock = this.checkCrossStageConstraints(request.runId, request.stage)
    if (crossStageBlock) {
      const trace: StageDecisionTrace = {
        traceId,
        stage: request.stage,
        runId: request.runId,
        evaluatedAt: gatewayTimestamp,
        resolvedFacts: request.stageFacts.parameters as Record<string, unknown>,
        circuitBreakerPreempted: false,
        crossStagePreempted: true,
        crossStageRationale: crossStageBlock,
        effect: 'block',
        rationale: [crossStageBlock],
        verdictId: `cs-${request.runId}-${request.stage}-${Date.now()}`,
        decisionPath: 'cross-stage-constraint',
      }
      const verdict: UnifiedStageVerdict = {
        stage: request.stage,
        effect: 'block',
        rationale: trace.rationale,
        verdictId: trace.verdictId,
        evaluatedAt: gatewayTimestamp,
        scope: request.stageSubScope ?? request.stage,
        auditEnvelope: {
          gatewayTimestamp,
          inputFactsKeys: Object.keys(request.stageFacts.parameters),
          crossStageConstraintApplied: true,
          circuitBreakerTriggered: false,
        },
        decisionTrace: trace,
      }
      this.recordStageVerdict(request.runId, verdict)
      return verdict
    }

    // ── Build facts: gateway-owned or pass-through ───────────────────
    const factsBuilder = this.factsBuilders.get(request.stage)
    const resolvedFacts = factsBuilder
      ? factsBuilder(request.stageFacts)
      : { ...request.stageFacts.parameters, ...request.stageFacts.context }

    // ── Policy evaluation: gateway-owned ─────────────────────────────
    if (!this.rulesProvider) {
      throw new Error(`B2: evaluateStage called but no rulesProvider registered — gateway cannot resolve rules internally`)
    }
    const { rules, evaluator } = this.rulesProvider()
    const ruleScope = request.stageSubScope ?? request.stage
    const verdictScope = ruleScope
    const context = {
      runId: request.runId,
      ruleScope,
      verdictScope,
      evaluatedAt: request.evaluatedAt,
      facts: resolvedFacts,
      fallbackMessage: `Stage ${request.stage} passed under the active policy pack.`,
    }
    const rawVerdict = evaluator(rules as any, context)

    const trace: StageDecisionTrace = {
      traceId,
      stage: request.stage,
      runId: request.runId,
      evaluatedAt: gatewayTimestamp,
      resolvedFacts,
      circuitBreakerPreempted: false,
      crossStagePreempted: false,
      effect: rawVerdict.effect,
      rationale: rawVerdict.rationale,
      verdictId: rawVerdict.verdictId,
      decisionPath: 'policy-evaluation',
    }

    const verdict: UnifiedStageVerdict = {
      stage: request.stage,
      effect: rawVerdict.effect,
      rationale: rawVerdict.rationale,
      verdictId: rawVerdict.verdictId,
      evaluatedAt: rawVerdict.evaluatedAt,
      scope: rawVerdict.scope,
      auditEnvelope: {
        gatewayTimestamp,
        inputFactsKeys: Object.keys(resolvedFacts),
        crossStageConstraintApplied: false,
        circuitBreakerTriggered: false,
      },
      decisionTrace: trace,
    }

    // Update circuit breaker state
    this.recordStageVerdict(request.runId, verdict)
    if (rawVerdict.effect === 'block') {
      this.stageBlockCounts.set(request.stage, blockCount + 1)
    } else {
      this.stageBlockCounts.set(request.stage, 0)
    }

    return verdict
  }

  /**
   * @deprecated Use evaluateDaemonLifecycleStage instead.
   * Kept for backward compatibility with existing tests.
   */
  evaluateDaemonStage(
    stage: DaemonLifecycleStage,
    rules: readonly import('./governance-types.js').GovernanceControl[],
    evaluator: (rules: readonly any[], context: any) => { verdictId: string; effect: string; rationale: string[]; scope: string; evaluatedAt: string },
    context: { runId: string; ruleScope: string; verdictScope: string; evaluatedAt: string; facts: Record<string, unknown>; fallbackMessage: string },
  ): DaemonStageVerdict {
    return this.evaluateDaemonLifecycleStage({
      stage,
      runId: context.runId,
      ruleScope: context.ruleScope,
      verdictScope: context.verdictScope,
      evaluatedAt: context.evaluatedAt,
      facts: context.facts,
      fallbackMessage: context.fallbackMessage,
      rules: rules as any,
      evaluator,
    })
  }

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
      this.trustService.recordModelCall(ctx.action.modelId, passed && outcome.success, outcome.durationMs)
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
        modelId: c.modelId,
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
            // ★ P1-7 fix: fallback 通过 output-stage controls，且检查 degrade/warn 信号
            const fbOutputCtx: GovernanceContext = {
              ...ctx,
              action: { type: 'answer.release', candidateId: fallback.candidate.id },
              candidate: fallback.candidate,
            }
            const fbOutputDecision = await this.evaluateStage('output', fbOutputCtx, dreadScore)
            if (fbOutputDecision.effect === 'block' || fbOutputDecision.effect === 'escalate') {
              continue // 此 fallback 也被 output 控制拒绝，尝试下一个
            }
            // ★ P1-7 fix: 将 output 控制的 degrade/warn 信号合并到最终 effect
            const finalEffect = fbOutputDecision.effect === 'degrade' ? 'degrade' as const
              : fbOutputDecision.effect === 'warn' ? 'release' as const
              : 'release' as const
            return {
              selectedCandidateId: fallback.candidate.id,
              effect: finalEffect,
              rationale: [
                `Primary candidate failed assurance: ${verdict.findings.map(f => f.message).join('; ')}`,
                `Fallback to candidate ${fallback.candidate.id} (score=${fallback.score.toFixed(3)})`,
                ...fbOutputDecision.rationale,
              ],
              score: fallback.score,
            }
          }
        }
        // ★ P2-2 fix: 所有候选均失败时，返回 score=0 而非 best.score（防止误导性高分）
        return {
          effect: 'escalate' as const,
          rationale: [`All candidates failed assurance: ${verdict.findings.map(f => f.message).join('; ')}`],
          score: 0,
        }
      }
    }

    // 执行 output 阶段控制
    const outputCtx: GovernanceContext = {
      ...ctx,
      action: { type: 'answer.release', candidateId: best.candidate.id },
      candidate: best.candidate,
    }
    const outputDecision = await this.evaluateStage('output', outputCtx, dreadScore)

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
    /** ★ Bug fix: 传入实际 DREAD 分数，不再硬编码 50 */
    dreadScore?: number,
  ): Promise<GovernanceDecision> {
    // ★ P3-1 fix: 延迟排序 — 仅在评估时排一次
    if (this.sortDirty) {
      this.sortByPriority()
      this.sortDirty = false
    }

    const stageControls = this.controls.filter(c => c.stage === stage)

    const results: GovernanceControlResult[] = []
    let worstStatus: GovernanceControlResult['status'] = 'pass'

    // ★ P1-8 fix: failFast=false 时并行评估控制（防阻塞事件循环）
    if (!this.config.failFast && stageControls.length > 1) {
      const promises = stageControls.map(control =>
        this.evaluateControl(control, ctx),
      )
      const settledResults = await Promise.all(promises)
      for (const result of settledResults) {
        results.push(result)
        if (isSeverer(result.status, worstStatus)) {
          worstStatus = result.status
        }
      }
    } else {
      // failFast=true 或只有一个控制: 串行评估
      for (const control of stageControls) {
        const result = await this.evaluateControl(control, ctx)
        results.push(result)
        if (isSeverer(result.status, worstStatus)) {
          worstStatus = result.status
        }
        if (result.status === 'block' && this.config.failFast) break
      }
    }

    // ★ Bug fix: 使用传入的 DREAD 分数，回退到中性值 50
    const trust = this.trustService.compute({ dreadScore: dreadScore ?? 50 })
    const effect = statusToEffect(worstStatus)

    return {
      effect,
      obligations: results.filter(r => r.status !== 'pass').map(r => r.message),
      trust,
      rationale: results.map(r => `[${r.controlId}] ${r.status}: ${r.message}`),
    }
  }

  /** ★ P1-8 fix: 单个控制评估 (含超时和错误处理，可并行调用) */
  private async evaluateControl(
    control: GovernanceControl,
    ctx: GovernanceContext,
  ): Promise<GovernanceControlResult> {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
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
      return {
        controlId: control.id,
        controlName: control.name,
        status: isBlockLevel ? 'block' : 'warn',
        message: `Control error (${isBlockLevel ? 'fail-closed→block' : 'fail-open→warn'}): ${String(err)}`,
      }
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
