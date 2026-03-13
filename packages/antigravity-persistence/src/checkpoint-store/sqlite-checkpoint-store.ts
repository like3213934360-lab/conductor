/**
 * Antigravity Workflow Runtime — SQLite CheckpointStore
 *
 * 检查点是事件流的折叠缓存（memoization），不是事务的一部分。
 *
 * 参考: Greg Young — "Snapshots are just fold memoization"
 */
import * as crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CheckpointDTO } from '@anthropic/antigravity-shared'
import type {
  CheckpointStore,
  SaveCheckpointInput,
  LoadCheckpointQuery,
} from '@anthropic/antigravity-core'

/**
 * 基于 SQLite 的 CheckpointStore 实现
 */
export class SqliteCheckpointStore implements CheckpointStore {
  private readonly db: Database.Database
  private readonly stmtSave: Database.Statement
  private readonly stmtLoadLatest: Database.Statement
  private readonly stmtLoadByVersion: Database.Statement
  private readonly stmtList: Database.Statement

  constructor(db: Database.Database) {
    this.db = db

    this.stmtSave = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints
        (checkpointId, runId, version, stateJson, stateHash, createdAt)
      VALUES
        (@checkpointId, @runId, @version, @stateJson, @stateHash, @createdAt)
    `)

    this.stmtLoadLatest = this.db.prepare(`
      SELECT checkpointId, runId, version, stateJson, stateHash, createdAt
      FROM checkpoints
      WHERE runId = ?
      ORDER BY version DESC
      LIMIT 1
    `)

    this.stmtLoadByVersion = this.db.prepare(`
      SELECT checkpointId, runId, version, stateJson, stateHash, createdAt
      FROM checkpoints
      WHERE runId = ? AND version = ?
    `)

    this.stmtList = this.db.prepare(`
      SELECT checkpointId, runId, version, stateJson, stateHash, createdAt
      FROM checkpoints
      WHERE runId = ?
      ORDER BY version DESC
    `)
  }

  /** 保存检查点 */
  async save(input: SaveCheckpointInput): Promise<void> {
    const { checkpoint } = input
    const stateJson = JSON.stringify(checkpoint.state)
    const stateHash = crypto
      .createHash('sha256')
      .update(stateJson)
      .digest('hex')

    this.stmtSave.run({
      checkpointId: checkpoint.checkpointId,
      runId: checkpoint.runId,
      version: checkpoint.version,
      stateJson,
      stateHash,
      createdAt: checkpoint.createdAt,
    })
  }

  /** 加载最新检查点 */
  async loadLatest(runId: string): Promise<CheckpointDTO | null> {
    const row = this.stmtLoadLatest.get(runId) as DatabaseRow | undefined
    if (!row) return null
    return this.rowToCheckpoint(row)
  }

  /** 按查询加载检查点（匹配 CheckpointStore 接口签名） */
  async loadByVersion(query: LoadCheckpointQuery): Promise<CheckpointDTO | null> {
    if (query.version === undefined) {
      return this.loadLatest(query.runId)
    }
    const row = this.stmtLoadByVersion.get(query.runId, query.version) as DatabaseRow | undefined
    if (!row) return null
    return this.rowToCheckpoint(row)
  }

  /** 列出所有检查点 */
  async list(runId: string): Promise<CheckpointDTO[]> {
    const rows = this.stmtList.all(runId) as DatabaseRow[]
    return rows.map(row => this.rowToCheckpoint(row))
  }

  /**
   * 数据库行转 CheckpointDTO
   *
   * 三模型审计修复 (P0 3/3共识):
   * 重计算 SHA-256 hash 并校验，防止数据篡改或 corruption
   */
  private rowToCheckpoint(row: DatabaseRow): CheckpointDTO {
    // P0 共识修复: 重计算 hash 并校验
    if (row.stateHash) {
      const computedHash = crypto
        .createHash('sha256')
        .update(row.stateJson)
        .digest('hex')
      if (computedHash !== row.stateHash) {
        throw new Error(
          `[STATE_CORRUPTED] Checkpoint ${row.checkpointId} hash mismatch: ` +
          `expected ${row.stateHash}, got ${computedHash}`,
        )
      }
    }

    return {
      checkpointId: row.checkpointId,
      runId: row.runId,
      version: row.version,
      state: JSON.parse(row.stateJson),
      createdAt: row.createdAt,
    }
  }
}

/** 数据库查询结果行类型 */
interface DatabaseRow {
  checkpointId: string
  runId: string
  version: number
  stateJson: string
  stateHash: string | null
  createdAt: string
}
