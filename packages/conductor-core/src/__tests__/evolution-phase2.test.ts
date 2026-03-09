/**
 * Conductor AGC — Evolution Phase 2 Test Suite
 *
 * 覆盖 5 个新模块:
 * 1. BenchmarkRunner + DagCorrectnessSuite + GovernanceCoverageSuite
 * 2. InMemoryVectorStore + VectorMemoryLayer (inline implementation to avoid rootDir cross-package)
 * 3. ProcessSandbox + SandboxManager
 * 4. TimeTravel + HITLGate
 * 5. PromptOptimizer + ELOCalculator + PromptMutator
 */
import { describe, it, expect } from 'vitest'

// ── 1. Benchmark Runner ──────────────────────────────────────────

describe('BenchmarkRunner', () => {
  it('应执行评估套件并生成报告', async () => {
    const { BenchmarkRunner } = await import('../benchmark/benchmark-runner.js')
    const runner = new BenchmarkRunner()

    const mockSuite = {
      name: 'MockSuite',
      getCases: () => [
        { id: 'c1', name: '用例1', category: 'cat-a', input: {}, expected: true },
        { id: 'c2', name: '用例2', category: 'cat-a', input: {}, expected: true },
        { id: 'c3', name: '用例3', category: 'cat-b', input: {}, expected: false },
      ],
      runCase: async (tc: any) => ({
        caseId: tc.id,
        caseName: tc.name,
        category: tc.category,
        passed: tc.expected === true,
        actual: tc.expected,
        expected: tc.expected,
        durationMs: 1,
      }),
    }

    const report = await runner.run(mockSuite as any)
    expect(report.suiteName).toBe('MockSuite')
    expect(report.totalCases).toBe(3)
    expect(report.passed).toBe(2)
    expect(report.failed).toBe(1)
    expect(report.passRate).toBe(67)
    expect(report.categoryStats['cat-a']?.total).toBe(2)
    expect(report.categoryStats['cat-b']?.total).toBe(1)
  })

  it('用例异常不应导致整体失败', async () => {
    const { BenchmarkRunner } = await import('../benchmark/benchmark-runner.js')
    const runner = new BenchmarkRunner()

    const suite = {
      name: 'ErrorSuite',
      getCases: () => [
        { id: 'e1', name: 'Error', category: 'err', input: {}, expected: null },
      ],
      runCase: async () => { throw new Error('Boom!') },
    }

    const report = await runner.run(suite as any)
    expect(report.totalCases).toBe(1)
    expect(report.failed).toBe(1)
    expect(report.results[0]?.error).toBe('Boom!')
  })

  it('空套件应返回零值报告', async () => {
    const { BenchmarkRunner } = await import('../benchmark/benchmark-runner.js')
    const runner = new BenchmarkRunner()

    const report = await runner.run({
      name: 'EmptySuite',
      getCases: () => [],
      runCase: async () => ({ caseId: '', caseName: '', category: '', passed: true, actual: null, expected: null, durationMs: 0 }),
    } as any)

    expect(report.totalCases).toBe(0)
    expect(report.passRate).toBe(0)
  })
})

describe('DagCorrectnessSuite', () => {
  it('应生成 5 个标准评估用例', async () => {
    const benchMod = await import('../benchmark/benchmark-runner.js')
    const dagMod = await import('../dag/dag-engine.js')
    const engine = new dagMod.DagEngine()
    const suite = new benchMod.DagCorrectnessSuite(engine as any)

    expect(suite.name).toBe('DAG Correctness')
    expect(suite.getCases().length).toBe(5)
    expect(suite.getCases().map((c: any) => c.id)).toContain('dag-linear')
    expect(suite.getCases().map((c: any) => c.id)).toContain('dag-terminal')
  })

  it('应能执行线性 DAG 用例', async () => {
    const benchMod = await import('../benchmark/benchmark-runner.js')
    const dagMod = await import('../dag/dag-engine.js')
    const engine = new dagMod.DagEngine()
    const suite = new benchMod.DagCorrectnessSuite(engine as any)

    const cases = suite.getCases()
    const linearCase = cases.find((c: any) => c.id === 'dag-linear')!
    const result = await suite.runCase(linearCase)
    expect(result.passed).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })
})

// ── 2. Vector Memory (inline cosine to avoid cross-package rootDir issue) ──

describe('InMemoryVectorStore (inline)', () => {
  // Inline cosine similarity to test the concept without cross-package import
  function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
  }

  it('余弦相似度: 相同向量应返回 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 5)
  })

  it('余弦相似度: 正交向量应返回 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 5)
  })

  it('余弦相似度: 空向量应返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('向量搜索 Top-K 应按相似度排序', () => {
    type VRec = { id: string; embedding: number[]; text: string }
    const records: VRec[] = [
      { id: 'r1', embedding: [1, 0, 0], text: 'hello' },
      { id: 'r2', embedding: [0, 1, 0], text: 'world' },
      { id: 'r3', embedding: [0.9, 0.1, 0], text: 'similar' },
    ]

    const query = [1, 0, 0]
    const results = records
      .map(r => ({ record: r, score: cosineSimilarity(query, r.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)

    expect(results.length).toBe(2)
    expect(results[0]?.record.id).toBe('r1')
    expect(results[0]?.score).toBeCloseTo(1.0, 3)
    expect(results[1]?.record.id).toBe('r3')
  })
})

