/**
 * concurrent-event-store.spec.ts — EventStore 并发写入测试
 *
 * 三模型建议 3: 并发集成测试
 *
 * 测试 EventStore 的进程内互斥锁在并发场景下的正确性。
 * 由于 JsonlEventStore 严格校验事件版本连续性,
 * 并发测试需要在获取锁后动态生成正确版本号。
 *
 * 覆盖:
 * 1. 多个 Promise.all 并发 append 同一 runId 的一致性
 * 2. 多 runId 并发写入互不干扰
 * 3. 并发 load 的读一致性
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { JsonlEventStore } from '../event-store/jsonl-event-store.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { WorkflowEventEnvelope } from '@anthropic/antigravity-shared'

describe('EventStore 并发写入', () => {
  let tempDir: string
  let store: JsonlEventStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-concurrent-'))
    store = new JsonlEventStore({ dataDir: tempDir })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  /** 创建测试事件 (版本号由调用者指定) */
  function createEvent(runId: string, version: number, seq: number): WorkflowEventEnvelope {
    return {
      eventId: `evt-${runId}-${seq}`,
      runId,
      type: 'NODE_STARTED',
      timestamp: new Date().toISOString(),
      version,
      payload: { seq } as Record<string, unknown>,
    } as WorkflowEventEnvelope
  }

  /**
   * 顺序写入 N 个事件到指定 runId
   *
   * 每次写入前先读取当前版本, 生成正确版本号的事件,
   * 依赖 EventStore 内部互斥锁保证串行执行。
   */
  async function appendSequential(runId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const events = await store.load({ runId })
      const nextVersion = events.length + 1
      await store.append({
        runId,
        events: [createEvent(runId, nextVersion, i)],
        expectedVersion: 'any',
      })
    }
  }

  it('顺序 append 同一 runId — 版本连续', async () => {
    const runId = 'seq-run'
    await appendSequential(runId, 10)

    const events = await store.load({ runId })
    expect(events).toHaveLength(10)

    // 版本号应从 1 开始递增
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.version).toBe(i + 1)
    }
  })

  it('并发 appendSequential 不同 runId — 互不干扰', async () => {
    const runs = ['run-a', 'run-b', 'run-c']
    const eventsPerRun = 5

    // 3 个 run 并行各写 5 个事件
    const promises = runs.map((runId: string) => appendSequential(runId, eventsPerRun))
    await Promise.all(promises)

    // 各 run 应独立拥有正确数量的事件
    for (const runId of runs) {
      const events = await store.load({ runId })
      expect(events).toHaveLength(eventsPerRun)
      for (const evt of events) {
        expect(evt.runId).toBe(runId)
      }
    }
  })

  it('并发 load — 读取不应互相干扰', async () => {
    const runId = 'read-test'

    // 先写入 10 个事件
    await appendSequential(runId, 10)

    // 并发 10 次 load
    const loadResults: WorkflowEventEnvelope[][] = []
    const promises = Array.from({ length: 10 }, () =>
      store.load({ runId }).then((events: WorkflowEventEnvelope[]) => {
        loadResults.push(events)
      }),
    )

    await Promise.all(promises)

    // 每次 load 应返回完全相同的 10 个事件
    for (const events of loadResults) {
      expect(events).toHaveLength(10)
      for (let i = 0; i < events.length; i++) {
        expect(events[i]!.version).toBe(i + 1)
        expect(events[i]!.eventId).toBeTruthy()
      }
    }
  })

  it('互斥锁竞争 — 版本冲突正确拒绝', async () => {
    const runId = 'mutex-test'
    const concurrency = 10

    // 创建 10 个"写入者", 每个都在锁外读取版本 0
    // 然后尝试写入 version: 1 的事件
    // 由于互斥锁串行执行, 只有第一个能成功
    // 其余因 event.version(1) != startVersion(2,3,...) 而失败
    // 这验证了 EventStore 的版本完整性保证
    const promises = Array.from({ length: concurrency }, (_: unknown, i: number) =>
      store.append({
        runId,
        events: [createEvent(runId, 1, i)],
        expectedVersion: 'any',
      }),
    )

    const results = await Promise.allSettled(promises)
    const succeeded = results.filter((r: PromiseSettledResult<void>) => r.status === 'fulfilled').length
    const failed = results.filter((r: PromiseSettledResult<void>) => r.status === 'rejected').length

    // 只有第一个写入者成功 (version: 1 匹配空流的 startVersion: 1)
    expect(succeeded).toBe(1)
    // 其余 9 个因版本不连续而被正确拒绝
    expect(failed).toBe(concurrency - 1)

    // 最终只有 1 个事件, 且版本为 1
    const events = await store.load({ runId })
    expect(events).toHaveLength(1)
    expect(events[0]!.version).toBe(1)
  })
})
