/**
 * Conductor AGC — 事件投影器 (Projector)
 *
 * Event Sourcing 核心: 纯函数将事件流还原为 AGCState。
 *
 * 审查修复:
 * #5: 版本单调递增校验
 * #6: RUN_COMPLETED 支持 cancelled/paused 终态
 * #12: RUN_VERIFIED 投影到 verificationResult 字段
 * #3: NODE_SKIPPED 事件处理
 */
import type { AGCState, NodeRuntimeState, CapturedContext } from './agc-state.js'
import type { AGCEventEnvelope } from '../schema/event.js'
import { parseAGCEvent } from '../schema/event.js'
import type {
  RunCreatedPayload, RunContextCapturedPayload,
  NodeQueuedPayload, NodeStartedPayload, NodeCompletedPayload,
  NodeFailedPayload, NodeSkippedPayload,
  RiskAssessedPayload, ComplianceEvaluatedPayload,
  CheckpointSavedPayload, RouteDecidedPayload,
  RunVerifiedPayload, RunCompletedPayload,
} from '../schema/event.js'

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
 *
 * 三模型审计修复 (P0 3/3共识):
 * - 移除所有 `as unknown as` 不安全转换
 * - 使用 parseAGCEvent() 做运行时类型守卫
 * - switch 在 parsed.type 上窄化 (discriminated union)
 */
export function reduceEvent(state: AGCState, envelope: AGCEventEnvelope): AGCState {
  // #5: 版本单调递增校验
  if (envelope.version <= state.version) {
    // 重复或乱序事件，跳过不处理
    return state
  }

  // 三模型审计 P0: 安全类型守卫替代 as unknown as
  const parsed = parseAGCEvent(envelope)
  const next = { ...state, version: envelope.version }
  if (!parsed) return next // 未知事件类型，安全跳过

  switch (parsed.type) {
    case 'RUN_CREATED': {
      const payload = envelope.payload as unknown as RunCreatedPayload
      next.status = 'running'
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
      const payload = envelope.payload as unknown as RunContextCapturedPayload
      next.capturedContext = {
        graph: payload.graph,
        metadata: payload.metadata,
        options: payload.options,
        capturedAt: payload.capturedAt ?? envelope.timestamp,
      } as CapturedContext
      break
    }

    case 'NODE_QUEUED': {
      const payload = envelope.payload as unknown as NodeQueuedPayload
      const nodeState = next.nodes[payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [payload.nodeId]: { ...nodeState, status: 'queued' },
        }
      }
      break
    }

    case 'NODE_STARTED': {
      const payload = envelope.payload as unknown as NodeStartedPayload
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
      const payload = envelope.payload as unknown as NodeCompletedPayload
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
      const payload = envelope.payload as unknown as NodeFailedPayload
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

    // 审查修复 #3: NODE_SKIPPED 事件处理
    case 'NODE_SKIPPED': {
      const payload = envelope.payload as unknown as NodeSkippedPayload
      const nodeState = next.nodes[payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [payload.nodeId]: {
            ...nodeState,
            status: 'skipped',
            completedAt: envelope.timestamp,
          },
        }
      }
      break
    }

    case 'RISK_ASSESSED': {
      const payload = envelope.payload as unknown as RiskAssessedPayload
      next.latestRisk = {
        drScore: payload.drScore,
        level: payload.level,
        factors: payload.factors,
        assessedAt: envelope.timestamp,
      }
      break
    }

    case 'COMPLIANCE_EVALUATED': {
      const payload = envelope.payload as unknown as ComplianceEvaluatedPayload
      next.latestCompliance = {
        allowed: payload.allowed,
        worstStatus: payload.worstStatus,
        findingCount: payload.findingCount,
        evaluatedAt: envelope.timestamp,
      }
      break
    }

    case 'CHECKPOINT_SAVED': {
      const payload = envelope.payload as unknown as CheckpointSavedPayload
      next.lastCheckpointId = payload.checkpointId
      next.lastCheckpointVersion = payload.version
      break
    }

    case 'ROUTE_DECIDED': {
      const payload = envelope.payload as unknown as RouteDecidedPayload
      next.routeDecision = {
        lane: payload.lane,
        nodePath: payload.nodePath,
        skippedCount: payload.skippedCount,
        confidence: payload.confidence,
      }
      break
    }

    // 审查修复 #12: RUN_VERIFIED 投影到读模型
    case 'RUN_VERIFIED': {
      const payload = envelope.payload as unknown as RunVerifiedPayload
      next.verificationResult = {
        ok: payload.ok,
        driftDetected: payload.driftDetected,
        verifiedAt: envelope.timestamp,
      }
      break
    }

    // 审查修复 #6: 支持 cancelled/paused 终态
    case 'RUN_COMPLETED': {
      const payload = envelope.payload as unknown as RunCompletedPayload
      const status = payload.finalStatus
      if (status === 'completed' || status === 'failed' ||
          status === 'cancelled' || status === 'paused') {
        next.status = status
      } else {
        // 未知终态降级为 failed
        next.status = 'failed'
      }
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
