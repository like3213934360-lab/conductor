/**
 * Conductor AGC — 工作流运行时 (WorkflowRuntime)
 *
 * AGC v8.0: Lease-Based Workflow Runtime — Layer 1。
 * 核心理念：LLM 不决定下一步，Runtime 发放执行租约。
 *
 * SOTA 参考:
 * - LangGraph: 编译时图拓扑 + 状态检查点
 * - Temporal.io: Workflow-as-code + Activity 租约
 * - Kubernetes: Controller pattern (desired → actual reconciliation)
 *
 * 强制等级: 10/10 — LLM 无法绕过租约系统
 *
 * 5 种偏差检测:
 * - UNLEASED_NODE: 尝试执行无租约的节点
 * - STALE_LEASE: 租约过期
 * - SCHEMA_INVALID: 检查点格式不符
 * - ILLEGAL_ROUTE: 尝试非法跳转
 * - ILLEGAL_SKIP: 跳过不可跳过的节点
 */

import type { AGCState, RunGraph } from '@anthropic/conductor-shared'
import type { CheckpointSchemaRegistry, SchemaValidationResult } from './checkpoint-schemas.js'
import { BoundaryGuard, type BoundaryMode } from './boundary-guard.js'
import type { TokenBudgetEnforcer } from './token-budget-enforcer.js'
import { randomUUID } from 'crypto'

// ── 节点合同 ──────────────────────────────────────────────────────────────────

/** 路由规则 */
export interface RouteRule {
  edgeId: string
  to: string
  when: (ctx: RouteEvalContext) => boolean
}

/** 路由评估上下文 */
export interface RouteEvalContext {
  state: AGCState
  nodeOutput: Record<string, unknown>
  metadata: Record<string, unknown>
}

/** 工作流节点合同 */
export interface WorkflowNodeContract {
  nodeId: string
  /** 对应的 task_boundary Mode */
  boundaryMode: 'PLANNING' | 'EXECUTION' | 'VERIFICATION'
  /** 是否允许跳过 */
  skippable: boolean
  /** 出边路由规则 (由代码计算，非 LLM 决定) */
  allowedOutgoing: RouteRule[]
}

/** 工作流定义 (从 agc.md 编译) */
export interface WorkflowDefinition {
  workflowId: string
  version: string
  graph: RunGraph
  nodes: Record<string, WorkflowNodeContract>
}

// ── 租约系统 ──────────────────────────────────────────────────────────────────

/** 节点执行租约 — 单次使用凭证 */
export interface NodeLease {
  runId: string
  nodeId: string
  leaseId: string
  stateVersion: number
  issuedAt: string
  expiresAt: string
}

/** 偏差类型 */
export type DeviationCode =
  | 'UNLEASED_NODE'
  | 'STALE_LEASE'
  | 'SCHEMA_INVALID'
  | 'ILLEGAL_ROUTE'
  | 'ILLEGAL_SKIP'
  | 'DUPLICATE_SUBMIT'
  | 'VERSION_MISMATCH'
  | 'BUDGET_EXCEEDED'

/** 工作流偏差 */
export interface WorkflowDeviation {
  code: DeviationCode
  nodeId?: string
  leaseId?: string
  message: string
  observed?: unknown
}

/** 提交检查点的输入 */
export interface CheckpointSubmission {
  runId: string
  leaseId: string
  nodeId: string
  checkpoint: unknown
  /** 当前 task_boundary 模式（用于 BoundaryGuard 断言） */
  currentMode?: BoundaryMode
  /** Token 消耗记录（用于 TokenBudgetEnforcer） */
  tokenUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

/** 提交检查点的结果 */
export type CheckpointResult =
  | { accepted: true; nextNodeIds: string[]; schemaResult: SchemaValidationResult }
  | { accepted: false; reason: string; deviation: WorkflowDeviation }

// ── WorkflowRuntime ──────────────────────────────────────────────────────────

/** Runtime 配置 */
export interface WorkflowRuntimeConfig {
  /** 租约有效期 (ms, 默认 300000 = 5 分钟) */
  leaseTtlMs: number
}

const DEFAULT_CONFIG: WorkflowRuntimeConfig = {
  leaseTtlMs: 5 * 60 * 1000,
}

/**
 * WorkflowRuntime — Lease-Based 工作流运行时
 *
 * 核心保证:
 * 1. LLM 只能执行 Runtime 授权的节点 (NodeLease)
 * 2. 检查点输出必须通过 Schema 验证 (CheckpointSchemaRegistry)
 * 3. 路由由代码计算，不是 LLM 决定
 * 4. 偏差立即检测和阻断
 */
export class WorkflowRuntime {
  private readonly config: WorkflowRuntimeConfig
  private readonly schemaRegistry: CheckpointSchemaRegistry
  private readonly boundaryGuard: BoundaryGuard
  private readonly budgetEnforcer?: TokenBudgetEnforcer

