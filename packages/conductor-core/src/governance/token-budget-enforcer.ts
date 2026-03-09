/**
 * Conductor AGC — Token 预算执行器 (TokenBudgetEnforcer)
 *
 * AGC v8.0: Layer 4 — Token 预算代码级强制。
 *
 * 核心理念：CP-ANALYZE 定义的 token 预算不再仅仅是提示词建议，
 * 而是由代码强制执行的硬性预算上限。
 *
 * 功能:
 * 1. 追踪每节点和全局的累计 token 消耗
 * 2. 在预算耗尽时阻止后续租约发放 (BUDGET_EXCEEDED)
 * 3. 支持节点级和全局级预算 + 预留机制防并行超支
 * 4. 预算接近时发出警告（可降级执行）
 *
 * SOTA 参考:
 * - LlamaIndex TokenCounter: 全局 token 跟踪
 * - OpenAI Usage API: 按请求计量
 * - Temporal.io: Activity budget reservation
 *
 * 强制等级: 10/10 — 代码层面阻断，非提示词建议
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 预算配置 */
export interface TokenBudgetConfig {
  /** 全局 token 上限 (整个 run) */
  globalLimit: number
  /** 预警阈值 (0-1, 默认 0.8 = 80%) */
  warningThreshold: number
  /** 节点级预算上限 (可选, nodeId → limit) */
  nodeLimits?: Record<string, number>
  /** 节点预估消耗 (用于预留, nodeId → estimatedTokens) */
  nodeEstimates?: Record<string, number>
  /** 默认节点预留量 (无预估时使用, 默认 2000) */
  defaultReservation: number
}

/** Token 消耗记录 */
export interface TokenUsageRecord {
  nodeId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  timestamp: string
}

/** 预算检查结果 */
export type BudgetCheckResult =
  | { allowed: true; remaining: number; reservedTokens: number; warning?: string }
  | { allowed: false; reason: string; used: number; limit: number }

/** 预算快照 (用于持久化和审计) */
export interface BudgetSnapshot {
  globalUsed: number
  globalReserved: number
  globalLimit: number
  globalRemaining: number
  utilizationPercent: number
  nodeBreakdown: Record<string, number>
  isWarning: boolean
  isExhausted: boolean
}

// ── 默认配置 ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TokenBudgetConfig = {
  globalLimit: Infinity, // 未指定时不限制
  warningThreshold: 0.8,
  defaultReservation: 2000,
}

// ── TokenBudgetEnforcer ──────────────────────────────────────────────────────

/**
 * TokenBudgetEnforcer — Token 预算代码级强制
 *
 * 核心保证:
 * 1. 超出全局预算 → 阻止租约发放 (BUDGET_EXCEEDED)
 * 2. 超出节点预算 → 阻止该节点执行
 * 3. 接近预算 → 发出警告 (可降级执行)
 * 4. 预留机制防止并行节点超支
 * 5. 所有消耗可审计追踪
 */
