/**
 * router.ts — MoA 动态路由 & CQRS 工具隔离
 *
 * 职责：
 * 1. RouterPolicy — 根据 TaskIntent + 上下文大小选择最优 Backend
 * 2. ToolManifest — 静态 CQRS 隔离：分析节点禁止写工具，防止并发踩踏
 *
 * 防御红线：
 *  - 'scout' / 'analyze' 意图强制绑定 READ_ONLY_TOOLS
 *  - 工具检查函数 assertToolAllowed() 在 Worker 调用前验证
 */

import type { WorkerBackend } from '../schema.js'

import type { RaceTelemetry } from './racing.js'

// ── 任务意图枚举 ──────────────────────────────────────────────────────────────

export type TaskIntent = 'scout' | 'analyze' | 'generate' | 'verify'

// ── CQRS Tool Manifests ───────────────────────────────────────────────────────

/** 只读工具集：分析节点强制使用，严禁任何写操作 */
export const READ_ONLY_TOOLS = new Set([
  'read_resource',
  'list_resources',
  'search_symbol',
  'get_diagnostics',
  'read_file',
  'list_directory',
])

/** 读写工具集：仅 generate / write 节点可用 */
export const READ_WRITE_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'apply_edit',
  'create_file',
  'rename_file',
  'delete_file',
  'write_file',
])

export interface ToolManifest {
  readonly allowedTools: ReadonlySet<string>
  readonly mode: 'read-only' | 'read-write'
}

export const READ_ONLY_MANIFEST: ToolManifest = {
  allowedTools: READ_ONLY_TOOLS,
  mode: 'read-only',
}

export const READ_WRITE_MANIFEST: ToolManifest = {
  allowedTools: READ_WRITE_TOOLS,
  mode: 'read-write',
}

/** 工具调用前的 CQRS 检查 — 违规抛出，防止并发踩踏 */
export class ToolAccessViolationError extends Error {
  constructor(tool: string, manifest: ToolManifest) {
    super(
      `CQRS violation: tool "${tool}" is not allowed in ${manifest.mode} manifest. ` +
      `Allowed: [${[...manifest.allowedTools].join(', ')}]`,
    )
    this.name = 'ToolAccessViolationError'
  }
}

export function assertToolAllowed(tool: string, manifest: ToolManifest): void {
  if (!manifest.allowedTools.has(tool)) {
    throw new ToolAccessViolationError(tool, manifest)
  }
}

// ── RouterPolicy 接口 ─────────────────────────────────────────────────────────

export interface RouterDecision {
  backend: WorkerBackend
  /** 该 Backend 被强制绑定的工具集 */
  manifest: ToolManifest
}

export interface RouterPolicy {
  route(intent: TaskIntent, contextTokenEstimate?: number): RouterDecision
  /** 多模型路由：返回 top-N 异构候选（供 RacingExecutor 赛马） */
  routeMulti(
    intent: TaskIntent,
    contextTokenEstimate?: number,
    constraints?: RouteConstraints,
    topN?: number,
  ): RouterDecision[]
}

// ── 默认实现 ──────────────────────────────────────────────────────────────────

/**
 * DefaultRouterPolicy：
 *  - generate  → Codex（精准代码生成）+ 读写工具
 *  - scout     → Gemini（超长上下文扫描）+ 只读（强制）
 *  - analyze   → tokens > 32K → Gemini；否则 Codex —— 均为只读（强制）
 *  - verify    → Gemini（多维验证）+ 只读（强制）
 */
export class DefaultRouterPolicy implements RouterPolicy {
  /** 超过此 token 估计，优先使用长上下文 Gemini */
  private static readonly LONG_CONTEXT_THRESHOLD = 32_000

  route(intent: TaskIntent, contextTokenEstimate: number = 0): RouterDecision {
    switch (intent) {
      case 'generate':
        return { backend: 'codex', manifest: READ_WRITE_MANIFEST }

      case 'scout':
        // scout 永远使用超长上下文 Gemini，且强制只读
        return { backend: 'gemini', manifest: READ_ONLY_MANIFEST }

      case 'analyze':
        // 分析：按 token 量路由，CQRS 强制只读
        return {
          backend: contextTokenEstimate > DefaultRouterPolicy.LONG_CONTEXT_THRESHOLD
            ? 'gemini'
            : 'codex',
          manifest: READ_ONLY_MANIFEST,
        }

      case 'verify':
        // verify 需要全面推理，用 Gemini，只读
        return { backend: 'gemini', manifest: READ_ONLY_MANIFEST }

      default: {
        const _exhaustive: never = intent
        throw new Error(`Unknown TaskIntent: ${String(_exhaustive)}`)
      }
    }
  }

