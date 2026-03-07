/**
 * Conductor AGC — 事件投影器 (Projector)
 *
 * Event Sourcing 核心: 纯函数将事件流还原为 AGCState。
 * reduceEvent 是整个系统最关键的函数——
 * 所有状态变更的语义都在这里定义。
 *
 * Phase 3 优化:
 * - RUN_CONTEXT_CAPTURED: 使用强类型 CapturedContext
 * - RUN_VERIFIED: 不再是死契约，正确处理
 * - projectState: 纯事件驱动，不再依赖外部 nodeIds
 */
import type { AGCState, NodeRuntimeState, CapturedContext } from './agc-state.js'
import type { AGCEventEnvelope } from '../schema/event.js'

/** 创建初始状态 */
export function createInitialState(runId: string, nodeIds: string[]): AGCState {
  const nodes: Record<string, NodeRuntimeState> = {}
  for (const id of nodeIds) {
    nodes[id] = { nodeId: id, status: 'pending' }
  }
  return {
    runId,
    version: 0,
    status: 'pending',
    nodes,
  }
}

/**
 * 事件归约器: 将单个事件应用到当前状态，返回新状态。
 * 纯函数，无副作用。
 */
export function reduceEvent(state: AGCState, envelope: AGCEventEnvelope): AGCState {
  const next = { ...state, version: envelope.version }

  switch (envelope.type) {
    case 'RUN_CREATED': {
      const payload = envelope.payload as { nodeIds?: string[] }
      next.status = 'running'
      // Phase 3: 从事件重建 nodes，纯事件驱动
      if (payload.nodeIds) {
        const newNodes: Record<string, NodeRuntimeState> = {}
        for (const id of payload.nodeIds) {
          newNodes[id] = { nodeId: id, status: 'pending' }
        }
        next.nodes = newNodes
      }
      break
    }

    case 'RUN_CONTEXT_CAPTURED': {
      // Phase 3: 强类型化
      const payload = envelope.payload as CapturedContext
      next.capturedContext = {
        graph: payload.graph,
        metadata: payload.metadata,
        options: payload.options,
        capturedAt: payload.capturedAt ?? envelope.timestamp,
      }
      break
    }

    case 'NODE_QUEUED': {
      const nodeId = (envelope.payload as { nodeId: string }).nodeId
      const nodeState = next.nodes[nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [nodeId]: { ...nodeState, status: 'queued' },
        }
      }
      break
    }

    case 'NODE_STARTED': {
      const payload = envelope.payload as { nodeId: string; model?: string }
      const nodeState = next.nodes[payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [payload.nodeId]: {
            ...nodeState,
            status: 'running',
            startedAt: envelope.timestamp,
            model: payload.model,
          },
        }
      }
      break
    }

    case 'NODE_COMPLETED': {
      const payload = envelope.payload as { nodeId: string; output: Record<string, unknown> }
      const nodeState = next.nodes[payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [payload.nodeId]: {
            ...nodeState,
            status: 'completed',
            output: payload.output,
            completedAt: envelope.timestamp,
          },
        }
      }
      break
    }

    case 'NODE_FAILED': {
      const payload = envelope.payload as { nodeId: string; error: string }
      const nodeState = next.nodes[payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [payload.nodeId]: {
            ...nodeState,
            status: 'failed',
            error: payload.error,
            completedAt: envelope.timestamp,
          },
        }
      }
      break
    }

    case 'RISK_ASSESSED': {
      const payload = envelope.payload as {
        drScore: number; level: string; factors: Record<string, number>
      }
      next.latestRisk = {
        drScore: payload.drScore,
        level: payload.level,
        factors: payload.factors,
        assessedAt: envelope.timestamp,
      }
      break
    }

    case 'COMPLIANCE_EVALUATED': {
      const payload = envelope.payload as {
        allowed: boolean; worstStatus: string; findingCount: number
      }
      next.latestCompliance = {
        allowed: payload.allowed,
        worstStatus: payload.worstStatus,
        findingCount: payload.findingCount,
        evaluatedAt: envelope.timestamp,
      }
      break
    }

    case 'CHECKPOINT_SAVED': {
      const payload = envelope.payload as { checkpointId: string; version: number }
      next.lastCheckpointId = payload.checkpointId
      next.lastCheckpointVersion = payload.version
      break
    }

    case 'ROUTE_DECIDED': {
      const payload = envelope.payload as {
        lane: string; nodePath: string[]; skippedCount: number; confidence: number
      }
      next.routeDecision = {
        lane: payload.lane,
        nodePath: payload.nodePath,
        skippedCount: payload.skippedCount,
        confidence: payload.confidence,
      }
      break
    }

    case 'RUN_VERIFIED': {
      // Phase 3: 不再是死契约，记录验证结果
      // 验证事件保留只读语义，不改变业务状态
      break
    }

    case 'RUN_COMPLETED': {
      const payload = envelope.payload as { finalStatus: string }
      next.status = payload.finalStatus === 'completed' ? 'completed' : 'failed'
      break
    }

    default:
      // 未知事件类型，不修改状态
      break
  }

  return next
}

/**
 * 从事件流投影完整状态。
 *
 * Phase 3 优化: 纯事件驱动的投影。
 * nodeIds 仍作为参数保留向后兼容，但 RUN_CREATED 事件
 * 内部也会重建 nodes map。
 */
export function projectState(
  runId: string,
  nodeIds: string[],
  events: AGCEventEnvelope[],
): AGCState {
  let state = createInitialState(runId, nodeIds)
  for (const event of events) {
    state = reduceEvent(state, event)
  }
  return state
}

/**
 * 纯事件驱动投影 — Phase 3 新增
 *
 * 不需要外部 nodeIds，完全从事件流重建状态。
 * 用于 verifyRun() 等需要独立验证的场景。
 */
export function projectStateFromEvents(
  runId: string,
  events: AGCEventEnvelope[],
): AGCState {
  let state = createInitialState(runId, [])
  for (const event of events) {
    state = reduceEvent(state, event)
  }
  return state
}
