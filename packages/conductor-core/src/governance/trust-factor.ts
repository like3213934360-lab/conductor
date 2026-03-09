/**
 * Conductor AGC — 动态信任因子服务 (Trust Factor Service)
 *
 * AGC v8.0: 替代固定权重 (0.30/0.35/0.35) 的动态信任评分系统。
 *
 * 设计参考:
 * - GaaS Trust Factor (arXiv 2025): 历史合规 + 违规衰减
 * - NIST SP 800-207 Zero Trust: 持续评估 + 最小权限
 * - Bayesian Trust Models: 先验 + 观测更新
 *
 * 信任评分 = Σ(signal_i × weight_i), 4 信号:
 * 1. riskScore: DREAD 归一化 (1 - dread/100)
 * 2. complianceRate: 历史策略 pass 率 (滑动窗口)
 * 3. modelReliability: 模型成功率 (超时/失败/成功)
 * 4. evidenceQuality: 引用密度 (citations/content_length)
 */

import type { TrustFactor, TrustSignals } from './governance-types.js'

// ── 配置 ──────────────────────────────────────────────────────────────────────

export interface TrustFactorConfig {
  /** 各信号权重 (归一化) */
  weights: {
    riskScore: number
    complianceRate: number
    modelReliability: number
    evidenceQuality: number
  }
  /** 信任等级阈值 */
  thresholds: {
    trusted: number      // >= 此值为 trusted
    guarded: number      // >= 此值为 guarded
    restricted: number   // >= 此值为 restricted
    // < restricted 为 escalated
  }
  /** 合规历史滑动窗口大小 */
  complianceWindowSize: number
  /** 模型可靠性衰减因子 (指数衰减) */
  reliabilityDecayFactor: number
}

export const DEFAULT_TRUST_CONFIG: TrustFactorConfig = {
  weights: {
    riskScore: 0.25,
    complianceRate: 0.30,
    modelReliability: 0.25,
    evidenceQuality: 0.20,
  },
  thresholds: {
    trusted: 0.75,
    guarded: 0.50,
    restricted: 0.25,
  },
  complianceWindowSize: 50,
  reliabilityDecayFactor: 0.95,
}

// ── 历史记录 ──────────────────────────────────────────────────────────────────

interface ComplianceRecord {
  passed: boolean
  timestamp: number
}

interface ModelRecord {
  provider: string
  success: boolean
  durationMs: number
  timestamp: number
}

// ── 信任因子服务 ──────────────────────────────────────────────────────────────

/**
 * TrustFactorService — 动态信任评分
 *
 * 状态模型:
 * - 维护每个 provider 的历史调用记录
 * - 维护全局合规评估历史
 * - 信任分数在每次 observe() 后更新
 */
export class TrustFactorService {
  private readonly config: TrustFactorConfig
  private readonly complianceHistory: ComplianceRecord[] = []
  private readonly modelHistory: Map<string, ModelRecord[]> = new Map()

  constructor(config?: Partial<TrustFactorConfig>) {
    this.config = { ...DEFAULT_TRUST_CONFIG, ...config }
  }

  /**
   * 计算当前信任因子
   *
   * @param dreadScore - DREAD 风险分数 (0-100)
   * @param provider - 当前使用的模型 provider
   * @param citationCount - 引用数
   * @param contentLength - 内容长度
   */
  compute(params: {
    dreadScore: number
    provider?: string
    citationCount?: number
    contentLength?: number
  }): TrustFactor {
    const signals = this.computeSignals(params)
    const score = this.computeComposite(signals)
    const band = this.scoreToBand(score)
    const reasons = this.generateReasons(signals, band)

    return { score, band, signals, reasons }
  }

  /**
   * 记录合规评估结果 (滑动窗口)
   */
  recordCompliance(passed: boolean): void {
    this.complianceHistory.push({ passed, timestamp: Date.now() })
    // 滑动窗口裁剪
    while (this.complianceHistory.length > this.config.complianceWindowSize) {
      this.complianceHistory.shift()
    }
  }

