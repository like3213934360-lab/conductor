/**
 * Conductor AGC — 应用服务 (AGCService)
 *
 * 编排层: 组合 DAG Engine + Risk Router + GovernanceGateway，
 * 通过 Event Sourcing 管理状态。
 *
 * v8.0: ComplianceEngine → GovernanceGateway (GaaS PDP/PEP)
 */
import type { AGCState, RunRequest, AGCEventEnvelope, CheckpointDTO,
  RouteDecision, GovernanceDecisionRecord, DRScore, RunGraph, RunMetadata,
  CapturedContext } from '@anthropic/conductor-shared'
import { createRunId, createEventId, createISODateTime, createCheckpointId,
  projectState, projectStateFromEvents, reduceEvent, RunRequestSchema } from '@anthropic/conductor-shared'
import type { EventStore } from '../contracts/event-store.js'
import type { CheckpointStore } from '../contracts/checkpoint-store.js'
import type { CoreLogger } from '../contracts/logger.js'
import { consoleLogger } from '../contracts/logger.js'
import { DagEngine } from '../dag/dag-engine.js'
import { DRCalculator } from '../risk/dr-calculator.js'
import { RiskRouter } from '../risk/risk-router.js'
import { GovernanceGateway } from '../governance/governance-gateway.js'
import { TrustFactorService } from '../governance/trust-factor.js'
import type { GovernanceControl, GovernanceDecision, ModelCandidate, ReleaseDecision, ActionOutcome } from '../governance/governance-types.js'
import { getDefaultControlPack } from '../governance/default-control-pack.js'
import { WorkflowRuntime } from '../governance/workflow-runtime.js'
import type { WorkflowDefinition, NodeLease, CheckpointSubmission, CheckpointResult } from '../governance/workflow-runtime.js'
import { CheckpointSchemaRegistry } from '../governance/checkpoint-schemas.js'
import { TokenBudgetEnforcer } from '../governance/token-budget-enforcer.js'
import { KeyedAsyncMutex } from '../concurrency/async-mutex.js' // ★ P0-4 fix
import type { ReflexionActorLoop } from '../reflexion/actor-loop.js'
import type { UpcastingRegistry } from '../event-sourcing/upcasting.js'

/** AGCService 依赖注入 */
export interface AGCServiceDeps {
  eventStore: EventStore
  checkpointStore: CheckpointStore
  logger?: CoreLogger
  /** v8.0: 自定义治理控制（不传则使用默认控制包） */
  governanceControls?: GovernanceControl[]
  /** Phase 4: Reflexion Actor Loop (可选, 启用后自动注入反思记忆) */
  reflexionLoop?: ReflexionActorLoop
  /** Phase 4: Event Upcasting 注册表 (可选) */
  upcastingRegistry?: UpcastingRegistry
}

/** 启动运行结果 */
export interface StartRunResult {
  runId: string
  state: AGCState
  route: RouteDecision
  governance: GovernanceDecisionRecord
  drScore: DRScore
  checkpoint?: CheckpointDTO
}

/** 验证运行结果 */
export interface VerifyRunResult {
  ok: boolean
  state: AGCState
  replayedState: AGCState
  driftDetected: boolean
  governance: GovernanceDecisionRecord
}

/** 节点执行回调 — 用户提供的实际节点逻辑 */
export type NodeExecutionCallback = (
  lease: NodeLease,
  ctx: { state: AGCState; graph: RunGraph; metadata: RunMetadata },
) => Promise<{ checkpoint: unknown; tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number }; outcome: ActionOutcome }>

/** 节点推进结果 */
export interface AdvanceNodeResult {
  executed: boolean
  nodeId?: string
  lease?: NodeLease
  governanceDecision?: GovernanceDecision
  checkpointResult?: CheckpointResult
  state: AGCState
  /** 下一批就绪节点 ID */
  nextNodeIds: string[]
}

/** 运行完成结果 */
export interface CompleteRunResult {
  release: ReleaseDecision
  state: AGCState
  governance: GovernanceDecisionRecord
}

/**
 * AGCService — Conductor 核心应用服务
 *
 * 单一职责: 编排 DAG/Risk/Compliance 并管理事件流
 */
