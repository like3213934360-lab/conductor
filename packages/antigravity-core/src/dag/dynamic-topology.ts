/**
 * Antigravity Workflow Runtime — 动态拓扑扩展 (Dynamic Topology Extensions)
 *
 * Workflow Runtime vNext: 在现有固定 DAG 上叠加拓扑覆盖层，支持子图、受控循环、运行时节点注入。
 *
 * 设计参考:
 * - LangGraph SubGraph: 嵌套图执行
 * - Temporal.io Workflow: 可恢复的有状态工作流
 * - Tarjan SCC Algorithm: 强连通分量检测 (loop 边识别)
 *
 * 设计约束: 扩展字段保持 optional，便于运行时按需叠加拓扑覆盖层。
 */

import type { RunGraph, GraphNode, GraphEdge, WorkflowState, WorkflowEventEnvelope } from '@anthropic/antigravity-shared'
import { createEventId, createISODateTime } from '@anthropic/antigravity-shared'

// ── 扩展类型 (全部 optional，便于渐进启用) ────────────────────────────────────

export interface LoopPolicy {
  /** 最大迭代次数 (安全阈值) */
  maxIterations: number
  /** 收敛条件表达式 (使用 safe evaluator，同 edge.condition 语法) */
  convergenceCondition?: string
}

export interface TopologyMutation {
  /** 操作类型 */
  op: 'addNode' | 'removeNode' | 'addEdge' | 'removeEdge'
  /** 目标 ID */
  targetId?: string
  /** 新增节点定义 */
  node?: GraphNode
  /** 新增边定义 */
  edge?: GraphEdge
  /** 变更原因 */
  reason: string
  /** 发起插件 ID */
  pluginId?: string
}

export interface GraphNodeEx extends GraphNode {
  /** 节点类型: task (默认) 或 subgraph */
  kind?: 'task' | 'subgraph'
  /** 子图定义 (kind=subgraph 时) */
  subgraph?: RunGraph
  /** 是否由插件管理 */
  pluginManaged?: boolean
}

export interface GraphEdgeEx extends GraphEdge {
  /** 边类型: control (默认) 或 loop */
  kind?: 'control' | 'loop'
  /** 循环策略 (kind=loop 时) */
  loop?: LoopPolicy
}

export interface LoopState {
  /** 当前迭代次数 */
  iteration: number
  /** 是否已收敛 */
  converged?: boolean
}

// ── 拓扑事件类型 ──────────────────────────────────────────────────────────────

export type DynamicTopologyEventType =
  | 'GRAPH_MUTATION_APPLIED'
  | 'SUBGRAPH_RUN_CREATED'
  | 'SUBGRAPH_COMPLETED'
  | 'LOOP_ITERATION_STARTED'
  | 'LOOP_CONVERGED'
  | 'LOOP_MAX_REACHED'

// ── 拓扑覆盖层 (Topology Overlay) ──────────────────────────────────────────

/**
 * materializeGraph — 将拓扑变更应用到基础图
 *
 * 纯函数: 不修改输入，返回新图。
 * 保持 Event Sourcing 惯例: mutations 来自 append-only 事件流。
 */
export function materializeGraph(
  baseGraph: RunGraph,
  mutations: TopologyMutation[],
): RunGraph {
  const nodes = [...baseGraph.nodes]
  const edges = [...(baseGraph.edges ?? [])]

  for (const mut of mutations) {
    switch (mut.op) {
      case 'addNode':
        if (mut.node && !nodes.some(n => n.id === mut.node!.id)) {
          nodes.push(mut.node)
        }
        break
      case 'removeNode':
        if (mut.targetId) {
          const idx = nodes.findIndex(n => n.id === mut.targetId)
          if (idx >= 0) nodes.splice(idx, 1)
        }
        break
      case 'addEdge':
        if (mut.edge) {
          edges.push(mut.edge)
        }
        break
      case 'removeEdge':
        if (mut.targetId) {
          const idx = edges.findIndex(e =>
            `${e.from}->${e.to}` === mut.targetId
          )
          if (idx >= 0) edges.splice(idx, 1)
        }
        break
    }
  }

  return { ...baseGraph, nodes, edges }
}

// ── Tarjan SCC 检测 ──────────────────────────────────────────────────────────

interface SCCNode {
  id: string
  index: number
  lowlink: number
  onStack: boolean
}

/**
 * Tarjan 强连通分量算法
 *
 * 用于检测图中的循环。返回所有 SCC (大小 > 1 的为循环)。
 * 时间复杂度: O(V + E)
 */
