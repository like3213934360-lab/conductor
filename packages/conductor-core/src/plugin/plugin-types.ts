/**
 * Conductor AGC — 插件类型定义
 *
 * 参考 VSCode Extension API + Rollup Plugin + Tapable Hooks
 *
 * 设计原则:
 * 1. Manifest 声明式配置（权限、优先级、时机）
 * 2. Hook-based 生命周期（非 class 继承）
 * 3. Capability-based 安全模型
 * 4. 强类型，Zod 校验
 */
import type { AGCState, RunGraph, RunMetadata, RunOptions,
  GovernanceDecisionRecord, RouteDecision, DRScore } from '@anthropic/conductor-shared'
import type { GovernanceControlResult } from '../governance/governance-types.js'

// ─────────────── 插件权限 ───────────────

/** 插件权限声明 */
export interface PluginPermissions {
  /** 文件系统访问: 允许读取的路径列表 */
  fs?: string[]
  /** 网络访问 */
  network?: boolean
  /** 环境变量访问 */
  env?: string[]
}

// ─────────────── Hook 上下文 ───────────────

/**
 * 运行上下文（传递给 Hook）
 *
 * 三模型审计 P0: extends CancellableHookContext (signal 可选)
 */
export interface RunHookContext extends CancellableHookContext {
  runId: string
  graph: RunGraph
  metadata: RunMetadata
  options: RunOptions
}

/** 风险评估结果上下文 */
export interface RiskHookContext extends CancellableHookContext {
  runId: string
  drScore: DRScore
}

/** 治理评估上下文 */
export interface GovernanceHookContext extends CancellableHookContext {
  runId: string
  state: Readonly<AGCState>
  graph: Readonly<RunGraph>
  metadata: Readonly<RunMetadata>
}

/** 节点完成上下文 */
export interface NodeCompleteHookContext extends CancellableHookContext {
  runId: string
  nodeId: string
  output: Record<string, unknown>
}

/** 运行完成上下文 */
export interface RunCompleteHookContext extends CancellableHookContext {
  runId: string
  finalState: Readonly<AGCState>
  route: RouteDecision
}

// ─────────────── Hook 执行模式 ───────────────

/**
 * Hook 执行模式 (参考 Tapable/Rollup)
 *
 * waterfall: 前一个输出是后一个输入（串行管道）
 * parallel:  全部并行执行（无依赖）
 * bail:      第一个非空返回值中断执行
 * series:    串行执行，无返回值传递
 */
export type HookMode = 'waterfall' | 'parallel' | 'bail' | 'series'

// ─────────────── Hook 定义 ───────────────

/**
 * 2026 SOTA: 可取消的 hook 上下文 (TC39 AbortController + Structured Concurrency)
 *
 * 参考:
 * - TC39 AbortController Stage 4
 * - Effect Runtime (2025): structured concurrency fiber cancellation
 * - WHATWG DOM Abort Model: signal propagation across async boundaries
 */
export interface CancellableHookContext {
  /** AbortSignal — 调用方可通过此信号取消 hook 执行 */
  signal?: AbortSignal
}

/**
 * ConductorHooks — 所有可用的生命周期钩子
 *
 * Hook 命名遵循 before/after 约定:
 * - before*: 可修改输入的 waterfall hook
 * - after*:  只读观察的 series/parallel hook
 *
 * 2026 SOTA: 所有 hook context 继承 CancellableHookContext (signal 可选)
 */
export interface ConductorHooks {
  // ─── 运行生命周期 ───
  /** waterfall: 标准化 RunRequest，可修改 graph/metadata/options */
  beforeRun: (ctx: RunHookContext) => RunHookContext | Promise<RunHookContext> | void | Promise<void>
  /** parallel: 运行上下文捕获后通知 */
  afterContextCaptured: (ctx: RunHookContext) => void | Promise<void>

  // ─── DAG ───
  /** waterfall: DAG 验证前，可修改图 */
  beforeDagValidate: (graph: RunGraph) => RunGraph | Promise<RunGraph> | void | Promise<void>
  /** series: DAG 验证后，只读观察 */
  afterDagValidate: (graph: Readonly<RunGraph>) => void | Promise<void>

  // ─── 风险评估 ───
  /** waterfall: 风险评估前，可注入额外因子 */
  beforeRisk: (ctx: RunHookContext) => RunHookContext | Promise<RunHookContext> | void | Promise<void>
  /** parallel: 风险评估后通知 */
  afterRisk: (ctx: RiskHookContext) => void | Promise<void>

  // ─── 治理检查 ───
  /** bail: 治理检查前，任一插件返回决策即跳过 */
  beforeGovernance: (ctx: GovernanceHookContext) => GovernanceDecisionRecord | Promise<GovernanceDecisionRecord> | void | Promise<void>
  /** waterfall: 治理检查后，可修改决策 */
  afterGovernance: (decision: GovernanceDecisionRecord, ctx: GovernanceHookContext) => GovernanceDecisionRecord | Promise<GovernanceDecisionRecord> | void | Promise<void>

