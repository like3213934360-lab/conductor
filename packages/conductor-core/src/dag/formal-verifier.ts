/**
 * Conductor AGC — 形式化验证中间件 (Formal State Invariant Verifier)
 *
 * AGC v8.0: 在 EventStore append 前验证状态转换不变量。
 *
 * 设计参考:
 * - TLA+ (Leslie Lamport): 时序逻辑不变量
 * - Azure COYOTE: 异步状态机形式化测试
 * - Alloy Analyzer: 关系逻辑约束求解
 *
 * 语义: 每个 TransitionProperty 是一个"安全属性"（Safety Property），
 *        违反时抛出 InvariantViolationError 阻止状态转换。
 */

import type { AGCState, RunGraph, AGCEventEnvelope } from '@anthropic/conductor-shared'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** DAG 执行补丁 — 一次 advance 产生的事件和状态差 */
export interface DagExecutionPatch {
  /** 产生的事件列表 */
  events: AGCEventEnvelope[]
  /** 转换后的新状态 */
  nextState: AGCState
  /** 转换前的状态版本 */
  prevVersion: number
}

/** 状态转换属性 (安全不变量) */
export interface TransitionProperty {
  /** 属性名 */
  name: string
  /** 描述 */
  description: string
  /** 断言函数 — 违反时 throw */
  assert(graph: RunGraph, prevState: AGCState, patch: DagExecutionPatch): void
}

/** 不变量违反错误 */
export class InvariantViolationError extends Error {
  constructor(
    public readonly propertyName: string,
    public readonly details: string,
  ) {
    super(`Formal Invariant Violation [${propertyName}]: ${details}`)
    this.name = 'InvariantViolationError'
  }
}

// ── 验证器 ────────────────────────────────────────────────────────────────────

/**
 * StateInvariantVerifier — 状态不变量验证中间件
 *
 * 位于 DagEngine.advance() 和 EventStore.append() 之间。
 * 所有属性通过后才允许事件持久化。
 */
export class StateInvariantVerifier {
  private readonly properties: TransitionProperty[] = []

  constructor(properties?: TransitionProperty[]) {
    if (properties) {
      this.properties.push(...properties)
    } else {
      // 加载默认不变量
      this.properties.push(
        mandatoryVerifyOnHighRisk,
        noSkippedMandatoryNodes,
        versionMonotonicity,
        noOrphanedNodes,
        terminationCondition,
      )
    }
  }

  /** 注册新属性 */
  register(property: TransitionProperty): void {
    this.properties.push(property)
  }

  /**
   * 验证一个 DagExecutionPatch
   *
   * @throws InvariantViolationError 如果任何属性被违反
   */
  verifyPatch(graph: RunGraph, prevState: AGCState, patch: DagExecutionPatch): void {
    for (const prop of this.properties) {
      prop.assert(graph, prevState, patch)
    }
  }

  /** 获取所有已注册属性 */
  getProperties(): readonly TransitionProperty[] {
    return this.properties
  }
}

// ── 预定义不变量 ──────────────────────────────────────────────────────────────

/**
 * P1: 高风险运行必须经过 VERIFY 节点
 *
 * 安全属性: ∀ run. risk ∈ {high, critical} ∧ terminating → VERIFY.completed
 */
const mandatoryVerifyOnHighRisk: TransitionProperty = {
  name: 'MandatoryVerifyOnHighRisk',
  description: '高风险运行在终止前必须完成 VERIFY 节点',
  assert(graph, prevState, patch) {
    // 从 capturedContext.options 读取风险等级 (真实字段)
    const options = (prevState as any).capturedContext?.options
    const riskHint = options?.riskHint as string | undefined
    const isHighRisk = riskHint === 'high' || riskHint === 'critical'
    const isTerminating = patch.events.some(e => e.type === 'RUN_COMPLETED')

    if (!isHighRisk || !isTerminating) return

    // 检查图中是否存在 verify/VERIFY 节点并已完成
    const verifyNode = graph.nodes.find(n =>
      n.name.toLowerCase().includes('verify') || n.id.toLowerCase().includes('verify')
    )
    if (!verifyNode) return // 图中无 verify 节点则不强制

    const runtime = patch.nextState.nodes[verifyNode.id]
    if (!runtime || (runtime as any).status !== 'completed') {
      throw new InvariantViolationError(
        'MandatoryVerifyOnHighRisk',
        `Risk hint "${riskHint}" requires VERIFY node "${verifyNode.name}" completion before RUN_COMPLETED`
      )
    }
  },
}

/**
 * P2: 不能跳过必须节点
 *
 * 安全属性: ∀ node ∈ graph. node.skippable === false → node.status ≠ 'skipped'
 */
const noSkippedMandatoryNodes: TransitionProperty = {
  name: 'NoSkippedMandatoryNodes',
  description: '标记为 skippable=false 的节点不能被跳过',
  assert(graph, _prevState, patch) {
    const mandatoryNodes = graph.nodes.filter(n => n.skippable === false)

    for (const node of mandatoryNodes) {
      const runtime = patch.nextState.nodes[node.id]
      if (runtime && (runtime as any).status === 'skipped') {
        throw new InvariantViolationError(
          'NoSkippedMandatoryNodes',
          `Mandatory node "${node.name}" (${node.id}) was illegally skipped`
        )
      }
    }
  },
}

/**
 * P3: 版本单调递增
 *
 * 安全属性: nextState.version > prevState.version
 */
const versionMonotonicity: TransitionProperty = {
  name: 'VersionMonotonicity',
  description: '状态版本必须单调递增',
  assert(_graph, prevState, patch) {
    if (patch.nextState.version <= prevState.version) {
      throw new InvariantViolationError(
        'VersionMonotonicity',
        `Version went from ${prevState.version} to ${patch.nextState.version} (must strictly increase)`
      )
    }
  },
}

/**
 * P4: 无孤儿节点
 *
 * 安全属性: ∀ runtime_node. ∃ graph_node (匹配)
 */
const noOrphanedNodes: TransitionProperty = {
  name: 'NoOrphanedNodes',
  description: '运行时节点必须有对应的图定义节点',
  assert(graph, _prevState, patch) {
    const graphNodeIds = new Set(graph.nodes.map(n => n.id))
    const runtimeNodeIds = Object.keys(patch.nextState.nodes)

    for (const runtimeId of runtimeNodeIds) {
      if (!graphNodeIds.has(runtimeId)) {
        throw new InvariantViolationError(
          'NoOrphanedNodes',
          `Runtime node "${runtimeId}" has no corresponding graph definition`
        )
      }
    }
  },
}

/**
 * P5: 终止条件
 *
 * 安全属性: RUN_COMPLETED 事件只有在所有非 skippable 节点完成后才能发出
 */
const terminationCondition: TransitionProperty = {
  name: 'TerminationCondition',
  description: 'RUN_COMPLETED 只有在所有必须节点完成后才能发出',
  assert(graph, _prevState, patch) {
    const isTerminating = patch.events.some(e => e.type === 'RUN_COMPLETED')
    if (!isTerminating) return

    const mandatoryNodes = graph.nodes.filter(n => n.skippable !== true)
    for (const node of mandatoryNodes) {
      const runtime = patch.nextState.nodes[node.id]
      if (!runtime || (runtime as any).status !== 'completed') {
        throw new InvariantViolationError(
          'TerminationCondition',
          `Cannot emit RUN_COMPLETED: mandatory node "${node.name}" (${node.id}) status is "${(runtime as any)?.status ?? 'missing'}"`
        )
      }
    }
  },
}
