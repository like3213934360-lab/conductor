/**
 * Antigravity Workflow Runtime — Manifest Index (BM25 历史匹配)
 *
 * 基于 minisearch 实现 Embedding-free 的历史运行匹配。
 *
 * 学术参考:
 * - Robertson & Zaragoza, "BM25 and Beyond" (2009)
 * - Zep Graphiti: temporal knowledge with validity windows
 */
import MiniSearch from 'minisearch'
import type { WasmDatabase, WasmStatement } from '../db/sqlite-client.js'

/** Manifest 条目 */
export interface ManifestEntry {
  runId: string
  goal: string
  repoRoot?: string
  files: string[]
  lane?: string
  riskLevel?: string
  worstStatus?: string
  nodeCount: number
  createdAt: string
  completedAt?: string
  summary?: string
}

/** 搜索结果 */
export interface ManifestSearchResult {
  runId: string
  score: number
  goal: string
  lane?: string
  riskLevel?: string
  createdAt: string
}

/** MiniSearch 文档 */
interface SearchDocument {
  runId: string
  goal: string
  filesText: string
  repoRoot: string
  lane?: string
  riskLevel?: string
  createdAt: string
}

/** MiniSearch 搜索结果 */
interface SearchResult {
  id: string
  score: number
  runId: string
  goal: string
  lane?: string
  riskLevel?: string
  createdAt: string
}

/**
 * Manifest 索引 — BM25 + 时间衰减
 */
export class ManifestIndex {
  private readonly db: WasmDatabase
  private readonly miniSearch: MiniSearch<SearchDocument>
  private readonly stmtInsert: WasmStatement
  private readonly stmtGetAll: WasmStatement

  /** 时间衰减半衰期（毫秒） — 默认 7 天 */
  private readonly halfLifeMs: number
  /** 2026 SOTA: WRRF 参数 */
  private readonly rrfK: number
  private readonly rrfExactWeight: number
  private readonly rrfFuzzyWeight: number
  /** 三模型审计: 索引条目上限 (防 OOM) */
  private readonly maxIndexSize: number