  // ─── 路由 ───
  /** waterfall: 路由决策后，可修改路由 */
  afterRoute: (decision: RouteDecision, ctx: RunHookContext) => RouteDecision | Promise<RouteDecision> | void | Promise<void>

  // ─── 节点生命周期 ───
  /** parallel: 节点完成通知 */
  onNodeComplete: (ctx: NodeCompleteHookContext) => void | Promise<void>

  // ─── 事件审计 ───
  /** series: 事件持久化前最后一道门禁 */
  beforeEventAppend: (events: ReadonlyArray<unknown>) => void | Promise<void>
  /** parallel: 事件持久化后通知（日志、遥测、索引） */
  afterEventAppend: (events: ReadonlyArray<unknown>) => void | Promise<void>

  // ─── 运行结束 ───
  /** series: 运行完成，清理资源 */
  onRunComplete: (ctx: RunCompleteHookContext) => void | Promise<void>
}

/** Hook 名称类型 */
export type HookName = keyof ConductorHooks

/** 各 Hook 的执行模式映射 */
export const HookModes: Record<HookName, HookMode> = {
  beforeRun: 'waterfall',
  afterContextCaptured: 'parallel',
  beforeDagValidate: 'waterfall',
  afterDagValidate: 'series',
  beforeRisk: 'waterfall',
  afterRisk: 'parallel',
  beforeGovernance: 'bail',
  afterGovernance: 'waterfall',
  afterRoute: 'waterfall',
  onNodeComplete: 'parallel',
  beforeEventAppend: 'series',
  afterEventAppend: 'parallel',
  onRunComplete: 'series',
}

// ─────────────── 治理控制贡献 ───────────────

/**
 * GovernanceControlContribution — 插件贡献的治理控制
 *
 * v8.0: 从 ComplianceRuleContribution 进化
 * 1. controlId/controlName 由引擎从插件 manifest 注入（避免漂移）
 * 2. 使用 GaaS 5 阶段模型 (input/execution/output/assurance/routing)
 * 3. 增加 applies() 条件过滤
 * 4. 增加 timeoutMs 超时保护
 */
export interface GovernanceControlContribution {
  /** 控制 ID (由插件自定义的短 ID) */
  id: string
  /** 控制名称 */
  name: string
  /** 执行阶段 (GaaS 5 阶段) */
  stage: 'input' | 'execution' | 'output' | 'assurance' | 'routing'
  /** 默认级别 */
  defaultLevel: 'block' | 'warn' | 'degrade'
  /** 优先级（越大越先执行） */
  priority?: number
  /** 超时毫秒数 */
  timeoutMs?: number
  /** 条件过滤: 返回 false 则跳过此控制 */
  applies?(ctx: Readonly<GovernanceHookContext>): boolean | Promise<boolean>
  /** 评估函数，返回 status + message */
  evaluate(ctx: Readonly<GovernanceHookContext>): Promise<Omit<GovernanceControlResult, 'controlId' | 'controlName'>>
}

// ─────────────── 插件定义 ───────────────

/** 插件清单（声明式配置） */
export interface PluginManifest {
  /** 插件唯一 ID */
  id: string
  /** 插件名称 */
  name: string
  /** 版本号 (semver) */
  version: string
  /** 最小支持的 API 版本 */
  apiVersion?: string
  /** 插件描述 */
  description?: string
  /** 权限声明 */
  permissions?: PluginPermissions
  /** 激活时机 */
  activationEvents?: Array<'onStartup' | 'onRun' | 'onVerify' | 'onCompliance'>
}

/** 插件状态 */
export type PluginStatus = 'discovered' | 'activating' | 'active' | 'failed' | 'deactivated'

/**
 * ConductorPlugin — 插件核心接口
 *
 * 设计参考:
 * - VSCode Extension API: manifest + activate/deactivate
 * - Rollup Plugin: hooks 对象集合
 * - Tapable: 多种 hook 执行模式
 */
export interface ConductorPlugin {
  /** 插件清单 */
  manifest: PluginManifest
  /** 优先级（数值越小越先执行，默认 100） */
  priority?: number
  /** 生命周期钩子 */
  hooks?: Partial<ConductorHooks>
  /** 治理控制贡献 */
  rules?: GovernanceControlContribution[]
  /** 激活插件（接收受限上下文） */
  activate?(ctx: PluginActivationContext): Promise<void>
  /** 停用插件（释放资源） */
  deactivate?(): Promise<void>
}

/** 插件激活上下文 — 受限 API */
export interface PluginActivationContext {
  /** 带前缀的只读日志 */
  logger: {
    info(msg: string, data?: Record<string, unknown>): void
    warn(msg: string, data?: Record<string, unknown>): void
    error(msg: string, data?: Record<string, unknown>): void
  }
  /** 数据目录（插件独立） */
  dataDir: string
}
