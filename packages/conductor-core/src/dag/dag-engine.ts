/**
 * Conductor AGC — DAG 执行引擎
 *
 * 轻量级自定义异步 DAG 引擎（参考 LangGraph-TS 模式）。
 * 基于 Event Sourcing: 引擎不直接修改状态，而是产出事件。
 */
import type { RunGraph, AGCState } from '@anthropic/conductor-shared'
import type { AGCEventEnvelope } from '@anthropic/conductor-shared'
import { createEventId, createISODateTime } from '@anthropic/conductor-shared'
import { topologicalSort, findReadyNodes } from './topology.js'

/** DAG 引擎配置 */
export interface DagEngineOptions {
  /** 最大并发节点数 */
  maxConcurrency: number
}

/** DAG 执行补丁（待追加的事件列表） */
export interface DagExecutionPatch {
  /** 待追加的事件 */
  events: AGCEventEnvelope[]
  /** 是否所有节点已完成/失败 */
  isTerminal: boolean
}

const DEFAULT_OPTIONS: DagEngineOptions = {
  maxConcurrency: 3,
}

/**
 * DAG 执行引擎
 *
 * 设计原则:
 * 1. 引擎是无状态的 — 所有状态来自外部传入的 AGCState
 * 2. 引擎不执行 IO — 只产出事件（Event Sourcing 惯例）
 * 3. 引擎不感知具体模型 — 由 application 层编排模型调用
 */
export class DagEngine {
  private readonly options: DagEngineOptions

  constructor(options?: Partial<DagEngineOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** 校验 DAG 图的合法性 */
  validate(graph: RunGraph): string[] {
    return topologicalSort(graph)
  }

  /**
   * 确定初始可排队的节点
   * 返回无前驱依赖的根节点 ID 列表
   */
  queueInitialNodes(graph: RunGraph): string[] {
    const nodeStatuses: Record<string, string> = {}
    for (const node of graph.nodes) {
      nodeStatuses[node.id] = 'pending'
    }
    return findReadyNodes(graph, nodeStatuses)
  }

  /**
   * 推进 DAG 执行: 根据当前状态计算下一步事件
   *
   * 调用模式:
   *   const patch = engine.advance(graph, state)
   *   await eventStore.append({ runId, events: patch.events })
   *   const newState = projectState(runId, nodeIds, allEvents)
   *   if (patch.isTerminal) { ... }
   */
  advance(graph: RunGraph, state: AGCState): DagExecutionPatch {
    const events: AGCEventEnvelope[] = []
    let currentVersion = state.version

    // 收集节点状态
    const nodeStatuses: Record<string, string> = {}
    for (const node of graph.nodes) {
      const ns = state.nodes[node.id]
      nodeStatuses[node.id] = ns?.status ?? 'pending'
    }

    // 查找就绪节点
    const readyNodes = findReadyNodes(graph, nodeStatuses)

    // 限制并发数
    const runningCount = Object.values(nodeStatuses).filter(s => s === 'running').length
    const canQueue = Math.max(0, this.options.maxConcurrency - runningCount)
    const toQueue = readyNodes.slice(0, canQueue)

    // 为就绪节点生成 NODE_QUEUED 事件
    for (const nodeId of toQueue) {
      currentVersion++
      events.push({
        eventId: createEventId(),
        runId: state.runId,
        type: 'NODE_QUEUED',
        payload: { nodeId },
        timestamp: createISODateTime(),
        version: currentVersion,
      })
    }

    // 检查是否终止: 所有节点都已 completed/failed/skipped
    const allTerminal = graph.nodes.every(node => {
      const status = nodeStatuses[node.id]
      return status === 'completed' || status === 'failed' || status === 'skipped'
    })

    const isTerminal = allTerminal && toQueue.length === 0

    if (isTerminal) {
      // 判断最终状态
      const hasFailure = Object.values(nodeStatuses).some(s => s === 'failed')
      currentVersion++
      events.push({
        eventId: createEventId(),
        runId: state.runId,
        type: 'RUN_COMPLETED',
        payload: { finalStatus: hasFailure ? 'failed' : 'completed' },
        timestamp: createISODateTime(),
        version: currentVersion,
      })
    }

    return { events, isTerminal }
  }
}
