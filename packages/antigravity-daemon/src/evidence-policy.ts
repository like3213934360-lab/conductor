import * as crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import type { NodeExecutionResult } from '@anthropic/antigravity-model-core'
import type {
  ArtifactRef,
  EvidenceRef,
  ExecutionReceipt,
  HandoffEnvelope,
  JudgeReport,
  SkipDecision,
  TribunalSummary,
  WorkflowDefinition,
  WorkflowInvocation,
} from './schema.js'

export interface ReceiptContext {
  runId: string
  nodeId: string
  result: NodeExecutionResult
  invocation: WorkflowInvocation
  definition: WorkflowDefinition
  capturedAt: string
  traceId: string
  tribunal?: TribunalSummary
  judgeReports?: JudgeReport[]
}

export interface ReleaseGateDecision {
  effect: 'allow' | 'block'
  rationale: string[]
  evidenceIds: string[]
}

function createArtifact(
  runId: string,
  nodeId: string,
  suffix: string,
  kind: ArtifactRef['kind'],
  capturedAt: string,
  digest?: string,
  description?: string,
): ArtifactRef {
  return {
    artifactId: `${runId}:${nodeId}:${suffix}`,
    kind,
    uri: `run://${runId}/artifacts/${nodeId.toLowerCase()}/${suffix}`,
    digest,
    description,
    createdAt: capturedAt,
  }
}

function createEvidence(
  evidenceId: string,
  kind: EvidenceRef['kind'],
  uri: string,
  capturedAt: string,
  summary?: string,
): EvidenceRef {
  return {
    evidenceId,
    kind,
    uri,
    summary,
    createdAt: capturedAt,
  }
}

function hashOutput(output: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex')
}

function extractModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(normalizeText(a).split(' ').filter(Boolean))
  const right = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) {
    return 0
  }
  const intersection = [...left].filter(token => right.has(token)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function buildJudgeReports(
  runId: string,
  nodeId: string,
  output: Record<string, unknown>,
  capturedAt: string,
): JudgeReport[] {
  if (nodeId === 'DEBATE') {
    const finalSummary = typeof output.finalSummary === 'string' ? output.finalSummary.trim() : ''
    const disagreementPoints = Array.isArray(output.disagreementPoints) ? output.disagreementPoints : []
    const candidateOptions = Array.isArray(output.candidateOptions) ? output.candidateOptions : []
    const completenessScore =
      (finalSummary.length >= 80 ? 0.4 : Math.min(finalSummary.length / 80, 0.4)) +
      (disagreementPoints.length > 0 ? 0.3 : 0) +
      (candidateOptions.length >= 2 ? 0.3 : 0)
    return [{
      judgeReportId: `${runId}:${nodeId}:judge`,
      judge: 'debate-structure-guard',
      verdict: completenessScore >= 0.75 ? 'agree' : 'partial',
      confidence: Math.max(0, Math.min(1, completenessScore)),
      rationale: finalSummary.length > 0
        ? finalSummary.slice(0, 240)
        : 'Debate summary produced without an explicit final summary.',
      evidenceIds: [],
      createdAt: capturedAt,
    }]
  }

  if (nodeId === 'VERIFY') {
    const compliance = typeof output.complianceCheck === 'string'
      ? output.complianceCheck.toUpperCase()
      : 'PASS'
    const assurance = typeof output.assuranceVerdict === 'string'
      ? output.assuranceVerdict.toUpperCase()
      : 'REVISE'
    const oracleResults = Array.isArray(output.oracleResults) ? output.oracleResults : []
    const hasOraclePass = oracleResults.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).passed === true)
    return [{
      judgeReportId: `${runId}:${nodeId}:judge`,
      judge: 'verification-structure-guard',
      verdict: compliance === 'VIOLATION'
        ? 'needs_human'
        : assurance === 'PASS' || hasOraclePass
          ? 'agree'
          : 'partial',
      confidence: compliance === 'VIOLATION' ? 0.95 : assurance === 'PASS' || hasOraclePass ? 0.82 : 0.65,
      rationale: `assurance=${assurance}; compliance=${compliance}; oraclePass=${hasOraclePass}`,
      evidenceIds: [],
      createdAt: capturedAt,
    }]
  }

  if (nodeId === 'HITL') {
    const needsHuman = output.approvalRequired === true
    return [{
      judgeReportId: `${runId}:${nodeId}:judge`,
      judge: 'human-gate',
      verdict: needsHuman ? 'needs_human' : 'agree',
      confidence: 1,
      rationale: typeof output.gateStatus === 'string'
        ? output.gateStatus
        : needsHuman
          ? 'needsHumanReview'
          : 'autoCleared',
      evidenceIds: [],
      createdAt: capturedAt,
    }]
  }

  return []
}

