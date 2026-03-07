/**
 * Conductor AGC — 三层记忆管理器 (Memory Manager)
 *
 * 统一管理三层记忆架构:
 * 1. Working Memory: 当前运行的 AGCState（在 AGCService 中）
 * 2. Episodic Memory: 历史运行经验（ManifestIndex + Reflexion）
 * 3. Semantic Memory: 跨运行知识图（时序事实表）
 *
 * 参考:
 * - MemGPT (Packer et al., 2023): tiered memory architecture
 * - Reflexion (Shinn et al., 2023): verbal reinforcement from past experiences
 * - Zep/Graphiti: temporal knowledge graphs
 */
import type Database from 'better-sqlite3'
import { ManifestIndex } from './manifest-index.js'
import type { ManifestEntry } from './manifest-index.js'
import { EpisodicMemory } from './episodic-memory.js'
import type { ReflexionPrompt } from './episodic-memory.js'
import { SemanticMemory } from './semantic-memory.js'
import type { SemanticFact, FactQuery } from './semantic-memory.js'

/** 记忆管理器配置 */
export interface MemoryManagerConfig {
  /** SQLite database 实例 */
  db: Database.Database
}

/**
 * MemoryManager — 三层记忆统一接口
 *
 * 整合 Episodic + Semantic 记忆，对外提供简洁 API。
 */
export class MemoryManager {
  public readonly manifestIndex: ManifestIndex
  public readonly episodicMemory: EpisodicMemory
  public readonly semanticMemory: SemanticMemory

  constructor(config: MemoryManagerConfig) {
    this.manifestIndex = new ManifestIndex(config.db)
    this.episodicMemory = new EpisodicMemory(config.db, this.manifestIndex)
    this.semanticMemory = new SemanticMemory(config.db)
  }

  /**
   * 记录一次运行到记忆系统
   *
   * 同时更新 Episodic（Manifest 索引）和 Semantic（知识图）记忆。
   */
  recordRun(entry: ManifestEntry, riskLevel: string): void {
    // 1. 更新 Manifest 索引（Episodic）
    this.manifestIndex.index(entry)

    // 2. 从运行结果提取语义事实（Semantic）
    this.semanticMemory.extractFromRun(
      entry.runId,
      riskLevel,
      entry.files,
      entry.createdAt,
    )
  }

  /**
   * 为新运行查询相关记忆
   *
   * 返回 Reflexion 提示 + 相关语义事实。
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

    return { reflexionPrompts, relevantFacts }
  }

  /**
   * 查询语义事实（直接透传）
   */
  queryFacts(query: FactQuery): SemanticFact[] {
    return this.semanticMemory.queryFacts(query)
  }
}

/** 记忆回忆结果 */
export interface MemoryRecall {
  reflexionPrompts: ReflexionPrompt[]
  relevantFacts: SemanticFact[]
}
