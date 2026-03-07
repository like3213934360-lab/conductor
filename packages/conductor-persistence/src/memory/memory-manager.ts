/**
 * Conductor AGC — 三层记忆管理器 (Memory Manager)
 *
 * 科研升级 E: MemGPT 自动 Eviction + LRU (Packer et al., 2023)
 *
 * 统一管理三层记忆架构:
 * 1. Working Memory: 当前运行的 AGCState（在 AGCService 中）
 * 2. Episodic Memory: 历史运行经验（ManifestIndex + Reflexion 三阶段）
 * 3. Semantic Memory: 跨运行知识图（时序事实表 + LRU eviction）
 *
 * 新增 MemGPT 特性:
 * - MemoryBudget: 每层记忆的容量上限
 * - 自动 eviction: recordRun 后检查预算，超限时 LRU 淘汰
 * - compact(): 合并重复的语义事实
 *
 * 参考:
 * - Packer et al., "MemGPT: Towards LLMs as Operating Systems" (2023)
 * - Shinn et al., "Reflexion" (2023)
 * - Zep/Graphiti: temporal knowledge graphs
 */
import type Database from 'better-sqlite3'
import { ManifestIndex } from './manifest-index.js'
import type { ManifestEntry } from './manifest-index.js'
import { EpisodicMemory } from './episodic-memory.js'
import type { EpisodicEntry, ReflexionPrompt, ReflexionEvaluation, ReflexionReflection } from './episodic-memory.js'
import { SemanticMemory } from './semantic-memory.js'
import type { SemanticFact, FactQuery } from './semantic-memory.js'

// ─── MemGPT 记忆预算 ─────────────────────────────────

/** 记忆预算配置 (MemGPT 风格) */
export interface MemoryBudget {
  /** 语义记忆最大活跃事实数 (默认 1000) */
  maxSemanticFacts: number
  /** 超限时单次淘汰数量 (默认 100) */
  evictionBatchSize: number
  /** 是否在 recordRun 后自动触发 eviction (默认 true) */
  autoEvict: boolean
  /** 是否在 eviction 前先 compact (默认 true) */
  compactBeforeEvict: boolean
}

const DEFAULT_BUDGET: MemoryBudget = {
  maxSemanticFacts: 1000,
  evictionBatchSize: 100,
  autoEvict: true,
  compactBeforeEvict: true,
}

/** 记忆管理器配置 */
export interface MemoryManagerConfig {
  /** SQLite database 实例 */
  db: Database.Database
  /** MemGPT 记忆预算 (可选) */
  budget?: Partial<MemoryBudget>
}

/**
 * MemoryManager — MemGPT 风格三层记忆统一接口
 *
 * 整合 Episodic + Semantic 记忆，自动管理记忆预算。
 *
 * 生命周期:
 * 1. recordRun(): 存储运行 → Reflexion evaluate + reflect → 语义提取 → 预算检查
 * 2. recall(): 检索历史 → Reflexion prompts + 语义事实
 * 3. maintain(): 手动触发 compact + eviction
 */
export class MemoryManager {
  public readonly manifestIndex: ManifestIndex
  public readonly episodicMemory: EpisodicMemory
  public readonly semanticMemory: SemanticMemory
  private readonly budget: MemoryBudget

  constructor(config: MemoryManagerConfig) {
    this.manifestIndex = new ManifestIndex(config.db)
    this.episodicMemory = new EpisodicMemory(config.db, this.manifestIndex)
    this.semanticMemory = new SemanticMemory(config.db)
    this.budget = { ...DEFAULT_BUDGET, ...config.budget }
  }

  /**
   * 记录一次运行到记忆系统 — 完整 MemGPT 流水线
   *
   * 步骤:
   * 1. Manifest 索引（Episodic）
   * 2. Reflexion 评估 + 反思
   * 3. 语义事实提取
   * 4. MemGPT 预算检查 + 自动 eviction
   */
  recordRun(entry: ManifestEntry, riskLevel: string, episodicEntry?: EpisodicEntry): RecordResult {
    // 1. 更新 Manifest 索引（Episodic）
    this.manifestIndex.index(entry)

    // 2. Reflexion 三阶段 (升级 D)
    let evaluation: ReflexionEvaluation | undefined
    let reflection: ReflexionReflection | null = null

    if (episodicEntry) {
      const result = this.episodicMemory.recordAndReflect(episodicEntry)
      evaluation = result.evaluation
      reflection = result.reflection
    }

    // 3. 从运行结果提取语义事实（Semantic）
    this.semanticMemory.extractFromRun(
      entry.runId,
      riskLevel,
      entry.files,
      entry.createdAt,
    )

    // 4. MemGPT 预算检查
    let evictionResult: EvictionResult | undefined
    if (this.budget.autoEvict) {
      evictionResult = this.enforceMemoryBudget()
    }

    return { evaluation, reflection, evictionResult }
  }