  /** 兼容接口：DefaultRouterPolicy 不支持多模型，返回单候选 */
  routeMulti(
    intent: TaskIntent,
    contextTokenEstimate: number = 0,
    _constraints?: RouteConstraints,
    _topN: number = 2,
  ): RouterDecision[] {
    return [this.route(intent, contextTokenEstimate)]
  }
}

// ── 多模型动态路由 (RFC-026 Phase 1) ─────────────────────────────────────────

/** 模型能力声明 — 从 Conductor Hub 配置读取或预埋 */
export interface ModelCapability {
  id: string
  backend: WorkerBackend
  scores: {
    code_quality: number   // [0, 10]
    long_context: number   // [0, 10]
    reasoning: number      // [0, 10]
    speed: number          // [0, 10]
    cost: number           // [0, 10] — 越低越便宜
    chinese: number        // [0, 10]
  }
  maxContextTokens: number
  supportedIntents: TaskIntent[]
}

/** 路由约束条件 */
export interface RouteConstraints {
  maxCost?: number
  preferredLanguage?: 'en' | 'zh'
  maxLatencyMs?: number
}

/**
 * DynamicRouterPolicy — 多模型动态路由策略
 *
 * 升级能力：
 *  1. 维护 ModelCapability 注册表（预埋 + 运行时注入）
 *  2. route() 保持向后兼容（单模型选择）
 *  3. routeMulti() 返回 top-N 候选（供 RacingExecutor 赛马）
 *  4. 意图→能力维度映射的评分矩阵
 *  5. 🆕 ELO 动态表现因子：基于赛马战报自适应调权
 */

// ── ELO 动态表现状态 ─────────────────────────────────────────────────────────

/** 单个模型的运行时 ELO 状态 — Per-Intent 细粒度版 */
interface ModelEloState {
  /** 累计胜场 */
  wins: number
  /** 累计败场（被 abort） */
  losses: number
  /** 累计报错 */
  errors: number
  /** 累计校验失败 */
  validateFailures: number
  /** 指数移动平均延迟（ms），α = 0.3 */
  emaLatencyMs: number
  /**
   * 🎯 Per-Intent 动态表现乘数 — 每种 intent 独立进化
   *
   * codex 可能在 generate 上表现卓越（multiplier > 1.0），
   * 但在 analyze 上频繁超时（multiplier < 1.0）——不会互相殃及。
   *
   * 🛡️ 硬性钳位 [0.3, 2.0]
   */
  intentMultiplier: Record<TaskIntent, number>
  /**
   * 📊 EMA Token 成本（每次调用的平均 total token）
   * 用于 routeMulti 的性价比评估
   */
  emaCostPerCall: number
  /** 总 Token 消耗追踪 */
  totalTokensConsumed: number
}

/** 融合质量追踪器 */
interface FusionQualityTracker {
  /** 融合次数 */
  fusionCount: number
  /** 累计融合 confidence delta 总和 */
  totalConfidenceDelta: number
  /** EMA 融合增益 */
  emaFusionGain: number
}

/** EMA 平滑系数 — 越大对最新数据越敏感 */
const EMA_ALPHA = 0.3
/** 表现乘数下界 — 防止被完全踢出候选队列 */
const MULTIPLIER_FLOOR = 0.3
/** 表现乘数上界 — 防止单一模型独占 */
const MULTIPLIER_CEILING = 2.0
/** 胜者奖励步长 */
const WIN_REWARD = 0.08
/** 败者惩罚步长（被 abort = 被对手甩开） */
const LOSS_PENALTY = 0.03
/** 报错惩罚步长（断路器衰减） */
const ERROR_PENALTY = 0.15
/** 校验失败惩罚步长 */
const VALIDATE_FAIL_PENALTY = 0.10
/** 延迟惩罚阈值（ms）— 超过此值的平均延迟会额外扣分 */
const LATENCY_PENALTY_THRESHOLD_MS = 30_000
/** 性价比权重 — 成本因子对最终评分的影响比例 */
const COST_EFFICIENCY_WEIGHT = 0.1
/** 高成本模型的 Token 阈值（每次调用 > 此值则扣分） */
const HIGH_COST_TOKEN_THRESHOLD = 8_000
/** 融合增益阈值 — EMA 增益低于此值自动关闭自动融合 */
const FUSION_GAIN_DISABLE_THRESHOLD = -0.05
/** 默认 Intent 列表 */
const ALL_INTENTS: TaskIntent[] = ['scout', 'analyze', 'generate', 'verify']

