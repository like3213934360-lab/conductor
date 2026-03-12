/**
 * Antigravity Workflow Runtime — 事件投影器 (Projector)
 *
 * Event Sourcing 核心: 纯函数将事件流还原为 WorkflowState。
 *
 * 审查修复:
 * #5: 版本单调递增校验
 * #6: RUN_COMPLETED 支持 cancelled/paused 终态
 * #12: RUN_VERIFIED 投影到 verificationResult 字段
 * #3: NODE_SKIPPED 事件处理
 *
 * 二轮复查修复:
 * - 移除所有 `as unknown as` 断言，改用 parsed.payload (discriminated union 自动窄化)
 */
import type { WorkflowState, NodeRuntimeState, CapturedContext } from './workflow-state.js'
import type { WorkflowEventEnvelope } from '../schema/event.js'
import { parseWorkflowEvent } from '../schema/event.js'

/** 创建初始状态 */
export function createInitialState(runId: string, nodeIds: string[]): WorkflowState {
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
 * 二轮复查修复: 使用 parsed.payload (discriminated union) 替代 as unknown as 断言。
 * switch 在 parsed.type 上窄化后，parsed.payload 自动获得正确类型。
 */
export function reduceEvent(state: WorkflowState, envelope: WorkflowEventEnvelope): WorkflowState {
  // #5: 版本单调递增校验
  if (envelope.version <= state.version) {
    // 重复或乱序事件，跳过不处理
    return state
  }

  // 运行时类型守卫 — parsed.payload 是 discriminated union
  const parsed = parseWorkflowEvent(envelope)
  const next = { ...state, version: envelope.version }
  if (!parsed) return next // 未知事件类型，安全跳过

  switch (parsed.type) {
    case 'RUN_CREATED': {
      next.status = 'running'
      if (parsed.payload.nodeIds) {
        const newNodes: Record<string, NodeRuntimeState> = {}
        for (const id of parsed.payload.nodeIds) {
          newNodes[id] = { nodeId: id, status: 'pending' }
        }
        next.nodes = newNodes
      }
      break
    }

    case 'RUN_CONTEXT_CAPTURED': {
      next.capturedContext = {
        graph: parsed.payload.graph,
        metadata: parsed.payload.metadata,
        options: parsed.payload.options,
        capturedAt: parsed.payload.capturedAt ?? envelope.timestamp,
      } as CapturedContext
      break
    }

    case 'NODE_QUEUED': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: { ...nodeState, status: 'queued' },
        }
      }
      break
    }

    case 'NODE_STARTED': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: {
            ...nodeState,
            status: 'running',
            startedAt: envelope.timestamp,
            model: parsed.payload.model,
            leaseId: parsed.payload.leaseId,
            leaseAttempt: parsed.payload.attempt,
            leaseExpiresAt: parsed.payload.expiresAt,
            requiredEvidence: parsed.payload.requiredEvidence,
            allowedModelPool: parsed.payload.allowedModelPool,
            inputDigest: parsed.payload.inputDigest,
          },
        }
      }
      break
    }

    case 'NODE_HEARTBEAT': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: {
            ...nodeState,
            leaseId: parsed.payload.leaseId,
            leaseAttempt: parsed.payload.attempt,
            lastHeartbeatAt: parsed.payload.heartbeatAt,
          },
        }
      }
      break
    }

    case 'NODE_COMPLETED': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: {
            ...nodeState,
            status: 'completed',
            output: parsed.payload.output,
            completedAt: envelope.timestamp,
            model: parsed.payload.model ?? nodeState.model,
            leaseId: parsed.payload.leaseId,
            durationMs: parsed.payload.durationMs,
            degraded: parsed.payload.degraded,
          },
        }
      }
      break
    }

    case 'NODE_FAILED': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: {
            ...nodeState,
            status: 'failed',
            error: parsed.payload.error,
            completedAt: envelope.timestamp,
            leaseId: parsed.payload.leaseId ?? nodeState.leaseId,
          },
        }
      }
      break
    }

    // 审查修复 #3: NODE_SKIPPED 事件处理
    case 'NODE_SKIPPED': {
      const nodeState = next.nodes[parsed.payload.nodeId]
      if (nodeState) {
        next.nodes = {
          ...next.nodes,
          [parsed.payload.nodeId]: {
            ...nodeState,
            status: 'skipped',
            completedAt: envelope.timestamp,
            leaseId: parsed.payload.leaseId ?? nodeState.leaseId,
          },
        }
      }
      break
    }

    case 'RISK_ASSESSED': {
      next.latestRisk = {
        drScore: parsed.payload.drScore,
        level: parsed.payload.level,
        factors: parsed.payload.factors,
        assessedAt: envelope.timestamp,
      }
      break
    }

    case 'COMPLIANCE_EVALUATED': {
      next.latestCompliance = {
        allowed: parsed.payload.allowed,
        worstStatus: parsed.payload.worstStatus,
        findingCount: parsed.payload.findingCount,
        evaluatedAt: envelope.timestamp,
      }
      break
    }

    case 'CHECKPOINT_SAVED': {
      next.lastCheckpointId = parsed.payload.checkpointId
      next.lastCheckpointVersion = parsed.payload.version
      break
    }

    case 'ROUTE_DECIDED': {
      next.routeDecision = {
        lane: parsed.payload.lane,
        nodePath: parsed.payload.nodePath,
        skippedCount: parsed.payload.skippedCount,
        confidence: parsed.payload.confidence,
      }
      break
    }

    // 审查修复 #12: RUN_VERIFIED 投影到读模型
    case 'RUN_VERIFIED': {
      next.verificationResult = {
        ok: parsed.payload.ok,
        driftDetected: parsed.payload.driftDetected,
        verifiedAt: envelope.timestamp,
      }
      break
    }

    // 审查修复 #6: 支持 cancelled/paused 终态
    case 'RUN_COMPLETED': {
      const status = parsed.payload.finalStatus
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
  events: WorkflowEventEnvelope[],
): WorkflowState {
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
  events: WorkflowEventEnvelope[],
): WorkflowState {
  let state = createInitialState(runId, [])
  for (const event of events) {
    state = reduceEvent(state, event)
  }
  return state
}
