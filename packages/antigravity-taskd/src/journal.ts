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
  VERIFY: { verify: VerifyAnalysis }
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
}

// ── 文件系统实现 ────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
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

    // 原子写入：先写 tmp，再 rename
    const filePath = this.checkpointPath(jobId, stageId)
    const tmpPath = `${filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(checkpoint, null, 2), 'utf8')
    fs.renameSync(tmpPath, filePath)
  }

  async loadCheckpoint<S extends keyof StagePayloadMap>(
    jobId: string,
    stageId: S,
  ): Promise<StageCheckpoint<StagePayloadMap[S]> | null> {
    const filePath = this.checkpointPath(jobId, stageId)
    if (!fs.existsSync(filePath)) return null

    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const checkpoint = JSON.parse(raw) as StageCheckpoint<StagePayloadMap[S]>

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
}
