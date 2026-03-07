/**
 * Conductor AGC — SQLite 连接管理
 *
 * 使用 better-sqlite3 提供同步 SQLite 访问，WAL 模式。
 *
 * 设计决策:
 * - better-sqlite3 vs sql.js: better-sqlite3 是同步 API + 原生绑定，
 *   比 WASM-based sql.js 性能高 10-50x。
 * - WAL 模式: 支持并发读，单写者不阻塞读者。
 * - PRAGMA 优化: journal_size_limit + synchronous=NORMAL
 */
import Database from 'better-sqlite3'
import * as path from 'node:path'
import * as fs from 'node:fs'

/** SQLite 客户端配置 */
export interface SqliteClientConfig {
  /** 数据目录 */
  dataDir: string
  /** 数据库文件名（默认: conductor.db） */
  dbName?: string
}

/**
 * SQLite 客户端
 *
 * 封装 better-sqlite3 连接，提供 WAL 模式 + PRAGMA 优化。
 */
export class SqliteClient {
  private db: Database.Database

  constructor(config: SqliteClientConfig) {
    const dbDir = path.join(config.dataDir, 'db')
    fs.mkdirSync(dbDir, { recursive: true })

    const dbPath = path.join(dbDir, config.dbName ?? 'conductor.db')
    this.db = new Database(dbPath)

    // WAL 模式: 并发读不被写阻塞
    this.db.pragma('journal_mode = WAL')
    // NORMAL synchronous: 在 WAL 模式下提供足够的持久性保证
    this.db.pragma('synchronous = NORMAL')
    // WAL 文件大小限制
    this.db.pragma('journal_size_limit = 67108864') // 64MB
    // 外键约束
    this.db.pragma('foreign_keys = ON')
    // Busy timeout
    this.db.pragma('busy_timeout = 5000')
  }

  /** 获取底层 database 实例 */
  getDatabase(): Database.Database {
    return this.db
  }

  /** 执行事务 */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /** 关闭连接 */
  close(): void {
    this.db.close()
  }
}
