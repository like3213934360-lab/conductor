/**
 * Conductor AGC — Reflexion Actor 闭环集成
 *
 * Phase 4: 将 Reflexion 三阶段 (Evaluator → Reflector → Actor) 与 DAG 引擎集成
 *
 * 参考:
 * - Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023)
 * - Section 3: Complete loop: Actor → Environment → Evaluator → Self-Reflection → Actor
 *
 * 闭环流程:
 * 1. DAG 执行完成 → ActorLoop.onRunComplete() 触发评估
 * 2. Evaluator 判断成功/失败
 * 3. 失败 → Reflector 生成反思
 * 4. 新运行开始 → Actor recall() 注入反思记忆到 DAG 上下文
 * 5. DAG 使用增强上下文执行 → 回到步骤 1
 */
import type { EpisodicMemory, ReflexionPrompt, EpisodicEntry } from '@anthropic/conductor-persistence'

/** Actor 闭环配置 */
export interface ActorLoopConfig {
  /** 每次运行注入的最大反思条数 */
  maxReflectionsPerRun: number
  /** 自动评估+反思 (运行完成后自动触发) */
  autoReflect: boolean
  /** 反思应用计数更新 */
  trackAppliedCount: boolean
}

const DEFAULT_CONFIG: ActorLoopConfig = {
  maxReflectionsPerRun: 3,
  autoReflect: true,
  trackAppliedCount: true,
}

/** 运行上下文增强结果 */
export interface EnrichedRunContext {
  /** 注入的反思提示 */
  reflexionPrompts: string[]
  /** 来源运行 ID */
  sourceRunIds: string[]
  /** 提示总数 */
  promptCount: number
}

/**
 * Reflexion Actor Loop — 闭环控制器
 *
 * 职责:
 * 1. 运行完成时触发评估+反思 (Phase 2-3)
 * 2. 新运行开始时注入反思记忆 (Phase 4 - Actor)
 * 3. 跟踪反思的应用次数 (衰减依据)
 */
export class ReflexionActorLoop {
  private readonly memory: EpisodicMemory
  private readonly config: ActorLoopConfig

  constructor(memory: EpisodicMemory, config?: Partial<ActorLoopConfig>) {
    this.memory = memory
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Phase 4 Actor: 为新运行获取增强上下文
   *
   * 流程:
   * 1. recall() 获取相关反思
   * 2. 格式化为可注入 DAG 上下文的提示
   * 3. 更新反思的 applied_count
   */
  enrichRunContext(goal: string): EnrichedRunContext {
    const prompts: ReflexionPrompt[] = this.memory.recall(goal, this.config.maxReflectionsPerRun)

    const reflexionPrompts: string[] = []
    const sourceRunIds: string[] = []

    for (const prompt of prompts) {
      reflexionPrompts.push(prompt.text)
      sourceRunIds.push(prompt.sourceRunId)

      // 更新应用计数
      if (this.config.trackAppliedCount && prompt.promptType === 'reflection') {
        this.memory.incrementAppliedCount(prompt.sourceRunId)
      }
    }

    return {
      reflexionPrompts,
      sourceRunIds,
      promptCount: reflexionPrompts.length,
    }
  }

  /**
   * 运行完成回调 — 触发 Evaluator + Reflector
   *
   * 这是闭环的关键连接点:
   * DAG 完成 → 评估 → 反思 → 存入记忆 → 下次 recall 可读取
   */
  onRunComplete(entry: EpisodicEntry): void {
    if (!this.config.autoReflect) return

    try {
      // 阶段 1: Evaluator
      const evaluation = this.memory.evaluate(entry)

      // 阶段 2: Reflector (仅在失败时)
      if (!evaluation.success) {
        this.memory.reflect(entry, evaluation)
      }
    } catch {
      // 三模型审计: 评估/反思失败不应阻塞 DAG 运行
      // 静默失败, 不影响主流程
    }
  }

  /** 获取配置 (只读) */
  getConfig(): Readonly<ActorLoopConfig> {
    return this.config
  }
}
