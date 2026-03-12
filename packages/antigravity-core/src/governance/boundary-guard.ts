/**
 * Antigravity Workflow Runtime — 边界守卫 (BoundaryGuard)
 *
 * Workflow Runtime vNext: task_boundary ↔ workflow 节点模式断言。
 * 确保 ANALYZE 节点只能在 PLANNING 模式下执行，
 * VERIFY 节点只能在 VERIFICATION 模式下执行等。
 *
 * 强制等级: 10/10 — 代码断言，非提示词依赖
 */

/** task_boundary 模式 */
export type BoundaryMode = 'PLANNING' | 'EXECUTION' | 'VERIFICATION'

/** 节点 → 允许的 task_boundary 模式映射 */
const NODE_BOUNDARY_MAP: Record<string, BoundaryMode> = {
  ANALYZE: 'PLANNING',
  PARALLEL: 'EXECUTION',
  DEBATE: 'EXECUTION',
  VERIFY: 'VERIFICATION',
  SYNTHESIZE: 'EXECUTION',
  PERSIST: 'EXECUTION',
}

/** 边界违规 */
export interface BoundaryViolation {
  nodeId: string
  expectedMode: BoundaryMode
  actualMode: BoundaryMode
  message: string
}

/**
 * BoundaryGuard — task_boundary 模式断言
 *
 * 防止 LLM 在错误的 task_boundary 模式下执行节点。
 * 例如：不允许在 EXECUTION 模式下执行 ANALYZE 节点。
 */
export class BoundaryGuard {
  private readonly mapping: Record<string, BoundaryMode>

  constructor(customMapping?: Record<string, BoundaryMode>) {
    this.mapping = { ...NODE_BOUNDARY_MAP, ...customMapping }
  }

  /** 断言节点在正确的模式下执行 */
  assert(nodeId: string, currentMode: BoundaryMode): BoundaryViolation | null {
    const expected = this.mapping[nodeId]
    if (!expected) return null // 未注册节点不强制

    if (currentMode !== expected) {
      return {
        nodeId,
        expectedMode: expected,
        actualMode: currentMode,
        message: `Node ${nodeId} requires ${expected} mode, but current mode is ${currentMode}`,
      }
    }

    return null
  }

  /** 获取节点的期望模式 */
  getExpectedMode(nodeId: string): BoundaryMode | undefined {
    return this.mapping[nodeId]
  }

  /** 注册自定义节点模式 */
  register(nodeId: string, mode: BoundaryMode): void {
    this.mapping[nodeId] = mode
  }
}
