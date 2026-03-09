# 📚 API Cookbook — Conductor AGC

10 个常见场景的代码示例。

---

## 1. 自定义 GovernanceControl

```typescript
import type { GovernanceControl } from '@anthropic/conductor-core'

const sensitiveDataControl: GovernanceControl = {
  id: 'custom-pii-filter',
  name: 'PII Data Filter',
  stage: 'output',
  defaultLevel: 'block',
  priority: 100,
  evaluate: async (ctx) => {
    const hasPII = /\b\d{3}-\d{2}-\d{4}\b/.test(JSON.stringify(ctx.action))
    return {
      controlId: 'custom-pii-filter',
      controlName: 'PII Data Filter',
      status: hasPII ? 'block' : 'pass',
      message: hasPII ? 'PII detected in output' : 'No PII found',
    }
  },
}

// 注册到 GovernanceGateway
gateway.register(sensitiveDataControl)
```

---

## 2. 编写插件 (Plugin)

```typescript
import type { ConductorPlugin } from '@anthropic/conductor-core'

const loggingPlugin: ConductorPlugin = {
  manifest: {
    id: 'my-logger',
    name: 'Custom Logger Plugin',
    version: '1.0.0',
    permissions: { network: false },
  },
  hooks: {
    afterRisk: async (ctx) => {
      console.log(`[Risk] Run ${ctx.runId}: DR=${ctx.drScore.score} ${ctx.drScore.level}`)
    },
    onNodeComplete: async (ctx) => {
      console.log(`[Node] ${ctx.nodeId} completed in run ${ctx.runId}`)
    },
    onRunComplete: async (ctx) => {
      console.log(`[Run] ${ctx.runId} finished: ${ctx.finalState.status}`)
    },
  },
}

// 注册
pluginManager.register(loggingPlugin)
```

---

## 3. P2P Agent Federation

```typescript
import { AgentRegistry, CapabilityMatcher } from '@anthropic/conductor-core'
import { SwarmRouter, SwarmOrchestrator } from '@anthropic/conductor-core'
import { FederationBus, InProcessTransport } from '@anthropic/conductor-core'

// 1. 注册 Agent
const registry = new AgentRegistry()
registry.register({
  id: 'code-reviewer',
  name: 'Code Review Agent',
  version: '1.0.0',
  description: 'Expert at code review and refactoring',
  capabilities: [
    { id: 'code_review', description: 'Review code', proficiency: 95 },
    { id: 'refactor', description: 'Suggest refactoring', proficiency: 85 },
  ],
  endpoint: { protocol: 'in-process', url: 'mem://code-reviewer' },
  trustScore: 90,
  activeTasks: 0,
  maxConcurrency: 5,
  lastHeartbeat: new Date().toISOString(),
  health: 'healthy',
})

// 2. 路由选择
const router = new SwarmRouter(registry)
const decision = router.route({
  taskId: 'task-1',
  requiredCapabilities: ['code_review'],
  strategy: 'capability_match',
})

// 3. 消息传递
const bus = new FederationBus(new InProcessTransport(), { localAgentId: 'orchestrator' })
await bus.delegate(decision!.selectedAgent.id, {
  taskId: 'task-1',
  description: 'Review pull request #42',
  requiredCapabilities: ['code_review'],
})
```

---

## 4. Time-Travel HITL

```typescript
import { TimeTravel, HITLGate } from '@anthropic/conductor-core'

// 1. 创建 Time-Travel 实例
const timeTravel = new TimeTravel()

// 2. 回退到指定版本
const rewindedState = timeTravel.rewind(currentState, events, targetVersion)

// 3. 创建分支
const forkedState = timeTravel.fork(currentState, events, forkPoint)

// 4. HITL 门控
const hitl = new HITLGate()
hitl.pause('run-1', 'SYNTHESIZE', 'Need human review for sensitive output')

// 等待人工审批
const approved = await hitl.waitForInput('run-1', 60_000) // 60s 超时
if (approved) {
  hitl.resume('run-1')
}
```

---

## 5. 运行 Benchmark Suite

```typescript
import { BenchmarkRunner, DagCorrectnessSuite, GovernanceCoverageSuite } from '@anthropic/conductor-core'

const runner = new BenchmarkRunner()
runner.addSuite(new DagCorrectnessSuite())
runner.addSuite(new GovernanceCoverageSuite())

const report = await runner.run()

console.log(`Total: ${report.totalCases}`)
console.log(`Passed: ${report.passed}`)
console.log(`Pass Rate: ${(report.passRate * 100).toFixed(1)}%`)
```

---

## 6. Event Sourcing 查询

```typescript
// 获取运行状态 (通过事件回放)
const state = await agcService.getState(runId)

// 验证完整性 (Event Replay + Drift Detection)
const { ok, driftDetected } = await agcService.verifyRun(runId)
```

---

## 7. Prompt Optimization (DSPy-style)

```typescript
import { PromptOptimizer } from '@anthropic/conductor-core'

const optimizer = new PromptOptimizer({ populationSize: 8, retireThreshold: 960 })

// 提交模板
const templateId = optimizer.submit('You are a {role}. Analyze: {input}')

// 记录结果 (自动 ELO 评分)
optimizer.recordResult(templateId, { quality: 0.9, latency: 1200 })

// 获取排行榜
const leaderboard = optimizer.getLeaderboard()
```

---

## 8. 自定义路由策略

```typescript
import { RiskRouter, DRCalculator } from '@anthropic/conductor-core'

const calculator = new DRCalculator()
const drScore = calculator.calculate({
  graph: myGraph,
  metadata: { goal: 'complex analysis', repoRoot: '.' },
})

const router = new RiskRouter()
const route = router.decide({
  score: drScore,
  findings: governanceFindings,
  graph: myGraph,
})

// route.lane: 'express' | 'standard' | 'full' | 'escalated'
```

---

## 9. Vector Memory 语义检索

```typescript
import { VectorMemoryLayer, InMemoryVectorStore } from '@anthropic/conductor-persistence'

const vectorStore = new InMemoryVectorStore()
const memory = new VectorMemoryLayer(vectorStore, embeddingProvider)

// 存储记忆
await memory.store('run-1', 'Code review found 3 security issues', { type: 'finding' })

// 语义检索 (Top-K)
const results = await memory.search('security vulnerabilities', { topK: 5 })
```

---

## 10. Cyclic DAG (循环流程)

```typescript
import { CyclicDagEngine } from '@anthropic/conductor-core'

const engine = new CyclicDagEngine({ maxCycleCount: 3 })

// 支持条件回边
const graph = {
  nodes: [
    { id: 'ANALYZE' }, { id: 'VERIFY' }, { id: 'FIX' },
  ],
  edges: [
    { from: 'ANALYZE', to: 'VERIFY' },
    { from: 'VERIFY', to: 'FIX', condition: 'status === "failed"' },
    { from: 'FIX', to: 'VERIFY' }, // 循环回边
  ],
}

engine.validate(graph) // Tarjan SCC 检测 + 最大循环限制
```
