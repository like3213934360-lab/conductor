import * as fs from 'node:fs'
import * as path from 'node:path'
import type { WorkflowState, NodeRuntimeState } from '@anthropic/antigravity-shared'
import type {
  CompletionSessionRecord,
  DaemonNodeStatus,
  ExecutionReceipt,
  CertificationRecordArtifactSummary,
  InvariantReportArtifactSummary,
  PolicyReportArtifactSummary,
  RunNodeSnapshot,
  RunSnapshot,
  RunStatus,
  ReleaseArtifacts,
  ReleaseBundleArtifactSummary,
  ReleaseDossierArtifactSummary,
  SkipDecision,
  StepHeartbeat,
  StepLease,
  TransparencyLedgerSummary,
  TribunalSummary,
  WorkflowDefinition,
  WorkflowInvocation,
} from './schema.js'
import { getWorkflowDisplayName } from './workflow-definition.js'
import { ANTIGRAVITY_AUTHORITY_HOST, ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

function mapRunStatus(state: WorkflowState | null, explicitStatus?: RunStatus): RunStatus {
  if (explicitStatus) {
    return explicitStatus
  }
  const raw = state?.status
  switch (raw) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'paused':
      return 'paused_for_human'
    case 'pending':
    case 'running':
    default:
      return 'running'
  }
}

function mapNodeStatus(
  state: NodeRuntimeState | undefined,
  runStatus: RunStatus,
  isPolicySkipped: boolean,
): DaemonNodeStatus {
  if (isPolicySkipped || state?.status === 'skipped') {
    return 'policy_skipped'
  }
  switch (state?.status) {
    case 'queued':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'pending':
    default:
      break
  }

  if (runStatus === 'cancelled') {
    return 'cancelled'
  }
  if (runStatus === 'paused_for_human') {
    return 'paused_for_human'
  }
  return 'pending'
}

function summarizeOutput(output: Record<string, unknown> | undefined): string | undefined {
  if (!output) {
    return undefined
  }
  if (typeof output.finalAnswer === 'string') {
    return output.finalAnswer.slice(0, 240)
  }
  if (typeof output.finalSummary === 'string') {
    return output.finalSummary.slice(0, 240)
  }
  if (typeof output.summary === 'string') {
    return output.summary.slice(0, 240)
  }
  const text = JSON.stringify(output)
  return text === '{}' ? undefined : text.slice(0, 240)
}

function derivePhase(nodes: Record<string, RunNodeSnapshot>, runStatus: RunStatus): string {
  const active = Object.values(nodes).find(node => node.status === 'running' || node.status === 'queued')
  if (active) {
    return active.nodeId
  }
  switch (runStatus) {
    case 'completed':
      return 'COMPLETED'
    case 'failed':
      return 'FAILED'
    case 'cancelled':
      return 'CANCELLED'
    case 'paused_for_human':
      return 'PAUSED_FOR_HUMAN'
    default:
      return 'STARTING'
  }
}

function deriveVerdict(state: WorkflowState | null, explicitVerdict?: string): string | undefined {
  if (explicitVerdict) {
    return explicitVerdict
  }
  const synth = state?.nodes.SYNTHESIZE?.output
  if (typeof synth?.finalAnswer === 'string' && synth.finalAnswer.trim().length > 0) {
    return synth.finalAnswer.slice(0, 240)
  }
  const verify = state?.nodes.VERIFY?.output
  if (typeof verify?.assuranceVerdict === 'string') {
    return `VERIFY:${verify.assuranceVerdict}`
  }
  return undefined
}

function deriveActiveLease(state: WorkflowState | null): StepLease | undefined {
  if (!state) {
    return undefined
  }
  const runningNode = Object.values(state.nodes).find(node => node.status === 'running' && typeof node.leaseId === 'string')
  if (!runningNode || !runningNode.leaseId || !runningNode.leaseExpiresAt) {
    return undefined
  }
  return {
    leaseId: runningNode.leaseId,
    runId: state.runId,
    nodeId: runningNode.nodeId,
    attempt: runningNode.leaseAttempt ?? 0,
    issuedAt: runningNode.startedAt ?? runningNode.completedAt ?? '',
    expiresAt: runningNode.leaseExpiresAt,
    authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
    requiredEvidence: runningNode.requiredEvidence ?? [],
    allowedModelPool: runningNode.allowedModelPool ?? [],
    inputDigest: runningNode.inputDigest,
  }
}

