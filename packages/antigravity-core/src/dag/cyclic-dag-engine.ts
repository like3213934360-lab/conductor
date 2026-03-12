/**
 * Antigravity Workflow Runtime — Cyclic DAG 引擎扩展
 *
 * 将 dynamic-topology.ts 的循环支持集成到 DAG 引擎:
 * - advance() 扩展支持 loop 边
 * - LoopState 追踪和持久化
 * - 循环节点状态重置
 * - 与 Event Sourcing 完全集成
 *
 * 参考:
 * - LangGraph 2.0 Cyclic Graph
 * - Temporal.io ContinueAsNew Pattern
 * - dynamic-topology.ts Tarjan SCC + shouldContinueLoop
 */
import type { RunGraph, WorkflowState, WorkflowEventEnvelope } from '@anthropic/antigravity-shared'
import { createEventId, createISODateTime } from '@anthropic/antigravity-shared'
import { DagEngine, type DagExecutionPatch } from './dag-engine.js'
import {
  analyzeTopology,
  shouldContinueLoop,
  type GraphEdgeEx,
  type LoopState,
} from './dynamic-topology.js'

/** 循环状态存储 */
export interface LoopStateStore {
  /** 循环边 key = `${from}->${to}` */
  [edgeKey: string]: LoopState
}

/** Cyclic DAG 引擎配置 */
export interface CyclicDagEngineOptions {
  /** 全局最大循环迭代次数 (安全阈值) */
  globalMaxIterations: number
  /** 最大并发节点数 */
  maxConcurrency: number
}

const DEFAULT_OPTIONS: CyclicDagEngineOptions = {
  globalMaxIterations: 100,
  maxConcurrency: 3,
}

/**
 * CyclicDagEngine — 支持受控循环的 DAG 执行引擎
 *
 * 扩展基础 DagEngine:
 * 1. 检测 loop 边 (kind='loop')
 * 2. 管理循环迭代状态 (LoopState)
 * 3. 在迭代结束时重置循环内节点状态
 * 4. 产出循环相关事件 (LOOP_ITERATION_STARTED, LOOP_CONVERGED, LOOP_MAX_REACHED)
 *
 * 设计原则:
 * - 继承 DagEngine 的无状态 + Event Sourcing 设计
 * - loopStates 通过 WorkflowState 传入 (不在引擎中保持状态)
 * - 所有循环变更通过事件表达
 */
export class CyclicDagEngine {
  private readonly baseEngine: DagEngine
  private readonly options: CyclicDagEngineOptions

  constructor(options?: Partial<CyclicDagEngineOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.baseEngine = new DagEngine({ maxConcurrency: this.options.maxConcurrency })
  }

  /**
   * 验证 DAG 图(含循环)的合法性
   *
   * 与基础 DagEngine.validate() 不同:
   * - 允许标记了 kind='loop' 的回边
   * - 要求 loop 边必须有 LoopPolicy
   */
  validate(graph: RunGraph): string[] {
    const edges = graph.edges as GraphEdgeEx[]
    const hasLoopEdges = edges.some(e => e.kind === 'loop')

    if (!hasLoopEdges) {
      // 无循环边: 使用基础引擎的 DAG 验证
      return this.baseEngine.validate(graph)
    }

    // 有循环边: 使用 Tarjan SCC 分析
    const { errors } = analyzeTopology(graph.nodes, edges)
    return errors
  }

