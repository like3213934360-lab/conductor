/**
 * Conductor AGC — 编译型策略类型定义 (Policy Types)
 *
 * AGC v8.0: JSON 策略 DSL — 将治理规则从 .md 文本变为可执行代码。
 *
 * 设计参考:
 * - OPA/Rego (Open Policy Agent): 声明式策略语言
 * - AWS IAM Policy JSON: 结构化条件表达式
 * - HashiCorp Sentinel: 策略即代码框架
 */

// ── 策略严重度 ────────────────────────────────────────────────────────────────

export type PolicySeverity = 'pass' | 'warn' | 'degrade' | 'block'

// ── 策略表达式 DSL ────────────────────────────────────────────────────────────

/**
 * PolicyExpr — 策略断言表达式 (递归组合)
 *
 * 类似 OPA/Rego 但更轻量，避免引入完整的策略语言运行时。
 * 所有表达式编译为纯 TypeScript 谓词函数。
 */
export type PolicyExpr =
  | { all: PolicyExpr[] }
  | { any: PolicyExpr[] }
  | { not: PolicyExpr }
  | { eq: [PolicyValueRef, unknown] }
  | { gt: [PolicyValueRef, number] }
  | { lt: [PolicyValueRef, number] }
  | { gte: [PolicyValueRef, number] }
  | { exists: PolicyValueRef }
  | { matches: [PolicyValueRef, string] }  // regex pattern
  | { count: [PolicyValueRef, CountOp] }

export interface CountOp {
  gt?: number
  eq?: number
  lt?: number
  gte?: number
}

/**
 * PolicyValueRef — 对 GovernanceContext 的路径引用
 *
 * 格式: 'scope.field' 或 'scope.array[*].field'
 */
export type PolicyValueRef = string

// ── 策略定义 ──────────────────────────────────────────────────────────────────

export interface PolicyDefinition {
  /** 策略 ID (唯一标识) */
  id: string
  /** 策略名称 */
  name: string
  /** 策略版本（语义化版本） */
  version: string
  /** 执行优先级（数字越大越先执行） */
  priority: number
  /** 默认严重度 */
  defaultLevel: Exclude<PolicySeverity, 'pass'>
  /** 是否启用 */
  enabled: boolean
  /** 前置条件 — 为 true 时才执行 assert（跳过不适用的规则）*/
  when?: PolicyExpr
  /** 断言表达式 — 返回 true 表示通过 */
  assert: PolicyExpr
  /** 失败后果 */
  onFailure: {
    status: Exclude<PolicySeverity, 'pass'>
    message: string
  }
  /** 元数据 */
  metadata?: {
    owner?: string
    tags?: string[]
    description?: string
    /** SHA-256 of assert JSON (用于完整性校验) */
    checksum?: string
  }
}

// ── 策略 Bundle ──────────────────────────────────────────────────────────────

export interface PolicyBundle {
  /** Bundle ID */
  bundleId: string
  /** Bundle 版本 */
  bundleVersion: string
  /** 签发时间 (ISO 8601) */
  issuedAt: string
  /** 最低兼容引擎版本 */
  minEngineVersion?: string
  /** 所有策略 */
  policies: PolicyDefinition[]
}

// ── 审计记录 ──────────────────────────────────────────────────────────────────

export interface PolicyAuditRecord {
  /** 运行 ID */
  runId?: string
  /** 策略 ID */
  policyId: string
  /** 策略版本 */
  policyVersion: string
  /** Bundle 版本 */
  bundleVersion: string
  /** 评估时间 (ISO 8601) */
  evaluatedAt: string
  /** 评估结果 */
  status: PolicySeverity
  /** 结果消息 */
  message: string
  /** 输入 hash (用于重放验证) */
  inputHash: string
  /** 持续时间 (ms) */
  durationMs: number
}

// ── 编译结果 ──────────────────────────────────────────────────────────────────

/** 编译后的策略谓词 */
export interface CompiledPolicy {
  /** 源策略 */
  source: PolicyDefinition
  /** 编译后的前置条件谓词 */
  when: (ctx: Record<string, unknown>) => boolean
  /** 编译后的断言谓词 */
  assert: (ctx: Record<string, unknown>) => boolean
}
