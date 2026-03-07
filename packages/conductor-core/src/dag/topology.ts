/**
 * Conductor AGC — DAG 拓扑工具
 *
 * 提供环检测、拓扑排序和就绪节点发现。
 * 参考 Kahn 算法（BFS 拓扑排序）。
 */
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'
import type { RunGraph, GraphNode } from '@anthropic/conductor-shared'

/** 邻接表索引 */
export interface AdjacencyIndex {
  /** 节点 ID → 前驱节点列表 */
  predecessors: Map<string, string[]>
  /** 节点 ID → 后继节点列表 */
  successors: Map<string, string[]>
  /** 节点 ID → 节点定义 */
  nodeMap: Map<string, GraphNode>
}

/** 构建邻接表索引 */
export function buildAdjacencyIndex(graph: RunGraph): AdjacencyIndex {
  const predecessors = new Map<string, string[]>()
  const successors = new Map<string, string[]>()
  const nodeMap = new Map<string, GraphNode>()

  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
    predecessors.set(node.id, [...node.dependsOn])
    if (!successors.has(node.id)) {
      successors.set(node.id, [])
    }
    for (const dep of node.dependsOn) {
      const succs = successors.get(dep) ?? []
      succs.push(node.id)
      successors.set(dep, succs)
    }
  }

  // 补充显式边（如果有）
  for (const edge of graph.edges) {
    const preds = predecessors.get(edge.to) ?? []
    if (!preds.includes(edge.from)) {
      preds.push(edge.from)
      predecessors.set(edge.to, preds)
    }
    const succs = successors.get(edge.from) ?? []
    if (!succs.includes(edge.to)) {
      succs.push(edge.to)
      successors.set(edge.from, succs)
    }
  }

  return { predecessors, successors, nodeMap }
}

/**
 * Kahn 算法拓扑排序 + 环检测
 * 如果存在环，抛出 GRAPH_CYCLE_DETECTED 错误。
 */
export function topologicalSort(graph: RunGraph): string[] {
  if (graph.nodes.length === 0) {
    throw new AGCError(AGCErrorCode.GRAPH_EMPTY, 'DAG 图为空，至少需要一个节点')
  }

  const index = buildAdjacencyIndex(graph)
  const inDegree = new Map<string, number>()

  for (const node of graph.nodes) {
    const preds = index.predecessors.get(node.id) ?? []
    inDegree.set(node.id, preds.length)
  }

  // Kahn BFS
  const queue: string[] = []
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId)
    }
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)

    const succs = index.successors.get(current) ?? []
    for (const succ of succs) {
      const deg = (inDegree.get(succ) ?? 0) - 1
      inDegree.set(succ, deg)
      if (deg === 0) {
        queue.push(succ)
      }
    }
  }

  if (sorted.length !== graph.nodes.length) {
    const cycleNodes = graph.nodes
      .filter(n => !sorted.includes(n.id))
      .map(n => n.id)
    throw new AGCError(
      AGCErrorCode.GRAPH_CYCLE_DETECTED,
      `DAG 图中检测到环，涉及节点: ${cycleNodes.join(', ')}`,
      { cycleNodes },
    )
  }

  return sorted
}

/**
 * 断言图是无环的（静态校验用）
 */
export function assertAcyclicGraph(graph: RunGraph): void {
  topologicalSort(graph)
}

/**
 * 查找当前可执行的就绪节点
 *
 * 条件: 所有前驱已完成(completed) 且自身状态为 pending/queued
 *
 * 三模型审计: 按 priority 降序排序 (高优先级先调度)
 */
export function findReadyNodes(
  graph: RunGraph,
  nodeStatuses: Record<string, string>,
): string[] {
  const index = buildAdjacencyIndex(graph)
  const ready: string[] = []

  for (const node of graph.nodes) {
    const status = nodeStatuses[node.id]
    if (status !== 'pending' && status !== 'queued') continue

    const preds = index.predecessors.get(node.id) ?? []
    const allDepsCompleted = preds.every(
      depId => nodeStatuses[depId] === 'completed' || nodeStatuses[depId] === 'skipped',
    )
    if (allDepsCompleted) {
      ready.push(node.id)
    }
  }

  // 三模型审计: 按 priority 降序排序
  // NOTE: priority 字段在 GraphNodeSchema 中已定义但 type inference 需要重新构建 shared 包
  ready.sort((a, b) => {
    const nodeA = graph.nodes.find(n => n.id === a)
    const nodeB = graph.nodes.find(n => n.id === b)
    const priA = typeof (nodeA as Record<string, unknown> | undefined)?.priority === 'number'
      ? (nodeA as Record<string, unknown>).priority as number : 0
    const priB = typeof (nodeB as Record<string, unknown> | undefined)?.priority === 'number'
      ? (nodeB as Record<string, unknown>).priority as number : 0
    return priB - priA
  })

  return ready
}
