/**
 * Antigravity Workflow Runtime — 治理类型定义 (Governance Types)
 *
 * Workflow Runtime vNext: GaaS (Governance-as-a-Service) 架构核心类型。
 *
 * 设计参考:
 * - NIST AI RMF: Govern 函数 (AI-600-1)
 * - OPA (Open Policy Agent): PDP/PEP 分离模式
 * - GaaS (arXiv 2025): Trust Factor + Action Gateway
 * - NeMo Guardrails: 输入/输出/工具拦截
 * - AgentSpec (arXiv 2025): 轻量运行时约束
 */

import type { WorkflowState, RunGraph, RunMetadata } from '@anthropic/antigravity-shared'

// ── 治理动作 ──────────────────────────────────────────────────────────────────

/**
 * GovernedAction — 所有需要治理授权的原子动作
 *
 * GaaS 模式: 每个动作在执行前必须通过 ActionGateway。
 */
export type GovernedAction =
  | { type: 'route'; lane?: string }
  | { type: 'model.invoke'; modelId: string; capability?: string }
  | { type: 'tool.invoke'; tool: string; args?: Record<string, unknown> }
  | { type: 'node.execute'; nodeId: string }
  | { type: 'node.skip'; nodeId: string; reason?: string }
  | { type: 'answer.release'; candidateId?: string }
  | { type: 'state.commit'; eventCount?: number }
  | { type: 'workflow.claim'; nodeId?: string }
  | { type: 'checkpoint.submit'; nodeId: string; leaseId: string }

// ── 治理上下文 ────────────────────────────────────────────────────────────────

/**
 * GovernanceContext — 治理决策的完整上下文
 *
 * 从 ComplianceContext 进化: 增加 action 和 candidate 字段。
 */
export interface GovernanceContext {
  /** 运行 ID */
  runId: string
  /** DAG 图定义 */
  graph: RunGraph
  /** 当前 workflow 状态 */
  state: WorkflowState
  /** 运行元数据 */
  metadata: RunMetadata
  /** 正在执行的动作 */
  action: GovernedAction
  /** 候选输出 (answer.release 时使用) */
  candidate?: ModelCandidate
  /** 当前节点 ID */
  currentNodeId?: string
}

/** 模型候选答案 */
export interface ModelCandidate {
  /** 候选 ID */
  id: string
  /** 产出模型 ID */
  modelId: string
  /** 内容摘要 */
  summary: string
  /** 模型自报置信度 */
  confidence: number
  /** 证据引用 */
  citations?: string[]
}

/** 动作执行结果 */
export interface ActionOutcome {
  /** 动作类型 */
  action: GovernedAction
  /** 是否成功 */
  success: boolean
  /** 耗时 (ms) */
  durationMs: number
  /** 输出摘要 */
  output?: string
  /** 错误信息 */
  error?: string
}

// ── 信任因子 ──────────────────────────────────────────────────────────────────

/**
 * TrustFactor — 动态信任评分
 *
 * 取代固定权重 (0.30/0.35/0.35):
 * 从 4 个信号动态计算，反映真实的运行时可信度。
 */
export interface TrustFactor {
  /** 综合信任分数 (0.0 - 1.0) */
  score: number
  /** 信任等级 */
  band: 'trusted' | 'guarded' | 'restricted' | 'escalated'
  /** 分信号 */
  signals: TrustSignals
  /** 评分理由 */
  reasons: string[]
}

/** 信任信号 (4 维) */
export interface TrustSignals {
  /** DREAD 风险分数 (from risk-signal-engine, 0-100 → 归一化到 0-1) */
  riskScore: number
  /** 历史合规率 (策略评估 pass 率) */
  complianceRate: number
  /** 模型可靠性 (成功率 / 超时率) */
  modelReliability: number
  /** 证据质量 (引用密度) */
  evidenceQuality: number
}

// ── 治理决策 ──────────────────────────────────────────────────────────────────

/**
 * GovernanceDecision — PDP 输出
 *
 * 5 级决策: allow → warn → degrade → block → escalate
 */
export interface GovernanceDecision {
  /** 决策效果 */
  effect: 'allow' | 'warn' | 'degrade' | 'block' | 'escalate'
  /** 后置义务 (要求执行方满足的条件) */
  obligations: string[]
  /** 路由建议 */
  route?: 'express' | 'standard' | 'full' | 'escalated'
  /** 当前信任因子 */
  trust: TrustFactor
  /** 决策理由 */
  rationale: string[]
}

/** 释放决策 (SYNTHESIZE → 最终输出) */
export interface ReleaseDecision {
  /** 选中的候选 ID */
  selectedCandidateId?: string
  /** 决策效果 */
  effect: 'release' | 'revise' | 'degrade' | 'escalate'
  /** 释放理由 */
  rationale: string[]
  /** 综合评分 */
  score: number
}

// ── 保证验证 ──────────────────────────────────────────────────────────────────

/** 保证验证结果 */
export interface AssuranceVerdict {
  /** 验证通过 */
  passed: boolean
  /** 置信度 */
  confidence: number
  /** 发现列表 */
  findings: AssuranceFinding[]
  /** 建议动作 */
  suggestedEffect: 'allow' | 'revise' | 'degrade' | 'escalate'
}

/** 保证发现项 */
export interface AssuranceFinding {
  /** 检查类型 */
  checkType: 'deterministic' | 'semantic' | 'contradiction' | 'policy'
  /** 严重度 */
  severity: 'info' | 'warning' | 'critical'
  /** 描述 */
  message: string
  /** 相关证据 */
  evidence?: string
}

