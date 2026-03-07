/**
 * async-mutex.spec.ts — 并发互斥锁 单元测试
 *
 * 三模型建议 3: 并发测试
 *
 * 覆盖:
 * 1. 基础互斥: 同一 key 串行执行
 * 2. 不同 key 并行执行
 * 3. 幂等释放: 双重 release 不崩溃
 * 4. 公平性: FIFO 顺序
 * 5. 高并发竞争: 100 个并发请求
 */
import { describe, it, expect } from 'vitest'
import { KeyedAsyncMutex } from '../../concurrency/async-mutex.js'

describe('KeyedAsyncMutex', () => {
  it('同一 key 应串行执行', async () => {
    const mutex = new KeyedAsyncMutex()
    const log: string[] = []

    const task1 = (async () => {
      const release = await mutex.acquire('run-1')
      log.push('task1-start')
      await sleep(50)
      log.push('task1-end')
      release()
    })()

    const task2 = (async () => {
      // 短暂延迟确保 task1 先获取锁
      await sleep(10)
      const release = await mutex.acquire('run-1')
      log.push('task2-start')
      log.push('task2-end')
      release()
    })()

    await Promise.all([task1, task2])

    // task1 必须完整执行后 task2 才开始
    expect(log).toEqual(['task1-start', 'task1-end', 'task2-start', 'task2-end'])
  })

  it('不同 key 应并行执行', async () => {
    const mutex = new KeyedAsyncMutex()
    const log: string[] = []

    const task1 = (async () => {
      const release = await mutex.acquire('run-1')
      log.push('run1-start')
      await sleep(50)
      log.push('run1-end')
      release()
    })()

    const task2 = (async () => {
      const release = await mutex.acquire('run-2')
      log.push('run2-start')
      await sleep(50)
      log.push('run2-end')
      release()
    })()

    await Promise.all([task1, task2])

    // 两个任务应同时开始 (交错执行)
    expect(log.indexOf('run1-start')).toBeLessThan(log.indexOf('run2-end'))
    expect(log.indexOf('run2-start')).toBeLessThan(log.indexOf('run1-end'))
  })

  it('幂等释放: 双重 release 不应崩溃', async () => {
    const mutex = new KeyedAsyncMutex()
    const release = await mutex.acquire('run-1')
    release()
    release() // 第二次调用应该是无操作
    expect(mutex.isLocked('run-1')).toBe(false)
  })

  it('释放后锁应被清理', async () => {
    const mutex = new KeyedAsyncMutex()
    const release = await mutex.acquire('run-1')
    expect(mutex.activeCount).toBe(1)
    expect(mutex.isLocked('run-1')).toBe(true)
    release()
    expect(mutex.activeCount).toBe(0)
    expect(mutex.isLocked('run-1')).toBe(false)
  })

  it('FIFO 公平性: 等待者按顺序获取锁', async () => {
    const mutex = new KeyedAsyncMutex()
    const order: number[] = []

    // 第一个获取锁
    const release1 = await mutex.acquire('run-1')

    // 接下来 3 个排队等待
    const p2 = mutex.acquire('run-1').then(release => {
      order.push(2)
      release()
    })
    const p3 = mutex.acquire('run-1').then(release => {
      order.push(3)
      release()
    })
    const p4 = mutex.acquire('run-1').then(release => {
      order.push(4)
      release()
    })

    // 给排队一些时间
    await sleep(10)

    // 释放第一个锁, 触发队列按 FIFO 执行
    release1()

    await Promise.all([p2, p3, p4])

    expect(order).toEqual([2, 3, 4])
  })

  it('withLock RAII 风格: 异常时自动释放', async () => {
    const mutex = new KeyedAsyncMutex()

    try {
      await mutex.withLock('run-1', async () => {
        throw new Error('模拟失败')
      })
    } catch {
      // 预期捕获
    }

    // 锁应已被释放
    expect(mutex.isLocked('run-1')).toBe(false)

    // 应可以再次获取
    const release = await mutex.acquire('run-1')
    expect(mutex.isLocked('run-1')).toBe(true)
    release()
  })

  it('高并发竞争: 100 个并发请求应全部完成', async () => {
    const mutex = new KeyedAsyncMutex()
    let counter = 0
    const errors: Error[] = []

    const tasks = Array.from({ length: 100 }, (_, i) =>
      mutex.withLock('shared-key', async () => {
        const before = counter
        // 模拟短暂的异步操作
        await sleep(0)
        counter = before + 1
      }).catch(err => errors.push(err)),
    )

    await Promise.all(tasks)

    // 互斥锁保证: 100 次 +1 操作最终值为 100
    expect(counter).toBe(100)
    expect(errors).toHaveLength(0)
    expect(mutex.isLocked('shared-key')).toBe(false)
  })

  it('withLock 返回值应正确传递', async () => {
    const mutex = new KeyedAsyncMutex()
    const result = await mutex.withLock('run-1', async () => {
      return 42
    })
    expect(result).toBe(42)
  })
})

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