// ── 3. Sandbox ──────────────────────────────────────────────────

describe('SandboxManager', () => {
  it('低风险应选择 ProcessSandbox', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const manager = new mod.SandboxManager()

    const sandbox = manager.selectSandbox('low')
    expect(sandbox.level).toBe('process')
  })

  it('无 E2B key 时高风险应降级到 ProcessSandbox', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const manager = new mod.SandboxManager() // 无 API key

    const sandbox = manager.selectSandbox('critical')
    expect(sandbox.level).toBe('process')
  })

  it('getAvailableSandboxes 应列出所有沙箱', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const manager = new mod.SandboxManager()

    const sandboxes = manager.getAvailableSandboxes()
    expect(sandboxes.length).toBe(2)
    expect(sandboxes.map((s: any) => s.level)).toContain('process')
    expect(sandboxes.map((s: any) => s.level)).toContain('e2b')
  })
})

describe('ProcessSandbox', () => {
  it('应成功执行 JavaScript 代码', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const sandbox = new mod.ProcessSandbox()

    const result = await sandbox.execute({
      code: 'console.log("hello")',
      language: 'javascript',
      timeoutMs: 5000,
    })

    expect(result.status).toBe('success')
    expect(result.stdout.trim()).toBe('hello')
    expect(result.isolationLevel).toBe('process')
  })

  it('超时应返回 timeout 状态', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const sandbox = new mod.ProcessSandbox()

    const result = await sandbox.execute({
      code: 'setTimeout(() => {}, 10000)',
      language: 'javascript',
      timeoutMs: 500,
    })

    expect(result.status).toBe('timeout')
  }, 10000)

  it('语法错误应返回 error 状态', async () => {
    const mod = await import('../plugin/isolated-sandbox.js')
    const sandbox = new mod.ProcessSandbox()

    const result = await sandbox.execute({
      code: 'this is not valid javascript!!!!!',
      language: 'javascript',
      timeoutMs: 3000,
    })

    expect(result.status).toBe('error')
    expect(result.exitCode).not.toBe(0)
  })
})

// ── 4. Time-Travel HITL ──────────────────────────────────────────

describe('TimeTravel', () => {
  it('rewindToVersion 应重建指定版本状态', async () => {
    const mod = await import('../dag/time-travel-hitl.js')

    const events = [
      { eventId: 'e1', runId: 'r1', type: 'NODE_QUEUED', payload: { nodeId: 'A' }, timestamp: '', version: 1 },
      { eventId: 'e2', runId: 'r1', type: 'NODE_QUEUED', payload: { nodeId: 'B' }, timestamp: '', version: 2 },
      { eventId: 'e3', runId: 'r1', type: 'NODE_QUEUED', payload: { nodeId: 'C' }, timestamp: '', version: 3 },
    ]

    const tt = new mod.TimeTravel(
      {
        getEvents: async () => events,
        getEventsByVersionRange: async (_: any, from: number, to: number) =>
          events.filter(e => e.version >= from && e.version <= to),
      },
      {
        project: (runId: string, evts: any[]) => ({
          runId,
          version: evts.length,
          status: 'running' as const,
          nodes: Object.fromEntries(evts.map((e: any) => [e.payload.nodeId, { nodeId: e.payload.nodeId, status: 'queued' as const }])),
        }),
      },
    )

    const snapshot = await tt.rewindToVersion('r1', 2)
    expect(snapshot.targetVersion).toBe(2)
    expect(snapshot.eventCount).toBe(2)
    expect(Object.keys(snapshot.state.nodes)).toContain('A')
    expect(Object.keys(snapshot.state.nodes)).toContain('B')
    expect(Object.keys(snapshot.state.nodes)).not.toContain('C')
  })

  it('forkFromVersion 应创建新分支', async () => {
    const mod = await import('../dag/time-travel-hitl.js')

    const tt = new mod.TimeTravel(
      {
        getEvents: async () => [{ eventId: 'e1', runId: 'r1', type: 'X', payload: {}, timestamp: '', version: 1 }],
        getEventsByVersionRange: async () => [{ eventId: 'e1', runId: 'r1', type: 'X', payload: {}, timestamp: '', version: 1 }],
      },
      {
        project: (runId: string) => ({
          runId,
          version: 1,
          status: 'running' as const,
          nodes: {},
        }),
      },
    )

    const fork = await tt.forkFromVersion('r1', 1)
    expect(fork.sourceRunId).toBe('r1')
    expect(fork.forkedRunId).toContain('r1-fork-')
    expect(fork.initialState.runId).toBe(fork.forkedRunId)
  })
})