  /**
   * 记录模型调用结果
   */
  recordModelCall(provider: string, success: boolean, durationMs: number): void {
    if (!this.modelHistory.has(provider)) {
      this.modelHistory.set(provider, [])
    }
    const records = this.modelHistory.get(provider)!
    records.push({ provider, success, durationMs, timestamp: Date.now() })
    // 保留最近 100 条
    while (records.length > 100) records.shift()
  }

  /** 重置所有历史 */
  reset(): void {
    this.complianceHistory.length = 0
    this.modelHistory.clear()
  }

  // ── 内部方法 ────────────────────────────────────────────────────────────────

  private computeSignals(params: {
    dreadScore: number
    provider?: string
    citationCount?: number
    contentLength?: number
  }): TrustSignals {
    // 1. 风险分数 (反转: 低风险 = 高信任)
    const riskScore = 1 - Math.min(1, params.dreadScore / 100)

    // 2. 合规率 (滑动窗口)
    const complianceRate = this.complianceHistory.length > 0
      ? this.complianceHistory.filter(r => r.passed).length / this.complianceHistory.length
      : 0.5 // 无历史时给中性值

    // 3. 模型可靠性 (指数衰减加权)
    let modelReliability = 0.5 // 默认中性
    if (params.provider) {
      const records = this.modelHistory.get(params.provider) ?? []
      if (records.length > 0) {
        let weightedSuccess = 0
        let totalWeight = 0
        const decay = this.config.reliabilityDecayFactor
        for (let i = records.length - 1; i >= 0; i--) {
          const age = records.length - 1 - i
          const weight = Math.pow(decay, age)
          weightedSuccess += records[i]!.success ? weight : 0
          totalWeight += weight
        }
        modelReliability = totalWeight > 0 ? weightedSuccess / totalWeight : 0.5
      }
    }

    // 4. 证据质量 (引用密度)
    const citationCount = params.citationCount ?? 0
    const contentLength = params.contentLength ?? 1
    const rawDensity = citationCount / Math.max(1, contentLength / 500) // 每 500 字符一个引用
    const evidenceQuality = Math.min(1, rawDensity) // 归一化到 [0, 1]

    return { riskScore, complianceRate, modelReliability, evidenceQuality }
  }

  private computeComposite(signals: TrustSignals): number {
    const { weights } = this.config
    const totalWeight = weights.riskScore + weights.complianceRate +
      weights.modelReliability + weights.evidenceQuality

    const score = (
      signals.riskScore * weights.riskScore +
      signals.complianceRate * weights.complianceRate +
      signals.modelReliability * weights.modelReliability +
      signals.evidenceQuality * weights.evidenceQuality
    ) / totalWeight

    return Math.max(0, Math.min(1, score))
  }

  private scoreToBand(score: number): TrustFactor['band'] {
    const { thresholds } = this.config
    if (score >= thresholds.trusted) return 'trusted'
    if (score >= thresholds.guarded) return 'guarded'
    if (score >= thresholds.restricted) return 'restricted'
    return 'escalated'
  }

  private generateReasons(signals: TrustSignals, band: TrustFactor['band']): string[] {
    const reasons: string[] = []
    if (signals.riskScore < 0.3) reasons.push(`High risk: DREAD score ${Math.round((1 - signals.riskScore) * 100)}`)
    if (signals.complianceRate < 0.7) reasons.push(`Low compliance rate: ${Math.round(signals.complianceRate * 100)}%`)
    if (signals.modelReliability < 0.5) reasons.push(`Low model reliability: ${Math.round(signals.modelReliability * 100)}%`)
    if (signals.evidenceQuality < 0.3) reasons.push(`Low evidence quality: ${Math.round(signals.evidenceQuality * 100)}%`)
    if (band === 'trusted' && reasons.length === 0) reasons.push('All trust signals nominal')
    return reasons
  }
}
