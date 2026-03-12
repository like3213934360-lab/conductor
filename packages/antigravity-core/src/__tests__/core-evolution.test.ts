/**
 * Antigravity Workflow Runtime — 核心测试套件
 *
 * 覆盖矩阵:
 * 1. DagEngine — 正常流、并发限制、终止判定
 * 2. RiskRouter — 四级路由、快速通道、BLOCK 升级
 * 3. SnapshotStore — 保存/查找/修剪、SnapshotManager 增量回放
 * 4. Observability Tracer — span 层级、NoOp 行为
 *
 * vitest 6.x + TypeScript 5.3+
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── 1. DagEngine Tests ──────────────────────────────────────────────

describe('DagEngine', () => {
  // 动态导入避免路径问题
  let DagEngine: any
  let topologicalSort: any
  let findReadyNodes: any

  beforeEach(async () => {
    const dagModule = await import('../dag/dag-engine.js')
    DagEngine = dagModule.DagEngine
    const topoModule = await import('../dag/topology.js')
    topologicalSort = topoModule.topologicalSort
    findReadyNodes = topoModule.findReadyNodes
  })

  describe('validate', () => {
    it('空图应抛出 GRAPH_EMPTY 错误', () => {
      expect(() => topologicalSort({ nodes: [], edges: [] })).toThrow()
    })

    it('单节点图应通过验证', () => {
      const result = topologicalSort({
        nodes: [{ id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 }],
        edges: [],
      })
      expect(result).toEqual(['A'])
    })

    it('线性链应返回正确拓扑顺序', () => {
      const result = topologicalSort({
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
          { id: 'C', name: 'C', dependsOn: ['B'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      })
      expect(result).toEqual(['A', 'B', 'C'])
    })

    it('有环图应抛出 GRAPH_CYCLE_DETECTED', () => {
      expect(() => topologicalSort({
        nodes: [
          { id: 'A', name: 'A', dependsOn: ['C'], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
          { id: 'C', name: 'C', dependsOn: ['B'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      })).toThrow('环')
    })
  })

  describe('findReadyNodes', () => {
    it('应找到所有无前驱的根节点', () => {
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'C', name: 'C', dependsOn: ['A', 'B'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const ready = findReadyNodes(graph, { A: 'pending', B: 'pending', C: 'pending' })
      expect(ready).toEqual(expect.arrayContaining(['A', 'B']))
      expect(ready).not.toContain('C')
    })

    it('前驱完成后应就绪', () => {
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const ready = findReadyNodes(graph, { A: 'completed', B: 'pending' })
      expect(ready).toEqual(['B'])
    })

    it('跳过的前驱应视为完成', () => {
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const ready = findReadyNodes(graph, { A: 'skipped', B: 'pending' })
      expect(ready).toEqual(['B'])
    })

    it('按 priority 降序排列就绪节点', () => {
      const graph = {
        nodes: [
          { id: 'A', name: 'Low', dependsOn: [], input: {}, skippable: false, priority: 1 },
          { id: 'B', name: 'High', dependsOn: [], input: {}, skippable: false, priority: 10 },
          { id: 'C', name: 'Mid', dependsOn: [], input: {}, skippable: false, priority: 5 },
        ],
        edges: [],
      }
      const ready = findReadyNodes(graph, { A: 'pending', B: 'pending', C: 'pending' })
      expect(ready).toEqual(['B', 'C', 'A'])
    })
  })

  describe('advance', () => {
    it('初始状态应排队根节点', () => {
      const engine = new DagEngine()
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const state = {
        runId: 'test-run',
        version: 0,
        status: 'running' as const,
        nodes: {
          A: { status: 'pending' },
          B: { status: 'pending' },
        },
        startedAt: '',
      }
      const patch = engine.advance(graph, state as any)
      expect(patch.events.some((e: any) => e.type === 'NODE_QUEUED' && e.payload.nodeId === 'A')).toBe(true)
      expect(patch.isTerminal).toBe(false)
    })

    it('所有节点完成后应终止', () => {
      const engine = new DagEngine()
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const state = {
        runId: 'test-run',
        version: 1,
        status: 'running' as const,
        nodes: {
          A: { status: 'completed' },
        },
        startedAt: '',
      }
      const patch = engine.advance(graph, state as any)
      expect(patch.isTerminal).toBe(true)
      expect(patch.events.some((e: any) => e.type === 'RUN_COMPLETED')).toBe(true)
    })

    it('并发限制应生效', () => {
      const engine = new DagEngine({ maxConcurrency: 1 })
      const graph = {
        nodes: [
          { id: 'A', name: 'A', dependsOn: [], input: {}, skippable: false, priority: 0 },
          { id: 'B', name: 'B', dependsOn: [], input: {}, skippable: false, priority: 0 },
        ],
        edges: [],
      }
      const state = {
        runId: 'test-run',
        version: 0,
        status: 'running' as const,
        nodes: {
          A: { status: 'pending' },
          B: { status: 'pending' },
        },
        startedAt: '',
      }
      const patch = engine.advance(graph, state as any)
      const queuedEvents = patch.events.filter((e: any) => e.type === 'NODE_QUEUED')
      expect(queuedEvents.length).toBe(1)
    })
  })
})

// ── 2. RiskRouter Tests ──────────────────────────────────────────────

describe('RiskRouter', () => {
  let RiskRouter: any

  beforeEach(async () => {
    const mod = await import('../risk/risk-router.js')
    RiskRouter = mod.RiskRouter
  })

  const createGraph = () => ({
    nodes: [
      { id: 'A', name: 'ANALYZE', dependsOn: [], input: {}, skippable: false, priority: 0 },
      { id: 'D', name: 'DEBATE', dependsOn: ['A'], input: {}, skippable: true, priority: 0 },
      { id: 'S', name: 'SYNTHESIZE', dependsOn: ['D'], input: {}, skippable: false, priority: 0 },
    ],
    edges: [],
  })

  it('DR=0 高置信度应走 express 通道', () => {
    const router = new RiskRouter()
    const decision = router.decide({
      score: { score: 0, factors: {}, level: 'low' },
      findings: [],
      graph: createGraph(),
      confidence: 90,
    })
    expect(decision.lane).toBe('express')
    expect(decision.skippedNodes.length).toBeGreaterThan(0)
  })

  it('low 风险应走 standard 通道', () => {
    const router = new RiskRouter()
    const decision = router.decide({
      score: { score: 20, factors: {}, level: 'low' },
      findings: [],
      graph: createGraph(),
      confidence: 80,
    })
    expect(decision.lane).toBe('standard')
  })

  it('high 风险应走 full 通道', () => {
    const router = new RiskRouter()
    const decision = router.decide({
      score: { score: 60, factors: {}, level: 'high' },
      findings: [],
      graph: createGraph(),
    })
    expect(decision.lane).toBe('full')
  })

  it('critical 风险应走 escalated 通道', () => {
    const router = new RiskRouter()
    const decision = router.decide({
      score: { score: 80, factors: {}, level: 'critical' },
      findings: [],
      graph: createGraph(),
    })
    expect(decision.lane).toBe('escalated')
  })

  it('BLOCK 级合规发现应强制 escalated', () => {
    const router = new RiskRouter()
    const decision = router.decide({
      score: { score: 10, factors: {}, level: 'low' },
      findings: [{ status: 'block', message: 'Compliance violation', ruleId: 'S01' }],
      graph: createGraph(),
      confidence: 95,
    })
    expect(decision.lane).toBe('escalated')
  })
})

// ── 3. Snapshot Store Tests ──────────────────────────────────────────

describe('InMemorySnapshotStore', () => {
  let InMemorySnapshotStore: any
  let SnapshotManager: any

  beforeEach(async () => {
    const mod = await import('../../../antigravity-shared/src/state/snapshot-store.js')
    InMemorySnapshotStore = mod.InMemorySnapshotStore
    SnapshotManager = mod.SnapshotManager
  })

  it('保存和查找最新快照', async () => {
    const store = new InMemorySnapshotStore()
    await store.save({
      id: 'snap-1',
      aggregateId: 'run-1',
      version: 10,
      timestamp: new Date().toISOString(),
      state: { counter: 42 },
    })
    const latest = await store.findLatest('run-1')
    expect(latest).not.toBeNull()
    expect(latest!.version).toBe(10)
    expect(latest!.state.counter).toBe(42)
  })

  it('多个快照应返回最新', async () => {
    const store = new InMemorySnapshotStore()
    await store.save({ id: 's1', aggregateId: 'run-1', version: 5, timestamp: '', state: { v: 5 } })
    await store.save({ id: 's2', aggregateId: 'run-1', version: 10, timestamp: '', state: { v: 10 } })
    await store.save({ id: 's3', aggregateId: 'run-1', version: 15, timestamp: '', state: { v: 15 } })

    const latest = await store.findLatest('run-1')
    expect(latest!.version).toBe(15)
  })

  it('修剪旧快照应保留指定数量', async () => {
    const store = new InMemorySnapshotStore()
    for (let i = 1; i <= 5; i++) {
      await store.save({
        id: `snap-${i}`,
        aggregateId: 'run-1',
        version: i * 10,
        timestamp: '',
        state: { v: i },
      })
    }

    const pruned = await store.pruneOlderSnapshots('run-1', 2)
    expect(pruned).toBe(3)
    expect(store.count('run-1')).toBe(2)
  })

  it('findNearestBefore 应找到版本前最近快照', async () => {
    const store = new InMemorySnapshotStore()
    await store.save({ id: 's1', aggregateId: 'run-1', version: 10, timestamp: '', state: { v: 10 } })
    await store.save({ id: 's2', aggregateId: 'run-1', version: 20, timestamp: '', state: { v: 20 } })

    const nearest = await store.findNearestBefore('run-1', 15)
    expect(nearest!.version).toBe(10)
  })
})

// ── 4. Observability Tracer Tests ────────────────────────────────────

describe('DagEngineTracer', () => {
  let DagEngineTracer: any
  let NoOpTracer: any

  beforeEach(async () => {
    const mod = await import('../observability/dag-tracer.js')
    DagEngineTracer = mod.DagEngineTracer
    NoOpTracer = mod.NoOpTracer
  })

  it('NoOp tracer 不应抛出', () => {
    const tracer = new DagEngineTracer(new NoOpTracer())
    const ctx = tracer.startRun('test-run')
    const nodeSpan = tracer.startNode(ctx, 'node-1', 'ANALYZE')
    const llmSpan = tracer.startLLMCall(nodeSpan, {
      system: 'deepseek',
      model: 'deepseek-chat',
      operation: 'chat',
    })
    tracer.recordLLMUsage(llmSpan, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    tracer.endSpan(llmSpan)
    tracer.endNode(ctx, 'node-1', 'completed')
    tracer.endRun(ctx, 'completed')
    // 不抛出即通过
  })

  it('mock tracer 应记录正确的 span 层级', () => {
    const spans: Array<{ name: string; parent?: string }> = []
    const mockTracer = {
      startSpan(name: string) {
        const span = { name, setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }
        spans.push({ name })
        return span
      },
      startChildSpan(parent: any, name: string) {
        const span = { name, setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: vi.fn(), setStatus: vi.fn(), recordException: vi.fn(), end: vi.fn() }
        spans.push({ name, parent: parent.name })
        return span
      },
    }

    const tracer = new DagEngineTracer(mockTracer)
    const ctx = tracer.startRun('run-1', 'graph-1')
    tracer.startNode(ctx, 'n1', 'ANALYZE')
    tracer.endNode(ctx, 'n1', 'completed')
    tracer.endRun(ctx, 'completed')

    expect(spans[0]!.name).toBe('dag.run')
    expect(spans[1]!.parent).toBe('dag.run')
  })
})
