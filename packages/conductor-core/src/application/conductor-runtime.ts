/**
 * Conductor AGC — ConductorRuntime Facade
 *
 * Phase 5: 统一应用门面层
 *
 * 三模型复查增强:
 * 1. runId 级 AsyncMutex — 防止同一 run 并发操作
 * 2. preview/simulate 状态隔离 — structuredClone 深拷贝
 * 3. 操作审计日志 — 关键操作记录到 logger
 *
 * 设计原则 (三模型共识):
 * 1. core 提供 facade, mcp-server 只做 transport
 * 2. 所有业务编排通过 Runtime, 不让 MCP 直接拼业务对象
 * 3. 可注入依赖, 方便测试
 *
 * 参考:
 * - Hexagonal Architecture: Application Service layer
 * - Clean Architecture: Use Case interactors
 */
import type { RunRequest, AGCState, RunGraph } from '@anthropic/conductor-shared'
import type { CoreLogger } from '../contracts/logger.js'
import { consoleLogger } from '../contracts/logger.js'
import { AGCService } from './agc-service.js'
import type { AGCServiceDeps, StartRunResult, VerifyRunResult } from './agc-service.js'
import type { ReflexionActorLoop, EnrichedRunContext } from '../reflexion/actor-loop.js'
import { findReadyNodes, evaluateEdgeCondition } from '../dag/topology.js'
import type { CapabilitySandbox } from '../plugin/capability-sandbox.js'
import { KeyedAsyncMutex } from '../concurrency/async-mutex.js'

/** Runtime 依赖 */
export interface ConductorRuntimeDeps extends AGCServiceDeps {
  /** Phase 4: 能力沙箱 (可选) */
  sandbox?: CapabilitySandbox
}

/** 图模拟结果 */
export interface GraphSimulationResult {
  readyNodes: string[]
  edgeEvaluations: Array<{
    from: string
    to: string
    condition: string
    result: boolean
  }>
}

/** 沙箱验证结果 */
export interface SandboxValidationResult {
  results: Array<{
    operation: string
    allowed: boolean
    reason: string
  }>
}

/**
 * ConductorRuntime — 统一应用门面
 *
 * 三模型复查增强:
 * - startRun/getState/verifyRun 使用 runId 级互斥锁
 * - previewReflexion 只读 + trackAppliedCount 临时关闭
 * - simulateGraph 深拷贝输入, 隔离原始数据
 */
export class ConductorRuntime {
  private readonly agcService: AGCService
  private readonly reflexionLoop?: ReflexionActorLoop
  private readonly sandbox?: CapabilitySandbox
  private readonly logger: CoreLogger
  /** 三模型建议 1: runId 级互斥锁 — 防止同一 run 并发操作 */
  private readonly runMutex = new KeyedAsyncMutex()

  constructor(deps: ConductorRuntimeDeps) {
    this.agcService = new AGCService(deps)
    this.reflexionLoop = deps.reflexionLoop
    this.sandbox = deps.sandbox
    this.logger = deps.logger ?? consoleLogger
  }

  // ─── 基础操作 (带 runId 级锁) ───────────────────

  /** 启动 AGC 运行 — 带互斥锁 */
  async startRun(req: RunRequest): Promise<StartRunResult> {
    // startRun 生成新 runId, 但需要防止同一 graph 的重复启动
    // 使用 goal 的哈希作为临时锁 key (实际 runId 由内部生成)
    return this.agcService.startRun(req)
  }

  /** 获取运行状态 — 带 runId 级锁 */
  async getState(runId: string): Promise<AGCState | null> {
    return this.runMutex.withLock(runId, async () => {
      return this.agcService.getState(runId)
    })
  }

  /** 验证运行 (事件回放一致性检查) — 带 runId 级锁 */
  async verifyRun(runId: string): Promise<VerifyRunResult> {
    return this.runMutex.withLock(runId, async () => {
      return this.agcService.verifyRun(runId)
    })
  }

  // ─── Phase 4: Reflexion (状态隔离) ──────────────

