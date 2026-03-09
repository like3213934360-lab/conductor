/**
 * Conductor AGC — P2P Federation Test Suite
 *
 * 覆盖 3 个联邦模块:
 * 1. AgentRegistry + CapabilityMatcher (6 tests)
 * 2. SwarmRouter + HandoffProtocol + SwarmOrchestrator (6 tests)
 * 3. FederationBus + InProcessTransport (6 tests)
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ─── Helper: 创建 AgentCard ─────────────────────────────────────────

function makeAgent(id: string, capabilities: string[], opts?: {
  trustScore?: number; activeTasks?: number; maxConcurrency?: number; proficiency?: number;
}) {
  return {
    id,
    name: `Agent-${id}`,
    version: '1.0.0',
    description: `Test agent ${id}`,
    capabilities: capabilities.map(c => ({
      id: c, description: c, proficiency: opts?.proficiency ?? 80,
    })),
    endpoint: { protocol: 'in-process' as const, url: `mem://${id}` },
    trustScore: opts?.trustScore ?? 85,
    activeTasks: opts?.activeTasks ?? 0,
    maxConcurrency: opts?.maxConcurrency ?? 5,
    lastHeartbeat: new Date().toISOString(),
    health: 'healthy' as const,
  }
}

// ── 1. Agent Registry ────────────────────────────────────────────────

describe('AgentRegistry', () => {
  it('register + get 应正常工作', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    const agent = makeAgent('alpha', ['code_review', 'summarize'])
    registry.register(agent)

    const got = registry.get('alpha')
    expect(got?.id).toBe('alpha')
    expect(got?.capabilities.length).toBe(2)
  })

  it('discover 按能力过滤', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('a1', ['code_review']))
    registry.register(makeAgent('a2', ['translate']))
    registry.register(makeAgent('a3', ['code_review', 'translate']))

    const reviewers = registry.discover({ capability: 'code_review' })
    expect(reviewers.length).toBe(2)
    expect(reviewers.map(a => a.id).sort()).toEqual(['a1', 'a3'])
  })

  it('heartbeat 应更新时间和状态', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('b1', ['test']))
    const before = registry.get('b1')!.lastHeartbeat

    // 等一小段时间确保时间戳不同
    await new Promise(r => setTimeout(r, 5))
    registry.heartbeat('b1', { activeTasks: 3 })

    const after = registry.get('b1')!
    expect(after.activeTasks).toBe(3)
    expect(after.lastHeartbeat).not.toBe(before)
  })

  it('checkHealth 应淘汰超时 Agent', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry({ heartbeatTimeoutMs: 10, evictionTimeoutMs: 20 })

    registry.register(makeAgent('old', ['x']))
    await new Promise(r => setTimeout(r, 30))

    const { evicted } = registry.checkHealth()
    expect(evicted).toContain('old')
    expect(registry.get('old')).toBeUndefined()
  })

  it('maxAgents 限制应生效', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry({ maxAgents: 2 })

    registry.register(makeAgent('x1', ['a']))
    registry.register(makeAgent('x2', ['b']))
    expect(() => registry.register(makeAgent('x3', ['c']))).toThrow('Registry full')
  })

  it('stats 应统计正确', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('s1', ['a']))
    registry.register(makeAgent('s2', ['b']))

    const stats = registry.stats()
    expect(stats.total).toBe(2)
    expect(stats.healthy).toBe(2)
  })
})

// ── 2. CapabilityMatcher ─────────────────────────────────────────────

describe('CapabilityMatcher', () => {
  it('应按综合评分排序匹配结果', async () => {
    const { AgentRegistry, CapabilityMatcher } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('m1', ['code_review'], { trustScore: 90, proficiency: 95 }))
    registry.register(makeAgent('m2', ['code_review', 'test'], { trustScore: 70, proficiency: 60 }))
    registry.register(makeAgent('m3', ['translate'], { trustScore: 95, proficiency: 99 }))

    const matcher = new CapabilityMatcher(registry)
    const results = matcher.match({ requiredCapabilities: ['code_review'] })

    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[0]?.agent.id).toBe('m1') // 更高的 proficiency + trust + capability match
  })

  it('requireAll 应过滤不完整匹配', async () => {
    const { AgentRegistry, CapabilityMatcher } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('f1', ['a', 'b']))
    registry.register(makeAgent('f2', ['a']))

    const matcher = new CapabilityMatcher(registry)
    const results = matcher.match({ requiredCapabilities: ['a', 'b'], requireAll: true })

    expect(results.length).toBe(1)
    expect(results[0]?.agent.id).toBe('f1')
  })

  it('findBest 应返回最优或 null', async () => {
    const { AgentRegistry, CapabilityMatcher } = await import('../federation/agent-card.js')
    const registry = new AgentRegistry()
    const matcher = new CapabilityMatcher(registry)

    expect(matcher.findBest({ requiredCapabilities: ['nonexistent'] })).toBeNull()
  })
})

// ── 3. SwarmRouter ───────────────────────────────────────────────────

describe('SwarmRouter', () => {
  it('capability_match 策略应选择最优 Agent', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmRouter } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('r1', ['summarize'], { trustScore: 90, proficiency: 95 }))
    registry.register(makeAgent('r2', ['translate'], { trustScore: 80 }))

    const router = new SwarmRouter(registry)
    const decision = router.route({
      taskId: 'task-1',
      requiredCapabilities: ['summarize'],
    })

    expect(decision).not.toBeNull()
    expect(decision!.selectedAgent.id).toBe('r1')
    expect(decision!.strategy).toBe('capability_match')
  })

  it('load_balance 策略应选择最空闲', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmRouter } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('lb1', ['x'], { activeTasks: 4, maxConcurrency: 5 }))
    registry.register(makeAgent('lb2', ['x'], { activeTasks: 1, maxConcurrency: 5 }))

    const router = new SwarmRouter(registry)
    const decision = router.route({
      taskId: 'task-2',
      requiredCapabilities: [],
      strategy: 'load_balance',
    })

    expect(decision!.selectedAgent.id).toBe('lb2')
    expect(decision!.strategy).toBe('load_balance')
  })

  it('trust_weighted 策略应选择最高信任', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmRouter } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('tw1', ['y'], { trustScore: 60 }))
    registry.register(makeAgent('tw2', ['y'], { trustScore: 95 }))

    const router = new SwarmRouter(registry)
    const decision = router.route({
      taskId: 'task-3',
      requiredCapabilities: [],
      strategy: 'trust_weighted',
    })

    expect(decision!.selectedAgent.id).toBe('tw2')
    expect(decision!.score).toBeCloseTo(0.95, 2)
  })

  it('无候选时应返回 null', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmRouter } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    const router = new SwarmRouter(registry)
    expect(router.route({ taskId: 't', requiredCapabilities: [] })).toBeNull()
  })
})

// ── 4. HandoffProtocol ───────────────────────────────────────────────

describe('HandoffProtocol', () => {
  it('pack/unpack 应保持数据完整性', async () => {
    const { HandoffProtocol } = await import('../federation/swarm-router.js')
    const protocol = new HandoffProtocol()

    const packed = protocol.pack({
      sourceAgentId: 'agent-A',
      targetAgentId: 'agent-B',
      taskId: 'task-1',
      runId: 'run-1',
      currentStage: 'DEBATE',
      conversationSummary: 'Three agents discussed code quality',
      constraints: ['max_tokens:4000', 'language:zh'],
    })

    expect(packed.checksum).toMatch(/^cksum-/)

    const { valid, context } = protocol.unpack(packed)
    expect(valid).toBe(true)
    expect(context.sourceAgentId).toBe('agent-A')
    expect(context.constraints.length).toBe(2)
  })

  it('篡改后 unpack 应校验失败', async () => {
    const { HandoffProtocol } = await import('../federation/swarm-router.js')
    const protocol = new HandoffProtocol()

    const packed = protocol.pack({
      sourceAgentId: 'a', targetAgentId: 'b',
      taskId: 't', runId: 'r', currentStage: 'X',
      conversationSummary: 'test',
    })

    // 篡改
    packed.taskId = 'tampered'
    const { valid, error } = protocol.unpack(packed)
    expect(valid).toBe(false)
    expect(error).toContain('Checksum mismatch')
  })

  it('transfer 应执行完整 handoff 流程', async () => {
    const { HandoffProtocol } = await import('../federation/swarm-router.js')
    const protocol = new HandoffProtocol()

    const result = await protocol.transfer(
      {
        sourceAgentId: 'src', targetAgentId: 'dst',
        taskId: 'task-h', runId: 'run-h',
        currentStage: 'VERIFY',
        conversationSummary: 'Handoff test',
      },
      async () => true,
    )

    expect(result.success).toBe(true)
    expect(result.transferMs).toBeGreaterThanOrEqual(0)
  })
})

// ── 5. FederationBus ─────────────────────────────────────────────────

describe('FederationBus', () => {
  it('send + subscribe 应正常工作', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()
    const bus = new FederationBus(transport, { localAgentId: 'sender' })

    const received: any[] = []
    transport.subscribe('target', (msg) => { received.push(msg) })

    await bus.send('target', 'task.delegate', { taskId: 't1', desc: 'test' })

    expect(received.length).toBe(1)
    expect(received[0].type).toBe('task.delegate')
    expect(received[0].sender).toBe('sender')
  })

  it('broadcast 应发送给所有订阅者（除自己）', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()

    const receivedA: any[] = []
    const receivedB: any[] = []
    transport.subscribe('agentA', (msg) => { receivedA.push(msg) })
    transport.subscribe('agentB', (msg) => { receivedB.push(msg) })
    transport.subscribe('broadcaster', () => {}) // 自己不应收到

    const bus = new FederationBus(transport, { localAgentId: 'broadcaster' })
    const { deliveredCount } = await bus.broadcast('heartbeat', { status: 'ok' })

    expect(deliveredCount).toBe(2)
    expect(receivedA.length).toBe(1)
    expect(receivedB.length).toBe(1)
  })

  it('subscribe 应过滤消息类型', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()
    const bus = new FederationBus(transport, { localAgentId: 'listener' })

    const received: any[] = []
    bus.subscribe((msg) => { received.push(msg) }, { types: ['task.result'] })

    // 发送两种消息
    await transport.send({
      messageId: '1', sender: 'other', receiver: 'listener',
      type: 'heartbeat', payload: {}, timestamp: new Date().toISOString(),
    })
    await transport.send({
      messageId: '2', sender: 'other', receiver: 'listener',
      type: 'task.result', payload: { ok: true }, timestamp: new Date().toISOString(),
    })

    expect(received.length).toBe(1)
    expect(received[0].type).toBe('task.result')
  })

  it('delegate + reply 便捷方法', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()

    const busA = new FederationBus(transport, { localAgentId: 'orchestrator' })
    const busB = new FederationBus(transport, { localAgentId: 'worker' })

    const workerReceived: any[] = []
    busB.subscribe((msg) => { workerReceived.push(msg) })

    const delegateMsg = await busA.delegate('worker', {
      taskId: 'job-1', description: 'analyze code',
      requiredCapabilities: ['code_review'],
    })

    expect(delegateMsg.type).toBe('task.delegate')
    expect(workerReceived.length).toBe(1)
  })

  it('event log 应记录所有消息', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()
    const bus = new FederationBus(transport, { localAgentId: 'logger' })

    transport.subscribe('target1', () => {})
    await bus.send('target1', 'heartbeat', {})
    await bus.send('target1', 'task.delegate', {})

    const stats = bus.stats()
    expect(stats.totalMessages).toBe(2)
    expect(stats.outgoing).toBe(2)
    expect(stats.byType['heartbeat']).toBe(1)
    expect(stats.byType['task.delegate']).toBe(1)
  })

  it('unsubscribe 应停止接收消息', async () => {
    const { InProcessTransport, FederationBus } = await import('../federation/federation-bus.js')
    const transport = new InProcessTransport()
    const bus = new FederationBus(transport, { localAgentId: 'unsub-test' })

    const received: any[] = []
    const sub = bus.subscribe((msg) => { received.push(msg) })

    await transport.send({
      messageId: '1', sender: 'x', receiver: 'unsub-test',
      type: 'heartbeat', payload: {}, timestamp: new Date().toISOString(),
    })
    expect(received.length).toBe(1)

    sub.unsubscribe()

    await transport.send({
      messageId: '2', sender: 'x', receiver: 'unsub-test',
      type: 'heartbeat', payload: {}, timestamp: new Date().toISOString(),
    })
    expect(received.length).toBe(1) // 不再增加
  })
})

// ── 6. SwarmOrchestrator ─────────────────────────────────────────────

describe('SwarmOrchestrator', () => {
  it('assignNode 应分派 Agent 并记录', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmOrchestrator } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('worker-1', ['analyze'], { trustScore: 90, proficiency: 95 }))

    const orchestrator = new SwarmOrchestrator(registry)
    const assignment = orchestrator.assignNode({
      taskId: 'run-1',
      nodeId: 'ANALYZE',
      requiredCapabilities: ['analyze'],
    })

    expect(assignment).not.toBeNull()
    expect(assignment!.agentId).toBe('worker-1')
    expect(assignment!.status).toBe('assigned')
  })

  it('initiateHandoff 应完成转移', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmOrchestrator } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('src-agent', ['analyze']))
    registry.register(makeAgent('dst-agent', ['verify']))

    const orchestrator = new SwarmOrchestrator(registry)
    orchestrator.assignNode({
      taskId: 'run-2', nodeId: 'ANALYZE', requiredCapabilities: ['analyze'],
    })

    const result = await orchestrator.initiateHandoff({
      taskId: 'run-2', nodeId: 'ANALYZE',
      sourceAgentId: 'src-agent', targetAgentId: 'dst-agent',
      runId: 'run-2', conversationSummary: 'Analysis complete, need verification',
    })

    expect(result.success).toBe(true)
    const assignment = orchestrator.getAssignment('run-2', 'ANALYZE')
    expect(assignment?.status).toBe('handed_off')
  })

  it('stats 应返回分派统计', async () => {
    const { AgentRegistry } = await import('../federation/agent-card.js')
    const { SwarmOrchestrator } = await import('../federation/swarm-router.js')
    const registry = new AgentRegistry()

    registry.register(makeAgent('w1', ['a', 'b'], { trustScore: 90 }))

    const orch = new SwarmOrchestrator(registry)
    orch.assignNode({ taskId: 't1', nodeId: 'N1', requiredCapabilities: ['a'] })
    orch.assignNode({ taskId: 't1', nodeId: 'N2', requiredCapabilities: ['b'] })
    orch.updateStatus('t1', 'N1', 'completed')

    const stats = orch.stats()
    expect(stats.total).toBe(2)
    expect(stats.byStatus['assigned']).toBe(1)
    expect(stats.byStatus['completed']).toBe(1)
  })
})