function buildArtifacts(
  runId: string,
  nodeId: string,
  output: Record<string, unknown>,
  capturedAt: string,
  outputDigest: string,
): ArtifactRef[] {
  switch (nodeId) {
    case 'ANALYZE':
      return [createArtifact(runId, nodeId, 'analysis-report', 'report', capturedAt, outputDigest, 'Normalized Antigravity task analysis.')]
    case 'PARALLEL':
      return [createArtifact(runId, nodeId, 'parallel-receipts', 'receipt', capturedAt, outputDigest, 'Dual-model parallel execution receipts.')]
    case 'DEBATE':
      return [createArtifact(runId, nodeId, 'debate-summary', 'report', capturedAt, outputDigest, 'Consensus-backed debate summary.')]
    case 'VERIFY':
      return [createArtifact(runId, nodeId, 'verification-receipt', 'receipt', capturedAt, outputDigest, 'Independent verification verdict.')]
    case 'SYNTHESIZE':
      return [createArtifact(runId, nodeId, 'final-answer', 'report', capturedAt, outputDigest, 'Artifact-backed final answer for Antigravity.')]
    case 'PERSIST':
      return [createArtifact(runId, nodeId, 'artifact-manifest', 'bundle', capturedAt, outputDigest, 'Persisted run projection and manifest bundle.')]
    case 'HITL':
      return [createArtifact(runId, nodeId, 'release-gate', 'receipt', capturedAt, outputDigest, 'Final Antigravity release gate result.')]
    default:
      return [createArtifact(runId, nodeId, 'output', 'other', capturedAt, outputDigest)]
  }
}

function buildEvidence(
  runId: string,
  nodeId: string,
  output: Record<string, unknown>,
  invocation: WorkflowInvocation,
  capturedAt: string,
  traceId: string,
): EvidenceRef[] {
  const evidence: EvidenceRef[] = [
    createEvidence(
      `${runId}:${nodeId}:trace`,
      'trace_span',
      `trace://${traceId}`,
      capturedAt,
      `${nodeId} trace span`,
    ),
  ]

  if (nodeId === 'ANALYZE') {
    evidence.push(
      createEvidence(
        `${runId}:${nodeId}:goal`,
        'other',
        `run://${runId}/goal`,
        capturedAt,
        invocation.goal,
      ),
      createEvidence(
        `${runId}:${nodeId}:workspace-root`,
        'file',
        pathToFileURL(invocation.workspaceRoot).toString(),
        capturedAt,
        'workspace-root',
      ),
    )
  }

  if (nodeId === 'PARALLEL') {
    const codex = output.codex as Record<string, unknown> | undefined
    const gemini = output.gemini as Record<string, unknown> | undefined
    if (codex?.taskId) {
      evidence.push(createEvidence(
        `${runId}:${nodeId}:codex`,
        'tool_receipt',
        `tool://${String(codex.modelId ?? 'codex')}/${String(codex.taskId)}`,
        capturedAt,
        typeof codex.summary === 'string' ? codex.summary.slice(0, 240) : 'codex parallel receipt',
      ))
    }
    if (gemini?.taskId) {
      evidence.push(createEvidence(
        `${runId}:${nodeId}:gemini`,
        'tool_receipt',
        `tool://${String(gemini.modelId ?? 'gemini')}/${String(gemini.taskId)}`,
        capturedAt,
        typeof gemini.summary === 'string' ? gemini.summary.slice(0, 240) : 'gemini parallel receipt',
      ))
    }
  }

  if (nodeId === 'DEBATE' || nodeId === 'VERIFY' || nodeId === 'HITL') {
    evidence.push(createEvidence(
      `${runId}:${nodeId}:judge`,
      'judge_report',
      `run://${runId}/nodes/${nodeId.toLowerCase()}/judge`,
      capturedAt,
      typeof output.finalSummary === 'string'
        ? output.finalSummary.slice(0, 240)
        : typeof output.gateStatus === 'string'
          ? output.gateStatus
          : typeof output.assuranceVerdict === 'string'
            ? output.assuranceVerdict
            : `${nodeId} judge signal`,
    ))
  }

  return evidence
}

