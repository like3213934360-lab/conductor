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

/** 单个模型的运行时 ELO 状态 */
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
   * 动态表现乘数 — 作用于 routeMulti() 的静态评分
   * 1.0 = 基线（等效于静态配置）
   * > 1.0 = 超额表现（胜率高、延迟低）
   * < 1.0 = 表现衰退（错误多、延迟高）
   *
   * 🛡️ 硬性钳位 [0.3, 2.0]：防止路由雪崩（永远不会完全归零）
   */
  performanceMultiplier: number
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

export class DynamicRouterPolicy implements RouterPolicy {
  private readonly models = new Map<string, ModelCapability>()
  /** 🧬 每个模型的 ELO 运行时状态 */
  private readonly eloState = new Map<string, ModelEloState>()

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
    // 🛡️ SOC2 Air-Gap: 本地模型兜底 — 物理隔离网络中的唯一存活者
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
    // 加载预埋模型
    for (const model of DynamicRouterPolicy.BUILTIN_MODELS) {
      this.models.set(model.id, model)
      this.eloState.set(model.id, this.createDefaultEloState())
    }
  }

  /** 创建默认 ELO 状态（基线 1.0） */
  private createDefaultEloState(): ModelEloState {
    return {
      wins: 0, losses: 0, errors: 0, validateFailures: 0,
      emaLatencyMs: 10_000,  // 初始假设 10 秒（保守估计）
      performanceMultiplier: 1.0,
    }
  }

  /** 钳位函数：防止乘数越界引发路由雪崩 */
  private static clampMultiplier(value: number): number {
    return Math.max(MULTIPLIER_FLOOR, Math.min(MULTIPLIER_CEILING, value))
  }

  /** 注册来自 Hub 的模型能力 */
  registerModel(capability: ModelCapability): void {
    this.models.set(capability.id, capability)
    if (!this.eloState.has(capability.id)) {
      this.eloState.set(capability.id, this.createDefaultEloState())
    }
  }

  /** 淘汰模型（断路器触发） */
  deregisterModel(modelId: string): void {
    this.models.delete(modelId)
    this.eloState.delete(modelId)
  }

  /** 获取已注册模型列表 */
  listModels(): ModelCapability[] {
    return [...this.models.values()]
  }

  /** 获取模型的 ELO 状态（调试/监控用） */
  getEloState(modelId: string): ModelEloState | undefined {
    return this.eloState.get(modelId)
  }

  /** 获取所有模型的 ELO 排名快照 */
  getEloRankings(): Array<{ modelId: string; multiplier: number; wins: number; losses: number; errors: number; emaLatencyMs: number }> {
    const rankings: Array<{ modelId: string; multiplier: number; wins: number; losses: number; errors: number; emaLatencyMs: number }> = []
    for (const [modelId, state] of this.eloState) {
      rankings.push({
        modelId,
        multiplier: state.performanceMultiplier,
        wins: state.wins,
        losses: state.losses,
        errors: state.errors,
        emaLatencyMs: Math.round(state.emaLatencyMs),
      })
    }
    return rankings.sort((a, b) => b.multiplier - a.multiplier)
  }

  // ── 🧬 ELO 反馈回路 ──────────────────────────────────────────────────────

  /**
   * 消化赛马战报，更新各模型的 ELO 动态表现因子。
   *
   * 调权算法：EMA 平滑步进（α = 0.3）
   *  - Winner：multiplier += WIN_REWARD，EMA 延迟更新
   *  - Loser（被 abort）：multiplier -= LOSS_PENALTY
   *  - Error：multiplier -= ERROR_PENALTY（断路器衰减）
   *  - Validate Failed：multiplier -= VALIDATE_FAIL_PENALTY
   *  - 延迟惩罚：EMA 延迟超过 30s 额外扣 0.05
   *
   * 所有调权后钳位到 [0.3, 2.0]，防止任何模型被完全踢出或无限膨胀。
   */
  ingestTelemetry(telemetry: RaceTelemetry): void {
    for (const candidate of telemetry.candidates) {
      // 通过 backend 查找对应的模型 ID
      const modelId = this.findModelIdByBackend(candidate.backend)
      if (!modelId) continue

      const state = this.eloState.get(modelId)
      if (!state) continue

      // 📊 更新 EMA 延迟（仅对有实际延迟的候选）
      if (candidate.latencyMs > 0) {
        state.emaLatencyMs = EMA_ALPHA * candidate.latencyMs + (1 - EMA_ALPHA) * state.emaLatencyMs
      }

      // 🎯 根据结果调整 performanceMultiplier
      switch (candidate.outcome) {
        case 'winner':
          state.wins++
          state.performanceMultiplier += WIN_REWARD
          break
        case 'loser':
          state.losses++
          state.performanceMultiplier -= LOSS_PENALTY
          break
        case 'error':
          state.errors++
          state.performanceMultiplier -= ERROR_PENALTY
          break
        case 'validate_failed':
          state.validateFailures++
          state.performanceMultiplier -= VALIDATE_FAIL_PENALTY
          break
      }

      // ⏱️ 额外延迟惩罚：EMA 延迟超过阈值，进一步降低速度分的等效加权
      if (state.emaLatencyMs > LATENCY_PENALTY_THRESHOLD_MS) {
        state.performanceMultiplier -= 0.05
      }

      // 🛡️ 钳位：绝对防止路由雪崩
      state.performanceMultiplier = DynamicRouterPolicy.clampMultiplier(state.performanceMultiplier)
    }
  }

  /** 通过 backend 名称查找模型 ID（反向映射） */
  private findModelIdByBackend(backend: WorkerBackend): string | undefined {
    for (const [id, model] of this.models) {
      if (model.backend === backend) return id
    }
    return undefined
  }

  // ── 路由接口 ──────────────────────────────────────────────────────────────

  /**
   * 🔧 route() — 向后兼容接口
   * 内部调用 routeMulti() 并取第一名。
   */
  route(intent: TaskIntent, contextTokenEstimate: number = 0): RouterDecision {
    const candidates = this.routeMulti(intent, contextTokenEstimate)
    if (candidates.length === 0) {
      // 保底降级：退化到 DefaultRouterPolicy 行为
      return new DefaultRouterPolicy().route(intent, contextTokenEstimate)
    }
    return candidates[0]!
  }

  /**
   * 🎯 routeMulti() — 多模型路由核心（ELO 加权版）
   *
   * 评分公式：finalScore = staticScore × performanceMultiplier
   *
   * staticScore 来自意图权重矩阵 × 模型能力声明；
   * performanceMultiplier 来自赛马战报的 ELO 实时反馈。
   * 当 multiplier = 1.0 时等价于旧的纯静态路由。
   */
  routeMulti(
    intent: TaskIntent,
    contextTokenEstimate: number = 0,
    constraints?: RouteConstraints,
    topN: number = 2,
  ): RouterDecision[] {
    const weights = DynamicRouterPolicy.INTENT_WEIGHTS[intent]
    const manifest = intent === 'generate' ? READ_WRITE_MANIFEST : READ_ONLY_MANIFEST

    // 候选筛选
    const candidates: Array<{ model: ModelCapability; score: number }> = []

    for (const model of this.models.values()) {
      // 筛选 1：意图支持
      if (!model.supportedIntents.includes(intent)) continue
      // 筛选 2：上下文窗口足够
      if (contextTokenEstimate > 0 && contextTokenEstimate > model.maxContextTokens) continue
      // 筛选 3：成本约束
      if (constraints?.maxCost !== undefined && model.scores.cost > constraints.maxCost) continue

      // 静态加权评分
      let staticScore = 0
      for (const [dim, weight] of Object.entries(weights)) {
        staticScore += (model.scores[dim as keyof ModelCapability['scores']] ?? 0) * weight
      }

      // 语言偏好加权
      if (constraints?.preferredLanguage === 'zh') {
        staticScore += model.scores.chinese * 0.15
      }

      // 🧬 ELO 动态乘数：将静态分数乘以运行时表现因子
      const elo = this.eloState.get(model.id)
      const multiplier = elo?.performanceMultiplier ?? 1.0
      const finalScore = staticScore * multiplier

      candidates.push({ model, score: finalScore })
    }

    // 按得分降序排列
    candidates.sort((a, b) => b.score - a.score)

    // 返回 top-N，确保异构性（尽量不重复同一 backend）
    const result: RouterDecision[] = []
    const usedBackends = new Set<string>()

    for (const { model } of candidates) {
      if (result.length >= topN) break
      // 优先异构：如果已有该 backend，降低优先级但不完全排除
      if (usedBackends.has(model.backend) && result.length < topN - 1) continue
      result.push({ backend: model.backend, manifest })
      usedBackends.add(model.backend)
    }

    // 如果异构策略导致结果不足，回填同构候选
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

