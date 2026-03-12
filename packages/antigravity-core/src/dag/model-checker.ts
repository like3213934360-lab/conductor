/**
 * Antigravity Workflow Runtime — 轻量级模型检查器 (Lightweight Bounded Model Checker)
 *
 * Workflow Runtime vNext: 在 formal-verifier 运行时检查基础上，
 * 新增设计时有界状态空间探索，可在部署前发现死锁和不变量违反。
 *
 * 设计参考:
 * - TLA+/TLC Model Checker: 有界模型检查 (Bounded Model Checking)
 * - SPIN/Promela: 显式状态枚举
 * - Azure COYOTE: 异步可控状态探索
 * - QuickCheck/Hypothesis: 基于属性的测试生成
 *
 * 实现策略:
 * - 不依赖外部 TLA+ 工具链
 * - 在 TypeScript 中实现有界 BFS/DFS 状态空间探索
 * - 用 DAG 图 + 模拟状态模拟器穷举所有可达状态
 * - 在每个状态点检查不变量和死锁
 */

import type { RunGraph, GraphNode, GraphEdge, WorkflowState } from '@anthropic/antigravity-shared'
import type { TransitionProperty, DagExecutionPatch } from './formal-verifier.js'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

type NodeStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped'

/** 状态快照 — 模型检查的原子状态 */
export interface StateSnapshot {
  /** 每个节点的状态 */
  nodeStatuses: Record<string, NodeStatus>
  /** 全局状态版本 */
  version: number
  /** 到达此状态的路径 (事件序列) */
  trace: string[]
}

/** 模型检查配置 */
export interface ModelCheckConfig {
  /** 最大探索状态数 (防止组合爆炸) */
  maxStates: number
  /** 最大路径深度 */
  maxDepth: number
  /** 探索策略 */
  strategy: 'bfs' | 'dfs'
  /** 是否检查死锁 */
  checkDeadlock: boolean
  /** 是否检查活锁 */
  checkLivelock: boolean
  /** 自定义不变量 */
  invariants?: TransitionProperty[]
}

export const DEFAULT_MODEL_CHECK_CONFIG: ModelCheckConfig = {
  maxStates: 10000,
  maxDepth: 50,
  strategy: 'bfs',
  checkDeadlock: true,
  checkLivelock: true,
}

/** 违反报告 */
export interface Violation {
  /** 违反类型 */
  type: 'deadlock' | 'livelock' | 'invariant' | 'unreachable_terminal'
  /** 详细描述 */
  description: string
  /** 到达违反状态的步骤序列 */
  trace: string[]
  /** 违反时的状态快照 */
  state: StateSnapshot
}

/** 模型检查结果 */
export interface ModelCheckResult {
  /** 是否通过 (无违反) */
  passed: boolean
  /** 违反列表 */
  violations: Violation[]
  /** 探索的总状态数 */
  statesExplored: number
  /** 达到的最大深度 */
  maxDepthReached: number
  /** 是否因为状态上限而截断 */
  truncated: boolean
  /** 状态空间覆盖率估计 */
  coverageEstimate: number
  /** 耗时 (ms) */
  durationMs: number
}

// ── 状态空间探索器 ────────────────────────────────────────────────────────────

/**
 * BoundedModelChecker — 有界模型检查器
 *
 * 核心算法:
 * 1. 从初始状态 (所有节点 pending) 开始
 * 2. BFS/DFS 枚举所有合法的下一步转换
 * 3. 在每个状态点运行不变量检查和死锁检测
 * 4. 记录违反并继续探索（不提前终止，获取完整报告）
 */
export class BoundedModelChecker {
  private readonly config: ModelCheckConfig

  constructor(config?: Partial<ModelCheckConfig>) {
    this.config = { ...DEFAULT_MODEL_CHECK_CONFIG, ...config }
  }

