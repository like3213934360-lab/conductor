/**
 * Conductor AGC — DR 分歧率计算器
 *
 * 科研升级 B: DREAD 风险模型 (Microsoft Security)
 *
 * 从自定义 4 维经验权重升级到 DREAD 5 维标准:
 * - Damage Potential: 攻击造成的损害程度
 * - Reproducibility: 攻击的可重现性
 * - Exploitability: 利用的难度
 * - Affected Users: 受影响用户范围
 * - Discoverability: 问题的可发现性
 *
 * 参考:
 * - Microsoft DREAD Threat Modeling (2002, 2023 updated)
 * - FIRST CVSS 3.1 (兼容映射)
 * - OWASP Risk Rating Methodology
 *
 * 每个维度评分 0-10，最终 DREAD Score = mean(5 维) × 10 → 0-100
 */
import type { RunGraph, RunMetadata, DRScore, RunOptions } from '@anthropic/conductor-shared'

/** DREAD 5 维因子 */
export interface DREADFactors {
  /** Damage Potential: 节点复杂度/DAG 深度 → 失败影响范围 */
  damage: number
  /** Reproducibility: 历史相似运行的失败率 → 可重现性 */
  reproducibility: number
  /** Exploitability: 目标描述模糊度 → 利用难度 */
  exploitability: number
  /** Affected Users: 涉及文件数 → 受影响范围 */
  affectedUsers: number
  /** Discoverability: 外部风险提示 → 问题可见性 */
  discoverability: number
}

/** DR 计算因子 (保持向后兼容) */
export interface DRFactors {
  nodeComplexity: number
  fileScope: number
  goalComplexity: number
  externalHint: number
}

/** DR 计算输入 */
export interface DRCalculatorInput {
  graph: RunGraph
  metadata: RunMetadata
  options?: RunOptions
}

/**
 * DR 分歧率计算器 — DREAD Model
 *
 * DREAD Score = mean(Damage, Reproducibility, Exploitability, AffectedUsers, Discoverability) × 10
 *
 * 映射关系:
 * | DREAD 维度       | AGC 信号源                        |
 * |-----------------|----------------------------------|
 * | Damage          | DAG 节点数 + 最大深度 (失败波及范围) |
 * | Reproducibility | 保留值 5.0 (无历史数据时中性)       |
 * | Exploitability  | 目标描述长度 (越短越模糊→越难利用)    |
 * | Affected Users  | 涉及文件数 (影响范围)              |
 * | Discoverability | 外部风险提示 riskHint              |
 */
export class DRCalculator {
  /** riskHint 到 DREAD 分数映射 (0-10 scale) */
  private static readonly HINT_DREAD: Record<string, number> = {
    low: 2, medium: 5, high: 8, critical: 10,
  }

  /**
   * 计算 DR 分歧率 (DREAD Model)
   */
  calculate(input: DRCalculatorInput): DRScore {
    const dread = this.extractDREAD(input.graph, input.metadata, input.options)
    const score = this.computeDREADScore(dread)
    const level = this.scoreToLevel(score)

    // 兼容旧接口: 同时输出 DREAD 因子和传统因子
    const factors: Record<string, number> = {
      damage: dread.damage,
      reproducibility: dread.reproducibility,
      exploitability: dread.exploitability,
      affectedUsers: dread.affectedUsers,
      discoverability: dread.discoverability,
    }

    return { score, factors, level }
  }

  /**
   * 提取 DREAD 5 维因子
   *
   * 每个维度 0-10，符合 DREAD 标准评分范围
   */
  private extractDREAD(
    graph: RunGraph,
    metadata: RunMetadata,
    options?: RunOptions,
  ): DREADFactors {
    // 1. Damage Potential (0-10)
    // DAG 节点越多 + 依赖深度越大 → 失败波及范围越大
    const nodeCount = graph.nodes.length
    const maxDepth = this.computeMaxDepth(graph)
    const damage = Math.min(10, (nodeCount * 0.8 + maxDepth * 1.5))

    // 2. Reproducibility (0-10)
    // 无历史数据时中性值 5.0；有 riskHint 时微调
    const reproducibility = 5.0

    // 3. Exploitability (0-10)
    // 目标描述越短→越模糊→exploit 越容易 (反向映射)
    const goalLen = metadata.goal.length
    const exploitability = goalLen < 20 ? 8
      : goalLen < 50 ? 6
      : goalLen < 100 ? 4
      : goalLen < 200 ? 3
      : 2

    // 4. Affected Users (0-10)
    // 涉及文件越多→影响范围越大
    const fileCount = metadata.files.length
    const affectedUsers = Math.min(10, fileCount * 0.5)

    // 5. Discoverability (0-10)
    // 外部风险提示直接映射到 DREAD 分数
    const hint = options?.riskHint
    const discoverability = hint
      ? (DRCalculator.HINT_DREAD[hint] ?? 5)
      : 5

    return { damage, reproducibility, exploitability, affectedUsers, discoverability }
  }

  /**
   * DREAD Score = mean(5 维) × 10 → 0-100
   *
   * 符合 Microsoft DREAD 标准公式:
   * DREAD Risk = (D + R + E + A + D) / 5
   */
  private computeDREADScore(factors: DREADFactors): number {
    const mean = (
      factors.damage +
      factors.reproducibility +
      factors.exploitability +
      factors.affectedUsers +
      factors.discoverability
    ) / 5
    return Math.round(Math.min(100, Math.max(0, mean * 10)))
  }

  /**
   * 计算 DAG 最大深度 (BFS)
   */
  private computeMaxDepth(graph: RunGraph): number {
    if (graph.nodes.length === 0) return 0

    // 构建邻接 + 入度
    const adj = new Map<string, string[]>()
    const inDegree = new Map<string, number>()
    for (const node of graph.nodes) {
      adj.set(node.id, [])
      inDegree.set(node.id, 0)
    }
    for (const edge of graph.edges) {
      const neighbors = adj.get(edge.from)
      if (neighbors) neighbors.push(edge.to)
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    }

    // BFS 拓扑排序 → 层级计算
    const queue: Array<{ id: string; depth: number }> = []
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push({ id, depth: 0 })
    }

    let maxDepth = 0
    while (queue.length > 0) {
      const current = queue.shift()!
      maxDepth = Math.max(maxDepth, current.depth)
      const neighbors = adj.get(current.id) ?? []
      for (const next of neighbors) {
        const newDeg = (inDegree.get(next) ?? 1) - 1
        inDegree.set(next, newDeg)
        if (newDeg === 0) {
          queue.push({ id: next, depth: current.depth + 1 })
        }
      }
    }

    return maxDepth
  }

  private scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score < 25) return 'low'
    if (score < 50) return 'medium'
    if (score < 75) return 'high'
    return 'critical'
  }
}