export function createExecutionReceipt(context: ReceiptContext): ExecutionReceipt {
  const outputDigest = hashOutput(context.result.output)
  const artifacts = buildArtifacts(
    context.runId,
    context.nodeId,
    context.result.output,
    context.capturedAt,
    outputDigest,
  )
  const evidence = buildEvidence(
    context.runId,
    context.nodeId,
    context.result.output,
    context.invocation,
    context.capturedAt,
    context.traceId,
  )
  const judgeReports = context.judgeReports ?? buildJudgeReports(
    context.runId,
    context.nodeId,
    context.result.output,
    context.capturedAt,
  )

  return {
    receiptId: crypto.randomUUID(),
    runId: context.runId,
    nodeId: context.nodeId,
    status: context.nodeId === 'HITL' && context.result.output.approvalRequired === true ? 'paused_for_human' : 'completed',
    traceId: context.traceId,
    model: context.result.model,
    durationMs: context.result.durationMs,
    outputHash: outputDigest,
    artifacts,
    evidence,
    tribunal: context.tribunal,
    judgeReports,
    capturedAt: context.capturedAt,
  }
}

export function createSkipDecision(params: {
  runId: string
  nodeId: string
  strategyId: string
  triggerCondition: string
  approvedBy: string
  traceId: string
  decidedAt: string
  reason: string
  evidence?: EvidenceRef[]
}): SkipDecision {
  return {
    skipDecisionId: crypto.randomUUID(),
    runId: params.runId,
    nodeId: params.nodeId,
    strategyId: params.strategyId,
    triggerCondition: params.triggerCondition,
    approvedBy: params.approvedBy,
    traceId: params.traceId,
    evidence: params.evidence ?? [
      createEvidence(
        `${params.runId}:${params.nodeId}:policy-skip`,
        'other',
        `run://${params.runId}/skip-decisions/${params.nodeId.toLowerCase()}`,
        params.decidedAt,
        params.reason,
      ),
    ],
    decidedAt: params.decidedAt,
    reason: params.reason,
  }
}

