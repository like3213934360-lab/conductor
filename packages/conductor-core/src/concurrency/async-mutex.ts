/**
 * Conductor AGC — AsyncMutex 异步互斥锁
 *
 * 三模型复查建议 1: runId 级并发控制
 *
 * 提供进程内异步互斥锁, 防止同一 runId 的并发操作。
 * 支持 key 级粒度, 不同 key 之间互不阻塞。
 *
 * 设计参考:
 * - Go sync.Mutex: 进程内互斥
 * - Java ReentrantLock: 可重入
 * - Node.js async-mutex: Promise-based locking
 *
 * 注意: 仅保护进程内并发 (Node.js 单进程多请求)。
 * 跨进程保护由 FileLock (file-lock.ts) 负责。
 */

/** 互斥锁等待队列项 */
interface WaitEntry {
  resolve: () => void
}

/**
 * KeyedAsyncMutex — 按 key 粒度的异步互斥锁
 *
 * 每个 key (如 runId) 独立锁定, 不同 key 并行执行。
 * 空闲锁自动清理, 防止内存泄漏。
 */
export class KeyedAsyncMutex {
  /** key → 等待队列 (空数组 = 已锁但无等待者, undefined = 未锁) */
  private readonly locks = new Map<string, WaitEntry[]>()
  /** 自动清理阈值: 超过此数量触发 idle key 清理 */
  private readonly gcThreshold: number

  constructor(gcThreshold = 1000) {
    this.gcThreshold = gcThreshold
  }

  /**
   * 获取锁 — 返回释放函数
   *
   * 用法:
   * ```ts
   * const release = await mutex.acquire('run-123')
   * try {
   *   // 临界区
   * } finally {
   *   release()
   * }
   * ```
   */
  async acquire(key: string): Promise<() => void> {
    const queue = this.locks.get(key)

    if (!queue) {
      // 未锁定 — 立即获取
      this.locks.set(key, [])
      return this.createRelease(key)
    }

    // 已锁定 — 加入等待队列
    return new Promise<() => void>((resolve) => {
      queue.push({
        resolve: () => resolve(this.createRelease(key)),
      })
    })
  }

  /**
   * 带锁执行 — RAII 风格
   *
   * 用法:
   * ```ts
   * const result = await mutex.withLock('run-123', async () => {
   *   return doWork()
   * })
   * ```
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  /** 获取当前活跃锁数量 (调试/监控用) */
  get activeCount(): number {
    return this.locks.size
  }

  /** 检查某个 key 是否被锁定 */
  isLocked(key: string): boolean {
    return this.locks.has(key)
  }

  /** 创建释放函数 */
  private createRelease(key: string): () => void {
    let released = false
    return () => {
      if (released) return // 幂等: 防止重复释放
      released = true

      const queue = this.locks.get(key)
      if (!queue) return

      if (queue.length > 0) {
        // 唤醒下一个等待者
        const next = queue.shift()!
        next.resolve()
      } else {
        // 无等待者 — 释放锁
        this.locks.delete(key)
      }

      // 周期性 GC: 清理意外残留的空队列
      if (this.locks.size > this.gcThreshold) {
        this.gc()
      }
    }
  }

  /** 清理空闲锁 (防内存泄漏 safety net) */
  private gc(): void {
    for (const [key, queue] of this.locks) {
      if (queue.length === 0) {
        this.locks.delete(key)
      }
    }
  }
}