  // 运行时状态
  private definition?: WorkflowDefinition
  private readonly activeLeases = new Map<string, NodeLease>() // leaseId → lease
  private readonly consumedLeases = new Set<string>() // 已使用的 leaseId
  private readonly completedNodes = new Set<string>() // 已完成节点
  private readonly skippedNodes = new Set<string>() // 已跳过节点
  private readonly deviations: WorkflowDeviation[] = []

  constructor(
    schemaRegistry: CheckpointSchemaRegistry,
    config?: Partial<WorkflowRuntimeConfig>,
    budgetEnforcer?: TokenBudgetEnforcer,
  ) {
    this.schemaRegistry = schemaRegistry
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.boundaryGuard = new BoundaryGuard()
    this.budgetEnforcer = budgetEnforcer
  }

  /** 初始化工作流 */
  start(definition: WorkflowDefinition): void {
    this.definition = definition
    this.activeLeases.clear()
    this.consumedLeases.clear()
    this.completedNodes.clear()
    this.skippedNodes.clear()
    this.deviations.length = 0
    // ★ Codex 审查修复: 重置预算状态防止跨 run 泄漏
    this.budgetEnforcer?.reset()
  }

  /**
   * 从 AGCState 恢复运行时状态（重启恢复）
   *
   * 解决 Gemini 审查问题 #1: Transient Runtime State Volatility Gap
   * ★ Bug fix: 同时恢复预算状态，防止重启后预算丢失
   */
  resume(state: AGCState): void {
    for (const [nodeId, nodeState] of Object.entries(state.nodes)) {
      if (nodeState.status === 'completed') this.completedNodes.add(nodeId)
      if (nodeState.status === 'skipped') this.skippedNodes.add(nodeId)
    }
    // ★ 恢复预算状态 (重启后无活跃租约，预留归零)
    if (this.budgetEnforcer && (state as Record<string, unknown>).budgetSnapshot) {
      const snapshot = (state as Record<string, unknown>).budgetSnapshot as {
        globalUsed: number; nodeBreakdown: Record<string, number>
      }
      this.budgetEnforcer.restoreFromSnapshot(snapshot)
    }
    // 重启后清空偏差记录（属于前一次执行的瞬态数据）
    this.deviations.length = 0
    this.activeLeases.clear()
    this.consumedLeases.clear()
  }

  /**
   * 领取下一个可执行节点的租约
   *
   * Runtime 计算就绪节点，发放单次使用租约。
   * LLM 只能执行有租约的节点。
   */
  claimNext(runId: string, state: AGCState): NodeLease[] {
    if (!this.definition) throw new Error('WorkflowRuntime not started')

    // 清理过期租约
    this.expireLeases()

    // 找出就绪节点：依赖全部完成 + 未被跳过 + 未完成 + 无活跃租约
    const readyNodes: string[] = []
    const graph = this.definition.graph

    for (const node of graph.nodes) {
      if (this.completedNodes.has(node.id)) continue
      if (this.skippedNodes.has(node.id)) continue
      if (this.hasActiveLease(node.id)) continue

      // 检查依赖
      const deps = node.dependsOn ?? []
      const allDepsReady = deps.every(dep =>
        this.completedNodes.has(dep) || this.skippedNodes.has(dep),
      )
      if (allDepsReady) {
        // ★ Token 预算强制检查 (Layer 4)
        if (this.budgetEnforcer) {
          const budgetCheck = this.budgetEnforcer.preflight(node.id)
          if (!budgetCheck.allowed) {
            this.deviations.push({
              code: 'BUDGET_EXCEEDED',
              nodeId: node.id,
              message: budgetCheck.reason,
            })
            continue // 预算耗尽，跳过该节点
          }
        }
        readyNodes.push(node.id)
      }
    }

    // 为就绪节点发放租约 (UUID 防重放)
    const now = Date.now()
    return readyNodes.map(nodeId => {
      const leaseId = randomUUID()
      const lease: NodeLease = {
        runId,
        nodeId,
        leaseId,
        stateVersion: state.version,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.config.leaseTtlMs).toISOString(),
      }
      this.activeLeases.set(leaseId, lease)
      return lease
    })
  }

