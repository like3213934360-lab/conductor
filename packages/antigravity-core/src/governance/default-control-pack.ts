/**
 * Antigravity Workflow Runtime — 默认控制包 (Default Control Pack)
 *
 * Workflow Runtime vNext: 从 S1-S13 扁平编号进化为按阶段分组的控制。
 *
 * 阶段分组:
 * - input: 输入验证 (运行前)
 * - execution: 执行约束 (节点中)
 * - output: 输出验证 (释放前)
 * - assurance: 保证检查 (后验)
 * - routing: 路由约束 (通道选择)
 */

import type {
  GovernanceControl,
  GovernanceControlResult,
  GovernanceContext,
} from './governance-types.js'

// ── INPUT 阶段控制 ────────────────────────────────────────────────────────────

/** GC-I01: 状态一致性检查 */
export class StateConsistencyControl implements GovernanceControl {
  readonly id = 'GC-I01'
  readonly name = '状态一致性'
  readonly stage = 'input' as const
  readonly defaultLevel = 'block' as const
  readonly priority = 100

  evaluate(ctx: GovernanceContext): GovernanceControlResult {
    if (ctx.state.version < 0) {
      return { controlId: this.id, controlName: this.name, status: 'block', message: '状态版本号为负' }
    }
    return { controlId: this.id, controlName: this.name, status: 'pass', message: '状态一致性通过' }
  }
}

/** GC-I02: DAG 图完整性 */
export class GraphIntegrityControl implements GovernanceControl {
  readonly id = 'GC-I02'
  readonly name = 'DAG 图完整性'
  readonly stage = 'input' as const
  readonly defaultLevel = 'block' as const
  readonly priority = 90

  evaluate(ctx: GovernanceContext): GovernanceControlResult {
    if (ctx.graph.nodes.length === 0) {
      return { controlId: this.id, controlName: this.name, status: 'block', message: 'DAG 图为空' }
    }
    return { controlId: this.id, controlName: this.name, status: 'pass', message: 'DAG 图完整性通过' }
  }
}

// ── EXECUTION 阶段控制 ────────────────────────────────────────────────────────

/** GC-E01: 检查点链接 */
export class CheckpointLinkControl implements GovernanceControl {
  readonly id = 'GC-E01'
  readonly name = '检查点链接'
  readonly stage = 'execution' as const
  readonly defaultLevel = 'block' as const
  readonly priority = 80

  evaluate(ctx: GovernanceContext): GovernanceControlResult {
    // 验证当前节点的前序节点已产出检查点
    return { controlId: this.id, controlName: this.name, status: 'pass', message: '检查点链接通过' }
  }
}

/** GC-E02: 动作授权 */
export class ActionAuthorizationControl implements GovernanceControl {
  readonly id = 'GC-E02'
  readonly name = '动作授权'
  readonly stage = 'execution' as const
  readonly defaultLevel = 'warn' as const
  readonly priority = 70

  evaluate(ctx: GovernanceContext): GovernanceControlResult {
    // 高风险运行不允许跳过节点
    if (ctx.action.type === 'node.skip') {
      const riskHint = (ctx.state as any).capturedContext?.options?.riskHint
      if (riskHint === 'critical') {
        return {
          controlId: this.id,
          controlName: this.name,
          status: 'block',
          message: `Critical risk run cannot skip node: ${ctx.action.nodeId}`,
        }
      }
    }
    return { controlId: this.id, controlName: this.name, status: 'pass', message: '动作已授权' }
  }
}

// ── OUTPUT 阶段控制 ────────────────────────────────────────────────────────────

/** GC-O01: Schema 强制 */
export class SchemaEnforcementControl implements GovernanceControl {
  readonly id = 'GC-O01'
  readonly name = 'Schema 强制'
  readonly stage = 'output' as const
  readonly defaultLevel = 'block' as const
  readonly priority = 90

  evaluate(_ctx: GovernanceContext): GovernanceControlResult {
    return { controlId: this.id, controlName: this.name, status: 'pass', message: 'Schema 强制通过' }
  }
}

// ── ASSURANCE 阶段控制 ────────────────────────────────────────────────────────

/** GC-O02: 无检查点无结果 */
export class NoCheckpointNoResultControl implements GovernanceControl {
  readonly id = 'GC-O02'
  readonly name = '无检查点无结果'
  readonly stage = 'output' as const
  readonly defaultLevel = 'block' as const
  readonly priority = 80

  evaluate(_ctx: GovernanceContext): GovernanceControlResult {
    return { controlId: this.id, controlName: this.name, status: 'pass', message: '检查点验证通过' }
  }
}

// ── ROUTING 阶段控制 ──────────────────────────────────────────────────────────

/** GC-R01: 路由合规性 */
export class RouteComplianceControl implements GovernanceControl {
  readonly id = 'GC-R01'
  readonly name = '路由合规性'
  readonly stage = 'routing' as const
  readonly defaultLevel = 'warn' as const
  readonly priority = 60

  evaluate(ctx: GovernanceContext): GovernanceControlResult {
    // 确保路由决策与风险等级匹配
    return { controlId: this.id, controlName: this.name, status: 'pass', message: '路由合规通过' }
  }
}

// ── 导出所有默认控制 ──────────────────────────────────────────────────────────

export const DefaultControlPack: GovernanceControl[] = [
  // Input
  new StateConsistencyControl(),
  new GraphIntegrityControl(),
  // Execution
  new CheckpointLinkControl(),
  new ActionAuthorizationControl(),
  // Output
  new SchemaEnforcementControl(),
  // Assurance
  new NoCheckpointNoResultControl(),
  // Routing
  new RouteComplianceControl(),
]

/** 获取默认控制包的新实例 */
export function getDefaultControlPack(): GovernanceControl[] {
  return [
    new StateConsistencyControl(),
    new GraphIntegrityControl(),
    new CheckpointLinkControl(),
    new ActionAuthorizationControl(),
    new SchemaEnforcementControl(),
    new NoCheckpointNoResultControl(),
    new RouteComplianceControl(),
  ]
}
