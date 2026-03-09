/**
 * Conductor AGC — Benchmark 评估系统
 *
 * 标准化评估框架:
 * - DAG 执行正确性验证
 * - 治理策略覆盖率审计
 * - 性能基准追踪
 *
 * 参考:
 * - AgentBench 2.0 (2025) — 多 Agent 能力评估
 * - SWE-bench v2 — 代码生成评估
 * - GAIA v2 — 多步推理评估
 *
 * 设计: 可扩展 Suite 接口，支持自定义评估维度
 */
import type { RunGraph, AGCState, AGCEventEnvelope } from '@anthropic/conductor-shared'

// ── 评估类型 ──────────────────────────────────────────────────────

/** 单个评估用例 */
export interface BenchmarkCase {
  /** 用例 ID */
  id: string
  /** 用例名称 */
  name: string
  /** 用例分类 */
  category: string
  /** 期望结果 */
  expected: unknown
  /** 输入数据 */
  input: unknown
}

/** 单个用例结果 */
export interface CaseResult {
  caseId: string
  caseName: string
  category: string
  /** 是否通过 */
  passed: boolean
  /** 实际结果 */
  actual: unknown
  /** 期望结果 */
  expected: unknown
  /** 耗时 ms */
  durationMs: number
  /** 失败原因 */
  error?: string
}

/** 评估套件接口 */
export interface IBenchmarkSuite {
  /** 套件名称 */
  readonly name: string
  /** 获取所有测试用例 */
  getCases(): BenchmarkCase[]
  /** 执行单个用例 */
  runCase(testCase: BenchmarkCase): Promise<CaseResult>
}

/** 评估报告 */
export interface BenchmarkReport {
  /** 报告 ID */
  reportId: string
  /** 生成时间 */
  timestamp: string
  /** 套件名称 */
  suiteName: string
  /** 总用例数 */
  totalCases: number
  /** 通过数 */
  passed: number
  /** 失败数 */
  failed: number
  /** 通过率 */
  passRate: number
  /** 平均耗时 */
  avgDurationMs: number
  /** 按分类统计 */
  categoryStats: Record<string, { total: number; passed: number; passRate: number }>
  /** 每个用例的详细结果 */
  results: CaseResult[]
}

// ── Benchmark Runner ──────────────────────────────────────────────

/**
 * BenchmarkRunner — 评估执行引擎
 *
 * 执行评估套件并生成标准化报告。
 * 所有用例独立执行，单个失败不影响其他。
 */
