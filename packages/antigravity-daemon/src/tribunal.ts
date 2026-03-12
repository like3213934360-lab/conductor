import * as crypto from 'node:crypto'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import type { WorkflowAgentRuntime } from '@anthropic/antigravity-core'
import type {
  JudgeReport,
  TribunalVerdictRecord,
  WorkflowDefinition,
  WorkflowInvocation,
} from './schema.js'
import { evaluateIndependentJudge } from './independent-judge.js'
import type { RemoteTribunalJudgeResult } from './remote-worker.js'
import { RemoteWorkerDirectory } from './remote-worker.js'

type JudgeVerdict = JudgeReport['verdict']

export interface TribunalEvaluationInput {
  runId: string
  nodeId: string
  output: Record<string, unknown>
  state: WorkflowState | null
  invocation: WorkflowInvocation
  definition: WorkflowDefinition
  capturedAt: string
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function extractModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

function verdictSeverity(verdict: JudgeVerdict): number {
  switch (verdict) {
    case 'agree':
      return 3
    case 'partial':
      return 2
    case 'disagree':
      return 1
    case 'needs_human':
      return 0
  }
}

function worseVerdict(left: JudgeVerdict, right: JudgeVerdict): JudgeVerdict {
  return verdictSeverity(left) <= verdictSeverity(right) ? left : right
}

function findStep(definition: WorkflowDefinition, nodeId: string) {
  return definition.steps.find(step => step.id === nodeId)
}

function gatherForbiddenFamilies(input: TribunalEvaluationInput): string[] {
  const step = findStep(input.definition, input.nodeId)
  const stageFamilies = new Set<string>()

  if (input.nodeId === 'PARALLEL') {
    const codex = input.output.codex as Record<string, unknown> | undefined
    const gemini = input.output.gemini as Record<string, unknown> | undefined
    stageFamilies.add(extractModelFamily(typeof codex?.modelId === 'string' ? codex.modelId : undefined))
    stageFamilies.add(extractModelFamily(typeof gemini?.modelId === 'string' ? gemini.modelId : undefined))
  }

  for (const upstreamId of step?.modelContract?.requiresDistinctFromStages ?? []) {
    const upstreamOutput = input.state?.nodes[upstreamId]?.output as Record<string, unknown> | undefined
    if (!upstreamOutput) {
      continue
    }
    if (upstreamId === 'PARALLEL') {
      const codex = upstreamOutput.codex as Record<string, unknown> | undefined
      const gemini = upstreamOutput.gemini as Record<string, unknown> | undefined
      stageFamilies.add(extractModelFamily(typeof codex?.modelId === 'string' ? codex.modelId : undefined))
      stageFamilies.add(extractModelFamily(typeof gemini?.modelId === 'string' ? gemini.modelId : undefined))
      continue
    }
    stageFamilies.add(extractModelFamily(typeof upstreamOutput.modelId === 'string' ? upstreamOutput.modelId : undefined))
    stageFamilies.add(extractModelFamily(typeof upstreamOutput.challengerModelId === 'string' ? upstreamOutput.challengerModelId : undefined))
  }

  return [...stageFamilies].filter(Boolean)
}

function buildUpstreamOutputs(input: TribunalEvaluationInput): Record<string, Record<string, unknown>> {
  const step = findStep(input.definition, input.nodeId)
  return Object.fromEntries(
    (step?.dependsOn ?? [])
      .map(dep => [dep, input.state?.nodes[dep]?.output])
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1] && typeof entry[1] === 'object')),
  )
}

function subjectOutputHash(output: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex')
}

