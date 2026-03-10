/**
 * Conductor AGC — JSONL 文件 EventStore
 *
 * 审查修复:
 * #2: 进程内写锁使用 while 循环重入检查（防止多等待者竞态）
 * #9: readJsonlStream 不再静默跳过损坏行（统计 + 版本缺口检测上移到 append）
 * #10: appendJsonlLines 检查 bytesWritten
 *
 * 架构特点:
 * 1. 一个 runId 对应一个 .jsonl 文件（stream-per-aggregate）
 * 2. 前缀分片避免大目录: data/events/{prefix}/{runId}.jsonl
 * 3. 进程内互斥锁保证并发安全（while 循环重入检查）
 * 4. fsync 保证持久性
 * 5. 流式读取支持 O(1) 内存回放
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'
import type { EventStore, AppendEventsInput, LoadEventsQuery } from '@anthropic/conductor-core'
import { appendJsonlLines, readJsonlStream, readLastJsonlLine } from './stream-utils.js'
import { withFileLock } from './file-lock.js'

/** JSONL EventStore 配置 */
export interface JsonlEventStoreConfig {
  /** 事件数据根目录 */
  dataDir: string
}

/**
 * 基于 JSONL 文件的 EventStore 实现
 */
export class JsonlEventStore implements EventStore {
  private readonly dataDir: string
  /**
   * 审查修复 #2: 使用 Set 标记 + Promise 链实现重入安全的写锁
   *
   * 原实现: Map<string, Promise<void>> 有竞态，
   * 两个等待者 await 同一个 prev 后都进入临界区。
   *
   * 新实现: 每次 acquireWriteLock 都在 while 循环中检查锁是否仍被持有。
   */
  private readonly writeLocks = new Map<string, { locked: boolean; queue: Array<() => void> }>()

  constructor(config: JsonlEventStoreConfig) {
    this.dataDir = config.dataDir
  }

  private getStreamPath(runId: string): string {
    const prefix = runId.substring(0, 2)
    return path.join(this.dataDir, 'events', prefix, `${runId}.jsonl`)
  }

  /**
   * 审查修复 #2: 互斥锁（不可重入）
   *
   * 保证同一 runId 同一时刻只有一个 append 在执行。
   * 使用队列模式: 释放锁时唤醒队列头部等待者。
   */
  private acquireWriteLock(runId: string): Promise<() => void> {
    let lockState = this.writeLocks.get(runId)
    if (!lockState) {
      lockState = { locked: false, queue: [] }
      this.writeLocks.set(runId, lockState)
    }

    const release = (): void => {
      const ls = this.writeLocks.get(runId)
      if (ls) {
        ls.locked = false
        // 唤醒队列中下一个等待者
        const next = ls.queue.shift()
        if (next) {
          ls.locked = true
          next()
        } else {
          // 没有等待者，清理锁条目（防内存泄漏）
          this.writeLocks.delete(runId)
        }
      }
    }

    if (!lockState.locked) {
      lockState.locked = true
      return Promise.resolve(release)
    }

    // 排队等待
    return new Promise<() => void>((resolve) => {
      lockState!.queue.push(() => resolve(release))
    })
  }

  /** 追加事件 */
  async append(input: AppendEventsInput): Promise<void> {
    const { runId, events, expectedVersion } = input
    if (events.length === 0) return

    const release = await this.acquireWriteLock(runId)
    try {
      const currentVersion = await this.getCurrentVersion(runId)

      // 乐观并发校验
      if (expectedVersion === 'no_stream') {
        if (currentVersion > 0) {
          throw new AGCError(
            AGCErrorCode.STATE_VERSION_CONFLICT,
            `流 ${runId} 已存在（当前版本 ${currentVersion}），但 expectedVersion='no_stream'`,
          )
        }
      } else if (typeof expectedVersion === 'number') {
        if (currentVersion !== expectedVersion) {
          throw new AGCError(
            AGCErrorCode.STATE_VERSION_CONFLICT,
            `版本冲突: 期望 ${expectedVersion}，实际 ${currentVersion}`,
          )
        }
      }
      // expectedVersion === 'any' → 跳过校验

      // 二次审查 P1 修复: 校验 event.runId 与目标 runId 一致
      const startVersion = currentVersion <= 0 ? 1 : currentVersion + 1
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!
        if (event.runId !== runId) {
          throw new AGCError(
            AGCErrorCode.STATE_VERSION_CONFLICT,
            `事件 runId 不匹配: 期望 ${runId}，实际 ${event.runId}`,
          )
        }
        if (event.version !== startVersion + i) {
          throw new AGCError(
            AGCErrorCode.STATE_VERSION_CONFLICT,
            `版本不连续: 期望 ${startVersion + i}，实际 ${event.version}`,
          )
        }
      }

      // Phase 4 接入: 跨进程文件锁 + 序列化并原子追加
      const streamPath = this.getStreamPath(runId)
      const lines = events.map(e => JSON.stringify(e))
      // 三模型建议修复: 确保父目录存在 (withFileLock 需要目录来创建 .lock 文件)
      const dir = path.dirname(streamPath)
      await fs.promises.mkdir(dir, { recursive: true })
      await withFileLock(streamPath, async () => {
        await appendJsonlLines(streamPath, lines)
      })
    } finally {
      release()
    }
  }

  /** 加载全部事件 */
  async load(query: LoadEventsQuery): Promise<AGCEventEnvelope[]> {
    const events: AGCEventEnvelope[] = []
    for await (const event of this.loadStream(query)) {
      events.push(event)
    }
    return events
  }

  /** 流式加载事件 — O(1) 内存 */
  async *loadStream(query: LoadEventsQuery): AsyncIterable<AGCEventEnvelope> {
    const streamPath = this.getStreamPath(query.runId)
    for await (const event of readJsonlStream<AGCEventEnvelope>(streamPath)) {
      if (query.fromVersion !== undefined && event.version < query.fromVersion) {
        continue
      }
      yield event
    }
  }

  /** 获取当前最新版本号 */
  async getCurrentVersion(runId: string): Promise<number> {
    const streamPath = this.getStreamPath(runId)
    const lastEvent = await readLastJsonlLine<AGCEventEnvelope>(streamPath)
    return lastEvent?.version ?? 0
  }

  /** 检查运行是否存在 */
  async exists(runId: string): Promise<boolean> {
    const streamPath = this.getStreamPath(runId)
    try {
      await fs.promises.access(streamPath, fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }
}