export class AGCService {
  private readonly eventStore: EventStore
  private readonly checkpointStore: CheckpointStore
  private readonly logger: CoreLogger
  private readonly dagEngine: DagEngine
  private readonly drCalculator: DRCalculator
  private readonly riskRouter: RiskRouter
  private readonly gateway: GovernanceGateway
  private readonly trustService: TrustFactorService
  /** v8.0: Lease-Based 工作流运行时 */
  private readonly runtime: WorkflowRuntime
  /** v8.0: 检查点 Schema 注册表 */
  private readonly schemaRegistry: CheckpointSchemaRegistry
  /** v8.0: Token 预算执行器 (可选) */
  private readonly budgetEnforcer?: TokenBudgetEnforcer
  /** Phase 4: Reflexion 闭环 (可选) */
  private readonly reflexionLoop?: ReflexionActorLoop
  /** Phase 4: Event Upcasting (可选) */
  private readonly upcastingRegistry?: UpcastingRegistry
  /** 当前运行上下文 (用于 advanceNode/completeRun) */
  private currentRunContext?: { runId: string; graph: RunGraph; metadata: RunMetadata; dreadScore: number }
  /** ★ P0-4 fix: 节点领取互斥锁 (防止并发 advanceNode 竞态) */
  private readonly advanceMutex = new KeyedAsyncMutex()

  constructor(deps: AGCServiceDeps) {
    this.eventStore = deps.eventStore
    this.checkpointStore = deps.checkpointStore
    this.logger = deps.logger ?? consoleLogger
    this.dagEngine = new DagEngine()
    this.drCalculator = new DRCalculator()
    this.riskRouter = new RiskRouter()
    // v8.0: GovernanceGateway (GaaS PDP/PEP)
    this.trustService = new TrustFactorService()
    this.gateway = new GovernanceGateway(
      this.trustService,
      deps.governanceControls ?? getDefaultControlPack(),
    )
    // v8.0: Lease-Based Runtime + Schema Registry
    this.schemaRegistry = new CheckpointSchemaRegistry()
    this.budgetEnforcer = new TokenBudgetEnforcer()
    this.runtime = new WorkflowRuntime(
      this.schemaRegistry,
      undefined,
      this.budgetEnforcer,
    )
    // Phase 4: Reflexion + Upcasting
    this.reflexionLoop = deps.reflexionLoop
    this.upcastingRegistry = deps.upcastingRegistry
  }

