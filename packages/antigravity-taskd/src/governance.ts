/**
 * governance.ts — 统一治理网关 (Governance Gateway)
 *
 * 卡在 VERIFY → WRITE 关键转移点：
 * 没有 Governance 的 Ed25519 签名授权，系统绝不允许触碰磁盘。
 */
import type {
  TaskJobMode,
  AggregateAnalysis,
  VerifyAnalysis,
} from './schema.js'
import type { CryptoIdentity } from './crypto-identity.js'

// ── 类型定义 ────────────────────────────────────────────────────

export interface GovernanceContext {
  aggregate: AggregateAnalysis
  verify: VerifyAnalysis
  merkleRoot: string
  shardCount: number
  degradedShards: number
  jobMode: TaskJobMode
}

export interface GovernanceDecision {
  authorized: boolean
  reason: string
  policyVersion: string
  decidedAt: string
  /** 决策本身的 Ed25519 签名（不可篡改） */
  signature: string
  /** 不通过的规则列表（仅 authorized=false 时有值） */
  violations: string[]
  /** 通过但有警告的规则 */
  warnings: string[]
}

export interface GovernanceRule {
  name: string
  /** 返回 true 表示通过 */
  check: (context: GovernanceContext) => boolean
  /** true = 硬阻断；false = 警告但放行 */
  blocking: boolean
}

export interface GovernanceGateway {
  authorize(context: GovernanceContext): Promise<GovernanceDecision>
}

// ── 默认策略规则 ────────────────────────────────────────────────

const POLICY_VERSION = 'default-v1'

const DEFAULT_RULES: GovernanceRule[] = [
  {
    name: 'verify-not-skipped',
    check: ctx => ctx.verify.verdict !== 'unverified',
    blocking: false,  // 降级时可放行但记录警告
  },
  {
    name: 'merkle-integrity',
    check: ctx => ctx.merkleRoot.length === 64,  // 有效的 SHA-256 hex
    blocking: true,   // Merkle root 无效 → 硬阻断
  },
  {
    name: 'max-degraded-ratio',
    check: ctx => ctx.shardCount === 0 || (ctx.degradedShards / ctx.shardCount) < 0.5,
    blocking: true,   // 超过 50% shard 降级 → 拒绝写入
  },
  {
    name: 'has-shard-results',
    check: ctx => ctx.shardCount > 0,
    blocking: true,   // 没有任何 shard → 禁止写入
  },
  {
    name: 'no-critical-conflicts',
    check: ctx => ctx.aggregate.conflicts.length < 5,
    blocking: false,  // 冲突过多时警告
  },
]

// ── 实现 ────────────────────────────────────────────────────────

export class DefaultGovernanceGateway implements GovernanceGateway {
  private readonly rules: GovernanceRule[]

  constructor(
    private readonly identity: CryptoIdentity,
    rules?: GovernanceRule[],
  ) {
    this.rules = rules ?? DEFAULT_RULES
  }

  async authorize(context: GovernanceContext): Promise<GovernanceDecision> {
    const violations: string[] = []
    const warnings: string[] = []

    for (const rule of this.rules) {
      const passed = rule.check(context)
      if (!passed) {
        if (rule.blocking) {
          violations.push(rule.name)
        } else {
          warnings.push(rule.name)
        }
      }
    }

    const authorized = violations.length === 0
    const reason = authorized
      ? warnings.length > 0
        ? `Authorized with warnings: ${warnings.join(', ')}`
        : 'All governance rules passed'
      : `Blocked by: ${violations.join(', ')}`

    // 签名决策本身 — 保证决策不可篡改
    const decisionPayload = { authorized, reason, violations, warnings, policyVersion: POLICY_VERSION }
    const signed = this.identity.signPayload(decisionPayload)

    return {
      authorized,
      reason,
      policyVersion: POLICY_VERSION,
      decidedAt: new Date().toISOString(),
      signature: signed.signature,
      violations,
      warnings,
    }
  }
}
