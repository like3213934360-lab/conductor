/**
 * Conductor AGC — Embedding 合谋检测器
 *
 * 使用 Embedding 余弦相似度替代 Jaccard + TF-IDF，
 * 检测多模型输出的语义级合谋/同质化。
 *
 * 设计:
 * - IEmbeddingProvider 抽象接口 (可接入 DeepSeek/OpenAI/本地模型)
 * - 余弦相似度纯 TS 实现 (无外部数学库依赖)
 * - Jaccard 降级方案 (API 不可用时)
 * - 三级阈值: NORMAL / WARNING / FLAGGED
 *
 * 参考:
 * - "Collusion Detection in Multi-Agent LLM Systems" (USENIX Security 2025)
 * - Meta Hermes-2 对抗训练 + 合谋检测
 */

// ── 类型定义 ──────────────────────────────────────────────────────

/** Embedding 向量结果 */
export interface EmbeddingResult {
  /** 嵌入向量 */
  embedding: number[]
  /** 使用的模型 */
  model: string
  /** 消耗的 tokens */
  tokens: number
}

/** Embedding 提供者接口 */
export interface IEmbeddingProvider {
  /** 获取文本的嵌入向量 */
  embed(text: string): Promise<EmbeddingResult>
  /** 检查提供者是否可用 */
  isAvailable(): boolean
}

/** 相似度检测结果 */
export interface CollusionResult {
  /** 相似度分数 (0-1) */
  similarity: number
  /** 检测状态 */
  status: 'NORMAL' | 'WARNING' | 'FLAGGED'
  /** 使用的检测方法 */
  method: 'embedding' | 'jaccard_fallback'
  /** 检测耗时 (ms) */
  durationMs: number
}

/** 批量检测结果 */
export interface BatchCollusionResult {
  /** 两两比较结果 */
  pairs: Array<{
    idA: string
    idB: string
    result: CollusionResult
  }>
  /** 是否有任何 FLAGGED */
  anyFlagged: boolean
  /** 是否有任何 WARNING */
  anyWarning: boolean
  /** 最高相似度 */
  maxSimilarity: number
}

/** 检测配置 */
export interface CollusionDetectorConfig {
  /** WARNING 阈值 */
  warningThreshold: number
  /** FLAGGED 阈值 */
  flaggedThreshold: number
  /** API 不可用时是否降级到 Jaccard */
  fallbackToJaccard: boolean
}

// ── 相似度计算 ──────────────────────────────────────────────────────

/**
 * 余弦相似度 — 纯 TS 实现
 *
 * cos(A, B) = (A·B) / (|A| × |B|)
 *
 * 优化: 单次遍历同时计算点积和范数
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`)
  }
  if (vecA.length === 0) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i]!
    const b = vecB[i]!
    dotProduct += a * b
    normA += a * a
    normB += b * b
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (normA * normB)
}

/**
 * Jaccard 相似度 — 降级方案
 *
 * J(A, B) = |A ∩ B| / |A ∪ B|
 *
 * 对文本进行分词 (按非单词字符分割)，转小写后计算集合相似度
 */
export function jaccardSimilarity(textA: string, textB: string): number {
  const tokenize = (text: string): Set<string> =>
    new Set(text.toLowerCase().split(/\W+/).filter(w => w.length > 0))

  const setA = tokenize(textA)
  const setB = tokenize(textB)

  if (setA.size === 0 && setB.size === 0) return 0

  let intersectionSize = 0
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++
  }

  const unionSize = setA.size + setB.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

// ── 合谋检测器 ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: CollusionDetectorConfig = {
  warningThreshold: 0.80,
  flaggedThreshold: 0.90,
  fallbackToJaccard: true,
}

/**
 * EmbeddingCollusionDetector — 基于语义相似度的合谋检测器
 *
 * 集成点: DEBATE 节点的 GovernanceGateway observe 拦截点
 */
export class EmbeddingCollusionDetector {
  private readonly config: CollusionDetectorConfig

  constructor(
    private readonly provider: IEmbeddingProvider,
    config?: Partial<CollusionDetectorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 检测两段文本的合谋程度
   */
  async detect(textA: string, textB: string): Promise<CollusionResult> {
    const t0 = Date.now()

    let similarity: number
    let method: CollusionResult['method']

    if (this.provider.isAvailable()) {
      try {
        const [embA, embB] = await Promise.all([
          this.provider.embed(textA),
          this.provider.embed(textB),
        ])
        similarity = cosineSimilarity(embA.embedding, embB.embedding)
        method = 'embedding'
      } catch {
        // 降级到 Jaccard
        if (this.config.fallbackToJaccard) {
          similarity = jaccardSimilarity(textA, textB)
          method = 'jaccard_fallback'
        } else {
          throw new Error('Embedding provider failed and fallback disabled')
        }
      }
    } else if (this.config.fallbackToJaccard) {
      similarity = jaccardSimilarity(textA, textB)
      method = 'jaccard_fallback'
    } else {
      throw new Error('Embedding provider unavailable and fallback disabled')
    }

    const status = this.classifySimilarity(similarity)
    return { similarity, status, method, durationMs: Date.now() - t0 }
  }

  /**
   * 批量检测: N 个模型输出的两两合谋矩阵
   */
  async batchDetect(
    outputs: Array<{ id: string; text: string }>,
  ): Promise<BatchCollusionResult> {
    const pairs: BatchCollusionResult['pairs'] = []
    let anyFlagged = false
    let anyWarning = false
    let maxSimilarity = 0

    // 预获取所有 embedding (优化: 减少 API 调用)
    let embeddings: Map<string, number[]> | null = null
    if (this.provider.isAvailable()) {
      try {
        const results = await Promise.all(
          outputs.map(o => this.provider.embed(o.text)),
        )
        embeddings = new Map(
          outputs.map((o, i) => [o.id, results[i]!.embedding]),
        )
      } catch {
        if (!this.config.fallbackToJaccard) {
          throw new Error('Batch embedding failed and fallback disabled')
        }
      }
    }

    // 计算两两相似度
    const t0 = Date.now()
    for (let i = 0; i < outputs.length; i++) {
      for (let j = i + 1; j < outputs.length; j++) {
        let similarity: number
        let method: CollusionResult['method']

        if (embeddings) {
          similarity = cosineSimilarity(
            embeddings.get(outputs[i]!.id)!,
            embeddings.get(outputs[j]!.id)!,
          )
          method = 'embedding'
        } else {
          similarity = jaccardSimilarity(outputs[i]!.text, outputs[j]!.text)
          method = 'jaccard_fallback'
        }

        const status = this.classifySimilarity(similarity)
        if (status === 'FLAGGED') anyFlagged = true
        if (status === 'WARNING') anyWarning = true
        if (similarity > maxSimilarity) maxSimilarity = similarity

        pairs.push({
          idA: outputs[i]!.id,
          idB: outputs[j]!.id,
          result: { similarity, status, method, durationMs: Date.now() - t0 },
        })
      }
    }

    return { pairs, anyFlagged, anyWarning, maxSimilarity }
  }

  /** 分类相似度 */
  private classifySimilarity(similarity: number): CollusionResult['status'] {
    if (similarity >= this.config.flaggedThreshold) return 'FLAGGED'
    if (similarity >= this.config.warningThreshold) return 'WARNING'
    return 'NORMAL'
  }
}