  /**
   * 启动新的 AGC 运行
   *
   * Phase 3 修复: 统一持久化边界，所有事件一次 append
   */
  async startRun(req: RunRequest): Promise<StartRunResult> {
    // 1. Schema 校验（Zod 强制）
    const parsed = RunRequestSchema.parse(req)
    const runId = parsed.runId ?? createRunId()
    const nodeIds = parsed.graph.nodes.map(n => n.id)

    this.logger.info('启动 AGC 运行', { runId, nodeCount: nodeIds.length })

    // 2. DAG 校验（环检测 + 拓扑排序）
    this.dagEngine.validate(parsed.graph)

    // 3. DR 分歧率计算 (三模型审计 P1: 传入 options 确保 Discoverability 维度生效)
    const drScore = this.drCalculator.calculate({
      graph: parsed.graph,
      metadata: parsed.metadata,
      options: parsed.options,
    })

    // 4. 构造全部事件（统一持久化边界）
    let version = 0
    const events: AGCEventEnvelope[] = []

    // RUN_CREATED
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'RUN_CREATED',
      payload: {
        goal: parsed.metadata.goal,
        nodeIds,
        repoRoot: parsed.metadata.repoRoot,
        files: parsed.metadata.files,
      },
      timestamp: createISODateTime(),
      version,
    })

    // Phase 3 修复 #1: RUN_CONTEXT_CAPTURED — 持久化完整上下文
    const capturedAt = createISODateTime()
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'RUN_CONTEXT_CAPTURED',
      payload: {
        graph: parsed.graph,
        metadata: parsed.metadata,
        options: parsed.options ?? { plugins: [], debug: false },
        capturedAt,
      },
      timestamp: capturedAt,
      version,
    })

    // RISK_ASSESSED
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'RISK_ASSESSED',
      payload: {
        drScore: drScore.score,
        level: drScore.level,
        factors: drScore.factors,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 5. 投影初始状态用于合规评估
    const initialState = projectState(runId, nodeIds, events)

    // 6. 治理网关 preflight 评估
    const governanceDecision = await this.gateway.preflight({
      runId,
      action: { type: 'node.execute', nodeId: 'ANALYZE' },
      state: initialState,
      graph: parsed.graph,
      metadata: parsed.metadata,
    })
    const governance: GovernanceDecisionRecord = {
      allowed: governanceDecision.effect === 'allow' || governanceDecision.effect === 'warn',
      worstStatus: governanceDecision.effect === 'allow' ? 'pass' : governanceDecision.effect === 'warn' ? 'warn' : 'block',
      evaluatedAt: createISODateTime(),
      findings: governanceDecision.rationale.map(r => ({ ruleId: 'GaaS', ruleName: 'GovernanceGateway', status: 'pass' as const, message: r })),
    }

    // COMPLIANCE_EVALUATED
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'COMPLIANCE_EVALUATED',
      payload: {
        allowed: governance.allowed,
        worstStatus: governance.worstStatus,
        findingCount: governance.findings.length,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 治理 BLOCK 短路 — 治理拒绝时立即终止运行
    if (!governance.allowed) {
      // 只持久化到合规评估为止的事件 + RUN_COMPLETED(failed)
      version++
      events.push({
        eventId: createEventId(),
        runId,
        type: 'RUN_COMPLETED',
        payload: { finalStatus: 'failed' },
        timestamp: createISODateTime(),
        version,
      })

      await this.eventStore.append({ runId, events, expectedVersion: 'no_stream' })
      const blockedState = projectState(runId, nodeIds, events)

      // 保存 checkpoint
      const blockedCheckpointId = createCheckpointId()
      const blockedCheckpoint: CheckpointDTO = {
        checkpointId: blockedCheckpointId,
        runId,
        version: blockedState.version,
        state: blockedState,
        createdAt: createISODateTime(),
      }
      await this.checkpointStore.save({ checkpoint: blockedCheckpoint })

      this.logger.warn('AGC 运行被治理拒绝', { runId, worstStatus: governance.worstStatus })

      return {
        runId,
        state: blockedState,
        route: {
          lane: 'escalated' as const,
          nodePath: [],
          skippedNodes: nodeIds.map(id => ({ nodeId: id, reason: 'compliance_blocked' })),
          confidence: 0,
        },
        governance,
        drScore,
        checkpoint: blockedCheckpoint,
      }
    }

    // 7. 路由决策 (仅在合规通过后)
    const route = parsed.options?.forceFullPath
      ? {
          lane: 'full' as const,
          nodePath: nodeIds,
          skippedNodes: [],
          confidence: 100,
        }
      : this.riskRouter.decide({
          score: drScore,
          findings: governance.findings,
          graph: parsed.graph,
        })

    // ROUTE_DECIDED
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'ROUTE_DECIDED',
      payload: {
        lane: route.lane,
        nodePath: route.nodePath,
        skippedNodes: route.skippedNodes,
        skippedCount: route.skippedNodes.length,
        confidence: route.confidence,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 审查修复 #3: 为 skippedNodes 发射 NODE_SKIPPED 事件
    for (const skippedNodeId of route.skippedNodes) {
      version++
      events.push({
        eventId: createEventId(),
        runId,
        type: 'NODE_SKIPPED',
        payload: { nodeId: skippedNodeId, reason: `express lane: ${route.lane}` },
        timestamp: createISODateTime(),
        version,
      })
    }

    // 8. 排队初始节点
    const initialNodes = this.dagEngine.queueInitialNodes(parsed.graph)
    for (const nodeId of initialNodes) {
      version++
      events.push({
        eventId: createEventId(),
        runId,
        type: 'NODE_QUEUED',
        payload: { nodeId },
        timestamp: createISODateTime(),
        version,
      })
    }

    // Phase 3 修复 #3: checkpoint 在所有业务事件之后
    const checkpointId = createCheckpointId()
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'CHECKPOINT_SAVED',
      payload: { checkpointId, version }, // 包含自身版本
      timestamp: createISODateTime(),
      version,
    })

    // 9. 统一持久化: 所有事件一次原子 append
    // Phase 3 修复 #4: 使用严格 'no_stream' 替代 'any'
    await this.eventStore.append({ runId, events, expectedVersion: 'no_stream' })

    // 10. 投影最终状态
    const finalState = projectState(runId, nodeIds, events)

    // 11. 保存检查点
    const checkpoint: CheckpointDTO = {
      checkpointId,
      runId,
      version: finalState.version,
      state: finalState,
      createdAt: createISODateTime(),
    }
    await this.checkpointStore.save({ checkpoint })

    // v8.0: 初始化 WorkflowRuntime
    const workflowDef: WorkflowDefinition = {
      workflowId: `agc-${runId}`,
      version: 'v8.0',
      graph: parsed.graph,
      nodes: Object.fromEntries(parsed.graph.nodes.map(n => [
        n.id,
      {
          nodeId: n.id,
          boundaryMode: 'EXECUTION' as const,
          skippable: n.skippable ?? false,
          allowedOutgoing: parsed.graph.edges
            ?.filter(e => e.from === n.id)
            .map(e => ({
              edgeId: `${e.from}->${e.to}`,
              to: e.to,
              // ★ P1-6 fix: 实现真实的条件评估器，而非永远返回 true
              when: e.condition
                ? (ctx: import('../governance/workflow-runtime.js').RouteEvalContext) => {
                    try {
                      // 简单的属性路径评估 (e.g. "route_path === 'express'")
                      const parts = e.condition!.split(/\s*(===|!==|==|!=)\s*/)
                      const prop = parts[0]
                      const value = parts[2]
                      if (prop && value) {
                        const actualValue = String(ctx.nodeOutput[prop.trim()] ?? '')
                        const expectedValue = value.trim().replace(/^['"]|['"]$/g, '')
                        return e.condition!.includes('!==') || e.condition!.includes('!=')
                          ? actualValue !== expectedValue
                          : actualValue === expectedValue
                      }
                      return true // 无法解析时默认通过
                    } catch {
                      return true // 评估异常时默认通过
                    }
                  }
                : () => true, // 无条件边始终通过
            })) ?? [],
        },
      ])),
    }
    this.runtime.start(workflowDef)

    // 保存当前运行上下文 (advanceNode/completeRun 使用)
    this.currentRunContext = {
      runId,
      graph: parsed.graph,
      metadata: parsed.metadata,
      dreadScore: drScore.score,
    }

    // 设置 Token 预算 (如果指定)
    if (parsed.options?.tokenBudget && this.budgetEnforcer) {
      this.budgetEnforcer.setGlobalLimit(parsed.options.tokenBudget)
    }

    this.logger.info('AGC 运行已启动 (已集成 WorkflowRuntime)', { runId, lane: route.lane, drScore: drScore.score })

    // Phase 4 接入: Reflexion enrichRunContext 注入反思记忆
    let enrichedContext: { reflexionPrompts: string[]; sourceRunIds: string[]; promptCount: number } | undefined
    if (this.reflexionLoop) {
      enrichedContext = this.reflexionLoop.enrichRunContext(parsed.metadata.goal)
      if (enrichedContext.promptCount > 0) {
        this.logger.info('Reflexion 注入反思记忆', {
          runId, promptCount: enrichedContext.promptCount,
          sourceRunIds: enrichedContext.sourceRunIds,
        })
      }
    }

    return { runId, state: finalState, route, governance, drScore, checkpoint }
  }

  // ── v8.0: 节点执行生命周期 (5 步治理合同) ──────────────────────────

  /**
   * 推进下一个节点 — Temporal Activity 合同模式
   *
   * 5 步强制生命周期:
   * 1. runtime.claimNext()         → 获取 NodeLease
   * 2. gateway.authorize()         → 授权检查 (execution + routing controls)
   * 3. userCallback(lease, ctx)    → 用户执行节点逻辑
   * 4. gateway.observe()           → 观察 + 更新信任因子
   * 5. runtime.submitCheckpoint()  → Schema 验证 + 路由计算
   *
   * 每一步失败都会阻断执行，确保 LLM 无法绕过任何一个拦截点。
   */
  async advanceNode(
    callback: NodeExecutionCallback,
  ): Promise<AdvanceNodeResult> {
    if (!this.currentRunContext) {
      throw new Error('No active run. Call startRun() first.')
    }

    const { runId, graph, metadata, dreadScore } = this.currentRunContext

    // ★ P0-4 fix: 互斥锁保护 claim+execute 原子性
    return this.advanceMutex.withLock(runId, async () => {

    // 1. 获取当前状态
    const state = await this.getState(runId)
    if (!state) throw new Error(`Run ${runId} not found`)

    // 2. ★ P1-2 fix: 使用 claimNextOne 代替 claimNext，避免孤立租约
    const lease = this.runtime.claimNextOne(runId, state)
    if (!lease) {
      // 无就绪节点，可能工作流已完成
      return { executed: false, state, nextNodeIds: [] }
    }

    this.logger.info('WorkflowRuntime 发放租约', { runId, nodeId: lease.nodeId, leaseId: lease.leaseId })

    // 3. gateway.authorize() — 授权检查
    const authDecision = await this.gateway.authorize({
      runId,
      action: { type: 'node.execute', nodeId: lease.nodeId },
      state,
      graph,
      metadata,
    })

    if (authDecision.effect === 'block' || authDecision.effect === 'escalate') {
      this.logger.warn('GovernanceGateway 授权拒绝', {
        runId, nodeId: lease.nodeId, effect: authDecision.effect,
        rationale: authDecision.rationale,
      })
      // ★ P0-2 fix: 授权失败时释放租约
      this.runtime.abandonLease(lease.leaseId, `auth ${authDecision.effect}`)
      // 授权失败 → 不执行 callback，记录事件
      const events: AGCEventEnvelope[] = [{
        eventId: createEventId(),
        runId,
        type: 'NODE_BLOCKED' as AGCEventEnvelope['type'],
        payload: { nodeId: lease.nodeId, effect: authDecision.effect, rationale: authDecision.rationale },
        timestamp: createISODateTime(),
        version: state.version + 1,
      }]
      await this.eventStore.append({ runId, events, expectedVersion: state.version })
      const newState = reduceEvent(state, events[0]!)
      return {
        executed: false,
        nodeId: lease.nodeId,
        lease,
        governanceDecision: authDecision,
        state: newState,
        nextNodeIds: [],
      }
    }

    this.logger.info('GovernanceGateway 授权通过', {
      runId, nodeId: lease.nodeId, route: authDecision.route,
    })

    // ★ P1-4 fix: 执行前预算检查（在昂贵的 LLM 调用之前）
    if (this.budgetEnforcer) {
      const budgetCheck = this.budgetEnforcer.preflight(lease.nodeId)
      if (!budgetCheck.allowed) {
        this.logger.warn('Token 预算不足，跳过节点', { runId, nodeId: lease.nodeId, reason: budgetCheck.reason })
        this.runtime.abandonLease(lease.leaseId, `budget: ${budgetCheck.reason}`)
        return { executed: false, nodeId: lease.nodeId, lease, state, nextNodeIds: [] }
      }
    }

    // 4. userCallback() — 执行节点逻辑
    const startTime = Date.now()
    let callbackResult: Awaited<ReturnType<NodeExecutionCallback>>
    try {
      callbackResult = await callback(lease, { state, graph, metadata })
    } catch (err) {
      // ★ P1-3 fix: callback 异常时释放租约
      this.runtime.abandonLease(lease.leaseId, `callback error: ${String(err)}`)
      this.logger.error('Node callback 执行失败', { runId, nodeId: lease.nodeId, error: String(err) })
      // 观察失败结果
      await this.gateway.observe(
        { runId, action: { type: 'node.execute', nodeId: lease.nodeId }, state, graph, metadata },
        { action: { type: 'node.execute', nodeId: lease.nodeId }, success: false, durationMs: Date.now() - startTime, error: String(err) },
      )
      throw err
    }
    const durationMs = Date.now() - startTime

    // 5. gateway.observe() — 观察 + 更新信任因子
    const observeDecision = await this.gateway.observe(
      {
        runId,
        action: { type: 'node.execute', nodeId: lease.nodeId },
        state,
        graph,
        metadata,
      },
      callbackResult.outcome,
    )

    // ★ P0-3 fix: 检查 observe 决策 — block/escalate 阻断 checkpoint 提交
    if (observeDecision.effect === 'block' || observeDecision.effect === 'escalate') {
      this.logger.warn('GovernanceGateway 观察拦截：阻断输出', {
        runId, nodeId: lease.nodeId, effect: observeDecision.effect,
        rationale: observeDecision.rationale,
      })
      this.runtime.abandonLease(lease.leaseId, `observe ${observeDecision.effect}`)
      // 发射 NODE_FAILED 事件
      const failEvents: AGCEventEnvelope[] = [{
        eventId: createEventId(),
        runId,
        type: 'NODE_FAILED',
        payload: { nodeId: lease.nodeId, error: `Observe interceptor ${observeDecision.effect}: ${observeDecision.rationale.join('; ')}` },
        timestamp: createISODateTime(),
        version: state.version + 1,
      }]
      await this.eventStore.append({ runId, events: failEvents, expectedVersion: state.version })
      const failState = reduceEvent(state, failEvents[0]!)
      return {
        executed: true,
        nodeId: lease.nodeId,
        lease,
        governanceDecision: observeDecision,
        state: failState,
        nextNodeIds: [],
      }
    }

    this.logger.info('GovernanceGateway 观察完成', {
      runId, nodeId: lease.nodeId,
      trustUpdated: true,
      observeEffect: observeDecision.effect,
    })

    // 6. runtime.submitCheckpoint() — Schema 验证 + 路由计算
    const submission: CheckpointSubmission = {
      runId,
      leaseId: lease.leaseId,
      nodeId: lease.nodeId,
      checkpoint: callbackResult.checkpoint,
      tokenUsage: callbackResult.tokenUsage,
    }
    const cpResult = this.runtime.submitCheckpoint(submission, state)

    if (!cpResult.accepted) {
      this.logger.error('WorkflowRuntime 检查点拒绝', {
        runId, nodeId: lease.nodeId, reason: cpResult.reason,
      })
      // 持久化偏差事件
      const devEvents: AGCEventEnvelope[] = [{
        eventId: createEventId(),
        runId,
        type: 'DEVIATION_DETECTED' as AGCEventEnvelope['type'],
        payload: { deviation: cpResult.deviation },
        timestamp: createISODateTime(),
        version: state.version + 1,
      }]
      await this.eventStore.append({ runId, events: devEvents, expectedVersion: state.version })
      const devState = reduceEvent(state, devEvents[0]!)
      return {
        executed: true,
        nodeId: lease.nodeId,
        lease,
        checkpointResult: cpResult,
        state: devState,
        nextNodeIds: [],
      }
    }

    // 7. 持久化成功事件
    let version = state.version
    const successEvents: AGCEventEnvelope[] = []

    version++
    successEvents.push({
      eventId: createEventId(),
      runId,
      type: 'NODE_COMPLETED',
      // ★ P0-1 fix: 发射符合共享 NodeCompletedPayload 的 payload
      payload: {
        nodeId: lease.nodeId,
        output: (callbackResult.checkpoint ?? {}) as Record<string, unknown>,
        model: callbackResult.outcome.action && 'provider' in callbackResult.outcome.action
          ? (callbackResult.outcome.action as { provider: string }).provider
          : undefined,
        durationMs,
        degraded: false,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 为下一批就绪节点发射 NODE_QUEUED
    for (const nextId of cpResult.nextNodeIds) {
      version++
      successEvents.push({
        eventId: createEventId(),
        runId,
        type: 'NODE_QUEUED',
        payload: { nodeId: nextId },
        timestamp: createISODateTime(),
        version,
      })
    }

    await this.eventStore.append({ runId, events: successEvents, expectedVersion: state.version })

    let newState = state
    for (const evt of successEvents) {
      newState = reduceEvent(newState, evt)
    }

    this.logger.info('advanceNode 完成', {
      runId, nodeId: lease.nodeId, nextNodes: cpResult.nextNodeIds,
    })

    return {
      executed: true,
      nodeId: lease.nodeId,
      lease,
      governanceDecision: authDecision,
      checkpointResult: cpResult,
      state: newState,
      nextNodeIds: cpResult.nextNodeIds,
    }

    }) // ★ P0-4 fix: advanceMutex.withLock 结束
  }

  /**
   * 完成运行 — SYNTHESIZE 阶段调用 release 拦截点
   *
   * Trust-Weighted 释放决策:
   * 1. gateway.release(candidates) → 信任加权释放
   * 2. 持久化 RUN_COMPLETED 事件
   */
  async completeRun(
    candidates: ModelCandidate[],
  ): Promise<CompleteRunResult> {
    if (!this.currentRunContext) {
      throw new Error('No active run. Call startRun() first.')
    }

    const { runId, graph, metadata, dreadScore } = this.currentRunContext
    const state = await this.getState(runId)
    if (!state) throw new Error(`Run ${runId} not found`)

    // 1. gateway.release() — Trust-Weighted 释放决策
    const releaseDecision = await this.gateway.release(
      {
        runId,
        action: { type: 'answer.release' },
        state,
        graph,
        metadata,
      },
      candidates,
      dreadScore,
    )

    this.logger.info('GovernanceGateway 释放决策', {
      runId, effect: releaseDecision.effect,
      selectedCandidate: releaseDecision.selectedCandidateId,
      score: releaseDecision.score,
    })

    // 2. 持久化 RUN_COMPLETED
    const finalStatus = releaseDecision.effect === 'release' ? 'completed'
      : releaseDecision.effect === 'escalate' ? 'failed'
      : 'completed' // degrade/revise 仍算完成

    const events: AGCEventEnvelope[] = [{
      eventId: createEventId(),
      runId,
      type: 'RUN_COMPLETED',
      payload: {
        finalStatus,
        releaseEffect: releaseDecision.effect,
        selectedCandidateId: releaseDecision.selectedCandidateId,
        releaseScore: releaseDecision.score,
      },
      timestamp: createISODateTime(),
      version: state.version + 1,
    }]

    await this.eventStore.append({ runId, events, expectedVersion: state.version })
    const finalState = reduceEvent(state, events[0]!)

    // 保存最终检查点
    const checkpointId = createCheckpointId()
    await this.checkpointStore.save({
      checkpoint: {
        checkpointId,
        runId,
        version: finalState.version,
        state: finalState,
        createdAt: createISODateTime(),
      },
    })

    // 清理运行上下文
    this.currentRunContext = undefined

    const governance: GovernanceDecisionRecord = {
      allowed: releaseDecision.effect !== 'escalate',
      worstStatus: releaseDecision.effect === 'release' ? 'pass' : 'warn',
      evaluatedAt: createISODateTime(),
      findings: releaseDecision.rationale.map(r => ({
        ruleId: 'GaaS-Release',
        ruleName: 'GovernanceGateway.release',
        status: 'pass' as const,
        message: r,
      })),
    }

    this.logger.info('AGC 运行完成 (全治理生命周期)', {
      runId, finalStatus,
      releaseEffect: releaseDecision.effect,
    })

    return { release: releaseDecision, state: finalState, governance }
  }

  /** 获取 WorkflowRuntime (用于外部查询偏差、完成状态等) */
  getRuntime(): WorkflowRuntime {
    return this.runtime
  }

  /**
   * 查询运行状态（通过事件回放）
   *
   * Phase 3: 使用纯事件驱动投影
   */
  async getState(runId: string): Promise<AGCState | null> {
    const exists = await this.eventStore.exists(runId)
    if (!exists) return null

    const events = await this.eventStore.load({ runId })
    if (events.length === 0) return null

    // Phase 3: 纯事件驱动投影，不依赖外部 nodeIds
    return projectStateFromEvents(runId, events)
  }

  /**
   * 验证运行完整性（漂移检测）
   *
   * Phase 3 修复:
   * - 使用 capturedContext 重建图/metadata（不再伪造）
   * - 增量回放（从 checkpoint 恢复，仅回放尾部事件）
   * - 发射 RUN_VERIFIED 事件
   */
  async verifyRun(runId: string): Promise<VerifyRunResult> {
    // 1. Phase 3 修复 #6: 增量回放优化
    const checkpoint = await this.checkpointStore.loadLatest(runId)
    let replayedState: AGCState

    if (checkpoint && this.eventStore.loadStream) {
      // 从 checkpoint 恢复 + 仅回放尾部事件
      replayedState = checkpoint.state as AGCState
      const tailEvents: AGCEventEnvelope[] = []

      for await (const event of this.eventStore.loadStream({
        runId,
        fromVersion: checkpoint.version + 1,
      })) {
        tailEvents.push(event)
      }

      // 在 checkpoint 状态之上应用尾部事件
      for (const event of tailEvents) {
        replayedState = reduceEvent(replayedState, event)
      }
    } else {
      // 兜底: 全量回放
      const events = await this.eventStore.load({ runId })
      replayedState = projectStateFromEvents(runId, events)
    }

    // 2. Phase 3 修复 #2: 使用 capturedContext 重建图/metadata
    const capturedCtx = replayedState.capturedContext as CapturedContext | undefined
    const graph: RunGraph = capturedCtx?.graph ?? {
      nodes: Object.keys(replayedState.nodes).map(id => ({
        id, name: id, dependsOn: [] as string[],
        input: {} as Record<string, unknown>, skippable: false, priority: 0,
      })),
      edges: [],
    }
    const metadata: RunMetadata = capturedCtx?.metadata ?? {
      goal: '', files: [] as string[], initiator: 'system',
    }

    // 3. 二次审查 P0 修复: 漂移检测改为深度状态比较
    //
    // 原逻辑 (有 bug): checkpointState.version !== replayedState.version
    // 问题: 任何新事件都会导致版本号前进, 导致假阳性
    //
    // 新逻辑: 从 checkpoint 开始增量回放 vs 全量回放, 比较最终节点状态是否一致
    // 这才是真正的 "漂移检测" — 检测状态是否被外部修改/损坏
    let driftDetected = false
    if (checkpoint) {
      const fullReplayEvents = await this.eventStore.load({ runId })
      const fullReplayState = projectStateFromEvents(runId, fullReplayEvents)
      // ★ P2-3 fix: 深度比较完整节点状态（包含 output/model/durationMs，不仅是 status）
      const replayedNodeJson = JSON.stringify(Object.keys(replayedState.nodes).sort().map(k => {
        const n = replayedState.nodes[k]!
        return { id: k, status: n.status, output: n.output, model: n.model, durationMs: n.durationMs }
      }))
      const fullNodeJson = JSON.stringify(Object.keys(fullReplayState.nodes).sort().map(k => {
        const n = fullReplayState.nodes[k]!
        return { id: k, status: n.status, output: n.output, model: n.model, durationMs: n.durationMs }
      }))
      driftDetected = replayedNodeJson !== fullNodeJson
    }

    // 4. 治理网关 preflight 重算
    const governanceDecision = await this.gateway.preflight({
      runId,
      action: { type: 'node.execute', nodeId: 'VERIFY' },
      state: replayedState,
      graph,
      metadata,
    })
    const governance: GovernanceDecisionRecord = {
      allowed: governanceDecision.effect === 'allow' || governanceDecision.effect === 'warn',
      worstStatus: governanceDecision.effect === 'allow' ? 'pass' : governanceDecision.effect === 'warn' ? 'warn' : 'block',
      evaluatedAt: createISODateTime(),
      findings: governanceDecision.rationale.map(r => ({ ruleId: 'GaaS', ruleName: 'GovernanceGateway', status: 'pass' as const, message: r })),
    }

    const ok = !driftDetected && governance.allowed

    // 5. 发射 RUN_VERIFIED 事件
    const currentVersion = replayedState.version
    const verifyEvent: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'RUN_VERIFIED',
      payload: { ok, driftDetected },
      timestamp: createISODateTime(),
      version: currentVersion + 1,
    }
    await this.eventStore.append({
      runId,
      events: [verifyEvent],
      expectedVersion: currentVersion,
    })

    // 6. 二次审查 P0 修复: 验证后保存 checkpoint (防止验证中毒)
    const postVerifyState = reduceEvent(replayedState, verifyEvent)
    const newCheckpointId = createCheckpointId()
    const checkpointSaveEvent: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'CHECKPOINT_SAVED',
      payload: { checkpointId: newCheckpointId, version: postVerifyState.version + 1 },
      timestamp: createISODateTime(),
      version: postVerifyState.version + 1,
    }
    await this.eventStore.append({
      runId,
      events: [checkpointSaveEvent],
      expectedVersion: postVerifyState.version,
    })

    const finalState = reduceEvent(postVerifyState, checkpointSaveEvent)
    await this.checkpointStore.save({
      checkpoint: {
        checkpointId: newCheckpointId,
        runId,
        version: finalState.version,
        state: finalState,
        createdAt: createISODateTime(),
      },
    })

    this.logger.info('运行验证完成', { runId, ok, driftDetected })

    return {
      ok,
      state: finalState,
      replayedState: finalState,
      driftDetected,
      governance,
    }
  }
}
