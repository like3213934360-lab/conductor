/**
 * Conductor AGC — Manifest Index (BM25 历史匹配)
 *
 * 基于 minisearch 实现 Embedding-free 的历史运行匹配。
 *
 * 学术参考:
 * - Robertson & Zaragoza, "BM25 and Beyond" (2009)
 * - Zep Graphiti: temporal knowledge with validity windows
 */
import MiniSearch from 'minisearch'
import type Database from 'better-sqlite3'

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
  private readonly db: Database.Database
  private readonly miniSearch: MiniSearch<SearchDocument>
  private readonly stmtInsert: Database.Statement
  private readonly stmtGetAll: Database.Statement

  /** 时间衰减半衰期（毫秒） — 默认 7 天 */
  private readonly halfLifeMs: number = 7 * 24 * 60 * 60 * 1000

  constructor(db: Database.Database) {
    this.db = db

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
        (run_id, goal, repo_root, files, lane, risk_level, worst_status,
         node_count, created_at, completed_at, summary)
      VALUES
        (@runId, @goal, @repoRoot, @files, @lane, @riskLevel, @worstStatus,
         @nodeCount, @createdAt, @completedAt, @summary)
    `)

    this.stmtGetAll = this.db.prepare(`
      SELECT run_id, goal, repo_root, files, lane, risk_level, worst_status,
             node_count, created_at, completed_at, summary
      FROM manifest
      ORDER BY created_at DESC
    `)

    this.rebuildIndex()
  }

  /** 索引新条目 */
  index(entry: ManifestEntry): void {
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
   * 搜索历史运行 — BM25 + 时间衰减
   */
  search(query: string, topK: number = 5): ManifestSearchResult[] {
    const now = Date.now()
    const lambda = Math.LN2 / this.halfLifeMs

    const rawResults = this.miniSearch.search(query)

    const results = rawResults as unknown as SearchResult[]

    return results
      .map((result: SearchResult) => {
        const createdAt = new Date(result.createdAt).getTime()
        const age = now - createdAt
        const decay = Math.exp(-lambda * age)
        const decayedScore = result.score * decay

        return {
          runId: result.runId,
          score: decayedScore,
          goal: result.goal,
          lane: result.lane,
          riskLevel: result.riskLevel,
          createdAt: result.createdAt,
        }
      })
      .sort((a: ManifestSearchResult, b: ManifestSearchResult) => b.score - a.score)
      .slice(0, topK)
  }

  /** 从 SQLite 重建内存索引 */
  private rebuildIndex(): void {
    const rows = this.stmtGetAll.all() as ManifestRow[]
    const docs = rows.map(row => this.rowToDocument(row))
    if (docs.length > 0) {
      this.miniSearch.addAll(docs)
    }
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
      runId: row.run_id,
      goal: row.goal,
      filesText: files.join(' '),
      repoRoot: row.repo_root ?? '',
      lane: row.lane ?? undefined,
      riskLevel: row.risk_level ?? undefined,
      createdAt: row.created_at,
    }
  }
}

/** 数据库行类型 */
interface ManifestRow {
  run_id: string
  goal: string
  repo_root: string | null
  files: string | null
  lane: string | null
  risk_level: string | null
  worst_status: string | null
  node_count: number
  created_at: string
  completed_at: string | null
  summary: string | null
}
