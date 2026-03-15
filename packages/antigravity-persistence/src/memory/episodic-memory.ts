/**
 * Antigravity Workflow Runtime — 事件性记忆 (Episodic Memory)
 *
 * 科研升级 D: Reflexion 三阶段循环 (Shinn et al., 2023)
 *
 * 原实现: 单步 prompt 生成 (搜索历史 → 直接输出建议)
 * 新实现: Actor → Evaluator → Reflector 三阶段循环
 *
 * 三阶段模型:
 * 1. Evaluator: 评估运行结果 (pass/fail + 原因分类)
 * 2. Reflector: 将评估转为结构化改进建议 (可执行的 verbal reinforcement)
 * 3. Actor: recall() 时注入反思记忆，指导新运行
 *
 * 参考:
 * - Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023)
 * - Yao et al., "ReAct: Synergizing Reasoning and Acting" (2023)
 * - Madaan et al., "Self-Refine" (2023)
 */
import type { WasmDatabase } from '../db/sqlite-client.js'
import type { ManifestIndex, ManifestSearchResult } from './manifest-index.js'
import type {
  EpisodicEntry,
  ReflexionEvaluation,
  ReflexionReflection,
  ReflexionPrompt,
  IEpisodicMemory,
} from '@anthropic/antigravity-shared'

// 统一从 shared 暴露记忆相关类型
export type { EpisodicEntry, ReflexionEvaluation, ReflexionReflection, ReflexionPrompt } from '@anthropic/antigravity-shared'

/**
 * 事件性记忆管理器 — Reflexion 三阶段
 *
 * 生命周期:
 * 1. 运行完成 → evaluate() 评估结果
 * 2. 评估失败 → reflect() 生成反思
 * 3. 新运行开始 → recall() 注入反思记忆
 */
export class EpisodicMemory implements IEpisodicMemory {
  private readonly manifestIndex: ManifestIndex
  private readonly db: WasmDatabase

  constructor(db: WasmDatabase, manifestIndex: ManifestIndex) {
    this.db = db
    this.manifestIndex = manifestIndex
  }

  // ─── 阶段 1: Evaluator ──────────────────────────────

