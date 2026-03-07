/**
 * Conductor AGC — 运行驱动器 (AGCRunDriver)
 *
 * 核心使命: 将 DAG 引擎从"纯事件投影"升级为"主动驱动执行"。
 * 通过 drain() 循环保证 100% 节点执行率。
 *
 * 架构:
 * - DagEngine 保持纯函数/无副作用（调度器）
 * - AGCRunDriver 负责实际驱动: 排队 → 执行 → GAP_CHECK → 事件 → 检查点
 * - NodeExecutorRegistry 将 nodeId 映射到具体 AI 执行器
 *
 * 参考:
 * - LangGraph: StateGraph + 条件路由
 * - Temporal: drain 循环 + 活动故障隔离
 * - Airflow: 分支跳过 + 拓扑推进
 */
import type { AGCState, AGCEventEnvelope, RunGraph, CheckpointDTO } from '@anthropic/conductor-shared'
import { createEventId, createISODateTime, createCheckpointId, projectStateFromEvents } from '@anthropic/conductor-shared'
import type { EventStore } from '@anthropic/conductor-core'
import type { CheckpointStore } from '@anthropic/conductor-core'
import { DagEngine } from '@anthropic/conductor-core'
import type { ConductorHubService } from './conductor-hub-service.js'
import {
  type NodeExecutor,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type TransitionDecision,
  NodeExecutorRegistry,
  gapCheck,
} from './node-executor.js'

// ── 类型定义 ────────────────────────────────────────────────────────────────

/** tick 执行结果 */
export interface DriverTickResult {
  state: AGCState
  /** 本次 tick 是否推进了进度 */
  progressMade: boolean
  /** 运行是否已终止 */
  terminal: boolean
  /** 本次执行的节点及结果 */
  executedNodes: Array<{ nodeId: string; status: 'completed' | 'failed' | 'skipped' }>
}

/** drain 执行选项 */
export interface DrainOptions {
  signal?: AbortSignal
  /** 最大 tick 次数（防止死循环） */
  maxTicks?: number
  /** 节点执行完成后的回调 */
  onNodeComplete?: (nodeId: string, result: NodeExecutionResult) => void
  /** 节点执行失败后的回调 */
  onNodeFailed?: (nodeId: string, error: Error) => void
}

/** AGCRunDriver 依赖注入 */
export interface AGCRunDriverDeps {
  eventStore: EventStore
  checkpointStore: CheckpointStore
  dagEngine: DagEngine
  hub: ConductorHubService
  executorRegistry?: NodeExecutorRegistry
}

// ── 条件路由策略 ────────────────────────────────────────────────────────────

/**
 * 条件路由: 根据节点实际输出决定跳过哪些后续节点
 *
 * AGC 工作流路由规则:
 * - PARALLEL → DR=0 + conf≥85 → 跳过 DEBATE + VERIFY (Fast-Track)
 * - PARALLEL → DR=0 + conf<85 → 跳过 DEBATE, VERIFY
 * - PARALLEL → DR>0 → 走 DEBATE
 * - DEBATE → DR<1 && risk<high → 跳过 VERIFY
 * - VERIFY → compliance=VIOLATION → 路由到 HITL
 */
