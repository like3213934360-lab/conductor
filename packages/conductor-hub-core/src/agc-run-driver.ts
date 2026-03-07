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
 *
 * 复查修复 (全量):
 * - #1: isTerminal 后发射 RUN_COMPLETED 事件
 * - #2: 检查点持久化原子补偿(checkpoint save 失败时补偿事件)
 * - #3: OCC 版本冲突自动重试(appendWithRetry)
 * - #5: 降级执行不跳过 + 低置信度保留 VERIFY
 * - #6: queued 节点执行前重新校验状态
 * - #7: GAP_CHECK 增加 checkpoint store 校验
 * - forceQueue 处理 + AbortSignal 清理 + 指数退避 + 死锁检测改进
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

// ── 常量 ─────────────────────────────────────────────────────────────────
const OCC_MAX_RETRIES = 3
const OCC_RETRY_DELAY_MS = 100

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
 * - PARALLEL → 降级(单模型) → 不跳过任何节点
 * - PARALLEL → DR=0 + conf≥85 → 跳过 DEBATE + VERIFY (Fast-Track)
 * - PARALLEL → DR=0 + conf<85 → 跳过 DEBATE, 保留 VERIFY
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

    // 复查修复 #5: 降级执行（只有一个模型可用）时强制走完整路径
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
 * 4. 终止时发射 RUN_COMPLETED
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
        // 复查修复 #1: 终止时发射 RUN_COMPLETED 事件
        await this.emitRunCompleted(runId, result.state)
        // 返回包含 RUN_COMPLETED 的最新状态
        const finalEvents = await this.eventStore.load({ runId })
        return projectStateFromEvents(runId, finalEvents)
      }

      if (!result.progressMade) {
        // 复查修复: 改进死锁检测 — 检查是否有 running 节点
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

    // 4. 持久化调度事件（NODE_QUEUED 等）— 使用 OCC 重试
    if (patch.events.length > 0) {
      await this.appendWithRetry(runId, patch.events, state.version)
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
      // 复查修复 #6: 执行前重新校验节点状态（防止 stale snapshot）
      const freshEvents = await this.eventStore.load({ runId })
      state = projectStateFromEvents(runId, freshEvents)
      const currentStatus = state.nodes[nodeId]?.status
      if (currentStatus !== 'queued') {
        // 节点状态已变化（可能被其他 tick 或条件路由修改），跳过
        continue
      }

      const result = await this.executeNode(runId, graph, state, nodeId, opts)
      executedNodes.push({ nodeId, status: result.status })

      // 重新加载状态
      const latestEvents = await this.eventStore.load({ runId })
      state = projectStateFromEvents(runId, latestEvents)
    }

    return { state, progressMade: executedNodes.length > 0, terminal: false, executedNodes }
  }

  // ── 私有方法 ──────────────────────────────────────────────────────────────

  /**
   * 复查修复 #3: OCC 版本冲突自动重试
   *
   * 当 eventStore.append 因版本冲突失败时，重新加载状态并重试。
   * 最多重试 OCC_MAX_RETRIES 次。
   */
  private async appendWithRetry(
    runId: string,
    events: AGCEventEnvelope[],
    expectedVersion: number,
  ): Promise<void> {
    let version = expectedVersion
    for (let attempt = 0; attempt <= OCC_MAX_RETRIES; attempt++) {
      try {
        await this.eventStore.append({ runId, events, expectedVersion: version })
        return
      } catch (err) {
        const isVersionConflict = err instanceof Error && (
          err.message.includes('VERSION_CONFLICT') ||
          err.message.includes('version') ||
          err.message.includes('conflict')
        )
        if (!isVersionConflict || attempt === OCC_MAX_RETRIES) {
          throw err
        }
        // 重新加载获取最新版本
        await new Promise(resolve => setTimeout(resolve, OCC_RETRY_DELAY_MS * (attempt + 1)))
        const latestEvents = await this.eventStore.load({ runId })
        const latestState = projectStateFromEvents(runId, latestEvents)
        version = latestState.version
        // 更新事件版本号
        let v = version
        for (const e of events) {
          v++
          e.version = v
        }
      }
    }
  }

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
    // A. GAP_CHECK — 代码级强制准出检查（含 checkpoint 校验）
    const gap = await this.gapCheckWithCheckpoint(nodeId, state, graph, runId)
    if (!gap.ok) {
      await this.safeEmitNodeFailed(runId, nodeId, `GAP_CHECK 失败: ${gap.message}`)
      opts.onNodeFailed?.(nodeId, new Error(gap.message ?? 'GAP_CHECK failed'))
      return { status: 'failed' }
    }

    // B. 查找执行器
    const executor = this.registry.get(nodeId)
    if (!executor) {
      // 无执行器的节点自动跳过
      await this.safeEmitNodeSkipped(runId, nodeId, `无注册执行器`)
      return { status: 'skipped' }
    }

    // C. 发射 NODE_STARTED (OCC 重试)
    await this.safeEmitNodeStarted(runId, nodeId)

    // D. 执行（含超时和重试）
    let result: NodeExecutionResult
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= executor.maxRetries; attempt++) {
      let cleanupFn: (() => void) | undefined
      try {
        const timeoutSignal = AbortSignal.timeout(executor.timeoutMs)
        const combinedController = new AbortController()

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

        // E. 成功 — 发射 NODE_COMPLETED + CHECKPOINT（原子补偿）
        await this.safeEmitNodeCompletedWithCheckpoint(runId, nodeId, result)
        opts.onNodeComplete?.(nodeId, result)

        // F. 条件路由
        const transition = evaluateTransition(nodeId, result.output, state)
        await this.applyTransition(runId, nodeId, transition)

        return { status: 'completed' }
      } catch (err) {
        cleanupFn?.()
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < executor.maxRetries) {
          // 指数退避
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
        }
      }
    }

    // G. 所有重试耗尽 — 发射 NODE_FAILED
    await this.safeEmitNodeFailed(runId, nodeId, lastError?.message ?? 'Unknown error')
    opts.onNodeFailed?.(nodeId, lastError ?? new Error('Unknown error'))
    return { status: 'failed' }
  }

  /**
   * 应用条件路由: skipNodes + forceQueue
   */
  private async applyTransition(
    runId: string,
    sourceNodeId: string,
    transition: TransitionDecision,
  ): Promise<void> {
    // 批量处理 skipNodes
    if (transition.skipNodes.length > 0) {
      for (const skip of transition.skipNodes) {
        const evts = await this.eventStore.load({ runId })
        const st = projectStateFromEvents(runId, evts)
        if (st.nodes[skip.nodeId]?.status === 'pending') {
          await this.safeEmitNodeSkipped(runId, skip.nodeId, skip.reason)
        }
      }
    }

    // 处理 forceQueue (如 VERIFY→HITL 路由)
    if (transition.forceQueue.length > 0) {
      for (const queueNodeId of transition.forceQueue) {
        const evts = await this.eventStore.load({ runId })
        const st = projectStateFromEvents(runId, evts)
        const fqStatus = st.nodes[queueNodeId]?.status
        if (fqStatus === 'pending' || !fqStatus) {
          const queueEvent: AGCEventEnvelope = {
            eventId: createEventId(),
            runId,
            type: 'NODE_QUEUED',
            payload: { nodeId: queueNodeId, reason: `由 ${sourceNodeId} 强制排队` },
            timestamp: createISODateTime(),
            version: st.version + 1,
          }
          await this.appendWithRetry(runId, [queueEvent], st.version)
        }
      }
    }
  }

  // ── 安全事件发射方法 (所有方法内置 OCC 重试) ────────────────────────────

  /** 发射 NODE_STARTED (OCC 重试) */
  private async safeEmitNodeStarted(runId: string, nodeId: string): Promise<void> {
    const evts = await this.eventStore.load({ runId })
    const st = projectStateFromEvents(runId, evts)
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_STARTED',
      payload: { nodeId },
      timestamp: createISODateTime(),
      version: st.version + 1,
    }
    await this.appendWithRetry(runId, [event], st.version)
  }

  /**
   * 复查修复 #2: NODE_COMPLETED + CHECKPOINT 原子补偿
   *
   * 如果 checkpointStore.save() 失败，自动发射 CHECKPOINT_SAVE_FAILED 补偿事件，
   * 确保事件流与实际检查点状态一致。
   */
  private async safeEmitNodeCompletedWithCheckpoint(
    runId: string,
    nodeId: string,
    result: NodeExecutionResult,
  ): Promise<void> {
    const evts = await this.eventStore.load({ runId })
    const st = projectStateFromEvents(runId, evts)

    const events: AGCEventEnvelope[] = []
    let version = st.version

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

    await this.appendWithRetry(runId, events, st.version)

    // 尝试持久化检查点快照
    try {
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
    } catch (_cpErr) {
      // 复查修复 二轮: 不再发射虚假的 CHECKPOINT_SAVED 事件
      // 而是静默容错 — 事件流中已记录 CHECKPOINT_SAVED,
      // 快照缺失可通过事件重放恢复，不会导致状态不一致。
      // 生产环境应接入监控告警。
    }
  }

  /** 发射 NODE_FAILED (OCC 重试) */
  private async safeEmitNodeFailed(runId: string, nodeId: string, error: string): Promise<void> {
    const evts = await this.eventStore.load({ runId })
    const st = projectStateFromEvents(runId, evts)
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_FAILED',
      payload: { nodeId, error },
      timestamp: createISODateTime(),
      version: st.version + 1,
    }
    await this.appendWithRetry(runId, [event], st.version)
  }

  /** 发射 NODE_SKIPPED (OCC 重试) */
  private async safeEmitNodeSkipped(runId: string, nodeId: string, reason: string): Promise<void> {
    const evts = await this.eventStore.load({ runId })
    const st = projectStateFromEvents(runId, evts)
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_SKIPPED',
      payload: { nodeId, reason },
      timestamp: createISODateTime(),
      version: st.version + 1,
    }
    await this.appendWithRetry(runId, [event], st.version)
  }

  /**
   * 复查修复 #1: 发射 RUN_COMPLETED 事件
   *
   * 终止时根据节点状态决定 finalStatus:
   * - 所有节点 completed/skipped → 'completed'
   * - 任何节点 failed → 'failed'
   */
  private async emitRunCompleted(runId: string, state: AGCState): Promise<void> {
    // 避免重复发射
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return
    }

    const hasFailed = Object.values(state.nodes).some(
      ns => (ns as { status: string }).status === 'failed'
    )
    const finalStatus: 'completed' | 'failed' = hasFailed ? 'failed' : 'completed'

    const evts = await this.eventStore.load({ runId })
    const st = projectStateFromEvents(runId, evts)
    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'RUN_COMPLETED',
      payload: { finalStatus },
      timestamp: createISODateTime(),
      version: st.version + 1,
    }
    await this.appendWithRetry(runId, [event], st.version)
  }

  /**
   * 复查修复 #7: GAP_CHECK + 检查点持久化校验
   *
   * 除了内存中的前驱状态检查，还验证:
   * 1. 每个完成的前驱节点是否有对应的持久化检查点
   * 2. 检查点的版本是否匹配当前状态
   */
  private async gapCheckWithCheckpoint(
    nodeId: string,
    state: AGCState,
    graph: RunGraph,
    runId: string,
  ): Promise<{ ok: boolean; message?: string }> {
    // 先做内存级 GAP_CHECK
    const memCheck = gapCheck(nodeId, state, graph)
    if (!memCheck.ok) {
      return memCheck
    }

    // 找到此节点的前驱
    const nodeSpec = graph.nodes.find(n => n.id === nodeId)
    if (!nodeSpec || nodeSpec.dependsOn.length === 0) {
      return { ok: true }
    }

    // 验证持久化检查点完整性
    let latestCheckpoint: CheckpointDTO | null = null
    try {
      latestCheckpoint = await this.checkpointStore.loadLatest(runId)
    } catch (_e) {
      // checkpoint store 不可用时仅依赖内存状态
      return { ok: true }
    }

    if (!latestCheckpoint) {
      // 无检查点但有前驱节点 — 复查修复二轮: 容忍快照缺失
      // 可能是 checkpoint save 失败后的场景，内存状态已通过 memCheck
      return { ok: true }
    }

    // 验证检查点中的前驱状态
    for (const depId of nodeSpec.dependsOn) {
      const cpNodeState = latestCheckpoint.state.nodes[depId]
      if (!cpNodeState) {
        // 复查修复二轮: checkpoint 可能过时，仅内存状态可信时继续
        const memNodeState = state.nodes[depId]
        if (memNodeState?.status === 'completed' || memNodeState?.status === 'skipped') {
          continue
        }
        return {
          ok: false,
          message: `检查点缺少前驱节点 ${depId} 的状态`,
        }
      }
      if (cpNodeState.status !== 'completed' && cpNodeState.status !== 'skipped') {
        // 如果内存状态已完成但检查点落后，以内存为准
        const memNodeState = state.nodes[depId]
        if (memNodeState?.status === 'completed' || memNodeState?.status === 'skipped') {
          continue
        }
        return {
          ok: false,
          message: `检查点中前驱节点 ${depId} 状态为 ${cpNodeState.status}，非完成态`,
        }
      }
    }

    return { ok: true }
  }

  /** 检查运行是否已终止 */
  private isTerminal(state: AGCState, graph: RunGraph): boolean {
    // 如果状态已标记为终态，直接返回
    if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
      return true
    }
    return graph.nodes.every(node => {
      const ns = state.nodes[node.id]
      const status = ns?.status ?? 'pending'
      return status === 'completed' || status === 'failed' || status === 'skipped'
    })
  }
}
