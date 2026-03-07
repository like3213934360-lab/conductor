/**
 * Conductor AGC — JSONL 文件 EventStore
 *
 * 实现 EventStore 接口，使用 append-only JSONL 文件持久化事件流。
 *
 * 架构特点:
 * 1. 一个 runId 对应一个 .jsonl 文件（stream-per-aggregate）
 * 2. 前缀分片避免大目录: data/events/{prefix}/{runId}.jsonl
 * 3. 文件级锁保证并发安全（单写者串行化）
 * 4. fsync 保证持久性（等同于 WAL 语义）
 * 5. 流式读取支持 O(1) 内存回放
 *
 * 学术参考:
 * - Greg Young EventStoreDB: stream-per-aggregate, expected revision
 * - Kafka log-structured storage: append-only + offset-based read
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'
import type { EventStore, AppendEventsInput, LoadEventsQuery } from '@anthropic/conductor-core'
import { appendJsonlLines, readJsonlStream, readLastJsonlLine } from './stream-utils.js'

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
  /** 进程内写锁（per-runId） */
  private readonly writeLocks: Map<string, Promise<void>> = new Map()

  constructor(config: JsonlEventStoreConfig) {
    this.dataDir = config.dataDir
  }

  /**
   * 获取 runId 对应的文件路径
   * 使用前2字符分片: data/events/ab/{runId}.jsonl
   */
  private getStreamPath(runId: string): string {
    const prefix = runId.substring(0, 2)
    return path.join(this.dataDir, 'events', prefix, `${runId}.jsonl`)
  }

  /**
   * 获取进程内写锁
   * 串行化同一 runId 的并发写入
   */
  private async acquireWriteLock(runId: string): Promise<() => void> {
    // 等待前一个写操作完成
    const prev = this.writeLocks.get(runId)
    if (prev) await prev.catch(() => {/* 忽略错误 */})

    let releaseFn: () => void
    const lockPromise = new Promise<void>(resolve => {
      releaseFn = resolve
    })
    this.writeLocks.set(runId, lockPromise)

    return releaseFn!
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
        if (currentVersion >= 0) {
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

      // 校验版本连续性
      const startVersion = currentVersion + 1
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!
        if (event.version !== startVersion + i) {
          throw new AGCError(
            AGCErrorCode.STATE_VERSION_CONFLICT,
            `版本不连续: 期望 ${startVersion + i}，实际 ${event.version}`,
          )
        }
      }

      // 序列化并原子追加
      const lines = events.map(e => JSON.stringify(e))
      await appendJsonlLines(this.getStreamPath(runId), lines)
    } finally {
      release()
    }
  }

  /** 加载全部事件（兼容 Phase 1） */
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
    return lastEvent?.version ?? -1
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
