/**
 * Conductor AGC — 事件性记忆 (Episodic Memory)
 *
 * 中期记忆：存储过去运行的经验摘要，支持 Reflexion 式回放。
 *
 * 参考: Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023)
 *
 * 当新运行开始时，搜索历史中相似的失败/成功模式，
 * 注入 Reflexion 提示: "上次运行 X 失败因为 Y，调整你的方法。"
 */
import type Database from 'better-sqlite3'
import type { ManifestIndex, ManifestSearchResult } from './manifest-index.js'

/** 事件性记忆条目 */
export interface EpisodicEntry {
  runId: string
  goal: string
  outcome: 'completed' | 'failed' | 'cancelled'
  riskLevel: string
  lane: string
  keyInsights: string[]
  failureReasons?: string[]
  createdAt: string
}

/** Reflexion 提示 */
export interface ReflexionPrompt {
  /** 来源运行 ID */
  sourceRunId: string
  /** 提示类型 */
  promptType: 'warning' | 'advice' | 'pattern'
  /** 提示文本 */
  text: string
  /** 相关性分数 */
  relevance: number
}

/**
 * 事件性记忆管理器
 *
 * 通过 ManifestIndex 搜索历史，生成 Reflexion 提示。
 */
export class EpisodicMemory {
  private readonly manifestIndex: ManifestIndex
  private readonly db: Database.Database

  constructor(db: Database.Database, manifestIndex: ManifestIndex) {
    this.db = db
    this.manifestIndex = manifestIndex
  }

  /**
   * 为新运行生成 Reflexion 提示
   *
   * 搜索历史中相似的运行，提取经验教训。
   */
  recall(goal: string, topK: number = 3): ReflexionPrompt[] {
    const matches = this.manifestIndex.search(goal, topK)
    return matches.map(match => this.matchToPrompt(match))
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
