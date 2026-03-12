/**
 * Antigravity Workflow Runtime — Federation Contract Test Suite
 *
 * 覆盖当前仍保留在主链上的联邦 contract:
 * 1. AgentRegistry + CapabilityMatcher (6 tests)
 * 2. HandoffProtocol (3 tests)
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

// ── 3. HandoffProtocol ───────────────────────────────────────────────

describe('HandoffProtocol', () => {
  it('pack/unpack 应保持数据完整性', async () => {
    const { HandoffProtocol } = await import('../federation/handoff-protocol.js')
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
    const { HandoffProtocol } = await import('../federation/handoff-protocol.js')
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
    const { HandoffProtocol } = await import('../federation/handoff-protocol.js')
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