  /**
   * 提交检查点 — 核心强制点
   *
   * 验证步骤:
   * 1. 租约有效性 (UNLEASED_NODE / STALE_LEASE / DUPLICATE_SUBMIT)
   * 2. Schema 验证 (SCHEMA_INVALID)
   * 3. 路由计算 (ILLEGAL_ROUTE)
   */
  submitCheckpoint(input: CheckpointSubmission, state: AGCState): CheckpointResult {
    if (!this.definition) throw new Error('WorkflowRuntime not started')

    const { leaseId, nodeId, checkpoint } = input

    // 1. 租约验证
    if (this.consumedLeases.has(leaseId)) {
      const dev: WorkflowDeviation = {
        code: 'DUPLICATE_SUBMIT',
        nodeId,
        leaseId,
        message: `Lease ${leaseId} already consumed`,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    const lease = this.activeLeases.get(leaseId)
    if (!lease) {
      const dev: WorkflowDeviation = {
        code: 'UNLEASED_NODE',
        nodeId,
        leaseId,
        message: `No active lease found for ${leaseId}`,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    if (lease.nodeId !== nodeId) {
      const dev: WorkflowDeviation = {
        code: 'UNLEASED_NODE',
        nodeId,
        leaseId,
        message: `Lease ${leaseId} is for node ${lease.nodeId}, not ${nodeId}`,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    // ★ Codex 审查修复: 验证 runId 和 stateVersion
    if (lease.runId !== input.runId) {
      const dev: WorkflowDeviation = {
        code: 'UNLEASED_NODE',
        nodeId,
        leaseId,
        message: `Lease ${leaseId} belongs to run ${lease.runId}, not ${input.runId}`,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    if (lease.stateVersion !== state.version) {
      const dev: WorkflowDeviation = {
        code: 'VERSION_MISMATCH',
        nodeId,
        leaseId,
        message: `Lease issued at state v${lease.stateVersion}, current state is v${state.version}`,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    if (new Date(lease.expiresAt).getTime() < Date.now()) {
      const dev: WorkflowDeviation = {
        code: 'STALE_LEASE',
        nodeId,
        leaseId,
        message: `Lease ${leaseId} expired at ${lease.expiresAt}`,
      }
      this.activeLeases.delete(leaseId)
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    // 2. Schema 验证
    const schemaResult = this.schemaRegistry.validate(nodeId, checkpoint)
    if (!schemaResult.valid) {
      const dev: WorkflowDeviation = {
        code: 'SCHEMA_INVALID',
        nodeId,
        leaseId,
        message: `CP-${nodeId} schema validation failed: ${schemaResult.errors?.map(e => `${e.path}: ${e.message}`).join('; ')}`,
        observed: checkpoint,
      }
      this.deviations.push(dev)
      return { accepted: false, reason: dev.message, deviation: dev }
    }

    // 3. BoundaryGuard 断言 (Gemini 审查修复 #3)
    if (input.currentMode) {
      const violation = this.boundaryGuard.assert(nodeId, input.currentMode)
      if (violation) {
        const dev: WorkflowDeviation = {
          code: 'UNLEASED_NODE',
          nodeId,
          leaseId,
          message: violation.message,
        }
        this.deviations.push(dev)
        return { accepted: false, reason: dev.message, deviation: dev }
      }
    }

    // 4. 消费租约 + 标记完成
    this.activeLeases.delete(leaseId)
    this.consumedLeases.add(leaseId)
    this.completedNodes.add(nodeId)

    // ★ 5. Token 预算记录 (Codex 审查修复: 闭合强制循环)
    if (this.budgetEnforcer && input.tokenUsage) {
      this.budgetEnforcer.recordUsage({
        nodeId,
        promptTokens: input.tokenUsage.promptTokens,
        completionTokens: input.tokenUsage.completionTokens,
        totalTokens: input.tokenUsage.totalTokens,
        timestamp: new Date().toISOString(),
      })
    }

    // 6. 路由计算 (代码决定，非 LLM)
    const nextNodeIds = this.computeNextNodes(nodeId, checkpoint as Record<string, unknown>, state)

    return { accepted: true, nextNodeIds, schemaResult }
  }

  /** 标记节点跳过 */
  skipNode(nodeId: string, reason: string): WorkflowDeviation | null {
    if (!this.definition) throw new Error('WorkflowRuntime not started')

    const contract = this.definition.nodes[nodeId]
    if (contract && !contract.skippable) {
      const dev: WorkflowDeviation = {
        code: 'ILLEGAL_SKIP',
        nodeId,
        message: `Node ${nodeId} is not skippable: ${reason}`,
      }
      this.deviations.push(dev)
      return dev
    }

    this.skippedNodes.add(nodeId)
    return null
  }

  /** 获取所有检测到的偏差 */
  getDeviations(): readonly WorkflowDeviation[] {
    return this.deviations
  }

  /** 检查是否有偏差 */
  hasDeviations(): boolean {
    return this.deviations.length > 0
  }

  /** 获取 Token 预算快照 (用于遥测和持久化) */
  getBudgetSnapshot(): import('./token-budget-enforcer.js').BudgetSnapshot | null {
    return this.budgetEnforcer?.getSnapshot() ?? null
  }

  /** 获取工作流完成状态 */
  isComplete(): boolean {
    if (!this.definition) return false
    return this.definition.graph.nodes.every(n =>
      this.completedNodes.has(n.id) || this.skippedNodes.has(n.id),
    )
  }

  // ── 内部方法 ────────────────────────────────────────────────────────────────

  /** 路由计算 — 由 Runtime 执行，非 LLM */
  private computeNextNodes(
    currentNodeId: string,
    output: Record<string, unknown>,
    state: AGCState,
  ): string[] {
    if (!this.definition) return []

    const contract = this.definition.nodes[currentNodeId]
    if (!contract) return []

    const ctx: RouteEvalContext = { state, nodeOutput: output, metadata: {} }
    const nextIds: string[] = []

    for (const rule of contract.allowedOutgoing) {
      try {
        if (rule.when(ctx)) {
          nextIds.push(rule.to)
        }
      } catch {
        // 路由函数异常不应阻塞，记录偏差
        this.deviations.push({
          code: 'ILLEGAL_ROUTE',
          nodeId: currentNodeId,
          message: `Route rule ${rule.edgeId} threw during evaluation`,
        })
      }
    }

    return nextIds
  }

  /** 检查节点是否有活跃租约 */
  private hasActiveLease(nodeId: string): boolean {
    for (const lease of this.activeLeases.values()) {
      if (lease.nodeId === nodeId) return true
    }
    return false
  }

  /** 清理过期租约 */
  private expireLeases(): void {
    const now = Date.now()
    for (const [leaseId, lease] of this.activeLeases.entries()) {
      if (new Date(lease.expiresAt).getTime() < now) {
        this.activeLeases.delete(leaseId)
        // ★ Bug fix: 释放过期租约的预留 token，防止永久泄漏
        if (this.budgetEnforcer) {
          const estimated = (this.definition as WorkflowDefinition | undefined)
            ? undefined : undefined // 从 config 获取
          const nodeEstimate = this.budgetEnforcer['config']?.nodeEstimates?.[lease.nodeId]
            ?? this.budgetEnforcer['config']?.defaultReservation ?? 2000
          this.budgetEnforcer.releaseReservation(nodeEstimate)
        }
        this.deviations.push({
          code: 'STALE_LEASE',
          nodeId: lease.nodeId,
          leaseId,
          message: `Lease ${leaseId} expired (TTL=${this.config.leaseTtlMs}ms)`,
        })
      }
    }
  }
}
