/**
 * Antigravity Workflow Runtime — 风险路由器
 *
 * 基于 DR 分歧率和合规发现项，决定执行通道（lane）。
 * 设计参考: NeMo Guardrails 的拦截器管道模式。
 */
import type { DRScore, GovernanceFinding, RouteDecision, RunGraph } from '@anthropic/antigravity-shared'

/** 路由器配置 */
export interface RiskRouterOptions {
  /** DR=0 且 confidence >= 此阈值时启用快速通道 */
  expressConfidenceThreshold: number
  /** 节点跳过的白名单（允许在快速通道中跳过的节点名） */
  skippableNodeNames: string[]
}

const DEFAULT_OPTIONS: RiskRouterOptions = {
  expressConfidenceThreshold: 85,
  skippableNodeNames: ['DEBATE'],
}

/**
 * 风险路由器
 *
 * 路由逻辑:
 *   DR=0 且 conf>=85 → express（跳过 DEBATE）
 *   low → standard
 *   medium → standard
 *   high → full
 *   critical → escalated（含 HITL）
 *   有 BLOCK → escalated
 */
export class RiskRouter {
  private readonly options: RiskRouterOptions

  constructor(options?: Partial<RiskRouterOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  decide(input: {
    score: DRScore
    findings: GovernanceFinding[]
    graph: RunGraph
    confidence?: number
  }): RouteDecision {
    const { score, findings, graph, confidence = 80 } = input
    const allNodeIds = graph.nodes.map(n => n.id)

    // 检查是否有 BLOCK 级别的合规发现
    const hasBlock = findings.some(f => f.status === 'block')
    if (hasBlock) {
      return {
        lane: 'escalated',
        nodePath: allNodeIds,
        skippedNodes: [],
        confidence: 100,
      }
    }

    // 快速通道: DR=0 且置信度足够
    if (score.score === 0 && confidence >= this.options.expressConfidenceThreshold) {
      const skippable = graph.nodes.filter(n =>
        n.skippable || this.options.skippableNodeNames.includes(n.name),
      )
      return {
        lane: 'express',
        nodePath: allNodeIds.filter(id =>
          !skippable.some(s => s.id === id),
        ),
        skippedNodes: skippable.map(s => ({
          nodeId: s.id,
          reason: `DR=0, confidence=${confidence}%, 快速通道跳过`,
        })),
        confidence,
      }
    }

    // 基于风险等级路由
    switch (score.level) {
      case 'low':
      case 'medium':
        return {
          lane: 'standard',
          nodePath: allNodeIds,
          skippedNodes: [],
          confidence,
        }
      case 'high':
        return {
          lane: 'full',
          nodePath: allNodeIds,
          skippedNodes: [],
          confidence,
        }
      case 'critical':
        return {
          lane: 'escalated',
          nodePath: allNodeIds,
          skippedNodes: [],
          confidence,
        }
      default:
        return {
          lane: 'standard',
          nodePath: allNodeIds,
          skippedNodes: [],
          confidence,
        }
    }
  }
}
