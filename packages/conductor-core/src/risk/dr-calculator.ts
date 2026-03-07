/**
 * Conductor AGC — DR 分歧率计算器
 *
 * Phase 3 修复: externalHint 不再硬编码，
 * 正确消费 RunOptions.riskHint 参数。
 */
import type { RunGraph, RunMetadata, DRScore, RunOptions } from '@anthropic/conductor-shared'

/** DR 计算因子 */
export interface DRFactors {
  /** 节点数量得分 */
  nodeComplexity: number
  /** 文件涉及范围得分 */
  fileScope: number
  /** 任务描述复杂度得分 */
  goalComplexity: number
  /** 外部风险提示 */
  externalHint: number
}

/** DR 计算输入 */
export interface DRCalculatorInput {
  graph: RunGraph
  metadata: RunMetadata
  options?: RunOptions
}

/**
 * DR 分歧率计算器
 *
 * 综合多个维度的风险信号，输出 0-100 的分歧率分数。
 * 分数越高 → 风险越大 → 需要更完整的 DAG 流程。
 */
export class DRCalculator {
  /** 因子权重 */
  private readonly weights: Record<keyof DRFactors, number> = {
    nodeComplexity: 0.25,
    fileScope: 0.30,
    goalComplexity: 0.25,
    externalHint: 0.20,
  }

  /** riskHint 字符串到数值映射 */
  private static readonly HINT_MAP: Record<string, number> = {
    low: 10, medium: 40, high: 70, critical: 95,
  }

  /**
   * 计算 DR 分歧率
   */
  calculate(input: DRCalculatorInput): DRScore {
    const factors = this.extractFactors(input.graph, input.metadata, input.options)
    const score = this.computeWeightedScore(factors)
    const level = this.scoreToLevel(score)

    return {
      score,
      factors: factors as unknown as Record<string, number>,
      level,
    }
  }

  private extractFactors(
    graph: RunGraph,
    metadata: RunMetadata,
    options?: RunOptions,
  ): DRFactors {
    // 节点复杂度: 节点越多越复杂
    const nodeComplexity = Math.min(graph.nodes.length * 12, 100)

    // 文件范围: 涉及文件越多越复杂
    const fileScope = Math.min(metadata.files.length * 8, 100)

    // 目标复杂度: 基于描述长度的启发式评估
    const goalLen = metadata.goal.length
    const goalComplexity = Math.min(goalLen / 5, 100)

    // P1 修复: 从 RunOptions.riskHint 动态获取外部提示
    const hint = options?.riskHint
    const externalHint = hint
      ? (DRCalculator.HINT_MAP[hint] ?? 30)
      : 30

    return { nodeComplexity, fileScope, goalComplexity, externalHint }
  }

  private computeWeightedScore(factors: DRFactors): number {
    let score = 0
    const entries = Object.entries(this.weights) as Array<[keyof DRFactors, number]>
    for (const [key, weight] of entries) {
      score += factors[key] * weight
    }
    return Math.round(Math.min(100, Math.max(0, score)))
  }

  private scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 25) return 'low'
    if (score < 50) return 'medium'
    if (score < 75) return 'high'
    return 'critical'
  }
}
