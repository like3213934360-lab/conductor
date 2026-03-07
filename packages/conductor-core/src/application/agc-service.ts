/**
 * Conductor AGC — 应用服务 (AGCService)
 *
 * 编排层: 组合 DAG Engine + Risk Router + Compliance Engine，
 * 通过 Event Sourcing 管理状态。
 *
 * Phase 3 修复:
 * 1. startRun() 发射 RUN_CONTEXT_CAPTURED 事件
 * 2. verifyRun() 使用 capturedContext 重建图（不再伪造）
 * 3. checkpoint 版本语义修正（事件后保存）
 * 4. CHECKPOINT_SAVED 严格 expectedVersion
 * 5. verifyRun() 发射 RUN_VERIFIED 事件
 * 6. 增量回放优化（从 checkpoint 恢复）
 * 7. complianceRules 依赖注入化
 */
import type { AGCState, RunRequest, AGCEventEnvelope, CheckpointDTO,
  RouteDecision, ComplianceDecision, DRScore, RunGraph, RunMetadata,
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
import { ComplianceEngine } from '../compliance/compliance-engine.js'
import type { ComplianceRule } from '../compliance/compliance-rule.js'
import { DefaultComplianceRules } from '../compliance/default-rules.js'

/** AGCService 依赖注入 */
export interface AGCServiceDeps {
  eventStore: EventStore
  checkpointStore: CheckpointStore
  logger?: CoreLogger
  /** Phase 3: 自定义合规规则（不传则使用默认规则） */
  complianceRules?: ComplianceRule[]
}

/** 启动运行结果 */
export interface StartRunResult {
  runId: string
  state: AGCState
  route: RouteDecision
  compliance: ComplianceDecision
  drScore: DRScore
  checkpoint?: CheckpointDTO
}

/** 验证运行结果 */
export interface VerifyRunResult {
  ok: boolean
  state: AGCState
  replayedState: AGCState
  driftDetected: boolean
  compliance: ComplianceDecision
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
  private readonly complianceEngine: ComplianceEngine

  constructor(deps: AGCServiceDeps) {
    this.eventStore = deps.eventStore
    this.checkpointStore = deps.checkpointStore
    this.logger = deps.logger ?? consoleLogger
    this.dagEngine = new DagEngine()
    this.drCalculator = new DRCalculator()
    this.riskRouter = new RiskRouter()
    // Phase 3: 合规规则 DI 化
    this.complianceEngine = new ComplianceEngine(
      deps.complianceRules ?? DefaultComplianceRules,
    )
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

    // 6. 合规评估
    const compliance = await this.complianceEngine.evaluate({
      state: initialState,
      graph: parsed.graph,
      metadata: parsed.metadata,
    })

    // COMPLIANCE_EVALUATED
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'COMPLIANCE_EVALUATED',
      payload: {
        allowed: compliance.allowed,
        worstStatus: compliance.worstStatus,
        findingCount: compliance.findings.length,
      },
      timestamp: createISODateTime(),
      version,
    })

    // 三模型审计 P0: compliance BLOCK 短路 — 合规拒绝时立即终止运行
    if (!compliance.allowed) {
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

      this.logger.warn('AGC 运行被合规拒绝', { runId, worstStatus: compliance.worstStatus })

      return {
        runId,
        state: blockedState,
        route: {
          lane: 'escalated' as const,
          nodePath: [],
          skippedNodes: nodeIds.map(id => ({ nodeId: id, reason: 'compliance_blocked' })),
          confidence: 0,
        },
        compliance,
        drScore,
        checkpoint: blockedCheckpoint,
      }
    }

    // 7. 路由决策 (仅在合规通过后)
    const route = this.riskRouter.decide({
      score: drScore,
      findings: compliance.findings,
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

    this.logger.info('AGC 运行已启动', { runId, lane: route.lane, drScore: drScore.score })

    return { runId, state: finalState, route, compliance, drScore, checkpoint }
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
        input: {} as Record<string, unknown>, skippable: false,
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
      // 比较节点状态 (忽略 version 字段)
      const replayedNodeJson = JSON.stringify(Object.keys(replayedState.nodes).sort().map(k => ({
        id: k, status: replayedState.nodes[k]?.status,
      })))
      const fullNodeJson = JSON.stringify(Object.keys(fullReplayState.nodes).sort().map(k => ({
        id: k, status: fullReplayState.nodes[k]?.status,
      })))
      driftDetected = replayedNodeJson !== fullNodeJson
    }

    // 4. 重算合规（使用完整图）
    const compliance = await this.complianceEngine.evaluate({
      state: replayedState,
      graph,
      metadata,
    })

    const ok = !driftDetected && compliance.allowed

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
      compliance,
    }
  }
}
