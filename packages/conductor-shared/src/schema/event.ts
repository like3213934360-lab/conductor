/**
 * Conductor AGC — Event Sourcing 事件定义
 *
 * 审查修复 #1: 事件 payload 强类型 discriminated union
 *
 * 设计:
 * - AGCEventEnvelopeSchema 的 payload 保持 z.record (兼容序列化)
 * - TypeScript 层使用 AGCEvent discriminated union 做强类型保护
 * - AGCTypedEventEnvelope 替代 payload as xxx 断言
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

// ─── 具体事件类型（强类型 discriminated union）─────────

/** 运行创建事件 */
export interface RunCreatedPayload {
  goal: string
  nodeIds: string[]
  repoRoot?: string
  files: string[]
}

export interface RunCreatedEvent {
  type: 'RUN_CREATED'
  payload: RunCreatedPayload
}

/**
 * 运行上下文捕获事件 — Phase 2 新增
 */
export interface RunContextCapturedPayload {
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
  metadata: {
    goal: string
    files: string[]
    initiator: string
    repoRoot?: string
    createdAt?: string
  }
  options: {
    plugins: string[]
    debug: boolean
    riskHint?: string
    tokenBudget?: number
  }
  capturedAt?: string
}

export interface RunContextCapturedEvent {
  type: 'RUN_CONTEXT_CAPTURED'
  payload: RunContextCapturedPayload
}

/** 节点排队事件 */
export interface NodeQueuedPayload { nodeId: string }
export interface NodeQueuedEvent {
  type: 'NODE_QUEUED'
  payload: NodeQueuedPayload
}

/** 节点开始执行事件 */
export interface NodeStartedPayload { nodeId: string; model?: string }
export interface NodeStartedEvent {
  type: 'NODE_STARTED'
  payload: NodeStartedPayload
}

/** 节点完成事件 */
export interface NodeCompletedPayload { nodeId: string; output: Record<string, unknown> }
export interface NodeCompletedEvent {
  type: 'NODE_COMPLETED'
  payload: NodeCompletedPayload
}

/** 节点失败事件 */
export interface NodeFailedPayload { nodeId: string; error: string }
export interface NodeFailedEvent {
  type: 'NODE_FAILED'
  payload: NodeFailedPayload
}

/** 节点跳过事件 — 审查修复 #3: 激活 skippedNodes */
export interface NodeSkippedPayload { nodeId: string; reason: string }
export interface NodeSkippedEvent {
  type: 'NODE_SKIPPED'
  payload: NodeSkippedPayload
}

/** 风险评估事件 */
export interface RiskAssessedPayload {
  drScore: number
  level: string
  factors: Record<string, number>
}
export interface RiskAssessedEvent {
  type: 'RISK_ASSESSED'
  payload: RiskAssessedPayload
}

/** 合规评估事件 */
export interface ComplianceEvaluatedPayload {
  allowed: boolean
  worstStatus: string
  findingCount: number
}
export interface ComplianceEvaluatedEvent {
  type: 'COMPLIANCE_EVALUATED'
  payload: ComplianceEvaluatedPayload
}

/** 检查点保存事件 */
export interface CheckpointSavedPayload { checkpointId: string; version: number }
export interface CheckpointSavedEvent {
  type: 'CHECKPOINT_SAVED'
  payload: CheckpointSavedPayload
}

/** 路由决策事件 */
export interface RouteDecidedPayload {
  lane: string
  nodePath: string[]
  skippedNodes: string[]
  skippedCount: number
  confidence: number
}
export interface RouteDecidedEvent {
  type: 'ROUTE_DECIDED'
  payload: RouteDecidedPayload
}

/** 运行验证事件 */
export interface RunVerifiedPayload { ok: boolean; driftDetected: boolean }
export interface RunVerifiedEvent {
  type: 'RUN_VERIFIED'
  payload: RunVerifiedPayload
}

/** 运行完成事件 */
export interface RunCompletedPayload { finalStatus: 'completed' | 'failed' | 'cancelled' | 'paused' }
export interface RunCompletedEvent {
  type: 'RUN_COMPLETED'
  payload: RunCompletedPayload
}

/** 所有 AGC 事件的联合类型 (discriminated union on 'type') */
export type AGCEvent =
  | RunCreatedEvent
  | RunContextCapturedEvent
  | NodeQueuedEvent
  | NodeStartedEvent
  | NodeCompletedEvent
  | NodeFailedEvent
  | NodeSkippedEvent
  | RiskAssessedEvent
  | ComplianceEvaluatedEvent
  | CheckpointSavedEvent
  | RouteDecidedEvent
  | RunVerifiedEvent
  | RunCompletedEvent

/** 事件类型标识的字面量联合 */
export type AGCEventType = AGCEvent['type']

/**
 * 强类型事件封装 — 审查修复 #1
 *
 * 用法:
 * ```ts
 * function handleEvent(env: AGCTypedEventEnvelope) {
 *   switch (env.type) {
 *     case 'RUN_CREATED': env.payload.nodeIds // 类型安全!
 *   }
 * }
 * ```
 */
export type AGCTypedEventEnvelope = AGCEventEnvelope & AGCEvent
