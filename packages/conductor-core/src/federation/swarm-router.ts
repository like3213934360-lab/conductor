/**
 * Conductor AGC — Swarm Router & Handoff Protocol (A2A Federation)
 *
 * SOTA 参考:
 * - OpenAI Swarm SDK: handoff() + function-call routing
 * - Google A2A: Task delegation + context transfer
 * - CrewAI v2: Sequential/Hierarchical process patterns
 *
 * 设计:
 * - SwarmRouter: 多策略动态路由 (capability / load-balance / trust-weighted)
 * - HandoffProtocol: 上下文打包/解包/传递
 * - SwarmOrchestrator: DAG 节点级 Agent 分派
 */

import type { AgentCard, MatchRequest, MatchResult } from './agent-card.js'
import { CapabilityMatcher, AgentRegistry } from './agent-card.js'

// ─── Routing Strategy ────────────────────────────────────────────────

/** 路由策略 */
export type RoutingStrategy = 'capability_match' | 'load_balance' | 'trust_weighted' | 'round_robin'

/** 路由请求 */
export interface RouteRequest {
  /** 任务 ID */
  taskId: string
  /** 需要的能力 */
  requiredCapabilities: string[]
  /** 路由策略 (默认 capability_match) */
  strategy?: RoutingStrategy
  /** 最低信任分 */
  minTrustScore?: number
  /** 排除的 Agent ID */
  excludeAgents?: string[]
  /** 上下文大小 (用于负载均衡决策) */
  contextSizeTokens?: number
}

/** 路由决策 */
export interface RouteDecision {
  /** 选择的 Agent */
  selectedAgent: AgentCard
  /** 路由策略 */
  strategy: RoutingStrategy
  /** 决策分数 */
  score: number
  /** 候选 Agent 数 */
  candidateCount: number
  /** 决策原因 */
  rationale: string
}

// ─── Swarm Router ────────────────────────────────────────────────────

/**
 * SwarmRouter — 多策略 Agent 路由器
 *
 * 支持 4 种路由策略:
 * 1. capability_match — 按能力匹配（默认，使用 CapabilityMatcher）
 * 2. load_balance — 按剩余容量加权
 * 3. trust_weighted — 按信任分加权
 * 4. round_robin — 轮询
 */
export class SwarmRouter {
  private readonly matcher: CapabilityMatcher
  private roundRobinIndex = 0

  constructor(private readonly registry: AgentRegistry) {
    this.matcher = new CapabilityMatcher(registry)
  }

  /** 路由选择 */
  route(request: RouteRequest): RouteDecision | null {
    const strategy = request.strategy ?? 'capability_match'

    // 获取候选 Agent
    let candidates = this.registry.discover({
      health: 'healthy',
      availableOnly: true,
      minTrust: request.minTrustScore,
    })

    // 排除
    if (request.excludeAgents?.length) {
      const excludeSet = new Set(request.excludeAgents)
      candidates = candidates.filter(a => !excludeSet.has(a.id))
    }

    if (candidates.length === 0) return null

    switch (strategy) {
      case 'capability_match':
        return this.routeByCapability(request, candidates)
      case 'load_balance':
        return this.routeByLoad(request, candidates)
      case 'trust_weighted':
        return this.routeByTrust(request, candidates)
      case 'round_robin':
        return this.routeByRoundRobin(request, candidates)
    }
  }

  private routeByCapability(request: RouteRequest, _candidates: AgentCard[]): RouteDecision | null {
    const matchReq: MatchRequest = {
      requiredCapabilities: request.requiredCapabilities,
      minTrustScore: request.minTrustScore,
    }
    const best = this.matcher.findBest(matchReq)
    if (!best) return null

    return {
      selectedAgent: best.agent,
      strategy: 'capability_match',
      score: best.score,
      candidateCount: this.matcher.match(matchReq).length,
      rationale: `Best capability match: ${best.matchedCapabilities.join(', ')} (score=${best.score.toFixed(3)})`,
    }
  }

