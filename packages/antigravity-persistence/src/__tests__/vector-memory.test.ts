/**
 * Vector Memory 独立测试
 *
 * 放在 antigravity-persistence 包内，避免跨包 rootDir 问题
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryVectorStore, VectorMemoryLayer } from '../memory/vector-memory.js'

describe('InMemoryVectorStore', () => {
  let store: InMemoryVectorStore

  beforeEach(() => {
    store = new InMemoryVectorStore()
  })

  it('upsert 和 search 应正常工作', async () => {
    await store.upsert({
      id: 'r1',
      embedding: [1, 0, 0],
      text: 'hello',
      metadata: { type: 'test' },
      timestamp: new Date().toISOString(),
    })
    await store.upsert({
      id: 'r2',
      embedding: [0, 1, 0],
      text: 'world',
      metadata: { type: 'test' },
      timestamp: new Date().toISOString(),
    })

    const results = await store.search([1, 0, 0], 2)
    expect(results.length).toBe(2)
    expect(results[0]?.record.id).toBe('r1')
    expect(results[0]?.score).toBeCloseTo(1.0, 5)
    expect(results[1]?.score).toBeCloseTo(0.0, 5)
  })

  it('filter 应过滤不匹配的记录', async () => {
    await store.batchUpsert([
      { id: 'a', embedding: [1, 0], text: 'a', metadata: { type: 'alpha' }, timestamp: '' },
      { id: 'b', embedding: [1, 0], text: 'b', metadata: { type: 'beta' }, timestamp: '' },
    ])

    const results = await store.search([1, 0], 10, { type: 'alpha' })
    expect(results.length).toBe(1)
    expect(results[0]?.record.id).toBe('a')
  })

  it('delete 应移除记录', async () => {
    await store.upsert({ id: 'x', embedding: [1], text: 'x', metadata: {}, timestamp: '' })
    expect(await store.count()).toBe(1)
    await store.delete('x')
    expect(await store.count()).toBe(0)
  })

  it('空存储搜索应返回空结果', async () => {
    const results = await store.search([1, 0, 0], 10)
    expect(results).toEqual([])
  })
})

describe('VectorMemoryLayer', () => {
  it('index 和 search 应协同工作', async () => {
    const store = new InMemoryVectorStore()

    const mockEmbedder = {
      isAvailable: () => true,
      embed: async (text: string) => ({
        embedding: text.includes('fix') ? [1, 0, 0] : [0, 1, 0],
        model: 'test',
        tokens: 10,
      }),
    }

    const layer = new VectorMemoryLayer(store, mockEmbedder, { minScore: 0.1 })

    await layer.index('mem-1', 'fix auth bug in login.ts', { type: 'run' })
    await layer.index('mem-2', 'implement new feature X', { type: 'run' })

    const results = await layer.search('fix similar bug')
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]?.record.id).toBe('mem-1')
  })

  it('embedder 不可用时应优雅降级', async () => {
    const store = new InMemoryVectorStore()
    const layer = new VectorMemoryLayer(store, {
      isAvailable: () => false,
      embed: async () => { throw new Error('unavailable') },
    })

    await layer.index('test', 'test text')
    const results = await layer.search('query')
    expect(results).toEqual([])
  })

  it('stats 应返回正确的利用率', async () => {
    const store = new InMemoryVectorStore()
    const layer = new VectorMemoryLayer(store, {
      isAvailable: () => true,
      embed: async () => ({ embedding: [1, 0], model: 'test', tokens: 5 }),
    }, { maxRecords: 100 })

    await layer.index('id1', 'text1')
    const stats = await layer.stats()
    expect(stats.totalRecords).toBe(1)
    expect(stats.utilizationPercent).toBe(1)
  })
})
