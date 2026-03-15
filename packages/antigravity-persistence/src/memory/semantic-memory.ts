/**
 * Antigravity Workflow Runtime — 语义记忆 (Semantic Memory)
 *
 * 长期知识: 跨运行的事实图谱，使用关系型时序知识表示。
 *
 * 参考:
 * - Zep/Graphiti: temporal knowledge graphs with validity windows
 * - 设计决策: 使用 SQLite 关系表代替图数据库，
 *   用 (subject, predicate, object, validFrom, validTo) 表示时序知识
 */
import type { WasmDatabase, WasmStatement } from '../db/sqlite-client.js'

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
  private readonly db: WasmDatabase
  private readonly stmtInsert: WasmStatement
  private readonly stmtInvalidate: WasmStatement

  constructor(db: WasmDatabase) {
    this.db = db

    this.stmtInsert = this.db.prepare(`
      INSERT INTO semanticFacts
        (subject, predicate, object, confidence, importance, pinned, sourceRunId, validFrom, validTo, createdAt)
      VALUES
        (@subject, @predicate, @object, @confidence, @importance, @pinned, @sourceRunId, @validFrom, @validTo, @createdAt)
    `)

    this.stmtInvalidate = this.db.prepare(`
      UPDATE semanticFacts
      SET validTo = @validTo
      WHERE subject = @subject AND predicate = @predicate AND validTo IS NULL
    `)
  }

  /**
   * 记录新事实
   *
   * 如果已存在同一 subject+predicate 的活跃事实，
   * 先将其 validTo 设为当前时间（关闭旧版本），再插入新版本。
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
      conditions.push('validFrom <= @asOf AND (validTo IS NULL OR validTo > @asOf)')
      params.asOf = query.asOf
    } else {
      // 默认只查活跃的事实
      conditions.push('validTo IS NULL')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    // 三模型审计 R2 (Codex P1): LIMIT 正整数钳制，防止负值/超大值 DoS
    const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 50)))
    params.limit = limit

    const stmt = this.db.prepare(`
      SELECT factId, subject, predicate, object, confidence,
             importance, pinned,
             sourceRunId, validFrom, validTo
      FROM semanticFacts
      ${where}
      ORDER BY confidence DESC, validFrom DESC
      LIMIT @limit
    `)

    const rows = stmt.all(params) as unknown as FactRow[]

    // 审计修复 #1: 更新访问时间 (LRU 追踪)
    if (rows.length > 0) {
      const factIds = rows.map(r => r.factId)
      const placeholders = factIds.map(() => '?').join(',')
      this.db.prepare(
        `UPDATE semanticFacts SET lastAccessedAt = ? WHERE factId IN (${placeholders})`,
      ).run(new Date().toISOString(), ...factIds)
    }

    return rows.map(row => ({
      factId: row.factId,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      confidence: row.confidence,
      importance: row.importance ?? 0.5,
      pinned: !!(row.pinned),
      sourceRunId: row.sourceRunId ?? undefined,
      validFrom: row.validFrom,
      validTo: row.validTo ?? undefined,
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
      'SELECT COUNT(*) as cnt FROM semanticFacts WHERE validTo IS NULL',
    ).get() as { cnt: number }
    return row.cnt
  }

  /**
   * 淘汰最少使用的 N 条活跃事实 — 真正的 LRU 策略
   *
   * 2026 SOTA:
   * - LRU 排序 (COALESCE(lastAccessedAt, validFrom) ASC)
   * - 排除 pinned 事实 (关键记忆保护, MemGPT 2023)
   * - 低重要度事实优先淘汰 (Generative Agents 2025)
   *
   * 科研参考: Packer 2023, MemGPT Section 4.2
   */
  evictOldest(n: number): number {
    const result = this.db.prepare(`
      UPDATE semanticFacts
      SET validTo = ?
      WHERE factId IN (
        SELECT factId FROM semanticFacts
        WHERE validTo IS NULL AND pinned = 0
        ORDER BY importance ASC, COALESCE(lastAccessedAt, validFrom) ASC
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
    this.db.prepare(`UPDATE semanticFacts SET pinned = 1 WHERE factId = ?`).run(factId)
  }

  unpinFact(factId: number): void {
    this.db.prepare(`UPDATE semanticFacts SET pinned = 0 WHERE factId = ?`).run(factId)
  }

  /**
   * 2026 SOTA: 更新事实重要度
   *
   * 参考: Generative Agents 2025 "Importance Scores"
   */
  updateImportance(factId: number, importance: number): void {
    const clamped = Math.max(0, Math.min(1, importance))
    this.db.prepare(`UPDATE semanticFacts SET importance = ? WHERE factId = ?`).run(clamped, factId)
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
      FROM semanticFacts
      WHERE validTo IS NULL
      GROUP BY subject, predicate
      HAVING cnt > 1
    `).all() as Array<{ subject: string; predicate: string; cnt: number }>

    let compacted = 0
    const now = new Date().toISOString()

    for (const dup of duplicates) {
      // 保留置信度最高的，关闭其余
      const result = this.db.prepare(`
        UPDATE semanticFacts
        SET validTo = ?
        WHERE subject = ? AND predicate = ? AND validTo IS NULL
          AND factId NOT IN (
            SELECT factId FROM semanticFacts
            WHERE subject = ? AND predicate = ? AND validTo IS NULL
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
  factId: number
  subject: string
  predicate: string
  object: string
  confidence: number
  importance: number
  pinned: number
  sourceRunId: string | null
  validFrom: string
  validTo: string | null
}
