/**
 * Antigravity Workflow Runtime — SQLite 连接管理 (WASM 版)
 *
 * 使用 sql.js (纯 WASM) 替代 better-sqlite3 (原生 C++)，
 * 彻底消除 Electron ABI 撕裂和跨平台二进制异构问题。
 *
 * 设计决策:
 * - sql.js 在 V8 WASM 虚拟机中运行，免疫 Node.js ABI 版本差异
 * - 初始化为异步 (加载 .wasm)，加载后所有读写操作保持同步语义
 * - WasmDatabase 提供与 better-sqlite3 兼容的 API 外观 (Adapter Pattern)
 *   消费方只需更换 import type，无需重写业务逻辑
 */
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import * as path from 'node:path'
import * as fs from 'node:fs'

// ─── WasmStatement: better-sqlite3 Statement 兼容适配器 ──────────────

/**
 * Prepared statement 适配器
 *
 * better-sqlite3 的 Statement 支持 .run(params) / .get(params) / .all(params)，
 * sql.js 的 Statement 使用 .bind() + .step() + .getAsObject() 的迭代模式。
 * 本适配器将后者包装为前者的接口形状。
 */
export class WasmStatement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string,
  ) {}

  /**
   * 执行写操作 (INSERT/UPDATE/DELETE)
   *
   * 接受位置参数数组或命名参数对象。
   * 返回 { changes } 用于 UPDATE/DELETE 的影响行数。
   */
  run(...args: unknown[]): { changes: number } {
    const params = this.normalizeParams(args)
    this.db.run(this.sql, params as any)
    const changes = this.db.getRowsModified()
    return { changes }
  }

  /**
   * 查询单行 (SELECT ... LIMIT 1)
   *
   * 返回第一行作为对象，无结果返回 undefined。
   */
  get(...args: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(this.sql)
    try {
      const params = this.normalizeParams(args)
      if (params !== undefined) stmt.bind(params as any)
      if (stmt.step()) {
        return stmt.getAsObject() as Record<string, unknown>
      }
      return undefined
    } finally {
      stmt.free()
    }
  }

  /**
   * 查询所有行 (SELECT)
   *
   * 返回对象数组。
   */
  all(...args: unknown[]): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(this.sql)
    try {
      const params = this.normalizeParams(args)
      if (params !== undefined) stmt.bind(params as any)
      const rows: Array<Record<string, unknown>> = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>)
      }
      return rows
    } finally {
      stmt.free()
    }
  }

  /**
   * 参数归一化
   *
   * better-sqlite3 风格: stmt.run({ key: value }) 或 stmt.run(val1, val2)
   * sql.js 风格: stmt.bind({ ':key': value }) 或 stmt.bind([val1, val2])
   *
   * 本方法将 better-sqlite3 的 @named 参数转换为 sql.js 的 :named 格式。
   */
  private normalizeParams(args: unknown[]): Record<string, unknown> | unknown[] | undefined {
    if (args.length === 0) return undefined
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      // 命名参数: { key: value } → { ':key': value } 或 { '@key': value } 透传
      const input = args[0] as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(input)) {
        // sql.js 接受 :key / @key / $key 前缀
        const normalizedKey = key.startsWith(':') || key.startsWith('@') || key.startsWith('$')
          ? key
          : `@${key}`
        result[normalizedKey] = value
      }
      return result
    }
    // 位置参数: stmt.run(val1, val2) → [val1, val2]
    return args
  }
}

// ─── WasmDatabase: better-sqlite3 Database 兼容适配器 ────────────────

/**
 * WasmDatabase — better-sqlite3 API 兼容层
 *
 * 提供与 better-sqlite3 的 Database 相同的接口形状:
 * - .prepare(sql) → WasmStatement
 * - .exec(sql)
 * - .pragma(str, options?)
 * - .transaction(fn)()
 * - .close()
 */
export class WasmDatabase {
  constructor(private readonly db: SqlJsDatabase, private readonly dbPath: string) {}

  /** 创建预编译语句 */
  prepare(sql: string): WasmStatement {
    return new WasmStatement(this.db, sql)
  }

  /** 直接执行 SQL (多语句) */
  exec(sql: string): void {
    this.db.run(sql)
  }

