/**
 * Conductor AGC — 策略运行时 + 注册表 (Policy Runtime & Registry)
 *
 * AGC v8.0: 不可变 Bundle 快照 + 版本化 + 审计追踪
 *
 * 运行时语义:
 * 1. 评估前: 检查 when 条件 → 不满足则 skip (pass)
 * 2. 评估中: 执行 assert 谓词
 * 3. 评估后: 生成 PolicyAuditRecord
 * 4. 结果: pass / warn / degrade / block
 */

import type { PolicyBundle, PolicyAuditRecord, CompiledPolicy, PolicySeverity } from './policy-types.js'
import type { GovernanceControl, GovernanceContext, GovernanceControlResult } from '../governance/governance-types.js'
import { compilePolicyBundle } from './policy-compiler.js'
import { createHash } from 'crypto'

// ── 策略评估结果 ──────────────────────────────────────────────────────────────

export interface PolicyEvaluation {
  policyId: string
  policyVersion: string
  status: PolicySeverity
  message: string
  durationMs: number
  skipped: boolean
}

// ── 策略运行时 ────────────────────────────────────────────────────────────────

/**
 * 评估编译后的策略集合
 *
 * @param compiled 编译后的策略数组 (已按 priority 排序)
 * @param ctx GovernanceContext → 转为 Record<string, unknown>
 * @returns 评估结果数组
 */
export function evaluatePolicies(
  compiled: CompiledPolicy[],
  ctx: GovernanceContext,
): PolicyEvaluation[] {
  // 将 GovernanceContext 扁平化为可遍历的 Record
  const flatCtx: Record<string, unknown> = {
    state: ctx.state,
    graph: ctx.graph,
    metadata: ctx.metadata,
    currentNodeId: ctx.currentNodeId,
    action: ctx.action,
  }

  return compiled.map(policy => {
    const start = Date.now()
    const def = policy.source

    // 前置条件检查
    if (!policy.when(flatCtx)) {
      return {
        policyId: def.id,
        policyVersion: def.version,
        status: 'pass' as const,
        message: `Skipped: when condition not met`,
        durationMs: Date.now() - start,
        skipped: true,
      }
    }

    // 执行断言
    try {
      const passed = policy.assert(flatCtx)
      return {
        policyId: def.id,
        policyVersion: def.version,
        status: passed ? ('pass' as const) : def.onFailure.status,
        message: passed ? `${def.name}: 通过` : def.onFailure.message,
        durationMs: Date.now() - start,
        skipped: false,
      }
    } catch (err) {
      // Fail-closed: 评估异常 → block
      return {
        policyId: def.id,
        policyVersion: def.version,
        status: 'block' as const,
        message: `${def.name} 评估异常 (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
        skipped: false,
      }
    }
  })
}

// ── 策略注册表 ────────────────────────────────────────────────────────────────

/**
 * PolicyRegistry — 不可变 Bundle 快照管理
 *
 * 线程安全: 每次热加载创建新 compiled 数组并原子交换引用。
 * 版本追踪: 保留历史 bundleVersion 用于审计/回滚。
 */
export class PolicyRegistry {
  private currentBundle: PolicyBundle | null = null
  private compiled: CompiledPolicy[] = []
  private versionHistory: string[] = []

  /** 加载 Bundle 并编译 */
  load(bundle: PolicyBundle): void {
    // 验证 Bundle 完整性
    if (!bundle.bundleId || !bundle.bundleVersion) {
      throw new Error('Invalid PolicyBundle: missing bundleId or bundleVersion')
    }
    if (!bundle.policies || bundle.policies.length === 0) {
      throw new Error('Invalid PolicyBundle: no policies defined')
    }

    // 编译策略
    const newCompiled = compilePolicyBundle(bundle.policies)

    // 原子交换
    this.currentBundle = bundle
    this.compiled = newCompiled
    this.versionHistory.push(bundle.bundleVersion)
  }

  /** 获取当前编译后的策略 */
  getCompiledPolicies(): CompiledPolicy[] {
    return this.compiled
  }

  /** 获取当前 Bundle 版本 */
  getCurrentVersion(): string | null {
    return this.currentBundle?.bundleVersion ?? null
  }

  /** 获取版本历史 */
  getVersionHistory(): readonly string[] {
    return this.versionHistory
  }

  /**
   * 将编译后的策略转为 GovernanceControl 接口
   *
   * 桥接模式: 让策略引擎无缝接入 GovernanceGateway 管道。
   */
  toGovernanceControls(): GovernanceControl[] {
    return this.compiled.map(cp => ({
      id: cp.source.id,
      name: cp.source.name,
      stage: 'input' as const,
      defaultLevel: cp.source.defaultLevel,
      priority: cp.source.priority,
      evaluate: (ctx: GovernanceContext): GovernanceControlResult => {
        const [result] = evaluatePolicies([cp], ctx)
        return {
          controlId: cp.source.id,
          controlName: cp.source.name,
          status: result!.status,
          message: result!.message,
        }
      },
    }))
  }
}

// ── 审计记录生成 ──────────────────────────────────────────────────────────────

/**
 * 将评估结果转为审计记录
 */
export function toAuditRecords(
  evaluations: PolicyEvaluation[],
  bundleVersion: string,
  runId?: string,
): PolicyAuditRecord[] {
  return evaluations.map(ev => {
    const evaluatedAt = new Date().toISOString()
    return {
      runId,
      policyId: ev.policyId,
      policyVersion: ev.policyVersion,
      bundleVersion,
      evaluatedAt,
      status: ev.status,
      message: ev.message,
      inputHash: hashInput(ev.policyId, ev.policyVersion, evaluatedAt),
      durationMs: ev.durationMs,
    }
  })
}

function hashInput(policyId: string, policyVersion: string, evaluatedAt: string): string {
  return createHash('sha256')
    .update(`${policyId}:${policyVersion}:${evaluatedAt}`)
    .digest('hex')
    .slice(0, 16)
}