// ── 控制包 ──────────────────────────────────────────────────────────────────

/** 控制阶段 (替代旧的 S1-S13 扁平编号) */
export type ControlStage = 'input' | 'execution' | 'output' | 'assurance' | 'routing'

/** 治理控制 — 从 ComplianceRule 进化 */
export interface GovernanceControl {
  /** 控制 ID */
  readonly id: string
  /** 控制名称 */
  readonly name: string
  /** 所属阶段 */
  readonly stage: ControlStage
  /** 默认级别 */
  readonly defaultLevel: 'block' | 'warn' | 'degrade'
  /** 优先级 */
  readonly priority?: number
  /** 评估 */
  evaluate(ctx: GovernanceContext): GovernanceControlResult | Promise<GovernanceControlResult>
}

/** 控制评估结果 */
export interface GovernanceControlResult {
  controlId: string
  controlName: string
  status: 'pass' | 'warn' | 'degrade' | 'block'
  message: string
  nodeId?: string
}

// ── PR-10: Daemon Lifecycle Stages ────────────────────────────────────────────

/**
 * DaemonLifecycleStage — stages available for daemon governance hooks.
 *
 * These map to daemon runtime lifecycle phases:
 * - daemon:preflight — before run starts
 * - daemon:skip-authorize — before a node is policy-skipped
 * - daemon:terminal-release — before final release decision
 * - daemon:node-observe — after node completion
 * - daemon:lease-authorize — before lease issuance
 * - daemon:approval — before human approval gate
 */
export type DaemonLifecycleStage =
  | 'daemon:preflight'
  | 'daemon:skip-authorize'
  | 'daemon:terminal-release'
  | 'daemon:node-observe'
  | 'daemon:lease-authorize'
  | 'daemon:approval'

/**
 * DaemonStageVerdict — policy verdict with stage metadata.
 *
 * Extends PolicyVerdict semantics with stage provenance,
 * so downstream systems can distinguish which lifecycle phase
 * produced a given verdict.
 */
export interface DaemonStageVerdict {
  /** Which daemon lifecycle stage produced this verdict */
  stage: DaemonLifecycleStage
  /** Verdict effect (from policy evaluator) */
  effect: string
  /** Human-readable rationale */
  rationale: string[]
  /** Stable verdict ID */
  verdictId: string
  /** When evaluation occurred */
  evaluatedAt: string
  /** Scope from policy evaluator */
  scope: string
  /** Phase A: gateway-level audit envelope (present when gateway adds independent logic) */
  auditEnvelope?: {
    gatewayTimestamp: string
    inputFactsKeys: string[]
    crossStageConstraintApplied: boolean
    circuitBreakerTriggered: boolean
  }
}

// ── B2: Unified Stage Evaluation Types ──────────────────────────────────────

/**
 * B2-2: Gateway-owned stage facts — structured input that the gateway
 * uses to build the facts dict internally. Callers provide domain-specific
 * input; gateway owns the facts→rules evaluation pipeline.
 */
export interface StageFacts {
  /** Domain-specific input parameters keyed by name */
  readonly parameters: Readonly<Record<string, unknown>>
  /** Optional caller-provided context (e.g. governance config, scores) */
  readonly context?: Readonly<Record<string, unknown>>
}

/**
 * B2-1: Unified stage evaluation request — the NEW primary entry point
 * for daemon lifecycle governance. Replaces caller-assembled evaluator pattern.
 *
 * Key difference from old path: caller does NOT provide `evaluator` or `rules`.
 * Gateway resolves those internally from its registered policy pack.
 */
export interface StageEvaluationRequest {
  /** Which daemon lifecycle stage to evaluate */
  stage: DaemonLifecycleStage
  /** Run being evaluated */
  runId: string
  /** When evaluation occurs */
  evaluatedAt: string
  /** Gateway-owned facts input (replaces caller-built facts dict) */
  stageFacts: StageFacts
  /** Optional sub-scope within the stage (e.g. gate ID for approval) */
  stageSubScope?: string
}

/**
 * B2-2: Stage decision trace — structured audit artifact produced by
 * the unified stage evaluation pipeline. Captures the full decision
 * chain: facts → constraints → rules → verdict.
 */
export interface StageDecisionTrace {
  /** Unique trace ID for this evaluation */
  traceId: string
  /** Stage that was evaluated */
  stage: DaemonLifecycleStage
  /** Run ID context */
  runId: string
  /** Timestamp of evaluation */
  evaluatedAt: string
  /** Facts as resolved by the gateway (not caller-built anymore) */
  resolvedFacts: Record<string, unknown>
  /** Whether circuit breaker pre-empted evaluation */
  circuitBreakerPreempted: boolean
  /** Whether cross-stage constraint pre-empted evaluation */
  crossStagePreempted: boolean
  /** Cross-stage constraint rationale (if applicable) */
  crossStageRationale?: string
  /** Final verdict effect */
  effect: string
  /** Verdict rationale chain */
  rationale: string[]
  /** Verdict ID (for correlation) */
  verdictId: string
  /** Decision path: which evaluation path was taken */
  decisionPath: 'circuit-breaker' | 'cross-stage-constraint' | 'policy-evaluation'
}

/**
 * B2-1: Extended stage verdict — includes the decision trace
 * for full audit chain transparency. Compatible with DaemonStageVerdict.
 */
export interface UnifiedStageVerdict extends DaemonStageVerdict {
  /** B2: Full decision trace for audit/observability */
  decisionTrace: StageDecisionTrace
}