function evaluateTransition(
  nodeId: string,
  output: Record<string, unknown>,
  state: AGCState,
): TransitionDecision {
  const skipNodes: Array<{ nodeId: string; reason: string }> = []
  const forceQueue: string[] = []

  if (nodeId === 'PARALLEL') {
    const drValue = (output.dr_value as number) ?? 0.5
    const bothAvailable = (output.both_available as boolean) ?? true
    const codex = output.codex as Record<string, unknown> | undefined
    const gemini = output.gemini as Record<string, unknown> | undefined
    const codexConf = typeof codex?.confidence === 'number' ? codex.confidence : 0
    const geminiConf = typeof gemini?.confidence === 'number' ? gemini.confidence : 0
    const avgConf = bothAvailable ? (codexConf + geminiConf) / 2 : Math.max(codexConf, geminiConf)

    // 复查修复: 降级执行（只有一个模型可用）时强制走完整路径，不允许跳过
    if (!bothAvailable) {
      // 不跳过任何节点 — 降级时需要更多验证
    } else if (drValue === 0 && avgConf >= 85) {
      // Fast-Track: 完全一致且高置信度
      skipNodes.push({ nodeId: 'DEBATE', reason: 'DR=0, conf>=85, Fast-Track' })
      skipNodes.push({ nodeId: 'VERIFY', reason: 'DR=0, conf>=85, Fast-Track' })
    } else if (drValue === 0 && avgConf < 85) {
      // 复查修复: 一致但低置信度 → 跳过 DEBATE 但保留 VERIFY
      skipNodes.push({ nodeId: 'DEBATE', reason: 'DR=0, 模型一致无需辩论' })
      // 不跳过 VERIFY — 低置信度需要独立验证
    }
    // DR > 0: 不跳过，走 DEBATE 路径
  }

  if (nodeId === 'DEBATE') {
    const parallelOutput = state.nodes['PARALLEL']?.output
    const drValue = (parallelOutput?.dr_value as number) ?? 0.5
    const riskLevel = state.capturedContext?.metadata?.goal ? 'medium' : 'low'
    const analyzeOutput = state.nodes['ANALYZE']?.output
    const actualRisk = (analyzeOutput?.risk_level as string) ?? riskLevel

    if (drValue < 1 && actualRisk !== 'high' && actualRisk !== 'critical') {
      skipNodes.push({ nodeId: 'VERIFY', reason: `DR=${drValue}, risk=${actualRisk}, 无需独立验证` })
    }
  }

  if (nodeId === 'VERIFY') {
    const complianceCheck = (output.compliance_check as string) ?? 'PASS'
    if (complianceCheck === 'VIOLATION') {
      forceQueue.push('HITL')
    }
  }

  return { skipNodes, forceQueue }
}

// ── AGCRunDriver 核心 ──────────────────────────────────────────────────────

/**
 * AGC 运行驱动器
 *
 * 通过 drain() 方法实现 100% 节点执行:
 * 1. 每次 tick() 推进一批就绪节点
 * 2. 每个节点: GAP_CHECK → NODE_STARTED → execute → 条件路由 → NODE_COMPLETED
 * 3. 循环直到 isTerminal
 *
 * 不同于 AGCService.startRun()（只初始化），
 * AGCRunDriver.drain() 会实际执行所有节点到完成。
 */
export class AGCRunDriver {
  private readonly eventStore: EventStore
  private readonly checkpointStore: CheckpointStore
  private readonly dagEngine: DagEngine
  private readonly hub: ConductorHubService
  private readonly registry: NodeExecutorRegistry

  constructor(deps: AGCRunDriverDeps) {
    this.eventStore = deps.eventStore
    this.checkpointStore = deps.checkpointStore
    this.dagEngine = deps.dagEngine
    this.hub = deps.hub
    this.registry = deps.executorRegistry ?? new NodeExecutorRegistry()
  }

  /**
   * drain — 驱动运行直到终态
   *
   * 这是单个 MCP 工具调用的入口：调用一次，全部节点执行完成后返回。
   * 保证: 每个可达节点要么 completed 要么 failed/skipped，不会遗漏。
   */
  async drain(runId: string, opts: DrainOptions = {}): Promise<AGCState> {
    const maxTicks = opts.maxTicks ?? 20
    let tickCount = 0

    for (;;) {
      if (opts.signal?.aborted) {
        throw new Error('AGC 运行被取消')
      }

      tickCount++
      if (tickCount > maxTicks) {
        throw new Error(`AGC 运行超过最大 tick 数 (${maxTicks})，可能存在死循环`)
      }

      const result = await this.tick(runId, opts)

      if (result.terminal) {
        return result.state
      }

      if (!result.progressMade) {
        // 复查修复: 改进死锁检测 — 检查是否有 running 节点（可能被其他驱动器处理）
        const hasRunningNodes = Object.values(result.state.nodes).some(
          ns => (ns as { status: string }).status === 'running'
        )
        if (hasRunningNodes) {
          // 有正在执行的节点，等待后重试
          await new Promise(resolve => setTimeout(resolve, 2000))
          continue
        }
        throw new Error('AGC 运行死锁: 无就绪节点且无运行中节点，但运行未终止')
      }
    }
  }

