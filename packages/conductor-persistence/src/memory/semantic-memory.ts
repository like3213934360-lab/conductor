/**
 * Conductor AGC — 语义记忆 (Semantic Memory)
 *
 * 长期知识: 跨运行的事实图谱，使用关系型时序知识表示。
 *
 * 参考:
 * - Zep/Graphiti: temporal knowledge graphs with validity windows
 * - 设计决策: 使用 SQLite 关系表代替图数据库，
 *   用 (subject, predicate, object, valid_from, valid_to) 表示时序知识
 */
import type Database from 'better-sqlite3'

/** 语义事实 */
export interface SemanticFact {
  factId?: number
  subject: string
  predicate: string
  object: string
  confidence: number
  sourceRunId?: string
  validFrom: string
  validTo?: string
}

/** 事实查询 */
export interface FactQuery {
  subject?: string
  predicate?: string
  /** 只返回在此时间点有效的事实 */
  asOf?: string
  limit?: number
}

/**
 * 语义记忆 — 关系型时序知识图
 */
export class SemanticMemory {
  private readonly db: Database.Database
  private readonly stmtInsert: Database.Statement
  private readonly stmtInvalidate: Database.Statement

  constructor(db: Database.Database) {
    this.db = db

    this.stmtInsert = this.db.prepare(`
      INSERT INTO semantic_facts
        (subject, predicate, object, confidence, source_run_id, valid_from, valid_to, created_at)
      VALUES
        (@subject, @predicate, @object, @confidence, @sourceRunId, @validFrom, @validTo, @createdAt)
    `)

    this.stmtInvalidate = this.db.prepare(`
      UPDATE semantic_facts
      SET valid_to = @validTo
      WHERE subject = @subject AND predicate = @predicate AND valid_to IS NULL
    `)
  }

  /**
   * 记录新事实
   *
   * 如果已存在同一 subject+predicate 的活跃事实，
   * 先将其 valid_to 设为当前时间（关闭旧版本），再插入新版本。
   * 这实现了 Zep 风格的 temporal knowledge versioning。
   */
  recordFact(fact: SemanticFact): void {
    this.db.transaction(() => {
      // 关闭旧版本
      this.stmtInvalidate.run({
        subject: fact.subject,
        predicate: fact.predicate,
        validTo: fact.validFrom,
      })

      // 插入新版本
      this.stmtInsert.run({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence,
        sourceRunId: fact.sourceRunId ?? null,
        validFrom: fact.validFrom,
        validTo: fact.validTo ?? null,
        createdAt: new Date().toISOString(),
      })
    })()
  }

  /**
   * 查询事实
   *
   * 支持按 subject、predicate 过滤，并可指定时间点查询。
   */
  queryFacts(query: FactQuery): SemanticFact[] {
    const conditions: string[] = []
    const params: Record<string, unknown> = {}

    if (query.subject) {
      conditions.push('subject = @subject')
      params.subject = query.subject
    }

    if (query.predicate) {
      conditions.push('predicate = @predicate')
      params.predicate = query.predicate
    }

    if (query.asOf) {
      conditions.push('valid_from <= @asOf AND (valid_to IS NULL OR valid_to > @asOf)')
      params.asOf = query.asOf
    } else {
      // 默认只查活跃的事实
      conditions.push('valid_to IS NULL')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = query.limit ?? 50

    const stmt = this.db.prepare(`
      SELECT fact_id, subject, predicate, object, confidence,
             source_run_id, valid_from, valid_to
      FROM semantic_facts
      ${where}
      ORDER BY confidence DESC, valid_from DESC
      LIMIT ${limit}
    `)

    const rows = stmt.all(params) as FactRow[]
    return rows.map(row => ({
      factId: row.fact_id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      sourceRunId: row.source_run_id ?? undefined,
      validFrom: row.valid_from,
      validTo: row.valid_to ?? undefined,
    }))
  }

  /**
   * 从运行结果中提取事实
   *
   * 例如: "文件 auth.ts 总是触发高风险评估"
   */
  extractFromRun(runId: string, riskLevel: string, files: string[], timestamp: string): void {
    // 如果是高风险运行，为每个文件记录风险关联事实
    if (riskLevel === 'high' || riskLevel === 'critical') {
      for (const file of files) {
        this.recordFact({
          subject: file,
          predicate: 'triggers_risk',
          object: riskLevel,
          confidence: 0.8,
          sourceRunId: runId,
          validFrom: timestamp,
        })
      }
    }
  }

  // ─── 科研升级 E: MemGPT eviction 接口 ──────────────

  /**
   * 统计活跃事实数量
   *
   * MemGPT 预算检查使用
   */
  count(): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM semantic_facts WHERE valid_to IS NULL',
    ).get() as { cnt: number }
    return row.cnt
  }

  /**
   * 淘汰最旧的 N 条活跃事实 — LRU 策略
   *
   * 科研参考: Packer 2023, MemGPT Section 4.2
   * "When the working context is full, the system
   * evicts the least recently used memory pages"
   *
   * 实现: 关闭最旧的 N 条活跃事实 (设置 valid_to)
   */
  evictOldest(n: number): number {
    const result = this.db.prepare(`
      UPDATE semantic_facts
      SET valid_to = ?
      WHERE fact_id IN (
        SELECT fact_id FROM semantic_facts
        WHERE valid_to IS NULL
        ORDER BY valid_from ASC
        LIMIT ?
      )
    `).run(new Date().toISOString(), n)

    return result.changes
  }

  /**
   * 合并相同 subject+predicate 的事实 — 去重压缩
   *
   * 科研参考: Packer 2023, MemGPT Section 4.3
   * "Compaction merges overlapping memory entries"
   *
   * 策略: 保留置信度最高的事实，关闭其余
   */
  compact(): number {
    // 找出有多个活跃版本的 subject+predicate 组合
    const duplicates = this.db.prepare(`
      SELECT subject, predicate, COUNT(*) as cnt
      FROM semantic_facts
      WHERE valid_to IS NULL
      GROUP BY subject, predicate
      HAVING cnt > 1
    `).all() as Array<{ subject: string; predicate: string; cnt: number }>

    let compacted = 0
    const now = new Date().toISOString()

    for (const dup of duplicates) {
      // 保留置信度最高的，关闭其余
      const result = this.db.prepare(`
        UPDATE semantic_facts
        SET valid_to = ?
        WHERE subject = ? AND predicate = ? AND valid_to IS NULL
          AND fact_id NOT IN (
            SELECT fact_id FROM semantic_facts
            WHERE subject = ? AND predicate = ? AND valid_to IS NULL
            ORDER BY confidence DESC
            LIMIT 1
          )
      `).run(now, dup.subject, dup.predicate, dup.subject, dup.predicate)

      compacted += result.changes
    }

    return compacted
  }
}

/** 数据库行类型 */
interface FactRow {
  fact_id: number
  subject: string
  predicate: string
  object: string
  confidence: number
  source_run_id: string | null
  valid_from: string
  valid_to: string | null
}