export class DynamicRouterPolicy implements RouterPolicy {
  private readonly models = new Map<string, ModelCapability>()
  /** 🧬 每个模型的 ELO 运行时状态 */
  private readonly eloState = new Map<string, ModelEloState>()
  /** 📊 融合质量追踪器 */
  private readonly fusionTracker: FusionQualityTracker = {
    fusionCount: 0, totalConfidenceDelta: 0, emaFusionGain: 0,
  }

  /** 默认预埋模型 */
  private static readonly BUILTIN_MODELS: ModelCapability[] = [
    {
      id: 'codex',
      backend: 'codex',
      scores: { code_quality: 9, long_context: 6, reasoning: 8, speed: 7, cost: 5, chinese: 5 },
      maxContextTokens: 128_000,
      supportedIntents: ['scout', 'analyze', 'generate', 'verify'],
    },
    {
      id: 'gemini',
      backend: 'gemini',
      scores: { code_quality: 7, long_context: 10, reasoning: 8, speed: 6, cost: 6, chinese: 6 },
      maxContextTokens: 1_000_000,
      supportedIntents: ['scout', 'analyze', 'generate', 'verify'],
    },
    // 🛡️ SOC2 Air-Gap: 本地模型兜底
    {
      id: 'ollama',
      backend: 'ollama',
      scores: { code_quality: 5, long_context: 4, reasoning: 5, speed: 8, cost: 10, chinese: 7 },
      maxContextTokens: 32_000,
      supportedIntents: ['scout', 'analyze', 'generate', 'verify'],
    },
  ]

  /** 意图→能力维度权重矩阵 */
  private static readonly INTENT_WEIGHTS: Record<TaskIntent, Record<keyof ModelCapability['scores'], number>> = {
    scout:    { code_quality: 0.1, long_context: 0.5, reasoning: 0.2, speed: 0.1, cost: 0.05, chinese: 0.05 },
    analyze:  { code_quality: 0.15, long_context: 0.2, reasoning: 0.4, speed: 0.1, cost: 0.1, chinese: 0.05 },
    generate: { code_quality: 0.5, long_context: 0.1, reasoning: 0.2, speed: 0.1, cost: 0.05, chinese: 0.05 },
    verify:   { code_quality: 0.2, long_context: 0.15, reasoning: 0.45, speed: 0.1, cost: 0.05, chinese: 0.05 },
  }

  constructor() {
    for (const model of DynamicRouterPolicy.BUILTIN_MODELS) {
      this.models.set(model.id, model)
      this.eloState.set(model.id, this.createDefaultEloState())
    }
  }

  /** 创建默认 ELO 状态（所有 intent 基线 1.0） */
  private createDefaultEloState(): ModelEloState {
    const intentMultiplier: Record<TaskIntent, number> = { scout: 1.0, analyze: 1.0, generate: 1.0, verify: 1.0 }
    return {
      wins: 0, losses: 0, errors: 0, validateFailures: 0,
      emaLatencyMs: 10_000,
      intentMultiplier,
      emaCostPerCall: 4_000,  // 初始假设 4K tokens/call
      totalTokensConsumed: 0,
    }
  }