function deriveActiveHeartbeat(state: WorkflowState | null): StepHeartbeat | undefined {
  if (!state) {
    return undefined
  }
  const runningNode = Object.values(state.nodes).find(node => node.status === 'running' && typeof node.leaseId === 'string' && typeof node.lastHeartbeatAt === 'string')
  if (!runningNode || !runningNode.leaseId || !runningNode.lastHeartbeatAt) {
    return undefined
  }
  return {
    leaseId: runningNode.leaseId,
    runId: state.runId,
    nodeId: runningNode.nodeId,
    attempt: runningNode.leaseAttempt ?? 0,
    heartbeatAt: runningNode.lastHeartbeatAt,
  }
}

function getLatestCompletionSession(
  sessions: readonly CompletionSessionRecord[],
  phase?: CompletionSessionRecord['phase'],
): CompletionSessionRecord | undefined {
  const filtered = phase
    ? sessions.filter(session => session.phase === phase)
    : sessions
  return [...filtered].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1)
}

function deriveAcknowledgedCompletionReceipt(
  completionSessions: readonly CompletionSessionRecord[],
) {
  const session = getLatestCompletionSession(completionSessions, 'committed')
  if (!session) {
    return undefined
  }
  return {
    ...session.receipt,
    committedAt: session.committedAt ?? session.updatedAt,
  }
}

function derivePreparedCompletionReceipt(
  completionSessions: readonly CompletionSessionRecord[],
) {
  const session = getLatestCompletionSession(completionSessions, 'prepared')
  if (!session) {
    return undefined
  }
  return {
    ...session.receipt,
    preparedAt: session.preparedAt ?? session.updatedAt,
  }
}

function derivePendingCompletionReceipt(
  completionSessions: readonly CompletionSessionRecord[],
) {
  return getLatestCompletionSession(completionSessions, 'pending')?.receipt
}

function buildTribunalSummaryByNode(
  completionSessions: readonly CompletionSessionRecord[],
): Map<string, TribunalSummary> {
  const summaries = new Map<string, TribunalSummary>()
  for (const session of completionSessions) {
    const tribunal = session.stagedBundle.tribunal
    if (!tribunal) {
      continue
    }
    const current = summaries.get(session.nodeId)
    if (!current || current.createdAt.localeCompare(tribunal.createdAt) < 0) {
      summaries.set(session.nodeId, tribunal)
    }
  }
  return summaries
}

export interface BuildRunSnapshotParams {
  runId: string
  invocation: WorkflowInvocation
  definition: WorkflowDefinition
  state: WorkflowState | null
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  explicitStatus?: RunStatus
  verdict?: string
  timelineCursor: number
  releaseArtifacts?: ReleaseArtifacts
  policyReport?: PolicyReportArtifactSummary
  invariantReport?: InvariantReportArtifactSummary
  releaseDossier?: ReleaseDossierArtifactSummary
  releaseBundle?: ReleaseBundleArtifactSummary
  certificationRecord?: CertificationRecordArtifactSummary
  transparencyLedger?: TransparencyLedgerSummary
  skipDecisions?: SkipDecision[]
  receipts?: ExecutionReceipt[]
  completionSessions?: CompletionSessionRecord[]
  latestTribunalVerdict?: TribunalSummary
}

