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

/** 语义事实 — 2026 SOTA: importance + pinning */
export interface SemanticFact {
  factId?: number
  subject: string
  predicate: string
  object: string
  confidence: number
  /** 2026 SOTA: 重要度分 (Generative Agents 2025: Importance Scoring) */
  importance: number
  /** 2026 SOTA: 是否固定 (不可淘汰, MemGPT 2023: critical memory) */
  pinned: boolean
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
        (subject, predicate, object, confidence, importance, pinned, source_run_id, valid_from, valid_to, created_at)
      VALUES
        (@subject, @predicate, @object, @confidence, @importance, @pinned, @sourceRunId, @validFrom, @validTo, @createdAt)
    `)

    this.stmtInvalidate = this.db.prepare(`
      UPDATE semantic_facts
      SET valid_to = @validTo
      WHERE subject = @subject AND predicate = @predicate AND valid_to IS NULL
    `)

    // 审计修复 #1: 添加 last_accessed_at 列支持真正的 LRU
    // 2026 SOTA: 添加 importance + pinned 列
    for (const col of [
      'last_accessed_at TEXT',
      'importance REAL NOT NULL DEFAULT 0.5',
      'pinned INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.exec(`ALTER TABLE semantic_facts ADD COLUMN ${col}`)
      } catch (err: unknown) {
        // 三模型审计: 只忽略 duplicate column 错误，其他错误重新抛出
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('duplicate column')) {
          throw err
        }
      }
    }
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

      // 插入新版本 (三模型审计: 含 importance + pinned)
      this.stmtInsert.run({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        confidence: fact.confidence,
        importance: fact.importance ?? 0.5,
        pinned: fact.pinned ? 1 : 0,
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
    // 三模型审计 R2 (Codex P1): LIMIT 正整数钳制，防止负值/超大值 DoS
    const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 50)))
    params.limit = limit

    const stmt = this.db.prepare(`
      SELECT fact_id, subject, predicate, object, confidence,
             importance, pinned,
             source_run_id, valid_from, valid_to
      FROM semantic_facts
      ${where}
      ORDER BY confidence DESC, valid_from DESC
      LIMIT @limit
    `)

    const rows = stmt.all(params) as FactRow[]

    // 审计修复 #1: 更新访问时间 (LRU 追踪)
    if (rows.length > 0) {
      const factIds = rows.map(r => r.fact_id)
      const placeholders = factIds.map(() => '?').join(',')
      this.db.prepare(
        `UPDATE semantic_facts SET last_accessed_at = ? WHERE fact_id IN (${placeholders})`,
      ).run(new Date().toISOString(), ...factIds)
    }

    return rows.map(row => ({
      factId: row.fact_id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      importance: row.importance ?? 0.5,
      pinned: !!(row.pinned),
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
          importance: riskLevel === 'critical' ? 0.9 : 0.7,
          pinned: false,
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
   * 淘汰最少使用的 N 条活跃事实 — 真正的 LRU 策略
   *
   * 2026 SOTA:
   * - LRU 排序 (COALESCE(last_accessed_at, valid_from) ASC)
   * - 排除 pinned 事实 (关键记忆保护, MemGPT 2023)
   * - 低重要度事实优先淘汰 (Generative Agents 2025)
   *
   * 科研参考: Packer 2023, MemGPT Section 4.2
   */
  evictOldest(n: number): number {
    const result = this.db.prepare(`
      UPDATE semantic_facts
      SET valid_to = ?
      WHERE fact_id IN (
        SELECT fact_id FROM semantic_facts
        WHERE valid_to IS NULL AND pinned = 0
        ORDER BY importance ASC, COALESCE(last_accessed_at, valid_from) ASC
        LIMIT ?
      )
    `).run(new Date().toISOString(), n)

    return result.changes
  }

  /**
   * 2026 SOTA: 固定关键记忆 (不可淘汰)
   *
   * 参考: Packer 2023 MemGPT "critical memories are pinned"
   */
  pinFact(factId: number): void {
    this.db.prepare(`UPDATE semantic_facts SET pinned = 1 WHERE fact_id = ?`).run(factId)
  }

  unpinFact(factId: number): void {
    this.db.prepare(`UPDATE semantic_facts SET pinned = 0 WHERE fact_id = ?`).run(factId)
  }

  /**
   * 2026 SOTA: 更新事实重要度
   *
   * 参考: Generative Agents 2025 "Importance Scores"
   */
  updateImportance(factId: number, importance: number): void {
    const clamped = Math.max(0, Math.min(1, importance))
    this.db.prepare(`UPDATE semantic_facts SET importance = ? WHERE fact_id = ?`).run(clamped, factId)
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
  importance: number
  pinned: number
  source_run_id: string | null
  valid_from: string
  valid_to: string | null
}