export function createSkipExecutionReceipt(params: {
  runId: string
  nodeId: string
  decision: SkipDecision
  capturedAt: string
}): ExecutionReceipt {
  const outputDigest = hashOutput({
    skipDecisionId: params.decision.skipDecisionId,
    reason: params.decision.reason,
    strategyId: params.decision.strategyId,
    triggerCondition: params.decision.triggerCondition,
  })

  const policyEvidence = createEvidence(
    `${params.runId}:${params.nodeId}:skip-decision`,
    'other',
    `run://${params.runId}/skip-decisions/${params.decision.skipDecisionId}`,
    params.capturedAt,
    params.decision.reason,
  )
  const artifacts = [
    createArtifact(
      params.runId,
      params.nodeId,
      'policy-skip-receipt',
      'receipt',
      params.capturedAt,
      outputDigest,
      'Policy-authorized skip receipt.',
    ),
  ]
  const judgeReports: JudgeReport[] = [{
    judgeReportId: `${params.runId}:${params.nodeId}:policy-judge`,
    judge: 'daemon-policy-engine',
    verdict: 'agree',
    confidence: 1,
    rationale: `${params.decision.strategyId}: ${params.decision.reason}`,
    evidenceIds: [...params.decision.evidence.map(item => item.evidenceId), policyEvidence.evidenceId],
    createdAt: params.capturedAt,
  }]

  return {
    receiptId: crypto.randomUUID(),
    runId: params.runId,
    nodeId: params.nodeId,
    status: 'policy_skipped',
    traceId: params.decision.traceId,
    model: `policy:${params.decision.strategyId}`,
    durationMs: 0,
    outputHash: outputDigest,
    artifacts,
    evidence: [...params.decision.evidence, policyEvidence],
    judgeReports,
    capturedAt: params.capturedAt,
  }
}

export function createHandoffEnvelopes(params: {
  runId: string
  nodeId: string
  definition: WorkflowDefinition
  receipt: ExecutionReceipt
  capturedAt: string
}): HandoffEnvelope[] {
  return params.definition.steps
    .filter(step => step.dependsOn.includes(params.nodeId))
    .map(step => ({
      handoffId: `${params.runId}:${params.nodeId}:${step.id}`,
      runId: params.runId,
      sourceNodeId: params.nodeId,
      targetNodeId: step.id,
      traceId: params.receipt.traceId,
      artifactIds: params.receipt.artifacts.map(item => item.artifactId),
      evidenceIds: params.receipt.evidence.map(item => item.evidenceId),
      budgetState: {
        sourceBudgetClass: params.definition.steps.find(item => item.id === params.nodeId)?.budgetClass,
        targetBudgetClass: step.budgetClass,
      },
      priorJudgeSignals: params.receipt.judgeReports,
      createdAt: params.capturedAt,
    }))
}