  /**
   * 推进 DAG 执行 (支持循环)
   *
   * 扩展基础 advance() 逻辑:
   * 1. 正常推进可执行节点
   * 2. 检查已完成的循环尾节点
   * 3. 如果循环应继续: 重置循环内节点 + 产出 LOOP_ITERATION_STARTED
   * 4. 如果循环应终止: 产出 LOOP_CONVERGED / LOOP_MAX_REACHED
   */
  advance(
    graph: RunGraph,
    state: WorkflowState,
    loopStates: LoopStateStore = {},
  ): DagExecutionPatch & { loopEvents: WorkflowEventEnvelope[]; updatedLoopStates: LoopStateStore } {
    const edges = graph.edges as GraphEdgeEx[]
    const loopEdges = edges.filter(e => e.kind === 'loop' && e.loop)

    // 如果没有 loop 边，直接委托给基础引擎
    if (loopEdges.length === 0) {
      const basePatch = this.baseEngine.advance(graph, state)
      return { ...basePatch, loopEvents: [], updatedLoopStates: loopStates }
    }

    // 收集当前节点状态
    const nodeStatuses: Record<string, string> = {}
    const nodeOutputs: Record<string, Record<string, unknown>> = {}
    for (const node of graph.nodes) {
      const ns = state.nodes[node.id]
      nodeStatuses[node.id] = ns?.status ?? 'pending'
      if (ns?.output) {
        nodeOutputs[node.id] = ns.output
      }
    }

    const allEvents: WorkflowEventEnvelope[] = []
    const loopEvents: WorkflowEventEnvelope[] = []
    const updatedLoopStates = { ...loopStates }
    let currentVersion = state.version

    // 检测需要处理的循环
    for (const loopEdge of loopEdges) {
      const edgeKey = `${loopEdge.from}->${loopEdge.to}`
      const currentLoopState = updatedLoopStates[edgeKey] ?? { iteration: 0 }

      // 检查循环尾节点 (from) 是否已完成
      if (nodeStatuses[loopEdge.from] !== 'completed') continue

      // 判断是否继续循环
      const decision = shouldContinueLoop(loopEdge, currentLoopState)

      if (decision.continue) {
        // 继续循环: 递增迭代计数
        const newIteration = currentLoopState.iteration + 1
        updatedLoopStates[edgeKey] = { iteration: newIteration }

        // 产出 LOOP_ITERATION_STARTED 事件
        currentVersion++
        const iterEvent: WorkflowEventEnvelope = {
          eventId: createEventId(),
          runId: state.runId,
          type: 'LOOP_ITERATION_STARTED',
          payload: {
            from: loopEdge.from,
            to: loopEdge.to,
            iteration: newIteration,
            maxIterations: loopEdge.loop!.maxIterations,
          },
          timestamp: createISODateTime(),
          version: currentVersion,
        }
        loopEvents.push(iterEvent)

        // 重置循环内节点状态为 pending
        const resetNodeIds = this.getLoopBodyNodes(graph, loopEdge, edges)
        for (const resetNodeId of resetNodeIds) {
          currentVersion++
          allEvents.push({
            eventId: createEventId(),
            runId: state.runId,
            type: 'NODE_RESET',
            payload: {
              nodeId: resetNodeId,
              reason: `Loop iteration ${newIteration}`,
              loopEdge: edgeKey,
            },
            timestamp: createISODateTime(),
            version: currentVersion,
          })
          nodeStatuses[resetNodeId] = 'pending'
        }

        // 重新排队循环目标节点
        currentVersion++
        allEvents.push({
          eventId: createEventId(),
          runId: state.runId,
          type: 'NODE_QUEUED',
          payload: { nodeId: loopEdge.to },
          timestamp: createISODateTime(),
          version: currentVersion,
        })
      } else {
        // 终止循环
        const converged = currentLoopState.converged
        const type = converged ? 'LOOP_CONVERGED' : 'LOOP_MAX_REACHED'

        currentVersion++
        const endEvent: WorkflowEventEnvelope = {
          eventId: createEventId(),
          runId: state.runId,
          type,
          payload: {
            from: loopEdge.from,
            to: loopEdge.to,
            iteration: currentLoopState.iteration,
            reason: decision.reason,
          },
          timestamp: createISODateTime(),
          version: currentVersion,
        }
        loopEvents.push(endEvent)

        // 删除循环状态
        delete updatedLoopStates[edgeKey]
      }
    }

    // 基础引擎推进（在循环处理之后）
    const basePatch = this.baseEngine.advance(graph, {
      ...state,
      version: currentVersion,
      nodes: Object.fromEntries(
        Object.entries(state.nodes).map(([id, ns]) => [
          id,
          { ...ns, status: (nodeStatuses[id] ?? ns.status) as typeof ns.status },
        ]),
      ) as WorkflowState['nodes'],
    })

    return {
      events: [...allEvents, ...loopEvents, ...basePatch.events],
      isTerminal: basePatch.isTerminal && loopEvents.length === 0,
      loopEvents,
      updatedLoopStates,
    }
  }

  /**
   * 获取循环体内的节点 ID 列表
   *
   * 循环体 = 从 loop.to 到 loop.from 之间的所有节点
   * (包含 loop.to 和 loop.from)
   */
  private getLoopBodyNodes(
    graph: RunGraph,
    loopEdge: GraphEdgeEx,
    allEdges: GraphEdgeEx[],
  ): string[] {
    const bodyNodes = new Set<string>()
    const visited = new Set<string>()
    const queue: string[] = [loopEdge.to]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      bodyNodes.add(current)

      // 如果到达循环尾节点 (from)，也包含它
      if (current === loopEdge.from) {
        bodyNodes.add(current)
        continue // 不再向下游扩展
      }

      // 沿 control 边向下游扩展 (不沿 loop 边)
      for (const edge of allEdges) {
        if (edge.from === current && edge.kind !== 'loop') {
          queue.push(edge.to)
        }
      }

      // 沿 dependsOn 向下游扩展
      for (const node of graph.nodes) {
        if (node.dependsOn.includes(current) && !bodyNodes.has(node.id)) {
          queue.push(node.id)
        }
      }
    }

    return Array.from(bodyNodes)
  }
}
