/**
 * Conductor AGC — DAG 拓扑工具
 *
 * 提供环检测、拓扑排序和就绪节点发现。
 * 参考 Kahn 算法（BFS 拓扑排序）。
 *
 * Phase 4: 条件边评估 (edge.condition)
 */
import { AGCError, AGCErrorCode } from '@anthropic/conductor-shared'
import type { RunGraph, GraphNode, GraphEdge } from '@anthropic/conductor-shared'

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
 * Phase 4: 条件边评估 + 优先级调度
 *
 * 条件: 
 * 1. 所有前驱已完成 (completed) 或条件边条件不满足 (视为不需要的依赖)
 * 2. 自身状态为 pending/queued
 * 3. 按 priority 降序排序
 */
export function findReadyNodes(
  graph: RunGraph,
  nodeStatuses: Record<string, string>,
  nodeOutputs?: Record<string, Record<string, unknown>>,
): string[] {
  const index = buildAdjacencyIndex(graph)
  const ready: string[] = []

  for (const node of graph.nodes) {
    const status = nodeStatuses[node.id]
    if (status !== 'pending' && status !== 'queued') continue

    const preds = index.predecessors.get(node.id) ?? []
    const allDepsCompleted = preds.every(depId => {
      const depStatus = nodeStatuses[depId]
      if (depStatus === 'completed' || depStatus === 'skipped') return true

      // Phase 4: 条件边评估 — 如果边有条件且条件不满足，该依赖视为不需要
      if (nodeOutputs) {
        const condEdge = graph.edges.find(
          e => e.from === depId && e.to === node.id && e.condition,
        )
        if (condEdge && !evaluateEdgeCondition(condEdge, nodeOutputs)) {
          return true // 条件不满足，跳过此依赖
        }
      }

      return false
    })
    if (allDepsCompleted) {
      ready.push(node.id)
    }
  }

  // 三模型审计: 按 priority 降序排序
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

/**
 * Phase 4: 条件边评估
 *
 * 安全评估 edge.condition 表达式。
 * 支持简单的属性路径比较: "nodeId.output.key === value"
 *
 * 安全设计: 不使用 eval/Function，仅支持以下操作符:
 * - === / !== / == / !=
 * - > / >= / < / <=
 * - 属性路径: nodeId.fieldName
 * - 字面量: 字符串('xxx'/"xxx"), 数字, true, false, null
 */
export function evaluateEdgeCondition(
  edge: GraphEdge,
  nodeOutputs: Record<string, Record<string, unknown>>,
): boolean {
  if (!edge.condition) return true

  const condition = edge.condition.trim()
  if (!condition) return true

  // 解析: left operator right
  const operators = ['===', '!==', '>=', '<=', '!=', '==', '>', '<'] as const
  let matchedOp: string | undefined
  let left = ''
  let right = ''

  for (const op of operators) {
    const idx = condition.indexOf(op)
    if (idx > 0) {
      matchedOp = op
      left = condition.slice(0, idx).trim()
      right = condition.slice(idx + op.length).trim()
      break
    }
  }

  if (!matchedOp) {
    // 无操作符: 检查布尔真值 (truthy)
    const val = resolveValue(left || condition, nodeOutputs)
    return Boolean(val)
  }

  const leftVal = resolveValue(left, nodeOutputs)
  const rightVal = resolveValue(right, nodeOutputs)

  switch (matchedOp) {
    case '===': return leftVal === rightVal
    case '!==': return leftVal !== rightVal
    case '==':  return leftVal == rightVal
    case '!=':  return leftVal != rightVal
    case '>':   return Number(leftVal) > Number(rightVal)
    case '>=':  return Number(leftVal) >= Number(rightVal)
    case '<':   return Number(leftVal) < Number(rightVal)
    case '<=':  return Number(leftVal) <= Number(rightVal)
    default:    return false
  }
}

/** 解析值: 属性路径 或 字面量 */
function resolveValue(
  token: string,
  nodeOutputs: Record<string, Record<string, unknown>>,
): unknown {
  // 字符串字面量
  if ((token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1)
  }
  // 数字字面量
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token)
  // 布尔/null 字面量
  if (token === 'true') return true
  if (token === 'false') return false
  if (token === 'null') return null

  // 属性路径: nodeId.field.subField
  const parts = token.split('.')
  if (parts.length >= 2) {
    const nodeId = parts[0]!
    const output = nodeOutputs[nodeId]
    if (!output) return undefined
    let current: unknown = output
    for (let i = 1; i < parts.length; i++) {
      if (current == null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[parts[i]!]
    }
    return current
  }

  return token
}
