import {
  DagEngine,
  DRCalculator,
  GovernanceGateway,
  RiskRouter,
  TrustFactorService,
  consoleLogger,
  getDefaultControlPack,
  type CheckpointStore,
  type CoreLogger,
  type EventStore,
  type GovernanceControl,
} from '@anthropic/antigravity-core'
import type {
  WorkflowEventEnvelope,
  WorkflowState,
  CheckpointDTO,
  DRScore,
  GovernanceDecisionRecord,
  RouteDecision,
  RunRequest,
} from '@anthropic/antigravity-shared'
import {
  RunRequestSchema,
  createCheckpointId,
  createEventId,
  createISODateTime,
  createRunId,
  projectState,
  projectStateFromEvents,
} from '@anthropic/antigravity-shared'

export interface BootstrapDaemonRunDeps {
  eventStore: EventStore
  checkpointStore: CheckpointStore
  governanceControls?: GovernanceControl[]
  logger?: CoreLogger
}

export interface BootstrapDaemonRunResult {
  runId: string
  state: WorkflowState
  route: RouteDecision
  governance: GovernanceDecisionRecord
  drScore: DRScore
  checkpoint?: CheckpointDTO
}

function mapGovernanceStatus(effect: 'allow' | 'warn' | 'degrade' | 'block' | 'escalate'): GovernanceDecisionRecord['worstStatus'] {
  switch (effect) {
    case 'allow':
      return 'pass'
    case 'warn':
      return 'warn'
    case 'degrade':
      return 'degrade'
    case 'block':
    case 'escalate':
    default:
      return 'block'
  }
}

export async function bootstrapDaemonRun(
  request: RunRequest,
  deps: BootstrapDaemonRunDeps,
): Promise<BootstrapDaemonRunResult> {
  const parsed = RunRequestSchema.parse(request)
  const runId = parsed.runId ?? createRunId()
  const nodeIds = parsed.graph.nodes.map(node => node.id)
  const dagEngine = new DagEngine()
  const drCalculator = new DRCalculator()
  const riskRouter = new RiskRouter()
  const gateway = new GovernanceGateway(
    new TrustFactorService(),
    deps.governanceControls ?? getDefaultControlPack(),
  )
  const logger = deps.logger ?? consoleLogger

  logger.info('Bootstrapping daemon-owned workflow run', { runId, nodeCount: nodeIds.length })

  dagEngine.validate(parsed.graph)

  const drScore = drCalculator.calculate({
    graph: parsed.graph,
    metadata: parsed.metadata,
    options: parsed.options,
  })

  let version = 0
  const events: WorkflowEventEnvelope[] = []

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

  const initialState = projectState(runId, nodeIds, events)
  const governanceDecision = await gateway.preflight({
    runId,
    action: { type: 'node.execute', nodeId: 'ANALYZE' },
    state: initialState,
    graph: parsed.graph,
    metadata: parsed.metadata,
  })
  const worstStatus = mapGovernanceStatus(governanceDecision.effect)
  const governance: GovernanceDecisionRecord = {
    allowed: governanceDecision.effect !== 'block' && governanceDecision.effect !== 'escalate',
    worstStatus,
    evaluatedAt: createISODateTime(),
    findings: governanceDecision.rationale.map(message => ({
      ruleId: 'daemon.preflight',
      ruleName: 'DaemonPreflight',
      status: worstStatus,
      message,
    })),
  }

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

  if (!governance.allowed) {
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'RUN_COMPLETED',
      payload: { finalStatus: 'failed' },
      timestamp: createISODateTime(),
      version,
    })

    await deps.eventStore.append({ runId, events, expectedVersion: 'no_stream' })
    const blockedState = projectState(runId, nodeIds, events)
    const checkpointId = createCheckpointId()
    const checkpoint: CheckpointDTO = {
      checkpointId,
      runId,
      version: blockedState.version,
      state: blockedState,
      createdAt: createISODateTime(),
    }
    await deps.checkpointStore.save({ checkpoint })

    return {
      runId,
      state: blockedState,
      route: {
        lane: 'escalated',
        nodePath: [],
        skippedNodes: nodeIds.map(nodeId => ({ nodeId, reason: 'preflight_blocked' })),
        confidence: 0,
      },
      governance,
      drScore,
      checkpoint,
    }
  }

  const route = parsed.options?.forceFullPath
    ? {
        lane: 'full' as const,
        nodePath: nodeIds,
        skippedNodes: [],
        confidence: 100,
      }
    : riskRouter.decide({
        score: drScore,
        findings: governance.findings,
        graph: parsed.graph,
      })

  version++
  events.push({
    eventId: createEventId(),
    runId,
    type: 'ROUTE_DECIDED',
    payload: {
      lane: route.lane,
      nodePath: route.nodePath,
      skippedNodes: route.skippedNodes.map(item => item.nodeId),
      skippedCount: route.skippedNodes.length,
      confidence: route.confidence,
    },
    timestamp: createISODateTime(),
    version,
  })

  for (const skippedNode of route.skippedNodes) {
    version++
    events.push({
      eventId: createEventId(),
      runId,
      type: 'NODE_SKIPPED',
      payload: {
        nodeId: skippedNode.nodeId,
        reason: skippedNode.reason,
      },
      timestamp: createISODateTime(),
      version,
    })
  }

  const initialNodes = dagEngine.queueInitialNodes(parsed.graph)
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

  const checkpointId = createCheckpointId()
  version++
  events.push({
    eventId: createEventId(),
    runId,
    type: 'CHECKPOINT_SAVED',
    payload: {
      checkpointId,
      version,
    },
    timestamp: createISODateTime(),
    version,
  })

  await deps.eventStore.append({ runId, events, expectedVersion: 'no_stream' })
  const state = projectState(runId, nodeIds, events)
  const checkpoint: CheckpointDTO = {
    checkpointId,
    runId,
    version: state.version,
    state,
    createdAt: createISODateTime(),
  }
  await deps.checkpointStore.save({ checkpoint })

  return {
    runId,
    state,
    route,
    governance,
    drScore,
    checkpoint,
  }
}

export async function loadRunStateFromEvents(
  eventStore: EventStore,
  runId: string,
): Promise<WorkflowState> {
  const events = await eventStore.load({ runId })
  return projectStateFromEvents(runId, events)
}