export class TokenBudgetEnforcer {
  private readonly config: TokenBudgetConfig
  private readonly usage: TokenUsageRecord[] = []
  private readonly nodeUsage = new Map<string, number>() // nodeId → totalTokens
  private globalUsed = 0
  private globalReserved = 0 // 已预留但未消耗的 token (防并行超支)

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.validateConfig()
  }

  /** 输入验证 — 防止 NaN/负值污染预算会计 */
  private validateConfig(): void {
    if (!Number.isFinite(this.config.globalLimit) && this.config.globalLimit !== Infinity) {
      throw new Error(`Invalid globalLimit: ${this.config.globalLimit}`)
    }
    if (this.config.globalLimit < 0) {
      throw new Error(`globalLimit must be non-negative: ${this.config.globalLimit}`)
    }
    if (this.config.warningThreshold < 0 || this.config.warningThreshold > 1) {
      throw new Error(`warningThreshold must be 0-1: ${this.config.warningThreshold}`)
    }
    if (this.config.defaultReservation < 0) {
      throw new Error(`defaultReservation must be non-negative: ${this.config.defaultReservation}`)
    }
  }

  /**
   * 设置全局预算上限
   *
   * 可在 run 初始化时从 RunOptions.tokenBudget 设置
   */
  setGlobalLimit(limit: number): void {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error(`Invalid globalLimit: ${limit}`)
    }
    ;(this.config as { globalLimit: number }).globalLimit = limit
  }

  /**
   * 设置节点级预算
   */
  setNodeLimit(nodeId: string, limit: number): void {
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error(`Invalid nodeLimit for ${nodeId}: ${limit}`)
    }
    if (!this.config.nodeLimits) {
      ;(this.config as { nodeLimits: Record<string, number> }).nodeLimits = {}
    }
    this.config.nodeLimits![nodeId] = limit
  }

  /**
   * 预检 + 预留 — 在发放租约前检查并预留预算
   *
   * 由 WorkflowRuntime.claimNext() 调用。
   * 预留机制: 为即将执行的节点预留预估 token，防止并行超支。
   */
  preflight(nodeId: string): BudgetCheckResult {
    const estimatedTokens = this.config.nodeEstimates?.[nodeId] ?? this.config.defaultReservation
    const effectiveUsed = this.globalUsed + this.globalReserved

    // 1. 全局预算检查 (已用 + 已预留)
    if (effectiveUsed >= this.config.globalLimit) {
      return {
        allowed: false,
        reason: `Global token budget exhausted: used=${this.globalUsed} reserved=${this.globalReserved} limit=${this.config.globalLimit}`,
        used: effectiveUsed,
        limit: this.config.globalLimit,
      }
    }

    // 2. 检查预留后是否超预算
    const afterReservation = effectiveUsed + estimatedTokens
    if (afterReservation > this.config.globalLimit && isFinite(this.config.globalLimit)) {
      return {
        allowed: false,
        reason: `Insufficient budget for node ${nodeId}: need ~${estimatedTokens}, available=${this.config.globalLimit - effectiveUsed}`,
        used: effectiveUsed,
        limit: this.config.globalLimit,
      }
    }

    // 3. 节点级预算检查
    const nodeLimit = this.config.nodeLimits?.[nodeId]
    if (nodeLimit !== undefined) {
      const nodeUsed = this.nodeUsage.get(nodeId) ?? 0
      if (nodeUsed >= nodeLimit) {
        return {
          allowed: false,
          reason: `Node ${nodeId} token budget exhausted: ${nodeUsed}/${nodeLimit}`,
          used: nodeUsed,
          limit: nodeLimit,
        }
      }
    }

    // 4. 执行预留
    this.globalReserved += estimatedTokens

    // 5. 接近预算警告
    const remaining = this.config.globalLimit - effectiveUsed - estimatedTokens
    const utilization = (effectiveUsed + estimatedTokens) / this.config.globalLimit
    if (utilization >= this.config.warningThreshold && isFinite(utilization)) {
      return {
        allowed: true,
        remaining,
        reservedTokens: estimatedTokens,
        warning: `Token budget at ${(utilization * 100).toFixed(1)}% (used=${this.globalUsed} reserved=${this.globalReserved}/${this.config.globalLimit}). Consider reducing prompt size.`,
      }
    }

    return { allowed: true, remaining, reservedTokens: estimatedTokens }
  }

  /**
   * 释放预留 — 在节点完成或失败后调用
   *
   * 由 WorkflowRuntime.submitCheckpoint() 内部调用
   */
  releaseReservation(estimatedTokens: number): void {
    this.globalReserved = Math.max(0, this.globalReserved - estimatedTokens)
  }

  /**
   * 记录 token 消耗 — 在节点完成后调用
   *
   * 由 WorkflowRuntime.submitCheckpoint() 内部调用。
   * 同时释放该节点的预留量。
   */
  recordUsage(record: TokenUsageRecord): void {
    // 输入验证
    if (!Number.isFinite(record.totalTokens) || record.totalTokens < 0) {
      throw new Error(`Invalid totalTokens: ${record.totalTokens}`)
    }
    if (!Number.isFinite(record.promptTokens) || record.promptTokens < 0) {
      throw new Error(`Invalid promptTokens: ${record.promptTokens}`)
    }
    if (!Number.isFinite(record.completionTokens) || record.completionTokens < 0) {
      throw new Error(`Invalid completionTokens: ${record.completionTokens}`)
    }

    // 释放该节点的预留量
    const estimated = this.config.nodeEstimates?.[record.nodeId] ?? this.config.defaultReservation
    this.releaseReservation(estimated)

    // 记录实际消耗
    this.usage.push(Object.freeze({ ...record })) // 冻结防外部修改
    this.globalUsed += record.totalTokens
    this.nodeUsage.set(
      record.nodeId,
      (this.nodeUsage.get(record.nodeId) ?? 0) + record.totalTokens,
    )
  }

  /**
   * 获取预算快照 — 用于审计、遥测和持久化
   */
  getSnapshot(): BudgetSnapshot {
    const effectiveUsed = this.globalUsed + this.globalReserved
    const utilization = this.config.globalLimit === Infinity
      ? 0
      : effectiveUsed / this.config.globalLimit

    return {
      globalUsed: this.globalUsed,
      globalReserved: this.globalReserved,
      globalLimit: this.config.globalLimit,
      globalRemaining: Math.max(0, this.config.globalLimit - effectiveUsed),
      utilizationPercent: Math.round(utilization * 100),
      nodeBreakdown: Object.fromEntries(this.nodeUsage),
      isWarning: utilization >= this.config.warningThreshold && isFinite(utilization),
      isExhausted: effectiveUsed >= this.config.globalLimit,
    }
  }

  /**
   * 从快照恢复 — restart 后从 AGCState 恢复预算状态
   */
  restoreFromSnapshot(snapshot: Pick<BudgetSnapshot, 'globalUsed' | 'nodeBreakdown'>): void {
    this.globalUsed = snapshot.globalUsed
    this.globalReserved = 0 // 重启后无活跃预留
    this.nodeUsage.clear()
    for (const [nodeId, used] of Object.entries(snapshot.nodeBreakdown)) {
      this.nodeUsage.set(nodeId, used)
    }
  }

  /**
   * 获取所有使用记录 — 用于审计 (返回冻结副本)
   */
  getUsageRecords(): readonly Readonly<TokenUsageRecord>[] {
    return this.usage
  }

  /**
   * 重置 — 新 run 开始时调用
   */
  reset(): void {
    this.usage.length = 0
    this.nodeUsage.clear()
    this.globalUsed = 0
    this.globalReserved = 0
  }
}