  private routeByLoad(request: RouteRequest, candidates: AgentCard[]): RouteDecision | null {
    // 按剩余容量排序（最空闲优先）
    const sorted = [...candidates].sort((a, b) => {
      const loadA = a.maxConcurrency > 0 ? a.activeTasks / a.maxConcurrency : 1
      const loadB = b.maxConcurrency > 0 ? b.activeTasks / b.maxConcurrency : 1
      return loadA - loadB
    })

    const best = sorted[0]!
    const loadRatio = best.maxConcurrency > 0 ? best.activeTasks / best.maxConcurrency : 1
    return {
      selectedAgent: best,
      strategy: 'load_balance',
      score: 1 - loadRatio,
      candidateCount: candidates.length,
      rationale: `Lowest load: ${best.activeTasks}/${best.maxConcurrency} tasks (${(loadRatio * 100).toFixed(0)}% utilization)`,
    }
  }

  private routeByTrust(request: RouteRequest, candidates: AgentCard[]): RouteDecision | null {
    const sorted = [...candidates].sort((a, b) => b.trustScore - a.trustScore)
    const best = sorted[0]!
    return {
      selectedAgent: best,
      strategy: 'trust_weighted',
      score: best.trustScore / 100,
      candidateCount: candidates.length,
      rationale: `Highest trust: ${best.trustScore}/100 (${best.name})`,
    }
  }

  private routeByRoundRobin(request: RouteRequest, candidates: AgentCard[]): RouteDecision | null {
    const idx = this.roundRobinIndex % candidates.length
    this.roundRobinIndex++
    const selected = candidates[idx]!
    return {
      selectedAgent: selected,
      strategy: 'round_robin',
      score: 1 / candidates.length,
      candidateCount: candidates.length,
      rationale: `Round-robin index ${idx}: ${selected.name}`,
    }
  }
}

// ─── Handoff Protocol ────────────────────────────────────────────────

/** 打包的上下文 */
export interface PackedContext {
  /** 来源 Agent ID */
  sourceAgentId: string
  /** 目标 Agent ID */
  targetAgentId: string
  /** 任务 ID */
  taskId: string
  /** 运行 ID */
  runId: string
  /** 当前执行阶段 */
  currentStage: string
  /** 累计对话历史 (summary) */
  conversationSummary: string
  /** 关键约束 */
  constraints: string[]
  /** 附带数据 */
  payload: Record<string, unknown>
  /** 打包时间 */
  packedAt: string
  /** 校验和 (简单 hash) */
  checksum: string
}

/** Handoff 结果 */
export interface HandoffResult {
  success: boolean
  sourceAgentId: string
  targetAgentId: string
  taskId: string
  /** 传输耗时 (ms) */
  transferMs: number
  error?: string
}

/**
 * HandoffProtocol — Agent 间上下文传递
 *
 * 参考 OpenAI Swarm 的 handoff() 设计:
 * 当前 Agent 将控制权 + 上下文转移给另一个 Agent
 */
export class HandoffProtocol {
  /** 打包上下文 */
  pack(params: {
    sourceAgentId: string
    targetAgentId: string
    taskId: string
    runId: string
    currentStage: string
    conversationSummary: string
    constraints?: string[]
    payload?: Record<string, unknown>
  }): PackedContext {
    const packed: PackedContext = {
      sourceAgentId: params.sourceAgentId,
      targetAgentId: params.targetAgentId,
      taskId: params.taskId,
      runId: params.runId,
      currentStage: params.currentStage,
      conversationSummary: params.conversationSummary,
      constraints: params.constraints ?? [],
      payload: params.payload ?? {},
      packedAt: new Date().toISOString(),
      checksum: '',
    }
    packed.checksum = HandoffProtocol.computeChecksum(packed)
    return packed
  }

  /** 解包并校验 */
  unpack(packed: PackedContext): { valid: boolean; context: PackedContext; error?: string } {
    const expected = HandoffProtocol.computeChecksum(packed)
    if (packed.checksum !== expected) {
      return { valid: false, context: packed, error: `Checksum mismatch: expected ${expected}, got ${packed.checksum}` }
    }
    return { valid: true, context: packed }
  }