function requirementSatisfied(
  requirement: string,
  nodeId: string,
  receipt: ExecutionReceipt | undefined,
  state: WorkflowState | null,
  receiptsByNode: Map<string, ExecutionReceipt>,
): boolean {
  const analyzeReceipt = receiptsByNode.get('ANALYZE')
  const parallelReceipt = receiptsByNode.get('PARALLEL')
  const debateReceipt = receiptsByNode.get('DEBATE')
  const verifyReceipt = receiptsByNode.get('VERIFY')
  const persistReceipt = receiptsByNode.get('PERSIST')
  const hitlReceipt = receiptsByNode.get('HITL')

  if (requirement === 'goal') {
    return analyzeReceipt?.evidence.some(item =>
      item.evidenceId.endsWith(':goal') &&
      item.kind === 'other' &&
      item.uri.startsWith('run://') &&
      (item.summary?.trim().length ?? 0) >= 20
    ) ?? false
  }
  if (requirement === 'workspace-root') {
    return analyzeReceipt?.evidence.some(item =>
      item.evidenceId.endsWith(':workspace-root') &&
      item.kind === 'file' &&
      item.summary === 'workspace-root' &&
      item.uri.startsWith('file:')
    ) ?? false
  }
  if (requirement === 'analysis-receipt') {
    return Boolean(analyzeReceipt?.outputHash) &&
      (analyzeReceipt?.artifacts.some(item => item.artifactId.endsWith('analysis-report')) ?? false)
  }
  if (requirement === 'parallel-receipts') {
    const toolReceipts = parallelReceipt?.evidence.filter(item => item.kind === 'tool_receipt') ?? []
    const parallelOutput = state?.nodes.PARALLEL?.output as Record<string, unknown> | undefined
    const codex = parallelOutput?.codex as Record<string, unknown> | undefined
    const gemini = parallelOutput?.gemini as Record<string, unknown> | undefined
    const codexFamily = extractModelFamily(typeof codex?.modelId === 'string' ? codex.modelId : undefined)
    const geminiFamily = extractModelFamily(typeof gemini?.modelId === 'string' ? gemini.modelId : undefined)
    const codexSummary = typeof codex?.summary === 'string' ? codex.summary : ''
    const geminiSummary = typeof gemini?.summary === 'string' ? gemini.summary : ''
    return toolReceipts.length >= 2 &&
      toolReceipts.every(item => item.uri.startsWith('tool://') && (item.summary?.trim().length ?? 0) >= 20) &&
      codexFamily.length > 0 &&
      geminiFamily.length > 0 &&
      codexFamily !== geminiFamily &&
      typeof codex?.outputHash === 'string' &&
      typeof gemini?.outputHash === 'string' &&
      codex.outputHash !== gemini.outputHash &&
      lexicalSimilarity(codexSummary, geminiSummary) < 0.9
  }
  if (requirement === 'judge-signal') {
    const tribunals = [
      parallelReceipt?.tribunal,
      debateReceipt?.tribunal,
      verifyReceipt?.tribunal,
    ].filter((item): item is TribunalSummary => Boolean(item))
    if (tribunals.length > 0) {
      return tribunals.some(report => report.confidence >= 0.6 && report.rationale.trim().length >= 20)
    }
    const reports = [
      ...(parallelReceipt?.judgeReports ?? []),
      ...(debateReceipt?.judgeReports ?? []),
      ...(verifyReceipt?.judgeReports ?? []),
    ]
    return reports.some(report => report.confidence >= 0.6 && report.rationale.trim().length >= 20)
  }
  if (requirement === 'debate-summary') {
    const debateOutput = state?.nodes.DEBATE?.output as Record<string, unknown> | undefined
    return (debateReceipt?.artifacts.some(item => item.artifactId.endsWith('debate-summary')) ?? false) &&
      (typeof debateOutput?.finalSummary === 'string' && debateOutput.finalSummary.trim().length >= 80)
  }
  if (requirement === 'verification-receipt') {
    const verifyOutput = state?.nodes.VERIFY?.output as Record<string, unknown> | undefined
    const analyzeOutput = state?.nodes.ANALYZE?.output as Record<string, unknown> | undefined
    const challengerFamily = extractModelFamily(typeof verifyOutput?.challengerModelId === 'string' ? verifyOutput.challengerModelId : undefined)
    const parallelOutput = state?.nodes.PARALLEL?.output as Record<string, unknown> | undefined
    const upstreamFamilies = [
      extractModelFamily((parallelOutput?.codex as Record<string, unknown> | undefined)?.modelId as string | undefined),
      extractModelFamily((parallelOutput?.gemini as Record<string, unknown> | undefined)?.modelId as string | undefined),
    ].filter(Boolean)
    const oracleResults = Array.isArray(verifyOutput?.oracleResults) ? verifyOutput.oracleResults : []
    const hasOraclePass = oracleResults.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).passed === true)
    const verifiabilityClass = analyzeOutput?.verifiabilityClass
    return (verifyReceipt?.artifacts.some(item => item.artifactId.endsWith('verification-receipt')) ?? false) &&
      typeof verifyOutput?.verificationReceiptSummary === 'string' &&
      verifyOutput.verificationReceiptSummary.trim().length >= 40 &&
      challengerFamily.length > 0 &&
      !upstreamFamilies.includes(challengerFamily) &&
      (verifiabilityClass !== 'high' || hasOraclePass)
  }
  if (requirement === 'final-answer') {
    const value = state?.nodes.SYNTHESIZE?.output?.finalAnswer
    const summary = state?.nodes.SYNTHESIZE?.output?.summary
    return typeof value === 'string' && value.trim().length >= 80 &&
      typeof summary === 'string' && summary.trim().length >= 20
  }
  if (requirement === 'artifact-manifest') {
    const manifest = state?.nodes.PERSIST?.output?.artifactManifest as Record<string, unknown> | undefined
    return (persistReceipt?.artifacts.some(item => item.artifactId.endsWith('artifact-manifest')) ?? false) &&
      typeof manifest?.artifactCount === 'number' &&
      manifest.artifactCount >= 1
  }
  if (requirement === 'release-gate') {
    const gateStatus = state?.nodes.HITL?.output?.gateStatus
    return Boolean(hitlReceipt) && typeof gateStatus === 'string' && gateStatus.trim().length > 0
  }
  return receipt?.evidence.some(item =>
    (item.summary?.includes(requirement) ?? false) &&
    (item.summary?.trim().length ?? 0) >= 8 &&
    item.uri.includes('://')
  ) ?? false
}