export function buildRunSnapshot(params: BuildRunSnapshotParams): RunSnapshot {
  const runStatus = mapRunStatus(params.state, params.explicitStatus)
  const policySkipped = new Set((params.skipDecisions ?? []).map(item => item.nodeId))
  const receiptsByNode = new Map((params.receipts ?? []).map(item => [item.nodeId, item]))
  const completionSessions = params.completionSessions ?? []
  const tribunalByNode = buildTribunalSummaryByNode(completionSessions)

  const nodes = params.definition.steps.reduce<Record<string, RunNodeSnapshot>>((acc, step) => {
    const nodeState = params.state?.nodes[step.id]
    const receipt = receiptsByNode.get(step.id)
    const tribunal = receipt?.tribunal ?? tribunalByNode.get(step.id)
    acc[step.id] = {
      nodeId: step.id,
      name: step.name,
      capability: step.capability,
      dependsOn: step.dependsOn,
      status: mapNodeStatus(nodeState, runStatus, policySkipped.has(step.id)),
      model: nodeState?.model,
      startedAt: nodeState?.startedAt,
      completedAt: nodeState?.completedAt,
      outputSummary: summarizeOutput(nodeState?.output),
      approvalGateId: step.approvalGate?.gateId,
      receiptId: receipt?.receiptId,
      tribunalVerdict: tribunal?.verdict,
      tribunalConfidence: tribunal?.confidence,
      tribunalMode: tribunal?.mode,
      tribunalUpdatedAt: tribunal?.createdAt,
      tribunalQuorumSatisfied: tribunal?.quorumSatisfied,
    }
    return acc
  }, {})

  return {
    runId: params.runId,
    goal: params.invocation.goal,
    workflowId: params.definition.workflowId,
    workflowVersion: params.definition.version,
    workflowTemplate: getWorkflowDisplayName(params.definition),
    authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
    authorityHost: ANTIGRAVITY_AUTHORITY_HOST,
    workspaceRoot: params.invocation.workspaceRoot,
    hostSessionId: params.invocation.hostSessionId,
    status: runStatus,
    phase: derivePhase(nodes, runStatus),
    nodes,
    runtimeState: params.state,
    activeLease: deriveActiveLease(params.state),
    activeHeartbeat: deriveActiveHeartbeat(params.state),
    pendingCompletionReceipt: derivePendingCompletionReceipt(completionSessions),
    preparedCompletionReceipt: derivePreparedCompletionReceipt(completionSessions),
    acknowledgedCompletionReceipt: deriveAcknowledgedCompletionReceipt(completionSessions),
    latestTribunalVerdict: params.latestTribunalVerdict ?? getLatestCompletionSession(completionSessions)?.stagedBundle.tribunal,
    verdict: deriveVerdict(params.state, params.verdict),
    releaseArtifacts: params.releaseArtifacts ?? {},
    policyReport: params.policyReport,
    invariantReport: params.invariantReport,
    releaseDossier: params.releaseDossier,
    releaseBundle: params.releaseBundle,
    certificationRecord: params.certificationRecord,
    transparencyLedger: params.transparencyLedger,
    timelineCursor: params.timelineCursor,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
  }
}

export function writeRunProjection(projectionPath: string, snapshot: RunSnapshot): void {
  fs.mkdirSync(path.dirname(projectionPath), { recursive: true })
  const payload = {
    runId: snapshot.runId,
    status: snapshot.status,
    phase: snapshot.phase,
    workflow: snapshot.workflowTemplate,
    verdict: snapshot.verdict,
    version: snapshot.runtimeState?.version ?? 0,
    authorityOwner: snapshot.authorityOwner,
    authorityHost: snapshot.authorityHost,
    hostSessionId: snapshot.hostSessionId,
    updatedAt: snapshot.updatedAt,
    timelineCursor: snapshot.timelineCursor,
    releaseArtifacts: snapshot.releaseArtifacts,
    policyReport: snapshot.policyReport,
    invariantReport: snapshot.invariantReport,
    releaseDossier: snapshot.releaseDossier,
    releaseBundle: snapshot.releaseBundle,
    certificationRecord: snapshot.certificationRecord,
    transparencyLedger: snapshot.transparencyLedger,
    nodes: Object.fromEntries(
      Object.entries(snapshot.nodes).map(([nodeId, node]) => [
        nodeId,
        {
          ...node,
          status: node.status === 'policy_skipped' ? 'skipped' : node.status === 'paused_for_human' ? 'paused' : node.status,
        },
      ]),
    ),
  }
  fs.writeFileSync(projectionPath, JSON.stringify(payload, null, 2), 'utf8')
}
