/**
 * Conductor Hub Core — Token 预算管理器 (Paged Context Manager)
 *
 * AGC v8.0: MemGPT 风格的内存分页 — 硬预算 + 语义相关性排序 + 主动分页工具
 *
 * 设计参考:
 * - MemGPT (UC Berkeley): 虚拟上下文管理 + 内存分页 + LLM-driven paging
 * - LlamaIndex: 渐进式上下文加载 + 语义检索
 * - DSPy Compiling: prompt 自动优化
 * - BM25/TF-IDF: 信息检索经典算法
 *
 * v8.0 新增:
 * 1. TF-IDF 语义相关性排序 (无需向量数据库)
 * 2. 查询感知的上下文加载
 * 3. 时序衰减优先级 (最近修改的文件更重要)
 * 4. 主动分页工具定义 (供 LLM 调用)
 * 5. 多维综合排序 (语义 × 大小 × 时序)
 */

import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, extname } from 'path'

// ── 配置 ──────────────────────────────────────────────────────────────────────

export interface TokenBudgetConfig {
  /** 全局 Token 上限 */
  globalLimit: number
  /** 每节点 Token 上限 */
  perNodeLimit: number
  /** 超出策略 */
  strategy: 'truncate' | 'page_memgpt' | 'summarize'
  /** 语义权重 (0-1) */
  semanticWeight: number
  /** 时序权重 (0-1) */
  recencyWeight: number
  /** 大小权重 (0-1) */
  sizeWeight: number
}

export const DEFAULT_TOKEN_BUDGET: TokenBudgetConfig = {
  globalLimit: 8000,
  perNodeLimit: 2000,
  strategy: 'page_memgpt',
  semanticWeight: 0.5,
  recencyWeight: 0.3,
  sizeWeight: 0.2,
}

// ── Token 估算 ────────────────────────────────────────────────────────────────

/**
 * 估算文本 Token 数
 * ASCII: 4 字符/token, 非 ASCII: 2 字符/token
 */
export function estimateTokens(text: string): number {
  let ascii = 0, nonAscii = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 127) ascii++
    else nonAscii++
  }
  return Math.ceil(ascii / 4 + nonAscii / 2)
}

// ── TF-IDF 语义相关性引擎 ────────────────────────────────────────────────────

/** 词频统计 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_\-/\.]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && t.length < 50)
}

/** 计算 TF (词频) */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1)
  }
  // 归一化
  const max = Math.max(...tf.values(), 1)
  for (const [k, v] of tf) {
    tf.set(k, v / max)
  }
  return tf
}

/** 计算 IDF (逆文档频率) */
function computeIDF(
  queryTerms: string[],
  documents: Array<{ tokens: string[] }>,
): Map<string, number> {
  const idf = new Map<string, number>()
  const N = documents.length || 1

  for (const term of queryTerms) {
    const df = documents.filter(doc =>
      doc.tokens.includes(term)
    ).length
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1) // smoothed IDF
  }
  return idf
}

/**
 * 计算文档与查询的 TF-IDF 相似度
 */
function tfidfSimilarity(
  queryTerms: string[],
  docTF: Map<string, number>,
  idf: Map<string, number>,
): number {
  let score = 0
  for (const term of queryTerms) {
    const tf = docTF.get(term) ?? 0
    const idfVal = idf.get(term) ?? 1
    score += tf * idfVal
  }
  // 归一化
  return queryTerms.length > 0 ? score / queryTerms.length : 0
}

// ── 分页上下文结果 ────────────────────────────────────────────────────────────

export interface PagedContextResult {
  /** 主上下文（已加载的文件内容） */
  activeContext: string
  /** 已加载文件列表 (按相关性排序) */
  loadedFiles: string[]
  /** 被驱逐到回忆区的文件 */
  pagedOutFiles: string[]
  /** 实际使用的 Token 数 */
  tokenCount: number
  /** 是否超出预算 */
  budgetExceeded: boolean
  /** 每个文件的相关性分数 */
  relevanceScores: Record<string, number>
}

export interface RecallEntry {
  /** 文件路径 */
  filePath: string
  /** 文件内容 (完整) */
  content: string
  /** Token 数 */
  tokens: number
  /** 驱逐时间 */
  evictedAt: string
  /** 语义相关性分数 */
  relevanceScore: number
}

// ── 主动分页工具定义 (供 LLM 调用) ────────────────────────────────────────────

/**
 * MemGPT 风格的主动分页工具定义
 *
 * 这些工具定义可以注入到 LLM 的可用工具列表中，
 * 让 LLM 自主决定何时把回忆区的文件拉回主上下文。
 */