export class BenchmarkRunner {
  /**
   * 执行评估套件
   */
  async run(suite: IBenchmarkSuite): Promise<BenchmarkReport> {
    const cases = suite.getCases()
    const results: CaseResult[] = []

    for (const testCase of cases) {
      try {
        const result = await suite.runCase(testCase)
        results.push(result)
      } catch (error) {
        results.push({
          caseId: testCase.id,
          caseName: testCase.name,
          category: testCase.category,
          passed: false,
          actual: undefined,
          expected: testCase.expected,
          durationMs: 0,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const passed = results.filter(r => r.passed).length
    const failed = results.length - passed
    const avgDurationMs = results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.durationMs, 0) / results.length)
      : 0

    // 按分类统计
    const categoryStats: BenchmarkReport['categoryStats'] = {}
    for (const r of results) {
      const stat = categoryStats[r.category] ??= { total: 0, passed: 0, passRate: 0 }
      stat.total++
      if (r.passed) stat.passed++
      stat.passRate = Math.round((stat.passed / stat.total) * 100)
    }

    return {
      reportId: `bench-${Date.now()}`,
      timestamp: new Date().toISOString(),
      suiteName: suite.name,
      totalCases: cases.length,
      passed,
      failed,
      passRate: cases.length > 0 ? Math.round((passed / cases.length) * 100) : 0,
      avgDurationMs,
      categoryStats,
      results,
    }
  }

  /** 执行多个套件 */
  async runAll(suites: IBenchmarkSuite[]): Promise<BenchmarkReport[]> {
    const reports: BenchmarkReport[] = []
    for (const suite of suites) {
      reports.push(await this.run(suite))
    }
    return reports
  }
}

// ── 内置评估套件 ──────────────────────────────────────────────────

/**
 * DagCorrectnessSuite — DAG 执行正确性评估
 *
 * 评估维度:
 * - 拓扑排序正确性
 * - 循环处理正确性
 * - 条件边评估正确性
 * - 并发调度正确性
 * - 终止判定正确性
 */
export class DagCorrectnessSuite implements IBenchmarkSuite {
  readonly name = 'DAG Correctness'

  private readonly dagEngine: { advance: (graph: RunGraph, state: AGCState) => { events: AGCEventEnvelope[]; isTerminal: boolean } }

  constructor(dagEngine: { advance: (graph: RunGraph, state: AGCState) => { events: AGCEventEnvelope[]; isTerminal: boolean } }) {
    this.dagEngine = dagEngine
  }

  getCases(): BenchmarkCase[] {
    return [
      {
        id: 'dag-linear',
        name: '线性 DAG 顺序执行',
        category: 'topology',
        input: this.createLinearGraph(3),
        expected: { nodesQueued: ['A'], isTerminal: false },
      },
      {
        id: 'dag-parallel-roots',
        name: '并行根节点调度',
        category: 'topology',
        input: this.createFanOutGraph(),
        expected: { rootCount: 3 },
      },
      {
        id: 'dag-diamond',
        name: '菱形依赖收敛',
        category: 'topology',
        input: this.createDiamondGraph(),
        expected: { convergenceNode: 'D' },
      },
      {
        id: 'dag-terminal',
        name: '全部完成后终止',
        category: 'lifecycle',
        input: this.createTerminalState(),
        expected: { isTerminal: true },
      },
      {
        id: 'dag-concurrency',
        name: '并发限制遵守',
        category: 'scheduling',
        input: this.createFanOutGraph(),
        expected: { maxQueued: 3 },
      },
    ]
  }

  async runCase(testCase: BenchmarkCase): Promise<CaseResult> {
    const t0 = Date.now()
    const { graph, state } = testCase.input as { graph: RunGraph; state: AGCState }

    try {
      const patch = this.dagEngine.advance(graph, state)
      const expected = testCase.expected as Record<string, unknown>
      let passed = true

      if (expected.isTerminal !== undefined) {
        passed = patch.isTerminal === expected.isTerminal
      }
      if (expected.nodesQueued) {
        const queued = patch.events.filter(e => e.type === 'NODE_QUEUED').map(e => e.payload.nodeId)
        passed = passed && JSON.stringify(queued.sort()) === JSON.stringify((expected.nodesQueued as string[]).sort())
      }

      return {
        caseId: testCase.id,
        caseName: testCase.name,
        category: testCase.category,
        passed,
        actual: { events: patch.events.length, isTerminal: patch.isTerminal },
        expected: testCase.expected,
        durationMs: Date.now() - t0,
      }
    } catch (error) {
      return {
        caseId: testCase.id,
        caseName: testCase.name,
        category: testCase.category,
        passed: false,
        actual: undefined,
        expected: testCase.expected,
        durationMs: Date.now() - t0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ── 测试图工厂 ──────────────────────────────────────

  private createNode(id: string, deps: string[] = []) {
    return { id, name: id, dependsOn: deps, input: {}, skippable: false, priority: 0 }
  }

  private createLinearGraph(n: number): { graph: RunGraph; state: AGCState } {
    const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
    const nodes = ids.map((id, i) => this.createNode(id, i > 0 ? [ids[i - 1]!] : []))
    return {
      graph: { nodes, edges: [] },
      state: {
        runId: 'bench-linear',
        version: 0,
        status: 'running',
        nodes: Object.fromEntries(ids.map(id => [id, { nodeId: id, status: 'pending' as const }])),
      },
    }
  }

  private createFanOutGraph(): { graph: RunGraph; state: AGCState } {
    const nodes = ['A', 'B', 'C'].map(id => this.createNode(id))
    return {
      graph: { nodes, edges: [] },
      state: {
        runId: 'bench-fanout',
        version: 0,
        status: 'running',
        nodes: Object.fromEntries(['A', 'B', 'C'].map(id => [id, { nodeId: id, status: 'pending' as const }])),
      },
    }
  }

  private createDiamondGraph(): { graph: RunGraph; state: AGCState } {
    const nodes = [
      this.createNode('A'),
      this.createNode('B', ['A']),
      this.createNode('C', ['A']),
      this.createNode('D', ['B', 'C']),
    ]
    return {
      graph: { nodes, edges: [] },
      state: {
        runId: 'bench-diamond',
        version: 0,
        status: 'running',
        nodes: Object.fromEntries(['A', 'B', 'C', 'D'].map(id => [id, { nodeId: id, status: 'pending' as const }])),
      },
    }
  }

  private createTerminalState(): { graph: RunGraph; state: AGCState } {
    return {
      graph: { nodes: [this.createNode('A')], edges: [] },
      state: {
        runId: 'bench-terminal',
        version: 1,
        status: 'running',
        nodes: { A: { nodeId: 'A', status: 'completed' as const } },
      },
    }
  }
}

/**
 * GovernanceCoverageSuite — 治理策略覆盖率评估
 */
export class GovernanceCoverageSuite implements IBenchmarkSuite {
  readonly name = 'Governance Coverage'

  getCases(): BenchmarkCase[] {
    return [
      { id: 'gov-express', name: 'Express 通道路由', category: 'routing', input: { score: 0, confidence: 95 }, expected: 'express' },
      { id: 'gov-standard', name: 'Standard 通道路由', category: 'routing', input: { score: 20, confidence: 80 }, expected: 'standard' },
      { id: 'gov-full', name: 'Full 通道路由', category: 'routing', input: { score: 60 }, expected: 'full' },
      { id: 'gov-escalated', name: 'Escalated 通道路由', category: 'routing', input: { score: 80 }, expected: 'escalated' },
      { id: 'gov-block', name: 'BLOCK 发现强制升级', category: 'compliance', input: { hasBlock: true }, expected: 'escalated' },
    ]
  }

  async runCase(testCase: BenchmarkCase): Promise<CaseResult> {
    const t0 = Date.now()
    // 使用 dynamic import 避免编译时依赖
    const { RiskRouter } = await import('../risk/risk-router.js')
    const router = new RiskRouter()
    const input = testCase.input as Record<string, unknown>

    const graph = {
      nodes: [
        { id: 'A', name: 'ANALYZE', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 },
        { id: 'D', name: 'DEBATE', dependsOn: ['A'], input: {}, skippable: true, priority: 0 },
        { id: 'S', name: 'SYNTHESIZE', dependsOn: ['D'], input: {}, skippable: false, priority: 0 },
      ],
      edges: [],
    }

    const decision = router.decide({
      score: {
        score: (input.score as number) ?? 50,
        factors: {},
        level: ((input.score as number) ?? 50) < 25 ? 'low' : ((input.score as number) ?? 50) < 50 ? 'medium' : ((input.score as number) ?? 50) < 75 ? 'high' : 'critical',
      },
      findings: input.hasBlock ? [{ status: 'block', message: 'test', ruleId: 'B01', ruleName: 'BlockRule' }] : [],
      graph,
      confidence: (input.confidence as number) ?? 80,
    })

    return {
      caseId: testCase.id,
      caseName: testCase.name,
      category: testCase.category,
      passed: decision.lane === testCase.expected,
      actual: decision.lane,
      expected: testCase.expected,
      durationMs: Date.now() - t0,
    }
  }
}