  /**
   * 为新运行查询相关记忆 — MemGPT recall
   *
   * 合并三路信号:
   * 1. Reflexion 提示 (Episodic)
   * 2. 相关语义事实 (Semantic)
   * 3. 记忆预算状态 (MemGPT)
   */
  recall(goal: string, files?: string[]): MemoryRecall {
    // 1. Episodic 记忆: Reflexion 提示
    const reflexionPrompts = this.episodicMemory.recall(goal)

    // 2. Semantic 记忆: 相关文件的知识
    const relevantFacts: SemanticFact[] = []
    if (files) {
      for (const file of files.slice(0, 10)) {
        const facts = this.semanticMemory.queryFacts({
          subject: file,
          limit: 5,
        })
        relevantFacts.push(...facts)
      }
    }

    // 3. MemGPT 预算状态
    const budgetStatus = this.getBudgetStatus()

    return { reflexionPrompts, relevantFacts, budgetStatus }
  }

  /**
   * 查询语义事实（直接透传）
   */
  queryFacts(query: FactQuery): SemanticFact[] {
    return this.semanticMemory.queryFacts(query)
  }

  // ─── MemGPT 记忆管理 ──────────────────────────────

  /**
   * 手动维护记忆 — compact + eviction
   *
   * 科研参考: Packer 2023, MemGPT Section 4.4
   * "Periodic maintenance compacts and evicts stale entries"
   */
  maintain(): EvictionResult {
    return this.enforceMemoryBudget()
  }

  /**
   * 获取记忆预算状态
   */
  getBudgetStatus(): BudgetStatus {
    const currentFacts = this.semanticMemory.count()
    return {
      maxSemanticFacts: this.budget.maxSemanticFacts,
      currentSemanticFacts: currentFacts,
      utilizationPercent: Math.round((currentFacts / this.budget.maxSemanticFacts) * 100),
      overBudget: currentFacts > this.budget.maxSemanticFacts,
    }
  }

  /**
   * 执行 MemGPT 预算 enforcement
   *
   * 策略:
   * 1. 先 compact (合并重复事实)
   * 2. 如果仍超限，LRU eviction
   */
  private enforceMemoryBudget(): EvictionResult {
    const before = this.semanticMemory.count()
    let compacted = 0
    let evicted = 0

    // Step 1: compact (去重)
    if (this.budget.compactBeforeEvict) {
      compacted = this.semanticMemory.compact()
    }

    // Step 2: LRU eviction (如果仍超限)
    const afterCompact = this.semanticMemory.count()
    if (afterCompact > this.budget.maxSemanticFacts) {
      // 审计修复 #4: 只淘汰实际超出的数量，避免过度淘汰
      const excess = afterCompact - this.budget.maxSemanticFacts
      evicted = this.semanticMemory.evictOldest(excess)
    }

    return {
      before,
      afterCompact: before - compacted,
      afterEvict: this.semanticMemory.count(),
      compacted,
      evicted,
    }
  }
}

/** 记忆回忆结果 */
export interface MemoryRecall {
  reflexionPrompts: ReflexionPrompt[]
  relevantFacts: SemanticFact[]
  /** MemGPT 预算状态 */
  budgetStatus: BudgetStatus
}

/** 录入结果 */
export interface RecordResult {
  evaluation?: ReflexionEvaluation
  reflection?: ReflexionReflection | null
  evictionResult?: EvictionResult
}

/** MemGPT 预算状态 */
export interface BudgetStatus {
  maxSemanticFacts: number
  currentSemanticFacts: number
  utilizationPercent: number
  overBudget: boolean
}

/** Eviction 结果 */
export interface EvictionResult {
  before: number
  afterCompact: number
  afterEvict: number
  compacted: number
  evicted: number
}
