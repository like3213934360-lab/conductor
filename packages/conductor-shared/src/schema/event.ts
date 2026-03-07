/**
 * Conductor AGC — Event Sourcing 事件定义
 *
 * 所有状态变更都通过不可变事件表达，
 * 状态由 projector.ts 的 reduceEvent 投影计算。
 */
import { z } from 'zod'

// ─── 事件基础信封 ─────────────────────────────────────
export const AGCEventEnvelopeSchema = z.object({
  /** 事件唯一 ID */
  eventId: z.string(),
  /** 所属运行 ID */
  runId: z.string(),
  /** 事件类型标识 */
  type: z.string(),
  /** 事件载荷 */
  payload: z.record(z.string(), z.unknown()),
  /** 事件发生时间 */
  timestamp: z.string(),
  /** 状态版本号（单调递增） */
  version: z.number().int().nonnegative(),
})

export type AGCEventEnvelope = z.infer<typeof AGCEventEnvelopeSchema>

// ─── 具体事件类型 ─────────────────────────────────────

/** 运行创建事件 */
export interface RunCreatedEvent {
  type: 'RUN_CREATED'
  payload: {
    goal: string
    nodeIds: string[]
    repoRoot?: string
    files: string[]
  }
}

/**
 * 运行上下文捕获事件 — Phase 2 新增
 *
 * 修复 Phase 1 缺陷: RUN_CREATED 过薄导致 verifyRun() 无法重建完整合规上下文。
 * 此事件紧随 RUN_CREATED 之后发射，持久化完整的 graph、metadata 和 options。
 *
 * 参考: Codex 审查 — "persist the normalized graph, metadata, and options,
 * or add a second immutable RUN_CONTEXT_CAPTURED event right after creation"
 */
export interface RunContextCapturedEvent {
  type: 'RUN_CONTEXT_CAPTURED'
  payload: {
    /** 完整 DAG 图定义 */
    graph: {
      nodes: Array<{
        id: string
        name: string
        dependsOn: string[]
        input: Record<string, unknown>
        skippable: boolean
        model?: string
      }>
      edges: Array<{
        from: string
        to: string
        condition?: string
      }>
    }
    /** 完整运行元数据 */
    metadata: {
      goal: string
      files: string[]
      initiator: string
      repoRoot?: string
      createdAt?: string
    }
    /** 完整运行选项 */
    options: {
      plugins: string[]
      debug: boolean
      riskHint?: string
      tokenBudget?: number
    }
  }
}

/** 节点排队事件 */
export interface NodeQueuedEvent {
  type: 'NODE_QUEUED'
  payload: { nodeId: string }
}

/** 节点开始执行事件 */
export interface NodeStartedEvent {
  type: 'NODE_STARTED'
  payload: { nodeId: string; model?: string }
}

/** 节点完成事件 */
export interface NodeCompletedEvent {
  type: 'NODE_COMPLETED'
  payload: { nodeId: string; output: Record<string, unknown> }
}

/** 节点失败事件 */
export interface NodeFailedEvent {
  type: 'NODE_FAILED'
  payload: { nodeId: string; error: string }
}

/** 风险评估事件 */
export interface RiskAssessedEvent {
  type: 'RISK_ASSESSED'
  payload: {
    drScore: number
    level: string
    factors: Record<string, number>
  }
}

/** 合规评估事件 */
export interface ComplianceEvaluatedEvent {
  type: 'COMPLIANCE_EVALUATED'
  payload: {
    allowed: boolean
    worstStatus: string
    findingCount: number
  }
}

/** 检查点保存事件 */
export interface CheckpointSavedEvent {
  type: 'CHECKPOINT_SAVED'
  payload: { checkpointId: string; version: number }
}

/** 路由决策事件 */
export interface RouteDecidedEvent {
  type: 'ROUTE_DECIDED'
  payload: {
    lane: string
    nodePath: string[]
    skippedCount: number
    confidence: number
  }
}

/** 运行验证事件 */
export interface RunVerifiedEvent {
  type: 'RUN_VERIFIED'
  payload: { ok: boolean; driftDetected: boolean }
}

/** 运行完成事件 */
export interface RunCompletedEvent {
  type: 'RUN_COMPLETED'
  payload: { finalStatus: string }
}

/** 所有 AGC 事件的联合类型 */
export type AGCEvent =
  | RunCreatedEvent
  | RunContextCapturedEvent
  | NodeQueuedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | RiskAssessedEvent
  | ComplianceEvaluatedEvent
  | CheckpointSavedEvent
  | RouteDecidedEvent
  | RunVerifiedEvent
  | RunCompletedEvent

/** 事件类型标识的字面量联合 */
export type AGCEventType = AGCEvent['type']