  /**
   * tick — 推进一步（执行一批就绪节点）
   *
   * 每次 tick:
   * 1. 获取当前状态
   * 2. DagEngine.advance() 计算就绪节点（产出 NODE_QUEUED 事件）
   * 3. 并行执行所有 queued 节点
   * 4. 应用条件路由（跳过不需要的节点）
   * 5. 保存检查点
   */
  async tick(runId: string, opts: DrainOptions = {}): Promise<DriverTickResult> {
    // 1. 加载当前状态
    const allEvents = await this.eventStore.load({ runId })
    let state = projectStateFromEvents(runId, allEvents)
    const graph = state.capturedContext?.graph
    if (!graph) {
      throw new Error(`runId=${runId} 缺少 capturedContext.graph`)
    }

    // 2. 检查是否已终止
    if (this.isTerminal(state, graph)) {
      return { state, progressMade: false, terminal: true, executedNodes: [] }
    }

    // 3. DagEngine.advance() 计算下一步
    const patch = this.dagEngine.advance(graph, state)

    // 4. 持久化调度事件（NODE_QUEUED 等）
    if (patch.events.length > 0) {
      await this.eventStore.append({
        runId,
        events: patch.events,
        expectedVersion: state.version,
      })
      // 重新投影状态
      const updatedEvents = await this.eventStore.load({ runId })
      state = projectStateFromEvents(runId, updatedEvents)
    }

    if (patch.isTerminal) {
      return { state, progressMade: true, terminal: true, executedNodes: [] }
    }

    // 5. 找出所有 queued 节点并执行
    const queuedNodes: string[] = []
    for (const nodeId of Object.keys(state.nodes)) {
      if (state.nodes[nodeId]?.status === 'queued') {
        queuedNodes.push(nodeId)
      }
    }

    if (queuedNodes.length === 0) {
      return { state, progressMade: false, terminal: false, executedNodes: [] }
    }

    // 6. 逐个执行（保持拓扑序稳定性，串行执行）
    const executedNodes: Array<{ nodeId: string; status: 'completed' | 'failed' | 'skipped' }> = []

    for (const nodeId of queuedNodes) {
      const result = await this.executeNode(runId, graph, state, nodeId, opts)
      executedNodes.push({ nodeId, status: result.status })

      // 重新加载状态（每个节点完成后状态已变化）
      const latestEvents = await this.eventStore.load({ runId })
      state = projectStateFromEvents(runId, latestEvents)
    }

    return { state, progressMade: executedNodes.length > 0, terminal: false, executedNodes }
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 执行单个节点: GAP_CHECK → START → execute → 路由 → COMPLETE
   */
  private async executeNode(
    runId: string,
    graph: RunGraph,
    state: AGCState,
    nodeId: string,
    opts: DrainOptions,
  ): Promise<{ status: 'completed' | 'failed' | 'skipped' }> {
    // A. GAP_CHECK — 代码级强制准出检查
    const gap = gapCheck(nodeId, state, graph)
    if (!gap.ok) {
      await this.emitNodeFailed(runId, state, nodeId, `GAP_CHECK 失败: ${gap.message}`)
      opts.onNodeFailed?.(nodeId, new Error(gap.message ?? 'GAP_CHECK failed'))
      return { status: 'failed' }
    }

    // B. 查找执行器
    const executor = this.registry.get(nodeId)
    if (!executor) {
      // 无执行器的节点自动跳过
      await this.emitNodeSkipped(runId, state, nodeId, `无注册执行器`)
      return { status: 'skipped' }
    }

    // C. 发射 NODE_STARTED
    await this.emitNodeStarted(runId, state, nodeId)

    // D. 执行（含超时和重试）
    let result: NodeExecutionResult
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= executor.maxRetries; attempt++) {
      // 复查修复: 每次重试前清理 listener 引用
      let cleanupFn: (() => void) | undefined
      try {
        const timeoutSignal = AbortSignal.timeout(executor.timeoutMs)
        const combinedController = new AbortController()

        // 合并外部 signal 和超时 signal，并追踪 cleanup
        const onAbort = () => combinedController.abort()
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        timeoutSignal.addEventListener('abort', onAbort, { once: true })
        cleanupFn = () => {
          opts.signal?.removeEventListener('abort', onAbort)
        }

        const ctx: NodeExecutionContext = {
          runId,
          graph,
          state,
          nodeId,
          attempt,
          signal: combinedController.signal,
          hub: this.hub,
          getUpstreamOutput: (upId: string) => state.nodes[upId]?.output,
        }

        result = await executor.execute(ctx)
        cleanupFn()

        // E. 成功 — 发射 NODE_COMPLETED  
        await this.emitNodeCompleted(runId, state, nodeId, result)
        opts.onNodeComplete?.(nodeId, result)

        // F. 条件路由 — 根据输出决定跳过/强制排队后续节点
        const transition = evaluateTransition(nodeId, result.output, state)

        // 复查修复: 批量处理跳过节点（减少事件存储往返）
        if (transition.skipNodes.length > 0) {
          const latestEvts = await this.eventStore.load({ runId })
          let latestSt = projectStateFromEvents(runId, latestEvts)
          for (const skip of transition.skipNodes) {
            if (latestSt.nodes[skip.nodeId]?.status === 'pending') {
              await this.emitNodeSkipped(runId, latestSt, skip.nodeId, skip.reason)
              const refreshed = await this.eventStore.load({ runId })
              latestSt = projectStateFromEvents(runId, refreshed)
            }
          }
        }

        // 复查修复: 处理 forceQueue（如 VERIFY→HITL 路由）
        if (transition.forceQueue.length > 0) {
          const latestEvts = await this.eventStore.load({ runId })
          let latestSt = projectStateFromEvents(runId, latestEvts)
          for (const queueNodeId of transition.forceQueue) {
            const fqStatus = latestSt.nodes[queueNodeId]?.status
            if (fqStatus === 'pending' || !fqStatus) {
              const queueEvent: AGCEventEnvelope = {
                eventId: createEventId(),
                runId,
                type: 'NODE_QUEUED',
                payload: { nodeId: queueNodeId, reason: `由 ${nodeId} 强制排队` },
                timestamp: createISODateTime(),
                version: latestSt.version + 1,
              }
              await this.eventStore.append({ runId, events: [queueEvent], expectedVersion: latestSt.version })
              const refreshed = await this.eventStore.load({ runId })
              latestSt = projectStateFromEvents(runId, refreshed)
            }
          }
        }

        return { status: 'completed' }
      } catch (err) {
        cleanupFn?.()
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < executor.maxRetries) {
          // 复查修复: 指数退避(2^attempt * 1000ms)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
        }
      }
    }