  /** 钳位函数 */
  private static clampMultiplier(value: number): number {
    return Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, value))
  }

  registerModel(capability: ModelCapability): void {
    this.models.set(capability.id, capability)
    if (!this.eloState.has(capability.id)) {
      this.eloState.set(capability.id, this.createDefaultEloState())
    }
  }

  deregisterModel(modelId: string): void {
    this.models.delete(modelId)
    this.eloState.delete(modelId)
  }

  listModels(): ModelCapability[] {
    return [...this.models.values()]
  }

  getEloState(modelId: string): ModelEloState | undefined {
    return this.eloState.get(modelId)
  }

  /** 获取所有模型的 ELO 排名快照（含 per-intent 细分） */
  getEloRankings(): Array<{
    modelId: string
    wins: number; losses: number; errors: number
    emaLatencyMs: number; emaCostPerCall: number
    intentMultiplier: Record<TaskIntent, number>
  }> {
    const rankings: Array<{
      modelId: string
      wins: number; losses: number; errors: number
      emaLatencyMs: number; emaCostPerCall: number
      intentMultiplier: Record<TaskIntent, number>
    }> = []
    for (const [modelId, state] of this.eloState) {
      rankings.push({
        modelId,
        wins: state.wins, losses: state.losses, errors: state.errors,
        emaLatencyMs: Math.round(state.emaLatencyMs),
        emaCostPerCall: Math.round(state.emaCostPerCall),
        intentMultiplier: { ...state.intentMultiplier },
      })
    }
    // 按 analyze intent 的乘数排序（最常用的 intent）
    return rankings.sort((a, b) => b.intentMultiplier.analyze - a.intentMultiplier.analyze)
  }

  /**
   * 📊 获取融合质量追踪数据
   * 返回 shouldAutoFuse = emaFusionGain 是否高于阈值
   */
  getFusionQuality(): { fusionCount: number; emaFusionGain: number; shouldAutoFuse: boolean } {
    return {
      fusionCount: this.fusionTracker.fusionCount,
      emaFusionGain: this.fusionTracker.emaFusionGain,
      shouldAutoFuse: this.fusionTracker.fusionCount < 3 || this.fusionTracker.emaFusionGain > FUSION_GAIN_DISABLE_THRESHOLD,
    }
  }

  // ── 🧬 ELO 反馈回路（Per-Intent 版） ─────────────────────────────────────

  /**
   * 消化赛马战报，更新对应模型在**特定 intent** 上的 ELO 因子。
   *
   * 升级点：
   *  - Per-Intent 乘数：只调整 telemetry.intent 对应的乘数维度
   *  - Token 成本追踪：从 candidate.tokensUsed 更新 emaCostPerCall
   *  - 全局延迟 EMA 仍然跨 intent 共享（延迟是物理属性，不分 intent）
   */
  ingestTelemetry(telemetry: RaceTelemetry): void {
    // 如果未指定 intent，降级为更新所有 intent（兼容旧代码）
    const targetIntents: TaskIntent[] = telemetry.intent ? [telemetry.intent] : ALL_INTENTS

    for (const candidate of telemetry.candidates) {
      const modelId = this.findModelIdByBackend(candidate.backend)
      if (!modelId) continue

      const state = this.eloState.get(modelId)
      if (!state) continue

      // 📊 更新全局 EMA 延迟
      if (candidate.latencyMs > 0) {
        state.emaLatencyMs = EMA_ALPHA * candidate.latencyMs + (1 - EMA_ALPHA) * state.emaLatencyMs
      }

      // 💰 更新 Token 成本追踪
      if (candidate.tokensUsed) {
        const totalTokens = candidate.tokensUsed.input + candidate.tokensUsed.output
        state.emaCostPerCall = EMA_ALPHA * totalTokens + (1 - EMA_ALPHA) * state.emaCostPerCall
        state.totalTokensConsumed += totalTokens
      }

      // 🎯 Per-Intent 乘数调整 — 只影响当前赛马所属的 intent
      for (const intent of targetIntents) {
        switch (candidate.outcome) {
          case 'winner':
            state.wins++
            state.intentMultiplier[intent] += WIN_REWARD
            break
          case 'loser':
            state.losses++
            state.intentMultiplier[intent] -= LOSS_PENALTY
            break
          case 'error':
            state.errors++
            state.intentMultiplier[intent] -= ERROR_PENALTY
            break
          case 'validate_failed':
            state.validateFailures++
            state.intentMultiplier[intent] -= VALIDATE_FAIL_PENALTY
            break
        }

        // ⏱️ 额外延迟惩罚
        if (state.emaLatencyMs > LATENCY_PENALTY_THRESHOLD_MS) {
          state.intentMultiplier[intent] -= 0.05
        }

        // 🛡️ 钳位
        state.intentMultiplier[intent] = DynamicRouterPolicy.clampMultiplier(state.intentMultiplier[intent]!)
      }
    }
  }

  /**
   * 📊 消化融合质量数据 — 追踪 MoA 融合是否真正带来了质量提升
   *
   * @param fusionConfidence 融合结果的 confidence
   * @param draftConfidences 各草稿的 confidence 列表
   */
  ingestFusionQuality(fusionConfidence: number, draftConfidences: number[]): void {
    if (draftConfidences.length === 0) return
    const avgDraftConfidence = draftConfidences.reduce((a, b) => a + b, 0) / draftConfidences.length
    const delta = fusionConfidence - avgDraftConfidence  // 正值 = 融合有提升

    this.fusionTracker.fusionCount++
    this.fusionTracker.totalConfidenceDelta += delta
    this.fusionTracker.emaFusionGain = EMA_ALPHA * delta + (1 - EMA_ALPHA) * this.fusionTracker.emaFusionGain
  }

  /** 通过 backend 名称查找模型 ID */
  private findModelIdByBackend(backend: WorkerBackend): string | undefined {
    for (const [id, model] of this.models) {
      if (model.backend === backend) return id
    }
    return undefined
  }

  // ── 路由接口 ──────────────────────────────────────────────────────────────

  route(intent: TaskIntent, contextTokenEstimate: number = 0): RouterDecision {
    const candidates = this.routeMulti(intent, contextTokenEstimate)
    if (candidates.length === 0) {
      return new DefaultRouterPolicy().route(intent, contextTokenEstimate)
    }
    return candidates[0]!
  }

  /**
   * 🎯 routeMulti() — 多模型路由核心（Per-Intent ELO + 性价比加权版）
   *
   * 评分公式：
   *   finalScore = staticScore × intentMultiplier[intent] × costEfficiencyFactor
   *
   * costEfficiencyFactor：
   *   emaCostPerCall > 8K tokens → 扣 0.1 × (cost / 8K)
   *   emaCostPerCall ≤ 8K tokens → 不扣分
   */
  routeMulti(
    intent: TaskIntent,
    contextTokenEstimate: number = 0,
    constraints?: RouteConstraints,
    topN: number = 2,
  ): RouterDecision[] {
    const weights = DynamicRouterPolicy.INTENT_WEIGHTS[intent]
    const manifest = intent === 'generate' ? READ_WRITE_MANIFEST : READ_ONLY_MANIFEST

    const candidates: Array<{ model: ModelCapability; score: number }> = []

    for (const model of this.models.values()) {
      if (!model.supportedIntents.includes(intent)) continue
      if (contextTokenEstimate > 0 && contextTokenEstimate > model.maxContextTokens) continue
      if (constraints?.maxCost !== undefined && model.scores.cost > constraints.maxCost) continue

      // 静态加权评分
      let staticScore = 0
      for (const [dim, weight] of Object.entries(weights)) {
        staticScore += (model.scores[dim as keyof ModelCapability['scores']] ?? 0) * weight
      }

      if (constraints?.preferredLanguage === 'zh') {
        staticScore += model.scores.chinese * 0.15
      }

      // 🧬 Per-Intent ELO 动态乘数
      const elo = this.eloState.get(model.id)
      const intentMul = elo?.intentMultiplier[intent] ?? 1.0

      // 💰 性价比因子：高成本模型被轻微惩罚
      let costFactor = 1.0
      if (elo && elo.emaCostPerCall > HIGH_COST_TOKEN_THRESHOLD) {
        costFactor = 1.0 - COST_EFFICIENCY_WEIGHT * (elo.emaCostPerCall / HIGH_COST_TOKEN_THRESHOLD - 1.0)
        costFactor = Math.max(0.7, costFactor)  // 成本因子下限 0.7，不会因为贵而完全被踢
      }

      const finalScore = staticScore * intentMul * costFactor

      candidates.push({ model, score: finalScore })
    }

    candidates.sort((a, b) => b.score - a.score)

    // 返回 top-N，确保异构性
    const result: RouterDecision[] = []
    const usedBackends = new Set<string>()

    for (const { model } of candidates) {
      if (result.length >= topN) break
      if (usedBackends.has(model.backend) && result.length < topN - 1) continue
      result.push({ backend: model.backend, manifest })
      usedBackends.add(model.backend)
    }

    if (result.length < topN) {
      for (const { model } of candidates) {
        if (result.length >= topN) break
        if (!result.some(r => r.backend === model.backend)) {
          result.push({ backend: model.backend, manifest })
        }
      }
    }

    return result
  }
}

