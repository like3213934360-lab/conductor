/**
 * Conductor AGC — SQLite Schema 迁移
 *
 * 使用 user_version PRAGMA 进行版本控制的增量迁移。
 */
import type Database from 'better-sqlite3'

/** 单个迁移步骤 */
interface Migration {
  version: number
  description: string
  sql: string
}

/** 所有迁移步骤 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: '创建检查点表',
    sql: `
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        state_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(run_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_cp_run_version
        ON checkpoints(run_id, version DESC);
    `,
  },
  {
    version: 2,
    description: '创建 Manifest 索引表',
    sql: `
      CREATE TABLE IF NOT EXISTS manifest (
        run_id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        repo_root TEXT,
        files TEXT DEFAULT '[]',
        lane TEXT,
        risk_level TEXT,
        worst_status TEXT,
        node_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_manifest_repo
        ON manifest(repo_root);
      CREATE INDEX IF NOT EXISTS idx_manifest_created
        ON manifest(created_at DESC);
    `,
  },
  {
    version: 3,
    description: '创建语义记忆表（关系型时序知识图）',
    sql: `
      CREATE TABLE IF NOT EXISTS semantic_facts (
        fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        source_run_id TEXT,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_run_id) REFERENCES manifest(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_subject
        ON semantic_facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate
        ON semantic_facts(predicate);
      CREATE INDEX IF NOT EXISTS idx_facts_validity
        ON semantic_facts(valid_from, valid_to);
    `,
  },
]

/**
 * 执行数据库迁移
 *
 * 使用 SQLite user_version PRAGMA 追踪已应用的迁移版本。
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number

  const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion)
  if (pendingMigrations.length === 0) return

  // 在事务中执行所有待迁移
  db.transaction(() => {
    for (const migration of pendingMigrations) {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    }
  })()
}