    // G. 所有重试耗尽 — 发射 NODE_FAILED
    await this.emitNodeFailed(runId, state, nodeId, lastError?.message ?? 'Unknown error')
    opts.onNodeFailed?.(nodeId, lastError ?? new Error('Unknown error'))
    return { status: 'failed' }
  }

  // ── 事件发射辅助方法 ──────────────────────────────────────────────────────

  private async emitNodeStarted(runId: string, state: AGCState, nodeId: string): Promise<void> {
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_STARTED',
      payload: { nodeId },
      timestamp: createISODateTime(),
      version: state.version + 1,
    }
    await this.eventStore.append({ runId, events: [event], expectedVersion: state.version })
  }

  private async emitNodeCompleted(
    runId: string,
    state: AGCState,
    nodeId: string,
    result: NodeExecutionResult,
  ): Promise<void> {
    // 加载最新版本
    const latestEvents = await this.eventStore.load({ runId })
    const latestState = projectStateFromEvents(runId, latestEvents)

    const events: AGCEventEnvelope[] = []
    let version = latestState.version

    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'NODE_COMPLETED',
      payload: {
        nodeId,
        output: result.output,
        model: result.model,
        durationMs: result.durationMs,
        degraded: result.degraded ?? false,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 保存检查点
    const checkpointId = createCheckpointId()
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'CHECKPOINT_SAVED',
      payload: { checkpointId, version },
      timestamp: createISODateTime(),
      version,
    })

    await this.eventStore.append({ runId, events, expectedVersion: latestState.version })

    // 保存检查点快照
    const postEvents = await this.eventStore.load({ runId })
    const postState = projectStateFromEvents(runId, postEvents)
    const checkpoint: CheckpointDTO = {
      checkpointId,
      runId,
      version: postState.version,
      state: postState,
      createdAt: createISODateTime(),
    }
    await this.checkpointStore.save({ checkpoint })
  }

  private async emitNodeFailed(
    runId: string,
    state: AGCState,
    nodeId: string,
    error: string,
  ): Promise<void> {
    const latestEvents = await this.eventStore.load({ runId })
    const latestState = projectStateFromEvents(runId, latestEvents)

    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_FAILED',
      payload: { nodeId, error },
      timestamp: createISODateTime(),
      version: latestState.version + 1,
    }
    await this.eventStore.append({ runId, events: [event], expectedVersion: latestState.version })
  }

  private async emitNodeSkipped(
    runId: string,
    state: AGCState,
    nodeId: string,
    reason: string,
  ): Promise<void> {
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_SKIPPED',
      payload: { nodeId, reason },
      timestamp: createISODateTime(),
      version: state.version + 1,
    }
    await this.eventStore.append({ runId, events: [event], expectedVersion: state.version })
  }

  /** 检查运行是否已终止 */
  private isTerminal(state: AGCState, graph: RunGraph): boolean {
    return graph.nodes.every(node => {
      const ns = state.nodes[node.id]
      const status = ns?.status ?? 'pending'
      return status === 'completed' || status === 'failed' || status === 'skipped'
    })
  }
}
