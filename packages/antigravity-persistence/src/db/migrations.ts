/**
 * Antigravity Workflow Runtime — SQLite Schema 迁移
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
        checkpointId TEXT PRIMARY KEY,
        runId TEXT NOT NULL,
        version INTEGER NOT NULL,
        stateJson TEXT NOT NULL,
        stateHash TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        UNIQUE(runId, version)
      );
      CREATE INDEX IF NOT EXISTS idxCheckpointRunVersion
        ON checkpoints(runId, version DESC);
    `,
  },
  {
    version: 2,
    description: '创建 Manifest 索引表',
    sql: `
      CREATE TABLE IF NOT EXISTS manifest (
        runId TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        repoRoot TEXT,
        files TEXT DEFAULT '[]',
        lane TEXT,
        riskLevel TEXT,
        worstStatus TEXT,
        nodeCount INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        completedAt TEXT,
        summary TEXT
      );
      CREATE INDEX IF NOT EXISTS idxManifestRepo
        ON manifest(repoRoot);
      CREATE INDEX IF NOT EXISTS idxManifestCreated
        ON manifest(createdAt DESC);
    `,
  },
  {
    version: 3,
    description: '创建语义记忆表（关系型时序知识图）',
    sql: `
      CREATE TABLE IF NOT EXISTS semanticFacts (
        factId INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        importance REAL NOT NULL DEFAULT 0.5,
        pinned INTEGER NOT NULL DEFAULT 0,
        sourceRunId TEXT,
        validFrom TEXT NOT NULL,
        validTo TEXT,
        createdAt TEXT NOT NULL,
        lastAccessedAt TEXT,
        FOREIGN KEY (sourceRunId) REFERENCES manifest(runId)
      );
      CREATE INDEX IF NOT EXISTS idxSemanticFactsSubject
        ON semanticFacts(subject);
      CREATE INDEX IF NOT EXISTS idxSemanticFactsPredicate
        ON semanticFacts(predicate);
      CREATE INDEX IF NOT EXISTS idxSemanticFactsValidity
        ON semanticFacts(validFrom, validTo);
    `,
  },
  {
    version: 4,
    description: '创建 Reflexion 记忆表',
    sql: `
      CREATE TABLE IF NOT EXISTS reflexionEvaluations (
        runId TEXT PRIMARY KEY,
        success INTEGER NOT NULL,
        failureCategory TEXT,
        severity REAL NOT NULL DEFAULT 0.5,
        evaluatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reflexionReflections (
        runId TEXT PRIMARY KEY,
        rootCause TEXT NOT NULL,
        actionItems TEXT NOT NULL,
        lessonType TEXT NOT NULL DEFAULT 'adjust',
        confidence REAL NOT NULL DEFAULT 0.5,
        qualityScore REAL NOT NULL DEFAULT 0.5,
        reinforcementStrength REAL NOT NULL DEFAULT 1.0,
        appliedCount INTEGER NOT NULL DEFAULT 0,
        reflectedAt TEXT NOT NULL,
        FOREIGN KEY (runId) REFERENCES reflexionEvaluations(runId)
      );
      CREATE INDEX IF NOT EXISTS idxReflexionReflectionsRelevance
        ON reflexionReflections(confidence DESC, reflectedAt DESC);
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
