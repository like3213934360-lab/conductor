/**
 * Conductor AGC — Reflexion 类型定义
 *
 * 架构优化: 将 Reflexion 相关接口从 conductor-persistence 提取到 conductor-shared,
 * 消除 conductor-core → conductor-persistence 的循环类型依赖。
 *
 * 依赖方向: shared ← core ← persistence (单向)
 */

/** 事件性记忆条目 */
export interface EpisodicEntry {
  runId: string
  goal: string
  outcome: 'completed' | 'failed' | 'cancelled'
  riskLevel?: string
  lane?: string
  keyInsights?: string[]
  failureReasons?: string[]
  nodeCount: number
  files: string[]
  createdAt: string
}

/** 评估结果 (Evaluator 输出) */
export interface ReflexionEvaluation {
  /** 运行 ID */
  runId: string
  /** 运行是否成功 */
  success: boolean
  /** 失败原因分类 */
  failureCategory?: 'timeout' | 'wrong_output' | 'crash' | 'compliance' | 'unknown'
  /** 影响因子 (0-1) */
  severity: number
  /** 评估时间 */
  evaluatedAt: string
}

/** 反思结果 (Reflector 输出) — 2026 SOTA: Critic-Actor-Judge */
export interface ReflexionReflection {
  /** 运行 ID */
  runId: string
  /** 根因分析 */
  rootCause: string
  /** 可执行的改进建议 (verbal reinforcement) */
  actionItems: string[]
  /** 教训类型 */
  lessonType: 'avoid' | 'prefer' | 'adjust'
  /** 置信度 (0-1) */
  confidence: number
  /** 2026 SOTA: 反思质量分 (Shinn 2023 Section 3.2: LLM 评分) */
  qualityScore: number
  /** 2026 SOTA: 强化强度 (Critic-Actor-Judge 2025) */
  reinforcementStrength: number
  /** 被应用的次数 */
  appliedCount: number
  /** 反思时间 */
  reflectedAt: string
}

/** Reflexion 提示 (Actor 输入) */
export interface ReflexionPrompt {
  /** 来源运行 ID */
  sourceRunId: string
  /** 提示类型 */
  promptType: 'warning' | 'advice' | 'pattern' | 'reflection'
  /** 提示文本 */
  text: string
  /** 相关性分数 */
  relevance: number
}

/**
 * EpisodicMemory 接口契约
 *
 * 架构优化: conductor-core 的 actor-loop 通过此接口与 persistence 层交互,
 * 而非直接导入 persistence 的具体实现类。
 *
 * 遵循依赖倒置原则 (DIP): core 定义接口, persistence 实现接口。
 */
export interface IEpisodicMemory {
  evaluate(entry: EpisodicEntry): ReflexionEvaluation
  reflect(entry: EpisodicEntry, evaluation: ReflexionEvaluation): ReflexionReflection | null
  recall(goal: string, topK?: number): ReflexionPrompt[]
  incrementAppliedCount(runId: string): void
}
