/**
 * Antigravity Workflow Runtime — JSONL 文件锁
 *
 * Phase 4: 进程级文件锁 (Advisory File Lock)
 *
 * 使用 .lock 文件 + PID 检测实现跨进程互斥写入保护。
 *
 * 设计参考:
 * - npm lockfile: PID-based stale lock detection
 * - flock(2): advisory file locking
 * - SQLite WAL: writer exclusion
 *
 * 安全设计:
 * 1. .lock 文件记录 PID + UUID + 时间戳
 * 2. 过期锁自动清除 (staleLockMs)
 * 3. 使用 O_EXCL 原子创建保证互斥
 * 4. unlock 时验证 UUID 一致性 (防止 PID 重用)
 * 5. 三模型审计: TOCTOU 修复 — stale check + acquire 原子化
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

/** 文件锁配置 */
export interface FileLockOptions {
  /** 锁过期时间 (毫秒), 默认 30 秒 */
  staleLockMs?: number
  /** 获取锁的重试间隔 (毫秒), 默认 50ms */
  retryIntervalMs?: number
  /** 最大重试次数, 默认 100 (= 5 秒超时) */
  maxRetries?: number
}

/** 锁文件内容 */
interface LockFileContent {
  pid: number
  /** 三模型审计: UUID 唱一标识 (防 PID 重用) */
  uuid: string
  timestamp: string
  hostname: string
}

const DEFAULT_OPTIONS: Required<FileLockOptions> = {
  staleLockMs: 30_000,
  retryIntervalMs: 50,
  maxRetries: 100,
}

/**
 * 文件锁 — 跨进程写入保护
 */
export class FileLock {
  private readonly lockPath: string
  private readonly options: Required<FileLockOptions>
  private acquired = false
  /** 三模型审计: 当前锁的唯一标识 */
  private lockUuid = ''

  constructor(filePath: string, options?: FileLockOptions) {
    this.lockPath = filePath + '.lock'
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** 获取锁 (阻塞重试) */
  async acquire(): Promise<void> {
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      if (await this.tryAcquire()) {
        this.acquired = true
        return
      }

      // 三模型审计: TOCTOU 修复 — 原子化过期检测+重新获取
      if (await this.tryReplaceStale()) {
        this.acquired = true
        return
      }

      // 等待重试
      await new Promise<void>(resolve => setTimeout(resolve, this.options.retryIntervalMs))
    }

    throw new Error(
      `获取文件锁超时: ${this.lockPath} (重试 ${this.options.maxRetries} 次)`,
    )
  }

  /** 释放锁 */
  async release(): Promise<void> {
    if (!this.acquired) return

    try {
      // 三模型审计: 验证 UUID 一致性 (而非 PID, 防止 PID 重用)
      const content = await this.readLockFile()
      if (content && content.uuid === this.lockUuid) {
        await fs.promises.unlink(this.lockPath)
      }
    } catch {
      // 锁文件已被清除, 忽略
    } finally {
      this.acquired = false
      this.lockUuid = ''
    }
  }

  /** 尝试获取锁 (非阻塞) */
  private async tryAcquire(): Promise<boolean> {
    const uuid = crypto.randomUUID()
    const content: LockFileContent = {
      pid: process.pid,
      uuid,
      timestamp: new Date().toISOString(),
      hostname: (await import('node:os')).hostname(),
    }

    try {
      // O_EXCL: 原子创建, 文件已存在则失败
      await fs.promises.writeFile(
        this.lockPath,
        JSON.stringify(content),
        { flag: 'wx' },
      )
      this.lockUuid = uuid
      return true
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'EEXIST') return false
      throw err
    }
  }

  /**
   * 三模型审计: 原子化过期锁替换 (TOCTOU 修复)
   *
   * 策略: 写入临时文件 + rename 原子替换
   * 1. 读取现有锁 → 检查是否过期
   * 2. 写入临时 .lock.tmp → O_EXCL 保证只有一个进程加入竞争
   * 3. 再次读取现有锁 → 确认仍是同一把过期锁
   * 4. rename 临时文件为 .lock
   */
  private async tryReplaceStale(): Promise<boolean> {
    // 1. 检查现有锁是否过期
    const existing = await this.readLockFile()
    if (!existing) return false
    if (!this.isContentStale(existing)) return false

    const staleUuid = existing.uuid

    // 2. 写入临时锁文件
    const tmpPath = this.lockPath + '.tmp.' + process.pid
    const uuid = crypto.randomUUID()
    const newContent: LockFileContent = {
      pid: process.pid,
      uuid,
      timestamp: new Date().toISOString(),
      hostname: (await import('node:os')).hostname(),
    }

    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(newContent), { flag: 'wx' })
    } catch {
      return false // 另一个进程已经在竞争
    }

    try {
      // 3. 再次确认仍是同一把过期锁 (防 TOCTOU)
      const recheck = await this.readLockFile()
      if (!recheck || recheck.uuid !== staleUuid) {
        // 锁已被其他进程更新, 放弃
        await fs.promises.unlink(tmpPath).catch(() => {})
        return false
      }

      // 4. 原子替换
      await fs.promises.rename(tmpPath, this.lockPath)
      this.lockUuid = uuid
      return true
    } catch {
      await fs.promises.unlink(tmpPath).catch(() => {})
      return false
    }
  }

  /** 检查锁内容是否过期 */
  private isContentStale(content: LockFileContent): boolean {
    // 检查持锁进程是否存活
    try {
      process.kill(content.pid, 0)
      // 进程存在, 检查时间是否过期
      const lockTime = new Date(content.timestamp).getTime()
      return Date.now() - lockTime > this.options.staleLockMs
    } catch {
      // 进程不存在, 锁已过期
      return true
    }
  }

  /** 读取锁文件 */
  private async readLockFile(): Promise<LockFileContent | null> {
    try {
      const data = await fs.promises.readFile(this.lockPath, 'utf-8')
      return JSON.parse(data) as LockFileContent
    } catch {
      return null
    }
  }
}

/**
 * 带文件锁的操作包装器
 *
 * 使用 try/finally 确保锁一定被释放。
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options?: FileLockOptions,
): Promise<T> {
  const lock = new FileLock(filePath, options)
  await lock.acquire()
  try {
    return await fn()
  } finally {
    await lock.release()
  }
}
