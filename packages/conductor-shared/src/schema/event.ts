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

// ─── 科研升级 C: Zod discriminatedUnion 运行时校验 ───
//
// 原实现: 反序列化后用 as unknown as PayloadType → 恶意 JSON 可注入
// 新实现: Zod discriminatedUnion 在反序列化时强制校验 payload 结构
//
// 参考: Zod discriminatedUnion docs, OWASP Input Validation Cheat Sheet

const RunCreatedPayloadSchema = z.object({
  type: z.literal('RUN_CREATED'),
  payload: z.object({
    goal: z.string(),
    nodeIds: z.array(z.string()),
    repoRoot: z.string().optional(),
    files: z.array(z.string()),
  }),
})

const RunContextCapturedPayloadSchema = z.object({
  type: z.literal('RUN_CONTEXT_CAPTURED'),
  payload: z.object({
    graph: z.object({
      nodes: z.array(z.object({
        id: z.string(), name: z.string(),
        dependsOn: z.array(z.string()),
        input: z.record(z.string(), z.unknown()),
        skippable: z.boolean(),
        model: z.string().optional(),
      })),
      edges: z.array(z.object({
        from: z.string(), to: z.string(),
        condition: z.string().optional(),
      })),
    }),
    metadata: z.object({
      goal: z.string(), files: z.array(z.string()),
      initiator: z.string(),
      repoRoot: z.string().optional(),
      createdAt: z.string().optional(),
    }),
    options: z.object({
      plugins: z.array(z.string()), debug: z.boolean(),
      riskHint: z.string().optional(),
      tokenBudget: z.number().optional(),
    }),
    capturedAt: z.string().optional(),
  }),
})

const NodeQueuedPayloadSchema = z.object({
  type: z.literal('NODE_QUEUED'),
  payload: z.object({ nodeId: z.string() }),
})

const NodeStartedPayloadSchema = z.object({
  type: z.literal('NODE_STARTED'),
  payload: z.object({ nodeId: z.string(), model: z.string().optional() }),
})

const NodeCompletedPayloadSchema = z.object({
  type: z.literal('NODE_COMPLETED'),
  payload: z.object({ nodeId: z.string(), output: z.record(z.string(), z.unknown()) }),
})

const NodeFailedPayloadSchema = z.object({
  type: z.literal('NODE_FAILED'),
  payload: z.object({ nodeId: z.string(), error: z.string() }),
})

const NodeSkippedPayloadSchema = z.object({
  type: z.literal('NODE_SKIPPED'),
  payload: z.object({ nodeId: z.string(), reason: z.string() }),
})

const RiskAssessedPayloadSchema = z.object({
  type: z.literal('RISK_ASSESSED'),
  payload: z.object({
    drScore: z.number(), level: z.string(),
    factors: z.record(z.string(), z.number()),
  }),
})

const ComplianceEvaluatedPayloadSchema = z.object({
  type: z.literal('COMPLIANCE_EVALUATED'),
  payload: z.object({
    allowed: z.boolean(), worstStatus: z.string(), findingCount: z.number(),
  }),
})

const CheckpointSavedPayloadSchema = z.object({
  type: z.literal('CHECKPOINT_SAVED'),
  payload: z.object({ checkpointId: z.string(), version: z.number() }),
})

const RouteDecidedPayloadSchema = z.object({
  type: z.literal('ROUTE_DECIDED'),
  payload: z.object({
    lane: z.string(), nodePath: z.array(z.string()),
    skippedNodes: z.array(z.string()),
    skippedCount: z.number(), confidence: z.number(),
  }),
})

const RunVerifiedPayloadSchema = z.object({
  type: z.literal('RUN_VERIFIED'),
  payload: z.object({ ok: z.boolean(), driftDetected: z.boolean() }),
})

const RunCompletedPayloadSchema = z.object({
  type: z.literal('RUN_COMPLETED'),
  payload: z.object({
    finalStatus: z.enum(['completed', 'failed', 'cancelled', 'paused']),
  }),
})

/**
 * AGC 事件 Zod discriminatedUnion — 运行时强制校验
 *
 * 用于反序列化时替代 as unknown as 断言。
 * 拒绝结构不匹配的恶意/损坏事件。
 */
export const AGCTypedEventSchema = z.discriminatedUnion('type', [
  RunCreatedPayloadSchema,
  RunContextCapturedPayloadSchema,
  NodeQueuedPayloadSchema,
  NodeStartedPayloadSchema,
  NodeCompletedPayloadSchema,
  NodeFailedPayloadSchema,
  NodeSkippedPayloadSchema,
  RiskAssessedPayloadSchema,
  ComplianceEvaluatedPayloadSchema,
  CheckpointSavedPayloadSchema,
  RouteDecidedPayloadSchema,
  RunVerifiedPayloadSchema,
  RunCompletedPayloadSchema,
])

/**
 * 安全解析 AGC 事件 — 科研升级 C
 *
 * 用法:
 * ```ts
 * const raw = JSON.parse(line)
 * const event = parseAGCEvent(raw)
 * if (event) {
 *   switch (event.type) {
 *     case 'RUN_CREATED': event.payload.nodeIds // 类型安全 + 运行时保证!
 *   }
 * }
 * ```
 *
 * @returns 解析成功返回强类型事件，失败返回 null
 */
export function parseAGCEvent(raw: unknown): AGCTypedEventEnvelope | null {
  // 第一步: 校验信封结构 (eventId, runId, version, timestamp)
  const envelope = AGCEventEnvelopeSchema.safeParse(raw)
  if (!envelope.success) return null

  // 第二步: 校验事件类型 + payload 结构
  const typed = AGCTypedEventSchema.safeParse({
    type: envelope.data.type,
    payload: envelope.data.payload,
  })
  if (!typed.success) return null

  return {
    ...envelope.data,
    type: typed.data.type,
    payload: typed.data.payload,
  } as AGCTypedEventEnvelope
}

