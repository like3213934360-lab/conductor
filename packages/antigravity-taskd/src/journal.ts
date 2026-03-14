/**
 * journal.ts — 阶段级断点续传 (Durable Execution)
 *
 * 将每个 stage 的输出序列化为 JSON checkpoint，
 * 崩溃恢复时直接跳到最远的已完成阶段，避免重跑 SCOUT / SHARD。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type {
  TaskStageId,
  ScoutManifest,
  ShardAnalysis,
  AggregateAnalysis,
  VerifyAnalysis,
  WriteAnalysis,
} from './schema.js'

// ── 类型定义 ────────────────────────────────────────────────────

/** ShardOutcome 引用（避免循环依赖，从 runtime 中解耦） */
export interface ShardOutcomeRef {
  status: 'success' | 'degraded' | 'failed'
  shardId: string
  error?: string
  durationMs: number
}

/** 文件条目（SCOUT 阶段使用） */
export interface FileEntryRef {
  path: string
  size: number
}

/** 按阶段类型化的 payload 映射 */
export interface StagePayloadMap {
  SCOUT: { manifest: ScoutManifest; fileHintEntries: FileEntryRef[] }
  SHARD_ANALYZE: { outcomes: ShardOutcomeRef[]; results: ShardAnalysis[] }
  AGGREGATE: { aggregate: AggregateAnalysis; merkleRoot: string }
  VERIFY: { verify: VerifyAnalysis; vfsPendingPaths?: string[] }
  WRITE: { writeResults: WriteAnalysis[] }
  FINALIZE: Record<string, never>
}

/** 检查点数据 */
export interface StageCheckpoint<T = unknown> {
  stageId: TaskStageId
  jobId: string
  version: number
  payload: T
  payloadHash: string
  timestamp: string
}

// ── 有序的 stage 列表（用于 getResumePoint 判定） ──────────────
const STAGE_ORDER: TaskStageId[] = [
  'SCOUT', 'SHARD_ANALYZE', 'AGGREGATE', 'VERIFY', 'WRITE', 'FINALIZE',
]

// ── JournalStore 接口 ───────────────────────────────────────────

export interface JournalStore {
  saveCheckpoint<S extends keyof StagePayloadMap>(
    jobId: string,
    stageId: S,
    payload: StagePayloadMap[S],
  ): Promise<void>

  loadCheckpoint<S extends keyof StagePayloadMap>(
    jobId: string,
    stageId: S,
  ): Promise<StageCheckpoint<StagePayloadMap[S]> | null>

  getResumePoint(jobId: string): Promise<TaskStageId | null>

  /** 删除指定 job 的所有 journal 文件（job 完成后调用） */
  purgeCheckpoints(jobId: string): void

  /** 清理超过 maxAgeDays 天的旧 journal（定期调用） */
  purgeOlderThan(maxAgeDays: number): void
}

// ── 文件系统实现 ────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

/** 递归剥离 __proto__ / constructor / prototype 键，防止原型链污染 */
function stripDangerousKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(stripDangerousKeys)
  const clean: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    clean[key] = stripDangerousKeys(value)
  }
  return clean
}

/** JSON 最大嵌套深度（防止递归 JSON.parse 击穿 V8 调用栈） */
const MAX_JSON_DEPTH = 1000

/**
 * 在调用 JSON.parse 之前，用 O(n) 的线性扫描检测嵌套深度。
 * 只统计 `[` `{` 的嵌套层数（跳过字符串内部），
 * 超过 MAX_JSON_DEPTH 则拒绝解析。
 */
function checkJsonDepth(raw: string): void {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i)
    if (escape) { escape = false; continue }
    if (ch === 0x5C /* \\ */) { if (inString) escape = true; continue }
    if (ch === 0x22 /* " */) { inString = !inString; continue }
    if (inString) continue
    if (ch === 0x7B /* { */ || ch === 0x5B /* [ */) {
      depth++
      if (depth > MAX_JSON_DEPTH) {
        throw new Error(`JSON nesting depth exceeds ${MAX_JSON_DEPTH} — possible recursive bomb, rejecting`)
      }
    } else if (ch === 0x7D /* } */ || ch === 0x5D /* ] */) {
      depth--
    }
  }
}

/** 安全反序列化 JSON：深度检查 → parse → 清洗原型污染键 */
function safeJsonParse<T>(raw: string): T {
  checkJsonDepth(raw)
  return stripDangerousKeys(JSON.parse(raw)) as T
}

