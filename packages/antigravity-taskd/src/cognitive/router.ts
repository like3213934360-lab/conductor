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
 */
export class DynamicRouterPolicy implements RouterPolicy {
  private readonly models = new Map<string, ModelCapability>()

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
    // 分数刻意低于云端模型，确保联网时不会被优先选择；
    // 但在 Air-Gap 模式下（deregister 掉 codex/gemini），它将自动成为唯一候选。
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
    }
  }

  /** 注册来自 Hub 的模型能力 */
  registerModel(capability: ModelCapability): void {
    this.models.set(capability.id, capability)
  }

  /** 淘汰模型（断路器触发） */
  deregisterModel(modelId: string): void {
    this.models.delete(modelId)
  }

  /** 获取已注册模型列表 */
  listModels(): ModelCapability[] {
    return [...this.models.values()]
  }

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
   * 🎯 routeMulti() — 多模型路由核心
   *
   * 根据意图的能力维度权重，对每个候选模型计算加权得分，
   * 返回 top-N 候选（默认 top-2，供 RacingExecutor 赛马使用）。
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

      // 加权评分
      let score = 0
      for (const [dim, weight] of Object.entries(weights)) {
        score += (model.scores[dim as keyof ModelCapability['scores']] ?? 0) * weight
      }

      // 语言偏好加权
      if (constraints?.preferredLanguage === 'zh') {
        score += model.scores.chinese * 0.15  // 额外中文加成
      }

      candidates.push({ model, score })
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

