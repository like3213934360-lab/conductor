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
   * 🛡️ Per-Job 异步写入序列化队列 (AsyncWriteQueue)
   *
   * 将同一 jobId 的所有写入操作（saveSnapshot + appendEvent）
   * 串行化为 Promise 链，彻底消除：
   *  - appendFileSync 的 JSONL 行交织损坏
   *  - 并发 writeJsonAtomic 的 .tmp 文件覆盖竞争
   *
   * 架构约束：队列仅保证单进程内的写入顺序。
   * 多进程场景需要额外的跨进程文件锁（如 flock）。
   */
  private readonly _writeQueues = new Map<string, Promise<void>>()

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

  /**
   * 将指定 jobId 的写入操作排入序列化队列。
   * 所有写入按入队顺序依次执行，绝不交织。
   */
  private enqueueWrite(jobId: string, writeFn: () => void): void {
    const prev = this._writeQueues.get(jobId) ?? Promise.resolve()
    const next = prev.then(() => {
      try {
        writeFn()
      } catch (err) {
        console.error(`[persistence] write failed for job ${jobId}:`, err)
        // 写入失败不阻塞后续写入，但错误会被记录
      }
    })
    this._writeQueues.set(jobId, next)
  }

  /**
   * 🛡️ 序列化保存快照
   *
   * 通过写入队列串行化，防止并发 writeJsonAtomic
   * 产生多个 .tmp 文件互相覆盖导致数据损坏。
   */
  saveSnapshot(snapshot: TaskJobSnapshot): void {
    this.ensureJob(snapshot.jobId)
    this.enqueueWrite(snapshot.jobId, () => {
      writeJsonAtomic(this.snapshotPath(snapshot.jobId), snapshot)
    })
  }

  /**
   * 🛡️ 序列化追加事件（带磁盘容量熔断器）
   *
   * 通过写入队列串行化，防止并发 appendFileSync
   * 导致 JSONL 行交织断裂。
   *
   * 磁盘防线：events.jsonl 超过 MAX_EVENTS_FILE_BYTES 时
   * 停止追加（静默丢弃），防止长期运行的 Job 撑爆磁盘。
   * events.jsonl 纯审计用途，从不被恢复流程读取。
   */
  private static readonly MAX_EVENTS_FILE_BYTES = 100 * 1024 * 1024 // 100MB
  private readonly _eventsExhausted = new Set<string>()

  appendEvent(jobId: string, event: TaskJobEvent): void {
    // 🛡️ 磁盘熔断：已标记为 exhausted 的 job 不再写入
    if (this._eventsExhausted.has(jobId)) return

    this.ensureJob(jobId)
    this.enqueueWrite(jobId, () => {
      // 惰性大小检查（每 N 次写入检查一次避免 stat 开销）
      try {
        const stat = fs.statSync(this.eventsPath(jobId))
        if (stat.size > TaskPersistenceStore.MAX_EVENTS_FILE_BYTES) {
          console.warn(`[persistence] events.jsonl for job ${jobId} exceeds ${TaskPersistenceStore.MAX_EVENTS_FILE_BYTES / 1024 / 1024}MB — halting event writes to prevent disk exhaustion`)
          this._eventsExhausted.add(jobId)
          return
        }
      } catch { /* stat 失败继续写入 */ }

      fs.appendFileSync(this.eventsPath(jobId), `${JSON.stringify(event)}\n`, 'utf8')
    })
  }

  /**
   * 等待指定 jobId 的所有排队写入完成，然后释放队列条目。
   * 适用于 job 终结时（completed/failed/cancelled）防止内存泄漏。
   */
  async flush(jobId: string): Promise<void> {
    const pending = this._writeQueues.get(jobId)
    if (pending) {
      await pending
      // 🛡️ 内存闭环：释放已完成 job 的队列条目
      this._writeQueues.delete(jobId)
    }
  }

  /**
   * 等待所有 jobId 的排队写入完成，然后释放全部队列条目。
   * 适用于 graceful shutdown，确保不丢失任何未持久化的数据。
   */
  async flushAll(): Promise<void> {
    await Promise.all([...this._writeQueues.values()])
    this._writeQueues.clear()
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