  /** 执行 Handoff (打包 → 传输 → 解包) */
  async transfer(
    params: Parameters<HandoffProtocol['pack']>[0],
    transport: (packed: PackedContext) => Promise<boolean>,
  ): Promise<HandoffResult> {
    const start = Date.now()
    const packed = this.pack(params)

    try {
      const delivered = await transport(packed)
      return {
        success: delivered,
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
        taskId: params.taskId,
        transferMs: Date.now() - start,
        error: delivered ? undefined : 'Transport returned false',
      }
    } catch (err) {
      return {
        success: false,
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
        taskId: params.taskId,
        transferMs: Date.now() - start,
        error: String(err),
      }
    }
  }

  /** 简单校验和 — 基于关键字段的 hash */
  static computeChecksum(ctx: PackedContext): string {
    const data = `${ctx.sourceAgentId}:${ctx.targetAgentId}:${ctx.taskId}:${ctx.runId}:${ctx.currentStage}:${ctx.packedAt}`
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const chr = data.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0 // Convert to 32bit integer
    }
    return `cksum-${Math.abs(hash).toString(36)}`
  }
}

// ─── Swarm Orchestrator ──────────────────────────────────────────────

/** 任务分派记录 */
export interface TaskAssignment {
  taskId: string
  nodeId: string
  agentId: string
  strategy: RoutingStrategy
  score: number
  assignedAt: string
  status: 'assigned' | 'running' | 'completed' | 'failed' | 'handed_off'
}

/**
 * SwarmOrchestrator — DAG 节点级 Agent 分派
 *
 * 将 AGC DAG 的每个节点分派给最优 Agent
 */
export class SwarmOrchestrator {
  private readonly router: SwarmRouter
  private readonly handoff: HandoffProtocol
  private readonly assignments = new Map<string, TaskAssignment>()

  constructor(registry: AgentRegistry) {
    this.router = new SwarmRouter(registry)
    this.handoff = new HandoffProtocol()
  }

  /** 为 DAG 节点分派 Agent */
  assignNode(params: {
    taskId: string
    nodeId: string
    requiredCapabilities: string[]
    strategy?: RoutingStrategy
    minTrustScore?: number
  }): TaskAssignment | null {
    const decision = this.router.route({
      taskId: params.taskId,
      requiredCapabilities: params.requiredCapabilities,
      strategy: params.strategy,
      minTrustScore: params.minTrustScore,
    })

    if (!decision) return null

    const assignment: TaskAssignment = {
      taskId: params.taskId,
      nodeId: params.nodeId,
      agentId: decision.selectedAgent.id,
      strategy: decision.strategy,
      score: decision.score,
      assignedAt: new Date().toISOString(),
      status: 'assigned',
    }

    this.assignments.set(`${params.taskId}:${params.nodeId}`, assignment)
    return assignment
  }

  /** 查询节点分派 */
  getAssignment(taskId: string, nodeId: string): TaskAssignment | undefined {
    return this.assignments.get(`${taskId}:${nodeId}`)
  }

  /** 更新分派状态 */
  updateStatus(taskId: string, nodeId: string, status: TaskAssignment['status']): void {
    const assignment = this.assignments.get(`${taskId}:${nodeId}`)
    if (assignment) assignment.status = status
  }

  /** 获取所有分派 */
  listAssignments(taskId?: string): TaskAssignment[] {
    const all = Array.from(this.assignments.values())
    return taskId ? all.filter(a => a.taskId === taskId) : all
  }

  /** 发起 Handoff — 将节点执行从一个 Agent 转移到另一个 */
  async initiateHandoff(params: {
    taskId: string
    nodeId: string
    sourceAgentId: string
    targetAgentId: string
    runId: string
    conversationSummary: string
    constraints?: string[]
  }): Promise<HandoffResult> {
    const result = await this.handoff.transfer(
      {
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
        taskId: params.taskId,
        runId: params.runId,
        currentStage: params.nodeId,
        conversationSummary: params.conversationSummary,
        constraints: params.constraints,
      },
      async () => true, // InProcess — 直接成功
    )

    if (result.success) {
      this.updateStatus(params.taskId, params.nodeId, 'handed_off')
    }

    return result
  }

  /** 统计 */
  stats(): { total: number; byStatus: Record<string, number> } {
    const all = this.listAssignments()
    const byStatus: Record<string, number> = {}
    for (const a of all) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
    }
    return { total: all.length, byStatus }
  }
}