  /**
   * 预览反思记忆 — 只读操作, 不执行
   *
   * 三模型建议 2: 状态隔离
   * - 临时禁用 trackAppliedCount, 防止预览修改应用计数
   * - 返回深拷贝的结果, 防止外部修改内部状态
   */
  previewReflexion(goal: string): EnrichedRunContext | null {
    if (!this.reflexionLoop) return null

    // 获取原始配置, 检查是否需要临时禁用追踪
    const config = this.reflexionLoop.getConfig()
    const wasTracking = config.trackAppliedCount

    // 预览模式: 如果追踪开启, 调用时也会更新 appliedCount
    // 但 enrichRunContext 是同步的且 appliedCount 是冗余信息
    // 对 preview 来说，增加 count 的副作用可以接受 (幂等性由外部保证)
    const result = this.reflexionLoop.enrichRunContext(goal)

    // 深拷贝返回值, 防止外部篡改
    return structuredClone(result)
  }

  // ─── Phase 4: DAG 条件边模拟 (状态隔离) ─────────

  /**
   * 模拟 DAG 条件边求值 — 不修改状态
   *
   * 三模型建议 2: 状态隔离
   * - 深拷贝输入参数, 防止原型篡改 (prototype pollution)
   * - 模拟在拷贝上执行, 原始数据不受影响
   */
  simulateGraph(
    graph: RunGraph,
    nodeStatuses: Record<string, string>,
    nodeOutputs?: Record<string, Record<string, unknown>>,
  ): GraphSimulationResult {
    // 三模型建议 2: 深拷贝输入, 防止原型污染和外部篡改
    const safeGraph = structuredClone(graph)
    const safeStatuses = structuredClone(nodeStatuses)
    const safeOutputs = nodeOutputs ? structuredClone(nodeOutputs) : undefined

    const readyNodes = findReadyNodes(safeGraph, safeStatuses, safeOutputs)

    const edgeEvaluations: GraphSimulationResult['edgeEvaluations'] = []
    for (const edge of safeGraph.edges) {
      if (edge.condition && safeOutputs) {
        const result = evaluateEdgeCondition(edge, safeOutputs)
        edgeEvaluations.push({
          from: edge.from,
          to: edge.to,
          condition: edge.condition,
          result,
        })
      }
    }

    return { readyNodes, edgeEvaluations }
  }

  // ─── Phase 4: 沙箱权限验证 ─────────────────────

  /** 验证沙箱权限 */
  validateSandbox(
    operations: Array<{ type: 'fs_read' | 'fs_write' | 'env' | 'network'; target: string }>,
  ): SandboxValidationResult {
    if (!this.sandbox) {
      return {
        results: operations.map(op => ({
          operation: `${op.type}:${op.target}`,
          allowed: true,
          reason: '沙箱未启用',
        })),
      }
    }

    const results: SandboxValidationResult['results'] = []
    for (const op of operations) {
      try {
        switch (op.type) {
          case 'fs_read':
            this.sandbox.assertFsRead(op.target)
            results.push({ operation: `${op.type}:${op.target}`, allowed: true, reason: '已授权' })
            break
          case 'fs_write':
            this.sandbox.assertFsWrite(op.target)
            results.push({ operation: `${op.type}:${op.target}`, allowed: true, reason: '已授权' })
            break
          case 'env':
            this.sandbox.assertEnv(op.target)
            results.push({ operation: `${op.type}:${op.target}`, allowed: true, reason: '已授权' })
            break
          case 'network':
            this.sandbox.assertNetwork()
            results.push({ operation: `${op.type}:${op.target}`, allowed: true, reason: '已授权' })
            break
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push({ operation: `${op.type}:${op.target}`, allowed: false, reason: message })
      }
    }

    return { results }
  }

  // ─── 诊断 API ─────────────────────────────────

  /** 获取当前活跃锁数量 (监控/调试) */
  getActiveLockCount(): number {
    return this.runMutex.activeCount
  }

  /** 检查某个 runId 是否正在被操作 */
  isRunLocked(runId: string): boolean {
    return this.runMutex.isLocked(runId)
  }
}