export class FileJournalStore implements JournalStore {
  constructor(private readonly baseDir: string) {}

  private checkpointPath(jobId: string, stageId: TaskStageId): string {
    return path.join(this.baseDir, jobId, 'journal', `${stageId}.json`)
  }

  async saveCheckpoint<S extends keyof StagePayloadMap>(
    jobId: string,
    stageId: S,
    payload: StagePayloadMap[S],
  ): Promise<void> {
    const dir = path.join(this.baseDir, jobId, 'journal')
    ensureDir(dir)

    const payloadJson = JSON.stringify(payload)
    const checkpoint: StageCheckpoint<StagePayloadMap[S]> = {
      stageId,
      jobId,
      version: 1,
      payload,
      payloadHash: sha256(payloadJson),
      timestamp: new Date().toISOString(),
    }

    // 原子写入：先写 tmp → fsync 刷盘 → rename 覆盖
    const filePath = this.checkpointPath(jobId, stageId)
    const tmpPath = `${filePath}.tmp`
    try {
      const content = JSON.stringify(checkpoint, null, 2)
      const fd = fs.openSync(tmpPath, 'w')
      try {
        fs.writeSync(fd, content, 0, 'utf8')
        fs.fsyncSync(fd)  // 🔥 强制刷盘，防止断电后 Page Cache 丢失
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(tmpPath, filePath)
    } catch (error) {
      // ENOSPC 或 IO 故障时清理残留的 .tmp 文件，不让它污染下次恢复
      try { fs.unlinkSync(tmpPath) } catch { /* 忽略清理失败 */ }
      console.warn(`[journal] saveCheckpoint failed for ${stageId}/${jobId}: ${error instanceof Error ? error.message : error}`)
      // 不向上抛出 — journal 保存失败不应该杀死整个 Job
    }
  }

  async loadCheckpoint<S extends keyof StagePayloadMap>(
    jobId: string,
    stageId: S,
  ): Promise<StageCheckpoint<StagePayloadMap[S]> | null> {
    const filePath = this.checkpointPath(jobId, stageId)
    if (!fs.existsSync(filePath)) return null

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const checkpoint = safeJsonParse<StageCheckpoint<StagePayloadMap[S]>>(raw)

      // 完整性校验
      const expectedHash = sha256(JSON.stringify(checkpoint.payload))
      if (expectedHash !== checkpoint.payloadHash) {
        console.warn(`[journal] checkpoint ${stageId} for job ${jobId} is corrupted (hash mismatch), ignoring`)
        return null
      }

      return checkpoint
    } catch {
      console.warn(`[journal] failed to read checkpoint ${stageId} for job ${jobId}`)
      return null
    }
  }

  async getResumePoint(jobId: string): Promise<TaskStageId | null> {
    let lastCompleted: TaskStageId | null = null

    for (const stageId of STAGE_ORDER) {
      const cp = await this.loadCheckpoint(jobId, stageId)
      if (cp) {
        lastCompleted = stageId
      } else {
        break  // 有序扫描，第一个缺失处就是恢复点
      }
    }

    return lastCompleted
  }

  purgeCheckpoints(jobId: string): void {
    const journalDir = path.join(this.baseDir, jobId, 'journal')
    try {
      if (fs.existsSync(journalDir)) {
        // 删除所有 checkpoint 文件 + .tmp 残留
        for (const file of fs.readdirSync(journalDir)) {
          fs.unlinkSync(path.join(journalDir, file))
        }
        fs.rmdirSync(journalDir)
      }
    } catch {
      // 清理失败不影响主流程
      console.warn(`[journal] failed to purge checkpoints for job ${jobId}`)
    }
  }

  purgeOlderThan(maxAgeDays: number): void {
    const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    try {
      if (!fs.existsSync(this.baseDir)) return
      for (const jobId of fs.readdirSync(this.baseDir)) {
        const journalDir = path.join(this.baseDir, jobId, 'journal')
        if (!fs.existsSync(journalDir)) continue
        // 检查最新文件的 mtime
        const files = fs.readdirSync(journalDir)
        if (files.length === 0) continue
        const latestMtime = Math.max(...files.map(f => {
          try { return fs.statSync(path.join(journalDir, f)).mtimeMs } catch { return 0 }
        }))
        if (latestMtime < cutoffMs) {
          this.purgeCheckpoints(jobId)
        }
      }
    } catch {
      console.warn('[journal] purgeOlderThan encountered an error, skipping')
    }
  }
}