export function findSCCs(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to)
  }

  let index = 0
  const stack: string[] = []
  const nodeInfo = new Map<string, SCCNode>()
  const sccs: string[][] = []

  function strongConnect(nodeId: string): void {
    const info: SCCNode = {
      id: nodeId,
      index: index,
      lowlink: index,
      onStack: true,
    }
    nodeInfo.set(nodeId, info)
    index++
    stack.push(nodeId)

    const neighbors = adjacency.get(nodeId) ?? []
    for (const neighbor of neighbors) {
      const neighborInfo = nodeInfo.get(neighbor)
      if (!neighborInfo) {
        strongConnect(neighbor)
        const updated = nodeInfo.get(neighbor)!
        info.lowlink = Math.min(info.lowlink, updated.lowlink)
      } else if (neighborInfo.onStack) {
        info.lowlink = Math.min(info.lowlink, neighborInfo.index)
      }
    }

    if (info.lowlink === info.index) {
      const scc: string[] = []
      let w: string
      do {
        w = stack.pop()!
        nodeInfo.get(w)!.onStack = false
        scc.push(w)
      } while (w !== nodeId)
      sccs.push(scc)
    }
  }

  for (const node of nodes) {
    if (!nodeInfo.has(node.id)) {
      strongConnect(node.id)
    }
  }

  return sccs
}

/**
 * analyzeTopology — 分析图拓扑，检测并验证循环
 *
 * 返回:
 * - errors: 非法循环（非 loop 边的回边）
 * - loops: 合法的受控循环
 */
export function analyzeTopology(
  nodes: GraphNode[],
  edges: (GraphEdge | GraphEdgeEx)[],
): {
  errors: string[]
  loops: Array<{ scc: string[]; loopEdge: GraphEdgeEx }>
} {
  const sccs = findSCCs(nodes, edges)
  const errors: string[] = []
  const loops: Array<{ scc: string[]; loopEdge: GraphEdgeEx }> = []

  for (const scc of sccs) {
    if (scc.length <= 1) continue // 单节点 SCC 无循环

    // 查找 SCC 中的所有边
    const sccSet = new Set(scc)
    const intraEdges = edges.filter(e =>
      sccSet.has(e.from) && sccSet.has(e.to)
    ) as GraphEdgeEx[]

    // SCC 内必须至少有一条 loop 边来合法化这个循环
    const loopEdges = intraEdges.filter(e => e.kind === 'loop' && e.loop)
    const hasLoopEdge = loopEdges.length > 0

    if (!hasLoopEdge) {
      errors.push(
        `SCC [${scc.join(', ')}] contains a cycle but no loop edge. ` +
        `At least one edge must have kind="loop" with a LoopPolicy.`
      )
      continue
    }

    for (const le of loopEdges) {
      if (!le.loop?.maxIterations || le.loop.maxIterations <= 0) {
        errors.push(`Loop edge ${le.from}->${le.to} must have maxIterations > 0`)
      } else {
        loops.push({ scc, loopEdge: le })
      }
    }
  }

  return { errors, loops }
}

// ── 循环调度 ──────────────────────────────────────────────────────────────────

/**
 * 判断循环节点是否应继续迭代
 */
export function shouldContinueLoop(
  loopEdge: GraphEdgeEx,
  loopState: LoopState,
): { continue: boolean; reason: string } {
  if (!loopEdge.loop) {
    return { continue: false, reason: 'No loop policy defined' }
  }

  if (loopState.converged) {
    return { continue: false, reason: 'Convergence condition met' }
  }

  if (loopState.iteration >= loopEdge.loop.maxIterations) {
    return { continue: false, reason: `Max iterations reached (${loopEdge.loop.maxIterations})` }
  }

  return { continue: true, reason: `Iteration ${loopState.iteration + 1}/${loopEdge.loop.maxIterations}` }
}

/**
 * 生成循环迭代事件
 */
export function createLoopEvent(
  runId: string,
  loopEdge: GraphEdgeEx,
  loopState: LoopState,
  version: number,
): WorkflowEventEnvelope {
  const shouldContinue = shouldContinueLoop(loopEdge, loopState)

  if (!shouldContinue.continue) {
    const type = loopState.converged ? 'LOOP_CONVERGED' : 'LOOP_MAX_REACHED'
    return {
      eventId: createEventId(),
      runId,
      type: type as string,
      payload: {
        from: loopEdge.from,
        to: loopEdge.to,
        iteration: loopState.iteration,
        reason: shouldContinue.reason,
      },
      timestamp: createISODateTime(),
      version,
    }
  }

  return {
    eventId: createEventId(),
    runId,
    type: 'LOOP_ITERATION_STARTED' as string,
    payload: {
      from: loopEdge.from,
      to: loopEdge.to,
      iteration: loopState.iteration + 1,
      maxIterations: loopEdge.loop!.maxIterations,
    },
    timestamp: createISODateTime(),
    version,
  }
}