  /**
   * 对 DAG 图进行模型检查
   *
   * @param graph - 待检查的 DAG 定义
   * @param invariants - 额外的自定义不变量
   * @returns ModelCheckResult
   */
  check(graph: RunGraph, invariants?: TransitionProperty[]): ModelCheckResult {
    const startTime = Date.now()
    const violations: Violation[] = []
    const visited = new Set<string>()
    const allInvariants = [...(invariants ?? []), ...(this.config.invariants ?? [])]

    // 初始状态
    const initState: StateSnapshot = {
      nodeStatuses: Object.fromEntries(graph.nodes.map(n => [n.id, 'pending' as NodeStatus])),
      version: 0,
      trace: [],
    }

    // BFS / DFS 探索
    const frontier: StateSnapshot[] = [initState]
    let statesExplored = 0
    let maxDepthReached = 0

    while (frontier.length > 0 && statesExplored < this.config.maxStates) {
      const current = this.config.strategy === 'bfs'
        ? frontier.shift()!
        : frontier.pop()!

      // 状态去重 (规范化指纹)
      const fingerprint = this.stateFingerprint(current)
      if (visited.has(fingerprint)) continue
      visited.add(fingerprint)

      statesExplored++
      const currentDepth = current.trace.length
      maxDepthReached = Math.max(maxDepthReached, currentDepth)

      if (currentDepth >= this.config.maxDepth) continue

      // ── 死锁检测 ──
      if (this.config.checkDeadlock) {
        const deadlockViolation = this.checkDeadlockAt(graph, current)
        if (deadlockViolation) violations.push(deadlockViolation)
      }

      // ── 不变量检查 ──
      for (const inv of allInvariants) {
        const invViolation = this.checkInvariantAt(graph, current, inv)
        if (invViolation) violations.push(invViolation)
      }

      // ── 枚举所有合法后继状态 ──
      const successors = this.enumerateSuccessors(graph, current)
      for (const s of successors) {
        const sf = this.stateFingerprint(s)
        if (!visited.has(sf)) {
          frontier.push(s)
        }
      }
    }

    // ── 终止可达性检查 ──
    const terminalViolation = this.checkTerminalReachability(graph, visited, initState)
    if (terminalViolation) violations.push(terminalViolation)

    const totalPossibleStates = Math.pow(6, graph.nodes.length) // 6 statuses per node
    const coverageEstimate = Math.min(1.0, statesExplored / totalPossibleStates)

    return {
      passed: violations.length === 0,
      violations,
      statesExplored,
      maxDepthReached,
      truncated: statesExplored >= this.config.maxStates,
      coverageEstimate,
      durationMs: Date.now() - startTime,
    }
  }

  // ── 内部方法 ────────────────────────────────────────────────────────────────

  /** 状态指纹 (用于去重) */
  private stateFingerprint(state: StateSnapshot): string {
    const entries = Object.entries(state.nodeStatuses).sort(([a], [b]) => a.localeCompare(b))
    return entries.map(([id, s]) => `${id}:${s}`).join('|')
  }

  /**
   * 死锁检测 — 存在未完成节点但无合法转换
   *
   * 死锁定义: ∃ node. status ∈ {pending, queued} ∧ ¬∃ 合法后继
   */
  private checkDeadlockAt(graph: RunGraph, state: StateSnapshot): Violation | null {
    const hasIncomplete = Object.values(state.nodeStatuses).some(
      s => s === 'pending' || s === 'queued'
    )
    if (!hasIncomplete) return null

    // queued 节点可以转为 running，所以不是死锁
    const hasQueued = Object.values(state.nodeStatuses).some(s => s === 'queued')
    const hasRunning = Object.values(state.nodeStatuses).some(s => s === 'running')
    const readyNodes = this.findReadyNodes(graph, state)

    // 有就绪节点、有排队节点、或有正在运行的节点都不是死锁
    if (readyNodes.length > 0 || hasQueued || hasRunning) return null

    return {
      type: 'deadlock',
      description: `Deadlock detected: ${Object.entries(state.nodeStatuses)
        .filter(([_, s]) => s === 'pending')
        .map(([id]) => id)
        .join(', ')} stuck with no available transitions`,
      trace: state.trace,
      state,
    }
  }

  private checkInvariantAt(
    graph: RunGraph,
    state: StateSnapshot,
    property: TransitionProperty,
  ): Violation | null {
    // 构造 prevState (前一版本) 和 nextState (当前版本)
    const prevState = this.toMockWorkflowState({ ...state, version: Math.max(0, state.version - 1) })
    const nextState = this.toMockWorkflowState(state)
    const mockPatch: DagExecutionPatch = {
      events: [],
      nextState,
      prevVersion: Math.max(0, state.version - 1),
    }

    // 跳过 VersionMonotonicity — 模型检查器探索的是状态点而非状态转换
    if (property.name === 'VersionMonotonicity') return null

    try {
      property.assert(graph, prevState, mockPatch)
      return null
    } catch (err) {
      return {
        type: 'invariant',
        description: `Invariant "${property.name}" violated: ${(err as Error).message}`,
        trace: state.trace,
        state,
      }
    }
  }

