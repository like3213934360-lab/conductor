/**
 * Conductor AGC — JSONL 文件锁
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
 * 1. .lock 文件记录 PID + 时间戳
 * 2. 过期锁自动清除 (staleLockMs)
 * 3. 使用 O_EXCL 原子创建保证互斥
 * 4. unlock 时验证 PID 一致性
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

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

      // 检查锁是否过期
      if (await this.isLockStale()) {
        await this.forceRelease()
        if (await this.tryAcquire()) {
          this.acquired = true
          return
        }
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
      // 验证 PID 一致性: 只释放自己的锁
      const content = await this.readLockFile()
      if (content && content.pid === process.pid) {
        await fs.promises.unlink(this.lockPath)
      }
    } catch {
      // 锁文件已被清除, 忽略
    } finally {
      this.acquired = false
    }
  }

  /** 尝试获取锁 (非阻塞) */
  private async tryAcquire(): Promise<boolean> {
    const content: LockFileContent = {
      pid: process.pid,
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
      return true
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'EEXIST') return false
      throw err
    }
  }

  /** 检查锁是否过期 */
  private async isLockStale(): Promise<boolean> {
    const content = await this.readLockFile()
    if (!content) return true

    // 检查持锁进程是否存活
    try {
      process.kill(content.pid, 0) // 0 信号: 仅检查进程是否存在
      // 进程存在, 检查时间是否过期
      const lockTime = new Date(content.timestamp).getTime()
      return Date.now() - lockTime > this.options.staleLockMs
    } catch {
      // 进程不存在, 锁已过期
      return true
    }
  }

  /** 强制释放过期锁 */
  private async forceRelease(): Promise<void> {
    try {
      await fs.promises.unlink(this.lockPath)
    } catch {
      // 忽略
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
