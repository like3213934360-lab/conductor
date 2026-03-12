import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteClient } from '../db/sqlite-client.js'
import { runMigrations } from '../db/migrations.js'
import { ManifestIndex } from '../memory/manifest-index.js'
import { SemanticMemory } from '../memory/semantic-memory.js'
import { EpisodicMemory } from '../memory/episodic-memory.js'

describe('Persistence schema', () => {
  let tempDir: string
  let sqliteClient: SqliteClient

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-memory-schema-'))
    sqliteClient = new SqliteClient({ dataDir: tempDir })
    runMigrations(sqliteClient.getDatabase())
  })

  afterEach(() => {
    sqliteClient.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('semantic memory 应写入 camelCase schema 并保持可查询', () => {
    const db = sqliteClient.getDatabase()
    const manifestIndex = new ManifestIndex(db)
    const semanticMemory = new SemanticMemory(db)

    manifestIndex.index({
      runId: 'run-123',
      goal: 'stabilize auth risk routing',
      repoRoot: tempDir,
      files: ['src/auth.ts'],
      lane: 'parallel',
      riskLevel: 'high',
      worstStatus: 'completed',
      nodeCount: 7,
      createdAt: '2026-03-11T00:00:00.000Z',
      completedAt: '2026-03-11T00:05:00.000Z',
      summary: 'manifest seed for semantic memory foreign-key coverage',
    })

    semanticMemory.recordFact({
      subject: 'src/auth.ts',
      predicate: 'triggersRisk',
      object: 'high',
      confidence: 0.8,
      importance: 0.7,
      pinned: false,
      sourceRunId: 'run-123',
      validFrom: '2026-03-11T00:00:00.000Z',
    })

    const columns = db.prepare(`PRAGMA table_info('semanticFacts')`).all() as Array<{ name: string }>
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining([
      'factId',
      'subject',
      'predicate',
      'object',
      'confidence',
      'importance',
      'pinned',
      'sourceRunId',
      'validFrom',
      'validTo',
      'createdAt',
      'lastAccessedAt',
    ]))
    const facts = semanticMemory.queryFacts({ subject: 'src/auth.ts' })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      subject: 'src/auth.ts',
      predicate: 'triggersRisk',
      sourceRunId: 'run-123',
    })
  })

  it('episodic memory 应写入 camelCase schema 并保持可回忆', () => {
    const db = sqliteClient.getDatabase()
    const manifestIndex = new ManifestIndex(db)
    const episodicMemory = new EpisodicMemory(db, manifestIndex)

    const result = episodicMemory.recordAndReflect({
      runId: 'run-episodic-1',
      goal: 'repair auth timeout handling',
      outcome: 'failed',
      riskLevel: 'high',
      nodeCount: 7,
      files: ['src/auth.ts'],
      failureReasons: ['timeout while validating auth flow'],
      createdAt: '2026-03-11T00:00:00.000Z',
    })

    expect(result.evaluation).toMatchObject({
      runId: 'run-episodic-1',
      success: false,
      failureCategory: 'timeout',
    })
    expect(result.reflection).not.toBeNull()

    const evaluationColumns = db.prepare(`PRAGMA table_info('reflexionEvaluations')`).all() as Array<{ name: string }>
    expect(evaluationColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'runId',
      'success',
      'failureCategory',
      'severity',
      'evaluatedAt',
    ]))

    const reflectionColumns = db.prepare(`PRAGMA table_info('reflexionReflections')`).all() as Array<{ name: string }>
    expect(reflectionColumns.map(column => column.name)).toEqual(expect.arrayContaining([
      'runId',
      'rootCause',
      'actionItems',
      'lessonType',
      'confidence',
      'qualityScore',
      'reinforcementStrength',
      'appliedCount',
      'reflectedAt',
    ]))

    const prompts = episodicMemory.recall('auth timeout mitigation', 2)
    expect(prompts.some(prompt => prompt.promptType === 'reflection')).toBe(true)

    episodicMemory.incrementAppliedCount('run-episodic-1')
    const counters = db.prepare(`
      SELECT appliedCount, reinforcementStrength
      FROM reflexionReflections
      WHERE runId = ?
    `).get('run-episodic-1') as { appliedCount: number, reinforcementStrength: number }
    expect(counters.appliedCount).toBe(1)
    expect(counters.reinforcementStrength).toBeLessThan(1.0)
  })
})