function summarizeRemoteMode(
  input: TribunalEvaluationInput,
  remoteReports: RemoteTribunalJudgeResult[],
  failures: string[],
  localReports: JudgeReport[],
  forbiddenFamilies: string[],
): TribunalVerdictRecord {
  const remoteWorkers = new Set(remoteReports.map(report => report.workerId))
  const distinctFamilies = new Set(remoteReports.map(report => report.modelFamily).filter(Boolean))
  const familyConflict = remoteReports.some(report =>
    !report.modelFamily || forbiddenFamilies.includes(report.modelFamily),
  ) || (remoteReports.length >= 2 && distinctFamilies.size < remoteReports.length)
  const remoteNeedsHuman = remoteReports.some(report => report.report.verdict === 'needs_human')
  const remoteQuorumSatisfied =
    remoteReports.length >= 2 &&
    remoteWorkers.size >= 2 &&
    distinctFamilies.size >= 2 &&
    failures.length === 0

  const fallbackUsed = !remoteQuorumSatisfied
  const mode =
    remoteQuorumSatisfied
      ? 'remote'
      : remoteReports.length > 0
        ? 'hybrid'
        : 'local-fallback'
  const jurorReports = [
    ...remoteReports.map(report => report.report),
    ...(fallbackUsed ? localReports : []),
  ]
  const verdictInputs = jurorReports.map(report => report.verdict)
  const baseVerdict = verdictInputs.reduce<JudgeVerdict>(worseVerdict, 'agree')
  const verdict =
    familyConflict || remoteNeedsHuman || failures.length > 0
      ? 'needs_human'
      : baseVerdict
  const confidenceInputs = jurorReports.map(report => report.confidence)
  const confidence = clamp(
    remoteQuorumSatisfied
      ? average(confidenceInputs)
      : average(confidenceInputs.length > 0 ? confidenceInputs : [0]),
  )

  return {
    tribunalId: `${input.runId}:${input.nodeId}:tribunal`,
    runId: input.runId,
    nodeId: input.nodeId,
    mode,
    verdict,
    confidence,
    quorumSatisfied: remoteQuorumSatisfied,
    remoteJurorCount: remoteReports.length,
    totalJurorCount: jurorReports.length,
    rationale: [
      `mode=${mode}`,
      `remoteJurors=${remoteReports.length}`,
      `distinctWorkers=${remoteWorkers.size}`,
      `distinctFamilies=${distinctFamilies.size}`,
      familyConflict ? `familyConflict=forbidden:${forbiddenFamilies.join(',') || 'none'}` : undefined,
      failures.length > 0 ? `failures=${failures.join(' | ')}` : undefined,
      ...jurorReports.map(report => `${report.judge}=${report.verdict}/${report.confidence.toFixed(2)}`),
    ].filter(Boolean).join('; '),
    evidenceIds: [...new Set(jurorReports.flatMap(report => report.evidenceIds))],
    jurorReportIds: jurorReports.map(report => report.judgeReportId),
    createdAt: input.capturedAt,
    subjectOutputHash: subjectOutputHash(input.output),
    fallbackUsed,
    jurorReports,
  }
}

export class TribunalService {
  constructor(
    private readonly remoteWorkers: RemoteWorkerDirectory,
    private readonly agentRuntime?: WorkflowAgentRuntime,
  ) {}

  async evaluate(input: TribunalEvaluationInput): Promise<TribunalVerdictRecord | undefined> {
    const step = findStep(input.definition, input.nodeId)
    if (!step?.modelContract?.judgeRequired) {
      return undefined
    }

    const heuristicReports = await evaluateIndependentJudge({
      ...input,
      agentRuntime: undefined,
    })
    const heuristicBaseline = heuristicReports[0]
    if (!heuristicBaseline) {
      return undefined
    }

    const forbiddenFamilies = gatherForbiddenFamilies(input)
    const remote = await this.remoteWorkers.delegateTribunal({
      runId: input.runId,
      nodeId: input.nodeId,
      goal: input.invocation.goal,
      capturedAt: input.capturedAt,
      subjectOutput: input.output,
      upstreamOutputs: buildUpstreamOutputs(input),
      heuristicBaseline: {
        verdict: heuristicBaseline.verdict,
        confidence: heuristicBaseline.confidence,
        rationale: heuristicBaseline.rationale,
      },
      forbiddenJudgeModelFamilies: forbiddenFamilies,
      signal: undefined,
    })

    const localReports =
      remote.reports.length >= 2 && remote.failures.length === 0
        ? []
        : await evaluateIndependentJudge({
            ...input,
            agentRuntime: this.agentRuntime,
          })

    return summarizeRemoteMode(
      input,
      remote.reports,
      remote.failures,
      localReports,
      forbiddenFamilies,
    )
  }
}
