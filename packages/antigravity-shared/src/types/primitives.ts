/**
 * Antigravity Workflow Runtime — 基础类型原语
 *
 * 所有 ID 和枚举类型的单一真实来源。
 * 使用 branded types 确保 RunId 和 NodeId 不可互换。
 */

/** 运行 ID（UUID 格式的 branded type） */
export type RunId = string & { readonly __brand: 'RunId' }

/** 节点 ID（DAG 节点标识） */
export type NodeId = string & { readonly __brand: 'NodeId' }

/** 事件 ID（Event Sourcing 事件标识） */
export type EventId = string & { readonly __brand: 'EventId' }

/** 检查点 ID */
export type CheckpointId = string & { readonly __brand: 'CheckpointId' }

/** ISO-8601 时间戳 */
export type ISODateTime = string & { readonly __brand: 'ISODateTime' }

/** 运行执行状态 */
export type ExecutionStatus =
  | 'pending'      // 等待启动
  | 'running'      // 执行中
  | 'paused'       // 暂停（等待 HITL）
  | 'completed'    // 成功完成
  | 'failed'       // 失败
  | 'cancelled'    // 已取消

/** 风险等级（四级路由） */
export type RiskLevel =
  | 'low'       // 低风险：快速通道
  | 'medium'    // 中风险：标准流程
  | 'high'      // 高风险：完整 DAG + 辩论
  | 'critical'  // 极高风险：完整 DAG + 辩论 + HITL

/** 合规决策状态 */
export type ComplianceStatus =
  | 'pass'      // 通过
  | 'warn'      // 警告（可继续）
  | 'block'     // 阻断（不可继续）
  | 'degrade'   // 降级（使用备选方案）

/** 路由通道 */
export type RouteLane =
  | 'express'   // 快速通道（低风险 + DR=0）
  | 'standard'  // 标准流程
  | 'full'      // 完整 DAG
  | 'escalated' // 升级（含 HITL）

/** 生成 branded ID 的工厂函数 */
export function createRunId(id?: string): RunId {
  return (id ?? crypto.randomUUID()) as RunId
}

export function createNodeId(id: string): NodeId {
  return id as NodeId
}

export function createEventId(): EventId {
  return crypto.randomUUID() as EventId
}

export function createCheckpointId(): CheckpointId {
  return crypto.randomUUID() as CheckpointId
}

export function createISODateTime(date?: Date): ISODateTime {
  return (date ?? new Date()).toISOString() as ISODateTime
}
