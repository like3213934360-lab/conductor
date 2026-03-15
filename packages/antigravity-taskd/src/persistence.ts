import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TaskJobEvent, TaskJobSnapshot } from './schema.js'

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * 原子写入 JSON 文件：write → fsync → rename
 * fsync 保证数据物理落盘，防止 Page Cache 断电丢失。
 * ENOSPC 等 IO 错误被捕获并向上传播但不会残留 .tmp。
 */
function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`
  try {
    const content = JSON.stringify(value, null, 2)
    const fd = fs.openSync(tmpPath, 'w')
    try {
      fs.writeSync(fd, content, 0, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmpPath, filePath)
  } catch (error) {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore cleanup failure */ }
    throw error  // persistence 写入失败比 journal 更严重，需要上抛
  }
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

export class TaskPersistenceStore {
  /**
   * 🛡️ 并发写入序列化锁 (Per-Job Write Queue)
   *
   * 当多个 shard worker 并发完成并同时调用 appendEvent 时，
   * appendFileSync 的 JSONL 行可能交织损坏。
   * 使用 Promise chain 将同一 jobId 的写入串行化。
   */
  private readonly _writeLocks = new Map<string, Promise<void>>()

  constructor(private readonly jobsDir: string) {
    ensureDir(this.jobsDir)
  }

  private jobDir(jobId: string): string {
    return path.join(this.jobsDir, jobId)
  }

  snapshotPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'snapshot.json')
  }

  eventsPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'events.jsonl')
  }

  ensureJob(jobId: string): void {
    ensureDir(this.jobDir(jobId))
  }

  saveSnapshot(snapshot: TaskJobSnapshot): void {
    this.ensureJob(snapshot.jobId)
    writeJsonAtomic(this.snapshotPath(snapshot.jobId), snapshot)
  }

  appendEvent(jobId: string, event: TaskJobEvent): void {
    this.ensureJob(jobId)
    // 序列化写入：链式 Promise 确保同一 jobId 的写入不会交织
    const prev = this._writeLocks.get(jobId) ?? Promise.resolve()
    const next = prev.then(() => {
      fs.appendFileSync(this.eventsPath(jobId), `${JSON.stringify(event)}\n`, 'utf8')
    }).catch((err) => {
      console.warn(`[persistence] appendEvent failed for job ${jobId}: ${err}`)
    })
    this._writeLocks.set(jobId, next)
  }

  readSnapshot(jobId: string): TaskJobSnapshot | null {
    const filePath = this.snapshotPath(jobId)
    if (!fs.existsSync(filePath)) return null
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      return stripDangerousKeys(JSON.parse(raw)) as TaskJobSnapshot
    } catch {
      console.warn(`[persistence] failed to read snapshot for job ${jobId}`)
      return null
    }
  }

  readAllSnapshots(): TaskJobSnapshot[] {
    if (!fs.existsSync(this.jobsDir)) return []
    return fs.readdirSync(this.jobsDir)
      .map(jobId => this.readSnapshot(jobId))
      .filter((snapshot): snapshot is TaskJobSnapshot => snapshot != null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }
}