  /**
   * 评估运行结果 — Reflexion Evaluator
   *
   * 对运行结果进行结构化评估：成功/失败 + 失败分类 + 严重度
   *
   * 参考 Shinn 2023 Section 3.1: "The evaluator provides
   * a binary signal of success or failure"
   */
  evaluate(entry: EpisodicEntry): ReflexionEvaluation {
    const success = entry.outcome === 'completed'

    let failureCategory: ReflexionEvaluation['failureCategory']
    let severity = 0.0

    if (!success) {
      // 从 failureReasons 推断失败类型
      const reasons = (entry.failureReasons ?? []).join(' ').toLowerCase()

      if (reasons.includes('timeout') || reasons.includes('超时')) {
        failureCategory = 'timeout'
        severity = 0.6
      } else if (reasons.includes('compliance') || reasons.includes('合规')) {
        failureCategory = 'compliance'
        severity = 0.8
      } else if (reasons.includes('crash') || reasons.includes('崩溃')) {
        failureCategory = 'crash'
        severity = 0.9
      } else if (reasons.includes('wrong') || reasons.includes('错误')) {
        failureCategory = 'wrong_output'
        severity = 0.7
      } else {
        failureCategory = 'unknown'
        severity = 0.5
      }

      // 高风险运行失败 → 严重度加权
      if (entry.riskLevel === 'critical') severity = Math.min(1.0, severity + 0.2)
      if (entry.riskLevel === 'high') severity = Math.min(1.0, severity + 0.1)
    }

    const evaluation: ReflexionEvaluation = {
      runId: entry.runId,
      success,
      failureCategory,
      severity,
      evaluatedAt: new Date().toISOString(),
    }

    // 持久化评估结果
    this.db.prepare(`
      INSERT OR REPLACE INTO reflexionEvaluations
        (runId, success, failureCategory, severity, evaluatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      evaluation.runId,
      evaluation.success ? 1 : 0,
      evaluation.failureCategory ?? null,
      evaluation.severity,
      evaluation.evaluatedAt,
    )

    return evaluation
  }

  // ─── 阶段 2: Reflector ──────────────────────────────

  /**
   * 生成反思 — Reflexion Reflector
   *
   * 将评估结果转为结构化改进建议。
   *
   * 参考 Shinn 2023 Section 3.2: "The self-reflection model
   * generates verbal reinforcement cues for future trials"
   */
  reflect(
    entry: EpisodicEntry,
    evaluation: ReflexionEvaluation,
  ): ReflexionReflection | null {
    // 只对失败的运行生成反思
    if (evaluation.success) return null

    const reasons = entry.failureReasons ?? []
    const rootCause = reasons.length > 0
      ? reasons.join('; ')
      : `运行 "${entry.goal}" ${evaluation.failureCategory ?? '未知原因'} 失败`

    const actionItems: string[] = []
    let lessonType: ReflexionReflection['lessonType'] = 'adjust'

    switch (evaluation.failureCategory) {
      case 'timeout':
        actionItems.push('减少并行节点数或增加超时限制')
        actionItems.push('检查是否有死循环依赖')
        lessonType = 'adjust'
        break
      case 'compliance':
        actionItems.push('提前运行合规检查，在 DAG 执行前拦截')
        actionItems.push('检查涉及文件的安全级别')
        lessonType = 'avoid'
        break
      case 'crash':
        actionItems.push('添加更健壮的错误处理')
        actionItems.push('检查输入数据的边界条件')
        lessonType = 'avoid'
        break
      case 'wrong_output':
        actionItems.push('增加输出校验节点')
        actionItems.push('参考历史成功运行的输出模式')
        lessonType = 'prefer'
        break
      default:
        actionItems.push('增加日志级别以便诊断')
        lessonType = 'adjust'
    }

    const confidence = Math.min(1.0, evaluation.severity * 0.8 + 0.2)

    const reflection: ReflexionReflection = {
      runId: entry.runId,
      rootCause,
      actionItems,
      lessonType,
      confidence,
      qualityScore: confidence * 0.8, // 2026 SOTA: 初始质量分 = 置信度 × 0.8
      reinforcementStrength: 1.0,     // 2026 SOTA: 初始强化强度
      appliedCount: 0,
      reflectedAt: new Date().toISOString(),
    }

    // 持久化反思结果 (2026 SOTA: 含质量分 + 强化强度)
    this.db.prepare(`
      INSERT OR REPLACE INTO reflexionReflections
        (runId, rootCause, actionItems, lessonType, confidence, qualityScore, reinforcementStrength, appliedCount, reflectedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reflection.runId,
      reflection.rootCause,
      JSON.stringify(reflection.actionItems),
      reflection.lessonType,
      reflection.confidence,
      reflection.qualityScore,
      reflection.reinforcementStrength,
      reflection.appliedCount,
      reflection.reflectedAt,
    )

    return reflection
  }

  // ─── 阶段 3: Actor (Recall) ──────────────────────────

  /**
   * 为新运行生成 Reflexion 提示 — Actor
   *
   * 合并两路信号:
   * 1. BM25 历史匹配 → 相似运行建议
   * 2. Reflexion 反思 → 失败教训注入
   *
   * 参考 Shinn 2023 Section 3.3: "At trial t, the actor
   * receives all previous self-reflections"
   */
  recall(goal: string, topK: number = 3): ReflexionPrompt[] {
    const prompts: ReflexionPrompt[] = []

    // 1. BM25 历史匹配
    const matches = this.manifestIndex.search(goal, topK)
    for (const match of matches) {
      prompts.push(this.matchToPrompt(match))
    }

    // 2. Reflexion 反思注入（审计修复 #3: 添加目标相关性过滤）
    const reflections = this.loadRelevantReflections(goal, topK)
    for (const ref of reflections) {
      let actionText: string
      try {
        // 审计修复 #5: JSON.parse 安全包裹
        const items = JSON.parse(ref.actionItems) as string[]
        actionText = items.join('; ')
      } catch {
        actionText = ref.actionItems // 降级: 直接使用原始文本
      }
      prompts.push({
        sourceRunId: ref.runId,
        promptType: 'reflection',
        text: `[Reflexion] 历史运行失败教训 (${ref.lessonType}): ${ref.rootCause}。` +
              `建议: ${actionText}`,
        relevance: ref.confidence,
      })
    }

    // 按相关性排序，取 topK
    return prompts
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, topK * 2) // 扩大返回范围：历史 + 反思
  }