  /** Stopwords 过滤集 (LongRAG 2025) */
  private static readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
    'and', 'or', 'not', 'it', 'this', 'that', 'as', 'but',
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
    '都', '一', '个', '上', '也', '很', '到', '说', '要', '他',
  ])

  constructor(db: WasmDatabase, config?: { halfLifeMs?: number; rrfK?: number; rrfExactWeight?: number; rrfFuzzyWeight?: number; maxIndexSize?: number }) {
    this.db = db
    this.halfLifeMs = config?.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000
    this.rrfK = config?.rrfK ?? 60
    this.rrfExactWeight = config?.rrfExactWeight ?? 0.6
    this.rrfFuzzyWeight = config?.rrfFuzzyWeight ?? 0.4
    this.maxIndexSize = config?.maxIndexSize ?? 10000

    this.miniSearch = new MiniSearch<SearchDocument>({
      fields: ['goal', 'filesText', 'repoRoot'],
      storeFields: ['runId', 'goal', 'lane', 'riskLevel', 'createdAt'],
      idField: 'runId',
      searchOptions: {
        boost: { goal: 2, filesText: 1.5, repoRoot: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    })

    this.stmtInsert = this.db.prepare(`
      INSERT OR REPLACE INTO manifest
        (runId, goal, repoRoot, files, lane, riskLevel, worstStatus,
         nodeCount, createdAt, completedAt, summary)
      VALUES
        (@runId, @goal, @repoRoot, @files, @lane, @riskLevel, @worstStatus,
         @nodeCount, @createdAt, @completedAt, @summary)
    `)

    this.stmtGetAll = this.db.prepare(`
      SELECT runId, goal, repoRoot, files, lane, riskLevel, worstStatus,
             nodeCount, createdAt, completedAt, summary
      FROM manifest
      ORDER BY createdAt DESC
    `)

    this.rebuildIndex()
  }

  /** 索引新条目 */
  index(entry: ManifestEntry): void {
    // 架构优化: 仅在新增条目 (非更新) 时检查容量
    // 避免 INSERT OR REPLACE 更新已有记录时不必要地淘汰旧条目
    this.enforceCapacity(entry.runId)

    this.stmtInsert.run({
      runId: entry.runId,
      goal: entry.goal,
      repoRoot: entry.repoRoot ?? null,
      files: JSON.stringify(entry.files),
      lane: entry.lane ?? null,
      riskLevel: entry.riskLevel ?? null,
      worstStatus: entry.worstStatus ?? null,
      nodeCount: entry.nodeCount,
      createdAt: entry.createdAt,
      completedAt: entry.completedAt ?? null,
      summary: entry.summary ?? null,
    })

    const doc = this.entryToDocument(entry)
    try {
      this.miniSearch.replace(doc)
    } catch {
      this.miniSearch.add(doc)
    }
  }

  /**
   * 搜索历史运行 — 2026 SOTA: WRRF Hybrid Retrieval
   *
   * 双路检索 + 加权 RRF 融合 + 时间衰减:
   * 1. BM25 精确匹配 (权重 w_exact=0.6)
   * 2. Fuzzy 模糊匹配 (权重 w_fuzzy=0.4)
   * 3. WRRF: score = w_i / (k + rank + 1)
   * 4. 时间衰减 (半衰期 7 天)
   * 5. Query rewriting: stopword 过滤 (LongRAG 2025)
   *
   * 2026 科研参考:
   * - Cormack et al., "Reciprocal Rank Fusion" (SIGIR 2009)
   * - LongRAG (2025): “retriever weighting for hybrid search”
   * - ColBERT v3 (2025): late-interaction re-ranking
   */
  search(query: string, topK: number = 5): ManifestSearchResult[] {
    const now = Date.now()
    const lambda = Math.LN2 / this.halfLifeMs
    const k = this.rrfK

    // 2026 SOTA: Query Rewriting — stopword 过滤 (LongRAG 2025)
    const cleanedQuery = this.rewriteQuery(query)
    if (!cleanedQuery) return []

    // 路 1: BM25 精确匹配 (高精度)
    const exactResults = this.miniSearch.search(cleanedQuery, {
      prefix: false,
      fuzzy: false,
    }) as unknown as SearchResult[]

    // 路 2: Fuzzy 模糊匹配 (高召回)
    const fuzzyResults = this.miniSearch.search(cleanedQuery, {
      prefix: true,
      fuzzy: 0.3,
    }) as unknown as SearchResult[]

    // WRRF 融合 (2026 SOTA: 加权 RRF, k=60)
    const rrfScores = new Map<string, { score: number; result: SearchResult }>()

    // 路 1 WRRF 贡献 (w_exact)
    for (let rank = 0; rank < exactResults.length; rank++) {
      const r = exactResults[rank]!
      const rrf = this.rrfExactWeight / (k + rank + 1)
      const existing = rrfScores.get(r.runId)
      if (existing) {
        existing.score += rrf
      } else {
        rrfScores.set(r.runId, { score: rrf, result: r })
      }
    }

    // 路 2 WRRF 贡献 (w_fuzzy)
    for (let rank = 0; rank < fuzzyResults.length; rank++) {
      const r = fuzzyResults[rank]!
      const rrf = this.rrfFuzzyWeight / (k + rank + 1)
      const existing = rrfScores.get(r.runId)
      if (existing) {
        existing.score += rrf
      } else {
        rrfScores.set(r.runId, { score: rrf, result: r })
      }
    }

    // 时间衰减 + 最终排序
    return Array.from(rrfScores.values())
      .map(({ score: rrfScore, result }) => {
        const createdAt = new Date(result.createdAt).getTime()
        // 防御性 NaN + 未来时间边界
        const age = (Number.isFinite(createdAt) && createdAt <= now)
          ? now - createdAt
          : 0
        const decay = age > 0 ? Math.exp(-lambda * age) : 1
        const finalScore = rrfScore * decay

        return {
          runId: result.runId,
          score: Number.isFinite(finalScore) ? finalScore : 0,
          goal: result.goal,
          lane: result.lane,
          riskLevel: result.riskLevel,
          createdAt: result.createdAt,
        }
      })
      .sort((a: ManifestSearchResult, b: ManifestSearchResult) => b.score - a.score)
      .slice(0, topK)
  }

  /** 从 SQLite 重建内存索引 (三模型审计: 仅加载最新 maxIndexSize 条) */
  private rebuildIndex(): void {
    const rows = this.db.prepare(`
      SELECT runId, goal, repoRoot, files, lane, riskLevel, worstStatus,
             nodeCount, createdAt, completedAt, summary
      FROM manifest
      ORDER BY createdAt DESC
      LIMIT @limit
    `).all({ limit: this.maxIndexSize }) as unknown as ManifestRow[]
    const docs = rows.map(row => this.rowToDocument(row))
    if (docs.length > 0) {
      this.miniSearch.addAll(docs)
    }
  }

  /**
   * 架构优化: 容量保护 — 仅在新增条目时淘汰
   *
   * INSERT OR REPLACE 更新已有记录时不增加净容量, 跳过淘汰
   * 策略: 当索引 >= maxIndexSize 时, 删除最旧的 10% 条目
   */
  private enforceCapacity(runId: string): void {
    if (this.miniSearch.documentCount < this.maxIndexSize) return

    // 架构优化: 如果 runId 已存在, 是更新操作, 不增加净容量
    const existing = this.db.prepare(
      'SELECT 1 FROM manifest WHERE runId = @runId LIMIT 1'
    ).get({ runId }) as Record<string, unknown> | undefined
    if (existing) return

    const evictCount = Math.max(1, Math.floor(this.maxIndexSize * 0.1))
    const oldest = this.db.prepare(`
      SELECT runId FROM manifest
      ORDER BY createdAt ASC
      LIMIT @evictCount
    `).all({ evictCount }) as Array<{ runId: string }>

    for (const row of oldest) {
      try {
        this.miniSearch.discard(row.runId)
      } catch {
        // 条目可能已不在索引中
      }
      this.db.prepare('DELETE FROM manifest WHERE runId = @runId').run({ runId: row.runId })
    }

    // vacuum 内部数据结构
    this.miniSearch.vacuum()
  }

  private entryToDocument(entry: ManifestEntry): SearchDocument {
    return {
      runId: entry.runId,
      goal: entry.goal,
      filesText: entry.files.join(' '),
      repoRoot: entry.repoRoot ?? '',
      lane: entry.lane,
      riskLevel: entry.riskLevel,
      createdAt: entry.createdAt,
    }
  }

  private rowToDocument(row: ManifestRow): SearchDocument {
    const files: string[] = row.files ? JSON.parse(row.files) : []
    return {
      runId: row.runId,
      goal: row.goal,
      filesText: files.join(' '),
      repoRoot: row.repoRoot ?? '',
      lane: row.lane ?? undefined,
      riskLevel: row.riskLevel ?? undefined,
      createdAt: row.createdAt,
    }
  }

  /**
   * 2026 SOTA: Query Rewriting — stopword 过滤
   *
   * 参考: LongRAG (2025) “query decomposition and cleaning”
   */
  private rewriteQuery(query: string): string {
    const tokens = query
      .split(/[\s,.，。]+/)
      .filter(t => t.length > 1 && !ManifestIndex.STOP_WORDS.has(t.toLowerCase()))
    return tokens.join(' ')
  }
}

/** 数据库行类型 */
interface ManifestRow {
  runId: string
  goal: string
  repoRoot: string | null
  files: string | null
  lane: string | null
  riskLevel: string | null
  worstStatus: string | null
  nodeCount: number
  createdAt: string
  completedAt: string | null
  summary: string | null
}