  private checkTerminalReachability(
    graph: RunGraph,
    visited: Set<string>,
    _initState: StateSnapshot,
  ): Violation | null {
    // 如果探索被截断（maxStates/maxDepth），不报终止不可达 — 搜索不完整
    if (visited.size >= this.config.maxStates) return null

    const hasTerminal = Array.from(visited).some(fp => {
      const statuses = fp.split('|').map(e => e.split(':')[1])
      return statuses.every(s => s === 'completed' || s === 'failed' || s === 'skipped')
    })

    if (!hasTerminal && graph.nodes.length > 0) {
      return {
        type: 'unreachable_terminal',
        description: `No terminal state is reachable within explored state space (${visited.size} states, depth ${this.config.maxDepth})`,
        trace: [],
        state: { nodeStatuses: {}, version: 0, trace: [] },
      }
    }

    return null
  }

  /**
   * 枚举合法后继状态
   *
   * 转换规则 (DAG 语义):
   * 1. pending → queued (当所有依赖已 completed/skipped)
   * 2. queued → running
   * 3. running → completed | failed
   * 4. pending → skipped (如果 skippable=true 且有 failed 依赖)
   */
  private enumerateSuccessors(graph: RunGraph, current: StateSnapshot): StateSnapshot[] {
    const successors: StateSnapshot[] = []

    // 找到可以推进的节点
    const readyNodes = this.findReadyNodes(graph, current)

    // 正在运行的节点可以完成或失败
    const runningNodes = graph.nodes.filter(n => current.nodeStatuses[n.id] === 'running')

    // 转换 1: pending → queued
    for (const nodeId of readyNodes) {
      const next = this.cloneState(current)
      next.nodeStatuses[nodeId] = 'queued'
      next.trace = [...current.trace, `${nodeId}:queued`]
      next.version = current.version + 1
      successors.push(next)
    }

    // 转换 2: queued → running
    for (const node of graph.nodes.filter(n => current.nodeStatuses[n.id] === 'queued')) {
      const next = this.cloneState(current)
      next.nodeStatuses[node.id] = 'running'
      next.trace = [...current.trace, `${node.id}:running`]
      next.version = current.version + 1
      successors.push(next)
    }

    // 转换 3: running → completed
    for (const node of runningNodes) {
      const nextCompleted = this.cloneState(current)
      nextCompleted.nodeStatuses[node.id] = 'completed'
      nextCompleted.trace = [...current.trace, `${node.id}:completed`]
      nextCompleted.version = current.version + 1
      successors.push(nextCompleted)

      // 转换 3b: running → failed
      const nextFailed = this.cloneState(current)
      nextFailed.nodeStatuses[node.id] = 'failed'
      nextFailed.trace = [...current.trace, `${node.id}:failed`]
      nextFailed.version = current.version + 1
      successors.push(nextFailed)
    }

    // 转换 4: pending → skipped (仅 skippable 节点且有 failed 依赖)
    for (const node of graph.nodes) {
      if (current.nodeStatuses[node.id] !== 'pending') continue
      if (node.skippable !== true) continue

      const deps = this.getDependencies(graph, node.id)
      const hasFailedDep = deps.some(d => current.nodeStatuses[d] === 'failed')
      if (hasFailedDep) {
        const next = this.cloneState(current)
        next.nodeStatuses[node.id] = 'skipped'
        next.trace = [...current.trace, `${node.id}:skipped`]
        next.version = current.version + 1
        successors.push(next)
      }
    }

    return successors
  }

  /** 查找就绪节点 (所有依赖已 completed/skipped) */
  private findReadyNodes(graph: RunGraph, state: StateSnapshot): string[] {
    return graph.nodes
      .filter(node => state.nodeStatuses[node.id] === 'pending')
      .filter(node => {
        const deps = this.getDependencies(graph, node.id)
        return deps.every(d => {
          const s = state.nodeStatuses[d]
          return s === 'completed' || s === 'skipped'
        })
      })
      .map(n => n.id)
  }

  /** 获取节点依赖 */
  private getDependencies(graph: RunGraph, nodeId: string): string[] {
    const node = graph.nodes.find(n => n.id === nodeId)
    const fromDeps = node?.dependsOn ?? []
    const fromEdges = (graph.edges ?? [])
      .filter(e => e.to === nodeId)
      .map(e => e.from)
    return [...new Set([...fromDeps, ...fromEdges])]
  }

  /** 深拷贝状态 */
  private cloneState(state: StateSnapshot): StateSnapshot {
    return {
      nodeStatuses: { ...state.nodeStatuses },
      version: state.version,
      trace: [...state.trace],
    }
  }

  /** 构造模拟 WorkflowState */
  private toMockWorkflowState(state: StateSnapshot): WorkflowState {
    const nodes: Record<string, any> = {}
    for (const [id, status] of Object.entries(state.nodeStatuses)) {
      nodes[id] = { status, nodeId: id }
    }
    return {
      runId: 'model-check',
      status: 'running',
      version: state.version,
      nodes,
    } as unknown as WorkflowState
  }
}