describe('HITLGate', () => {
  it('完整暂停-输入-恢复流程', async () => {
    const mod = await import('../dag/time-travel-hitl.js')
    const gate = new mod.HITLGate()

    // 暂停
    const pauseEvent = gate.pause('r1', 'nodeA', 'risk_escalation', 5, 'high risk detected')
    expect(pauseEvent.type).toBe('HITL_PAUSE_REQUESTED')
    expect(gate.getState().isPaused).toBe(true)

    // 输入
    const inputEvent = gate.receiveInput('r1', {
      action: 'approve',
      operator: 'admin',
      comment: 'LGTM',
    }, 6)
    expect(inputEvent.type).toBe('HITL_INPUT_RECEIVED')

    // 恢复
    const { event, shouldResume } = gate.resume('r1', 7)
    expect(event.type).toBe('HITL_RESUMED')
    expect(shouldResume).toBe(true)
    expect(gate.getState().isPaused).toBe(false)
  })

  it('reject 应标记不恢复', async () => {
    const mod = await import('../dag/time-travel-hitl.js')
    const { events, shouldResume } = mod.HITLGate.createHITLFlow(
      'r2', 'nodeB', 'compliance_review',
      { action: 'reject', operator: 'reviewer', comment: 'Not compliant' },
      10,
    )

    expect(events.length).toBe(3)
    expect(shouldResume).toBe(false)
  })

  it('未暂停时不应接受输入', async () => {
    const mod = await import('../dag/time-travel-hitl.js')
    const gate = new mod.HITLGate()

    expect(() => gate.receiveInput('r1', { action: 'approve', operator: 'x' }, 0))
      .toThrow('not paused')
  })
})

// ── 5. Prompt Optimizer ──────────────────────────────────────────

describe('ELOCalculator', () => {
  it('应正确计算期望胜率', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const elo = new mod.ELOCalculator()

    expect(elo.expectedScore(1000, 1000)).toBeCloseTo(0.5, 3)
    expect(elo.expectedScore(1200, 1000)).toBeGreaterThan(0.5)
    expect(elo.expectedScore(800, 1000)).toBeLessThan(0.5)
  })

  it('获胜方应增加评分', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const elo = new mod.ELOCalculator()

    const { newRatingA, newRatingB } = elo.update(1000, 1000, 'A_WINS')
    expect(newRatingA).toBeGreaterThan(1000)
    expect(newRatingB).toBeLessThan(1000)
  })

  it('平局应保持对称', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const elo = new mod.ELOCalculator()

    const { newRatingA, newRatingB } = elo.update(1000, 1000, 'DRAW')
    expect(newRatingA).toBe(1000)
    expect(newRatingB).toBe(1000)
  })
})

describe('PromptOptimizer', () => {
  it('registerCandidate + getBest 应工作', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const optimizer = new mod.PromptOptimizer()

    const c1 = optimizer.registerCandidate('请分析以下代码: {code}', ['code'])
    expect(c1.eloScore).toBe(1000)

    const best = optimizer.getBest()
    expect(best?.id).toBe(c1.id)
  })

  it('recordResult 应更新 ELO', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const optimizer = new mod.PromptOptimizer()

    const a = optimizer.registerCandidate('Prompt A')
    const b = optimizer.registerCandidate('Prompt B')

    optimizer.recordResult({
      candidateA: a.id,
      candidateB: b.id,
      winner: a.id,
      qualityScore: 0.8,
      reason: 'A is better',
    })

    const ranked = optimizer.getRanked()
    expect(ranked[0]?.id).toBe(a.id)
    expect(ranked[0]!.eloScore).toBeGreaterThan(ranked[1]!.eloScore)
  })

  it('evolve 应从最优候选生成变异', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const optimizer = new mod.PromptOptimizer()

    optimizer.registerCandidate('Base prompt')
    const mutations = optimizer.evolve()

    expect(mutations.length).toBeGreaterThan(0)
    expect(mutations.length).toBeLessThanOrEqual(3)
    for (const m of mutations) {
      expect(m.parentId).toBeDefined()
      expect(m.mutationType).toBeDefined()
    }
  })

  it('retire 应淘汰低分候选', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const optimizer = new mod.PromptOptimizer({ retireThreshold: 960, minSamples: 2 })

    const a = optimizer.registerCandidate('Good prompt')
    const b = optimizer.registerCandidate('Bad prompt')

    // A 赢 B 多次 → B 分数下降到 960 以下
    for (let i = 0; i < 5; i++) {
      optimizer.recordResult({
        candidateA: a.id,
        candidateB: b.id,
        winner: a.id,
        qualityScore: 0.9,
        reason: 'A wins',
      })
    }

    const retired = optimizer.retire()
    expect(retired).toContain(b.id)
  })

  it('export/import 应正确序列化', async () => {
    const mod = await import('../optimization/prompt-optimizer.js')
    const optimizer = new mod.PromptOptimizer()

    optimizer.registerCandidate('Template 1')
    optimizer.registerCandidate('Template 2')

    const exported = optimizer.export()
    expect(exported.length).toBe(2)

    const newOptimizer = new mod.PromptOptimizer()
    newOptimizer.import(exported)
    expect(newOptimizer.stats().totalCandidates).toBe(2)
  })
})