  /**
   * PRAGMA 操作 — 兼容 better-sqlite3 的 pragma() 接口
   *
   * better-sqlite3 用法:
   *   db.pragma('journal_mode = WAL')          → 设置 PRAGMA
   *   db.pragma('user_version', { simple: true }) → 读取标量值
   *   db.pragma('user_version = 3')            → 设置版本号
   */
  pragma(pragmaStr: string, options?: { simple?: boolean }): unknown {
    const trimmed = pragmaStr.trim()

    if (trimmed.includes('=')) {
      // 设置型 PRAGMA
      this.db.run(`PRAGMA ${trimmed}`)
      return undefined
    }

    // 查询型 PRAGMA
    const results = this.db.exec(`PRAGMA ${trimmed}`)
    if (results.length === 0 || results[0]!.values.length === 0) return undefined
    if (options?.simple) {
      return results[0]!.values[0]![0]
    }
    // 返回完整结果集 (如 table_info)
    const columns = results[0]!.columns
    return results[0]!.values.map(row => {
      const obj: Record<string, unknown> = {}
      columns.forEach((col, i) => { obj[col] = row[i] })
      return obj
    })
  }

  /**
   * 事务 — 兼容 better-sqlite3 的 db.transaction(fn)() 模式
   *
   * better-sqlite3: db.transaction(() => { ... })()
   * 本适配器: 返回一个可调用函数，执行时包裹 BEGIN/COMMIT/ROLLBACK
   */
  transaction<T>(fn: () => T): () => T {
    return () => {
      this.db.run('BEGIN TRANSACTION')
      try {
        const result = fn()
        this.db.run('COMMIT')
        return result
      } catch (err) {
        this.db.run('ROLLBACK')
        throw err
      }
    }
  }

  /** 获取最后修改的行数 */
  getRowsModified(): number {
    return this.db.getRowsModified()
  }

  /** 关闭数据库并持久化到磁盘 */
  close(): void {
    // 将内存数据库导出写回磁盘
    this.flush()
    this.db.close()
  }

  /** 将内存数据库刷写到磁盘文件 */
  flush(): void {
    if (this.dbPath) {
      const data = this.db.export()
      fs.writeFileSync(this.dbPath, Buffer.from(data))
    }
  }
}

// ─── SqliteClient: 对外暴露的顶层客户端 ──────────────────────────────

/** SQLite 客户端配置 */
export interface SqliteClientConfig {
  /** 数据目录 */
  dataDir: string
  /** 数据库文件名（默认: antigravity-runtime.db） */
  dbName?: string
  /** sql.js WASM 文件路径（默认: 自动查找 node_modules） */
  wasmPath?: string
}

/**
 * SQLite 客户端 (WASM 版)
 *
 * 使用异步工厂方法 create() 初始化（加载 WASM 二进制）。
 * 初始化完成后，所有数据读写操作保持同步语义。
 */
export class SqliteClient {
  private wasmDb: WasmDatabase

  private constructor(wasmDb: WasmDatabase) {
    this.wasmDb = wasmDb
  }

  /**
   * 异步工厂方法 — 加载 WASM 并打开/创建数据库
   *
   * sql.js 的 initSqlJs() 需要异步加载 .wasm 二进制文件。
   * 此方法在入口处（taskd main / extension activate / test setup）
   * 调用一次，后续所有操作均为同步。
   */
  static async create(config: SqliteClientConfig): Promise<SqliteClient> {
    const dbDir = path.join(config.dataDir, 'db')
    fs.mkdirSync(dbDir, { recursive: true })
    const dbPath = path.join(dbDir, config.dbName ?? 'antigravity-runtime.db')

    // 初始化 sql.js WASM 引擎
    const SQL = await initSqlJs()

    // 加载已有数据库文件或创建新数据库
    let db: SqlJsDatabase
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath)
      db = new SQL.Database(buffer)
    } else {
      db = new SQL.Database()
    }

    const wasmDb = new WasmDatabase(db, dbPath)

    // PRAGMA 优化 (WAL 模式在 sql.js 内存引擎中无效，但设置不会报错)
    wasmDb.pragma('journal_mode = WAL')
    wasmDb.pragma('synchronous = NORMAL')
    wasmDb.pragma('foreign_keys = ON')

    return new SqliteClient(wasmDb)
  }

  /** 获取底层 database 实例 */
  getDatabase(): WasmDatabase {
    return this.wasmDb
  }

  /** 执行事务 */
  transaction<T>(fn: () => T): T {
    return this.wasmDb.transaction(fn)()
  }

  /** 关闭连接并持久化 */
  close(): void {
    this.wasmDb.close()
  }

  /** 手动刷写到磁盘 (热备份) */
  flush(): void {
    this.wasmDb.flush()
  }
}