export function evaluateReleaseGate(params: {
  definition: WorkflowDefinition
  receipts: ExecutionReceipt[]
  state: WorkflowState | null
}): ReleaseGateDecision {
  const receiptsByNode = new Map(params.receipts.map(receipt => [receipt.nodeId, receipt]))
  const rationale: string[] = []
  const evidenceIds = params.receipts.flatMap(receipt => receipt.evidence.map(item => item.evidenceId))

  for (const step of params.definition.steps) {
    const receipt = receiptsByNode.get(step.id)
    if (!receipt) {
      rationale.push(`missing execution receipt for ${step.id}`)
      continue
    }
    if (receipt.status === 'policy_skipped') {
      if (!step.skippable) {
        rationale.push(`mandatory step ${step.id} was policy skipped`)
      }
      if (receipt.evidence.length === 0) {
        rationale.push(`policy skipped step ${step.id} is missing skip evidence`)
      }
      continue
    }
    if (receipt.status === 'failed' || receipt.status === 'cancelled') {
      rationale.push(`step ${step.id} ended with ${receipt.status}`)
    }
    for (const requirement of step.evidenceRequirements) {
      if (!requirementSatisfied(requirement, step.id, receipt, params.state, receiptsByNode)) {
        rationale.push(`step ${step.id} is missing evidence requirement "${requirement}"`)
      }
    }
    if (step.modelContract?.judgeRequired) {
      const tribunal = receipt.tribunal
      if (!tribunal) {
        rationale.push(`step ${step.id} is missing tribunal summary`)
      } else {
        if (!tribunal.quorumSatisfied) {
          rationale.push(`step ${step.id} did not satisfy tribunal quorum`)
        }
        if (tribunal.mode !== 'remote') {
          rationale.push(`step ${step.id} tribunal mode ${tribunal.mode} does not satisfy remote-only release`)
        }
        if (tribunal.confidence < 0.6) {
          rationale.push(`step ${step.id} tribunal confidence ${tribunal.confidence.toFixed(2)} is below 0.60`)
        }
        if (tribunal.verdict === 'disagree' || tribunal.verdict === 'needs_human') {
          rationale.push(`step ${step.id} failed tribunal evaluation`)
        }
      }
    }
  }

  const verifyCompliance = params.state?.nodes.VERIFY?.output?.complianceCheck
  if (typeof verifyCompliance === 'string' && verifyCompliance.toUpperCase() === 'VIOLATION') {
    rationale.push('VERIFY reported compliance VIOLATION')
  }

  const finalAnswer = params.state?.nodes.SYNTHESIZE?.output?.finalAnswer
  if (typeof finalAnswer !== 'string' || finalAnswer.trim().length === 0) {
    rationale.push('SYNTHESIZE did not produce a finalAnswer artifact')
  }

  return {
    effect: rationale.length > 0 ? 'block' : 'allow',
    rationale,
    evidenceIds,
  }
}