export const PAGING_TOOL_DEFINITIONS = [
  {
    name: 'recall_file',
    description: 'Load a previously evicted file back into active context. Use when you need information from a file that was paged out due to token budget.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path of the file to recall from memory',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'evict_file',
    description: 'Remove a file from active context to make room for other files. Use when a file is no longer relevant to the current task.',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path of the file to evict from active context',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'search_recall_memory',
    description: 'Search through paged-out files to find relevant content without loading them fully. Returns matching file paths and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant content in evicted files',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
] as const

// ── 分页上下文管理器 ──────────────────────────────────────────────────────────

/**
 * PagedContextManager — MemGPT 风格的语义感知上下文管理
 *
 * v8.0 升级: 多维综合排序 (语义 × 大小 × 时序)
 */
export class PagedContextManager {
  private readonly config: TokenBudgetConfig
  /** 回忆区 (模拟外部存储) */
  private readonly recallMemory: Map<string, RecallEntry> = new Map()
  /** 全局已使用 Token 数 (跨多次 loadContext 调用追踪) */
  private globalTokensUsed: number = 0

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_TOKEN_BUDGET, ...config }
  }

  /** 获取全局剩余 Token 预算 */
  getRemainingGlobalBudget(): number {
    return Math.max(0, this.config.globalLimit - this.globalTokensUsed)
  }

  /** 重置全局 Token 计数器 (新运行开始时调用) */
  resetGlobalBudget(): void {
    this.globalTokensUsed = 0
  }

  /**
   * 按 Token 预算 + 语义相关性加载文件上下文
   *
   * v8.0 策略:
   * 1. 计算 TF-IDF 语义相关性分数
   * 2. 计算时序衰减分数 (最近修改的文件更重要)
   * 3. 计算大小分数 (小文件信息密度更高)
   * 4. 综合三维排序
   * 5. 按排序结果逐个加载，直到预算耗尽
   * 6. 超出部分驱逐到回忆区 (带相关性分数，便于后续召回)
   */
  async loadContext(
    filePaths: string[],
    options?: {
      budget?: number
      query?: string
      taskGoal?: string
    },
  ): Promise<PagedContextResult> {
    const perNodeMax = options?.budget ?? this.config.perNodeLimit
    // 同时受全局预算约束
    const globalRemaining = this.config.globalLimit - this.globalTokensUsed
    const maxTokens = Math.min(perNodeMax, globalRemaining)
    const query = options?.query ?? options?.taskGoal ?? ''

    // ── 1. 读取所有文件 ──
    const fileEntries: Array<{
      path: string
      content: string
      tokens: number
      modifiedAt: number
      tokens_list: string[]
    }> = []

    for (const fp of filePaths) {
      try {
        if (!existsSync(fp)) continue
        const content = await readFile(fp, 'utf-8')
        const tokens = estimateTokens(content)
        let modifiedAt = Date.now()
        try {
          const s = await stat(fp)
          modifiedAt = s.mtimeMs
        } catch { /* use now */ }

        fileEntries.push({
          path: fp,
          content,
          tokens,
          modifiedAt,
          tokens_list: tokenize(content + ' ' + basename(fp, extname(fp))),
        })
      } catch {
        // 跳过不可读文件
      }
    }

    if (fileEntries.length === 0) {
      return {
        activeContext: '',
        loadedFiles: [],
        pagedOutFiles: [],
        tokenCount: 0,
        budgetExceeded: false,
        relevanceScores: {},
      }
    }

    // ── 2. 计算 TF-IDF 语义相关性 ──
    const queryTerms = tokenize(query)
    const idf = computeIDF(queryTerms, fileEntries.map(f => ({ tokens: f.tokens_list })))

    const semanticScores = new Map<string, number>()
    for (const entry of fileEntries) {
      const docTF = computeTF(entry.tokens_list)
      const score = query.length > 0
        ? tfidfSimilarity(queryTerms, docTF, idf)
        : 0
      semanticScores.set(entry.path, score)
    }

    // ── 3. 计算时序衰减 ──
    const now = Date.now()
    const ages = fileEntries.map(f => now - f.modifiedAt)
    const maxAge = Math.max(...ages, 1)
    const recencyScores = new Map<string, number>()
    for (const entry of fileEntries) {
      const age = now - entry.modifiedAt
      // 单文件情况: 给默认分 0.5 而非退化为 0
      recencyScores.set(entry.path, fileEntries.length === 1 ? 0.5 : 1 - (age / maxAge))
    }

    // ── 4. 计算大小分数 (小文件优先) ──
    const maxTokenCount = Math.max(...fileEntries.map(f => f.tokens), 1)
    const sizeScores = new Map<string, number>()
    for (const entry of fileEntries) {
      // 单文件情况: 给默认分 0.5
      sizeScores.set(entry.path, fileEntries.length === 1 ? 0.5 : 1 - (entry.tokens / maxTokenCount))
    }

    // ── 5. 综合排序 ──
    const { semanticWeight, recencyWeight, sizeWeight } = this.config
    const totalWeight = semanticWeight + recencyWeight + sizeWeight

    const compositeScores = new Map<string, number>()
    for (const entry of fileEntries) {
      const semantic = semanticScores.get(entry.path) ?? 0
      const recency = recencyScores.get(entry.path) ?? 0
      const size = sizeScores.get(entry.path) ?? 0

      // 归一化语义分数到 [0,1] — IDF 可能超过 1
      const maxSemantic = Math.max(...Array.from(semanticScores.values()), 1)
      const normalizedSemantic = maxSemantic > 0 ? semantic / maxSemantic : 0

      const composite = (
        normalizedSemantic * semanticWeight +
        recency * recencyWeight +
        size * sizeWeight
      ) / totalWeight

      compositeScores.set(entry.path, composite)
    }

    // 按综合分数降序排列
    fileEntries.sort((a, b) =>
      (compositeScores.get(b.path) ?? 0) - (compositeScores.get(a.path) ?? 0)
    )

    // ── 6. 按预算加载 ──
    const loaded: typeof fileEntries = []
    const pagedOut: string[] = []
    let totalTokens = 0

    for (const file of fileEntries) {
      if (totalTokens + file.tokens <= maxTokens) {
        loaded.push(file)
        totalTokens += file.tokens
      } else {
        pagedOut.push(file.path)
        this.recallMemory.set(file.path, {
          filePath: file.path,
          content: file.content,
          tokens: file.tokens,
          evictedAt: new Date().toISOString(),
          relevanceScore: compositeScores.get(file.path) ?? 0,
        })
      }
    }

    // Truncate 或 page_memgpt 策略: 如果最高优先文件超出预算，截断它
    if (loaded.length === 0 && fileEntries.length > 0) {
      const first = fileEntries[0]!
      const truncatedContent = truncateToTokens(first.content, maxTokens)
      const usedTokens = Math.min(first.tokens, maxTokens)
      this.globalTokensUsed += usedTokens
      return {
        activeContext: `--- ${first.path} (truncated to ${maxTokens} tokens) ---\n${truncatedContent}`,
        loadedFiles: [first.path],
        pagedOutFiles: fileEntries.slice(1).map(f => f.path),
        tokenCount: usedTokens,
        budgetExceeded: true,
        relevanceScores: Object.fromEntries(compositeScores),
      }
    }

    // 构建上下文字符串 (带相关性分数标注)
    const contextParts = loaded.map(f => {
      const score = compositeScores.get(f.path) ?? 0
      return `--- ${f.path} (${f.tokens} tokens, relevance: ${score.toFixed(3)}) ---\n${f.content}`
    })
    const activeContext = contextParts.join('\n\n')

    // 更新全局 Token 计数器
    this.globalTokensUsed += totalTokens

    return {
      activeContext,
      loadedFiles: loaded.map(f => f.path),
      pagedOutFiles: pagedOut,
      tokenCount: totalTokens,
      budgetExceeded: pagedOut.length > 0,
      relevanceScores: Object.fromEntries(compositeScores),
    }
  }

  /**
   * 从回忆区召回文件 (MemGPT page-in)
   */
  recallFile(filePath: string): RecallEntry | undefined {
    return this.recallMemory.get(filePath)
  }

  /**
   * 主动驱逐文件到回忆区 (MemGPT page-out)
   */
  evictFile(filePath: string, content: string, tokens: number): void {
    this.recallMemory.set(filePath, {
      filePath,
      content,
      tokens,
      evictedAt: new Date().toISOString(),
      relevanceScore: 0,
    })
  }

  /**
   * 搜索回忆区 — TF-IDF 查询匹配
   *
   * 让 LLM 不用加载全部内容就能搜索被驱逐的文件
   */
  searchRecallMemory(query: string, maxResults: number = 5): Array<{
    filePath: string
    relevance: number
    snippet: string
    tokens: number
  }> {
    const queryTerms = tokenize(query)
    const entries = Array.from(this.recallMemory.values())

    if (entries.length === 0 || queryTerms.length === 0) return []

    // 计算 IDF
    const documents = entries.map(e => ({ tokens: tokenize(e.content) }))
    const idf = computeIDF(queryTerms, documents)

    // 计算每个文件的相关性
    const scored = entries.map(entry => {
      const docTokens = tokenize(entry.content)
      const docTF = computeTF(docTokens)
      const relevance = tfidfSimilarity(queryTerms, docTF, idf)

      // 提取最佳片段
      const lines = entry.content.split('\n')
      let bestLine = ''
      let bestScore = 0
      for (const line of lines) {
        const lineTokens = tokenize(line)
        const lineScore = queryTerms.filter(t => lineTokens.includes(t)).length
        if (lineScore > bestScore) {
          bestScore = lineScore
          bestLine = line.trim()
        }
      }

      return {
        filePath: entry.filePath,
        relevance,
        snippet: bestLine.slice(0, 200),
        tokens: entry.tokens,
      }
    })

    return scored
      .filter(s => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults)
  }

  /**
   * 获取回忆区所有条目
   */
  getRecallMemory(): RecallEntry[] {
    return Array.from(this.recallMemory.values())
  }

  /**
   * 清理回忆区
   */
  clearRecallMemory(): void {
    this.recallMemory.clear()
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<TokenBudgetConfig> {
    return this.config
  }

  /**
   * 获取主动分页工具定义 (注入到 LLM 工具列表)
   */
  getPagingToolDefinitions(): typeof PAGING_TOOL_DEFINITIONS {
    return PAGING_TOOL_DEFINITIONS
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/**
 * 截断文本到指定 Token 数
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const estimatedChars = maxTokens * 3
  if (text.length <= estimatedChars) return text
  return text.slice(0, estimatedChars) + '\n... [截断: 超出 Token 预算]'
}
