/**
 * Conductor AGC — Vector Memory Layer
 *
 * 为现有 MemoryManager 添加向量语义检索能力:
 * - IVectorStore 抽象接口（可接入 Chroma/Qdrant/内存）
 * - InMemoryVectorStore (暴力搜索, 零外部依赖)
 * - VectorMemoryLayer (与 MemoryManager 集成)
 *
 * 复用 embedding-detector.ts 的 IEmbeddingProvider 接口
 *
 * 参考:
 * - MemGPT v3 (2025) — Hierarchical Memory with Vector Retrieval
 * - Mem0 v2 — Adaptive Memory with Embedding Search
 * - Zep Enterprise — Temporal + Semantic Memory
 * - RAG 最佳实践 — Chunk, Embed, Retrieve, Re-rank
 */

// ── 向量存储类型 ──────────────────────────────────────────────────

/** 向量记录 */
export interface VectorRecord {
  /** 记录 ID */
  id: string
  /** 向量嵌入 */
  embedding: number[]
  /** 关联的文本内容 */
  text: string
  /** 元数据 */
  metadata: Record<string, unknown>
  /** 创建时间 */
  timestamp: string
}

/** 检索结果 */
export interface SearchResult {
  /** 匹配的记录 */
  record: VectorRecord
  /** 相似度得分 (0-1) */
  score: number
}

/** 向量存储接口 */
export interface IVectorStore {
  /** 插入或更新记录 */
  upsert(record: VectorRecord): Promise<void>
  /** 批量插入 */
  batchUpsert(records: VectorRecord[]): Promise<void>
  /** 语义检索 (Top-K) */
  search(queryEmbedding: number[], topK: number, filter?: Record<string, unknown>): Promise<SearchResult[]>
  /** 删除记录 */
  delete(id: string): Promise<boolean>
  /** 记录总数 */
  count(): Promise<number>
}

// ── InMemory 实现 ──────────────────────────────────────────────────

/**
 * InMemoryVectorStore — 暴力搜索向量存储
 *
 * 适用于:
 * - 开发/测试环境
 * - 小规模数据 (< 10K records)
 * - 零外部依赖场景
 *
 * 生产环境应替换为 Qdrant/Chroma 实现
 */
export class InMemoryVectorStore implements IVectorStore {
  private records = new Map<string, VectorRecord>()

  async upsert(record: VectorRecord): Promise<void> {
    this.records.set(record.id, record)
  }

  async batchUpsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, record)
    }
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = []

    for (const record of this.records.values()) {
      // 可选过滤
      if (filter && !this.matchesFilter(record, filter)) continue

      const score = this.cosineSimilarity(queryEmbedding, record.embedding)
      results.push({ record, score })
    }

    // 按相似度降序排列，取 Top-K
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  async delete(id: string): Promise<boolean> {
    return this.records.delete(id)
  }

  async count(): Promise<number> {
    return this.records.size
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  /** 简单的元数据过滤 */
  private matchesFilter(record: VectorRecord, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (record.metadata[key] !== value) return false
    }
    return true
  }

  /** 测试辅助: 清空 */
  clear(): void {
    this.records.clear()
  }
}

// ── Embedding Provider 接口 (复用) ────────────────────────────────

/** 复用 embedding-detector.ts 的接口 */
export interface IEmbeddingProvider {
  embed(text: string): Promise<{ embedding: number[]; model: string; tokens: number }>
  isAvailable(): boolean
}

// ── Vector Memory Layer ──────────────────────────────────────────

/** Vector Memory 配置 */
export interface VectorMemoryConfig {
  /** 检索 Top-K */
  topK: number
  /** 最小相似度阈值 */
  minScore: number
  /** 最大存储记录数 */
  maxRecords: number
}

const DEFAULT_CONFIG: VectorMemoryConfig = {
  topK: 10,
  minScore: 0.3,
  maxRecords: 5000,
}

/**
 * VectorMemoryLayer — 语义记忆检索层
 *
 * 集成方式:
 * 1. 在 MemoryManager.recordRun() 后调用 index() 存储运行记忆
 * 2. 在 MemoryManager.recall() 中调用 search() 检索相关记忆
 *
 * 与现有 SemanticMemory (SQLite 关系型) 互补:
 * - SemanticMemory: 结构化事实 (subject-predicate-object)
 * - VectorMemoryLayer: 非结构化语义检索 (embedding similarity)
 */
export class VectorMemoryLayer {
  private readonly config: VectorMemoryConfig

  constructor(
    private readonly store: IVectorStore,
    private readonly embedder: IEmbeddingProvider,
    config?: Partial<VectorMemoryConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 索引一条记忆
   */
  async index(
    id: string,
    text: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.embedder.isAvailable()) return

    const { embedding } = await this.embedder.embed(text)
    await this.store.upsert({
      id,
      embedding,
      text,
      metadata,
      timestamp: new Date().toISOString(),
    })

    // 超限时不再主动淘汰 — 由外部调度
    const count = await this.store.count()
    if (count > this.config.maxRecords) {
      // 可以在这里触发淘汰策略
      // 当前设计: 依赖外部 MemoryManager 统一管理
    }
  }

  /**
   * 索引运行结果
   */
  async indexRun(
    runId: string,
    goal: string,
    result: string,
    files: string[],
    riskLevel: string,
  ): Promise<void> {
    // 将目标和结果合并为检索文本
    const text = `Goal: ${goal}\nResult: ${result}`
    await this.index(`run-${runId}`, text, {
      type: 'run',
      runId,
      files,
      riskLevel,
    })
  }

  /**
   * 语义检索相关记忆
   */
  async search(
    query: string,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    if (!this.embedder.isAvailable()) return []

    const { embedding } = await this.embedder.embed(query)
    const results = await this.store.search(embedding, this.config.topK, filter)

    // 过滤低分结果
    return results.filter(r => r.score >= this.config.minScore)
  }

  /**
   * 获取存储统计
   */
  async stats(): Promise<{ totalRecords: number; maxRecords: number; utilizationPercent: number }> {
    const total = await this.store.count()
    return {
      totalRecords: total,
      maxRecords: this.config.maxRecords,
      utilizationPercent: Math.round((total / this.config.maxRecords) * 100),
    }
  }
}