  /**
   * 端到端 Reflexion 录入
   *
   * 运行完成后调用：evaluate → reflect → 自动存储
   */
  recordAndReflect(entry: EpisodicEntry): {
    evaluation: ReflexionEvaluation
    reflection: ReflexionReflection | null
  } {
    const evaluation = this.evaluate(entry)
    const reflection = this.reflect(entry, evaluation)
    return { evaluation, reflection }
  }

  /**
   * 加载与目标相关的反思结果
   *
   * 审计修复 #3: 从全局加载改为目标关键词过滤
   * Reflexion (Shinn 2023): "只注入与当前试验相关的历史自我反思"
   */
  private loadRelevantReflections(goal: string, limit: number): ReflectionRow[] {
    // 提取目标关键词 (简单分词)
    const keywords = goal.split(/[\s,.，。]+/).filter(w => w.length > 2)
    if (keywords.length === 0) {
      return this.db.prepare(`
        SELECT runId, rootCause, actionItems, lessonType, confidence, reflectedAt
        FROM reflexionReflections
        WHERE confidence >= 0.5
        ORDER BY reflectedAt DESC
        LIMIT ?
      `).all(limit) as unknown as ReflectionRow[]
    }

    // 目标关键词匹配 (rootCause 中包含任何关键词)
    const likeConditions = keywords.slice(0, 5).map((_, i) => `rootCause LIKE @kw${i}`)
    const params: Record<string, string | number> = { limit }
    keywords.slice(0, 5).forEach((kw, i) => {
      params[`kw${i}`] = `%${kw}%`
    })

    return this.db.prepare(`
      SELECT runId, rootCause, actionItems, lessonType, confidence, reflectedAt
      FROM reflexionReflections
      WHERE confidence >= 0.5 AND (${likeConditions.join(' OR ')})
      ORDER BY confidence DESC, reflectedAt DESC
      LIMIT @limit
    `).all(params) as unknown as ReflectionRow[]
  }

  /**
   * Phase 4: 更新反思应用计数 (Actor Loop 调用)
   *
   * 每次 recall() 注入反思时, appliedCount++。
   * 衰减依据: appliedCount 越高, reinforcementStrength 越低。
   */
  incrementAppliedCount(runId: string): void {
    this.db.prepare(`
      UPDATE reflexionReflections
      SET appliedCount = appliedCount + 1,
          reinforcementStrength = MAX(0.1, reinforcementStrength * 0.9)
      WHERE runId = ?
    `).run(runId)
  }

  /** 将搜索结果转为 Reflexion 提示 */
  private matchToPrompt(match: ManifestSearchResult): ReflexionPrompt {
    const isHighRisk = match.riskLevel === 'high' || match.riskLevel === 'critical'

    if (isHighRisk) {
      return {
        sourceRunId: match.runId,
        promptType: 'warning',
        text: `历史运行 "${match.goal}" (${match.createdAt}) 被评为 ${match.riskLevel} 风险，` +
              `执行路径: ${match.lane}。请注意潜在的相似风险。`,
        relevance: match.score,
      }
    }

    return {
      sourceRunId: match.runId,
      promptType: 'advice',
      text: `发现相似历史运行 "${match.goal}" (${match.createdAt})，` +
            `风险级别: ${match.riskLevel ?? '未知'}，路由: ${match.lane ?? '未知'}。` +
            `可参考其执行经验。`,
      relevance: match.score,
    }
  }
}

/** 反思行类型 */
interface ReflectionRow {
  runId: string
  rootCause: string
  actionItems: string
  lessonType: string
  confidence: number
  reflectedAt: string
}
