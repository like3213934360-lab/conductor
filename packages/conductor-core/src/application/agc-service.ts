/**
 * Conductor AGC — 应用服务 (AGCService)
 *
 * 编排层: 组合 DAG Engine + Risk Router + Compliance Engine，
 * 通过 Event Sourcing 管理状态。
 */
import type { AGCState, RunRequest, AGCEventEnvelope, CheckpointDTO,
  RouteDecision, ComplianceDecision, DRScore } from '@anthropic/conductor-shared'
import { createRunId, createEventId, createISODateTime, createCheckpointId,
  projectState, RunRequestSchema } from '@anthropic/conductor-shared'
import type { EventStore } from '../contracts/event-store.js'
import type { CheckpointStore } from '../contracts/checkpoint-store.js'
import type { CoreLogger } from '../contracts/logger.js'
import { consoleLogger } from '../contracts/logger.js'
import { DagEngine } from '../dag/dag-engine.js'
import { DRCalculator } from '../risk/dr-calculator.js'
import { RiskRouter } from '../risk/risk-router.js'
import { ComplianceEngine } from '../compliance/compliance-engine.js'
import { DefaultComplianceRules } from '../compliance/default-rules.js'

/** AGCService 依赖注入 */
export interface AGCServiceDeps {
  eventStore: EventStore
  checkpointStore: CheckpointStore
  logger?: CoreLogger
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
    this.complianceEngine = new ComplianceEngine(DefaultComplianceRules)
  }

  /**
   * 启动新的 AGC 运行
   */
  async startRun(req: RunRequest): Promise<StartRunResult> {
    // 1. Schema 校验（Zod 强制）
    const parsed = RunRequestSchema.parse(req)
    const runId = parsed.runId ?? createRunId()
    const nodeIds = parsed.graph.nodes.map(n => n.id)

    this.logger.info('启动 AGC 运行', { runId, nodeCount: nodeIds.length })

    // 2. DAG 校验（环检测 + 拓扑排序）
    this.dagEngine.validate(parsed.graph)

    // 3. DR 分歧率计算
    const drScore = this.drCalculator.calculate({
      graph: parsed.graph,
      metadata: parsed.metadata,
    })

    // 4. 创建初始事件
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

    // 7. 路由决策
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
        skippedCount: route.skippedNodes.length,
        confidence: route.confidence,
      },
      timestamp: createISODateTime(),
      version,
    })

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

    // 9. 持久化事件
    await this.eventStore.append({ runId, events, expectedVersion: 'no_stream' })

    // 10. 投影最终状态
    const finalState = projectState(runId, nodeIds, events)

    // 11. 保存检查点
    const checkpointId = createCheckpointId()
    const checkpoint: CheckpointDTO = {
      checkpointId,
      runId,
      version: finalState.version,
      state: finalState,
      createdAt: createISODateTime(),
    }
    await this.checkpointStore.save({ checkpoint })

    // CHECKPOINT_SAVED
    version++
    const cpEvent: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'CHECKPOINT_SAVED',
      payload: { checkpointId, version: finalState.version },
      timestamp: createISODateTime(),
      version,
    }
    await this.eventStore.append({ runId, events: [cpEvent], expectedVersion: 'any' })

    this.logger.info('AGC 运行已启动', { runId, lane: route.lane, drScore: drScore.score })

    return { runId, state: finalState, route, compliance, drScore, checkpoint }
  }

  /**
   * 查询运行状态（通过事件回放）
   */
  async getState(runId: string): Promise<AGCState | null> {
    const exists = await this.eventStore.exists(runId)
    if (!exists) return null

    const events = await this.eventStore.load({ runId })
    if (events.length === 0) return null

    // 从 RUN_CREATED 事件中提取 nodeIds
    const createdEvent = events.find(e => e.type === 'RUN_CREATED')
    const nodeIds = (createdEvent?.payload as { nodeIds?: string[] })?.nodeIds ?? []

    return projectState(runId, nodeIds, events)
  }

  /**
   * 验证运行完整性（漂移检测）
   *
   * 通过全量事件回放重算状态，与最新检查点对比。
   */
  async verifyRun(runId: string): Promise<VerifyRunResult> {
    // 1. 从事件流回放
    const events = await this.eventStore.load({ runId })
    const createdEvent = events.find(e => e.type === 'RUN_CREATED')
    const nodeIds = (createdEvent?.payload as { nodeIds?: string[] })?.nodeIds ?? []
    const replayedState = projectState(runId, nodeIds, events)

    // 2. 加载最新检查点
    const checkpoint = await this.checkpointStore.loadLatest(runId)
    const checkpointState = checkpoint?.state ?? replayedState

    // 3. 漂移检测
    const driftDetected = checkpointState.version !== replayedState.version

    // 4. 重算合规
    // 注意: 这里需要图定义，Phase 1 简化处理
    const compliance = await this.complianceEngine.evaluate({
      state: replayedState,
      graph: { nodes: nodeIds.map(id => ({ id, name: id, dependsOn: [] as string[], input: {} as Record<string, unknown>, skippable: false })), edges: [] },
      metadata: { goal: '', files: [] as string[], initiator: 'system' },
    })

    const ok = !driftDetected && compliance.allowed

    this.logger.info('运行验证完成', { runId, ok, driftDetected })

    return { ok, state: checkpointState, replayedState, driftDetected, compliance }
  }
}
