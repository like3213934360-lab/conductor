import { z } from 'zod'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import type { WorkflowAgentRuntime } from '@anthropic/antigravity-core'
import type { JudgeReport, WorkflowDefinition, WorkflowInvocation } from './schema.js'

type JudgeVerdict = JudgeReport['verdict']

interface JudgeScores {
  coherence: number
  faithfulness: number
  relevance: number
  completeness: number
  overall: number
}

interface JudgeEvaluationResult {
  verdict: JudgeVerdict
  confidence: number
  rationale: string
}

export interface IndependentJudgeInput {
  runId: string
  nodeId: string
  output: Record<string, unknown>
  state: WorkflowState | null
  invocation: WorkflowInvocation
  definition: WorkflowDefinition
  capturedAt: string
  agentRuntime?: WorkflowAgentRuntime
}

const ModelJudgeResponseSchema = z.object({
  verdict: z.enum(['agree', 'partial', 'disagree', 'needs_human']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(8),
  evidenceIds: z.array(z.string()).default([]),
  issues: z.array(z.string()).default([]),
  scores: z.object({
    coherence: z.number().min(0).max(1),
    faithfulness: z.number().min(0).max(1),
    relevance: z.number().min(0).max(1),
    completeness: z.number().min(0).max(1),
    overall: z.number().min(0).max(1),
  }).optional(),
}).passthrough()

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function lexicalSimilarity(a: string | undefined, b: string | undefined): number {
  const left = new Set(normalizeText(a).split(' ').filter(Boolean))
  const right = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) {
    return 0
  }
  const intersection = [...left].filter(token => right.has(token)).length
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function extractModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

function scoresToVerdict(scores: JudgeScores): JudgeEvaluationResult {
  const confidence = clamp(scores.overall)
  const verdict: JudgeVerdict =
    confidence >= 0.8
      ? 'agree'
      : confidence >= 0.6
        ? 'partial'
        : confidence >= 0.35
          ? 'disagree'
          : 'needs_human'
  const rationale = `overall=${confidence.toFixed(2)}; coherence=${scores.coherence.toFixed(2)}; faithfulness=${scores.faithfulness.toFixed(2)}; relevance=${scores.relevance.toFixed(2)}; completeness=${scores.completeness.toFixed(2)}`
  return { verdict, confidence, rationale }
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

function gatherForbiddenFamilies(input: IndependentJudgeInput): string[] {
  const step = findStep(input.definition, input.nodeId)
  const stageFamilies = new Set<string>()

  if (input.nodeId === 'PARALLEL') {
    const output = input.output
    const codex = output.codex as Record<string, unknown> | undefined
    const gemini = output.gemini as Record<string, unknown> | undefined
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

function extractJsonObject(text: string): unknown {
  const direct = text.trim()
  if (direct.startsWith('{') && direct.endsWith('}')) {
    return JSON.parse(direct)
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return JSON.parse(fenced[1])
  }
  const bare = text.match(/\{[\s\S]*\}/)
  if (bare?.[0]) {
    return JSON.parse(bare[0])
  }
  throw new Error('model judge did not return a JSON object')
}

function buildJudgePrompt(input: IndependentJudgeInput, heuristic: JudgeEvaluationResult): { message: string; systemPrompt: string } {
  const forbiddenFamilies = gatherForbiddenFamilies(input)
  const upstream = Object.entries(input.state?.nodes ?? {})
    .filter(([, node]) => node?.output)
    .map(([nodeId, node]) => ({ nodeId, status: node.status, output: node.output }))
  const systemPrompt = [
    'You are the independent Antigravity workflow judge.',
    'Return only valid JSON with keys: verdict, confidence, rationale, evidenceIds, issues, scores.',
    'Be conservative. If the evidence is weak, incomplete, or non-independent, lower the verdict.',
  ].join(' ')
  const message = JSON.stringify({
    task: 'independent_judge',
    runId: input.runId,
    nodeId: input.nodeId,
    goal: input.invocation.goal,
    heuristicBaseline: heuristic,
    forbiddenJudgeModelFamilies: forbiddenFamilies,
    output: input.output,
    upstream,
  }, null, 2)
  return { message, systemPrompt }
}

async function evaluateSingleModelJudge(
  input: IndependentJudgeInput,
  heuristic: JudgeEvaluationResult,
  agentRuntime: WorkflowAgentRuntime,
  modelHint: string,
  forbiddenFamilies: string[],
  message: string,
  systemPrompt: string,
): Promise<JudgeReport> {
  try {
    const response = await agentRuntime.ask({
      message,
      modelHint,
      systemPrompt,
    })
    const parsed = ModelJudgeResponseSchema.parse(extractJsonObject(response.text))
    const usedFamily = extractModelFamily(response.usedModel)
    if (usedFamily && forbiddenFamilies.includes(usedFamily)) {
      return {
        judgeReportId: `${input.runId}:${input.nodeId}:independent-judge:model-conflict`,
        judge: 'independent-judge:model-conflict',
        verdict: 'needs_human',
        confidence: Math.min(heuristic.confidence, 0.25),
        rationale: `model-backed judge used forbidden family ${usedFamily}; forbidden families=${forbiddenFamilies.join(', ')}`,
        evidenceIds: parsed.evidenceIds,
        createdAt: input.capturedAt,
      }
    }

    const verdict = worseVerdict(parsed.verdict, heuristic.verdict)
    const confidence = clamp(Math.min(parsed.confidence, (parsed.confidence + heuristic.confidence) / 2))
    const rationale = [
      `model=${response.usedModel}`,
      `modelVerdict=${parsed.verdict}/${parsed.confidence.toFixed(2)}`,
      `heuristicVerdict=${heuristic.verdict}/${heuristic.confidence.toFixed(2)}`,
      parsed.rationale,
      heuristic.rationale,
      parsed.issues.length > 0 ? `issues=${parsed.issues.join(' | ')}` : undefined,
    ].filter(Boolean).join('; ')

    return {
      judgeReportId: `${input.runId}:${input.nodeId}:independent-judge:model`,
      judge: `independent-judge:model:${response.usedModel}`,
      verdict,
      confidence,
      rationale,
      evidenceIds: parsed.evidenceIds,
      createdAt: input.capturedAt,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      judgeReportId: `${input.runId}:${input.nodeId}:independent-judge:model-fallback`,
      judge: 'independent-judge:model-fallback',
      verdict: heuristic.verdict,
      confidence: heuristic.confidence,
      rationale: `${heuristic.rationale}; model-backed judge unavailable: ${reason}`,
      evidenceIds: [],
      createdAt: input.capturedAt,
    }
  }
}

function buildQuorumReport(
  input: IndependentJudgeInput,
  heuristic: JudgeEvaluationResult,
  reports: JudgeReport[],
): JudgeReport {
  const successfulModelReports = reports.filter(report =>
    report.judge.startsWith('independent-judge:model:') &&
    !report.judge.includes(':fallback') &&
    !report.judge.includes(':conflict'),
  )

  if (reports.some(report => report.verdict === 'needs_human')) {
    return {
      judgeReportId: `${input.runId}:${input.nodeId}:independent-judge:quorum`,
      judge: 'independent-judge:quorum',
      verdict: 'needs_human',
      confidence: Math.min(
        heuristic.confidence,
        reports.reduce((lowest, report) => Math.min(lowest, report.confidence), 1),
      ),
      rationale: `quorum blocked by judge conflict or human-escalation; reports=${reports.map(report => `${report.judge}:${report.verdict}/${report.confidence.toFixed(2)}`).join(', ')}`,
      evidenceIds: [...new Set(reports.flatMap(report => report.evidenceIds))],
      createdAt: input.capturedAt,
    }
  }

  const consensusVerdict = reports.reduce<JudgeVerdict>(
    (current, report) => worseVerdict(current, report.verdict),
    heuristic.verdict,
  )
  const confidenceInputs = [
    heuristic.confidence,
    ...successfulModelReports.map(report => report.confidence),
  ]
  const confidence = clamp(average(confidenceInputs))
  return {
    judgeReportId: `${input.runId}:${input.nodeId}:independent-judge:quorum`,
    judge: 'independent-judge:quorum',
    verdict: consensusVerdict,
    confidence,
    rationale: [
      `heuristic=${heuristic.verdict}/${heuristic.confidence.toFixed(2)}`,
      ...reports.map(report => `${report.judge}=${report.verdict}/${report.confidence.toFixed(2)}`),
    ].join('; '),
    evidenceIds: [...new Set(reports.flatMap(report => report.evidenceIds))],
    createdAt: input.capturedAt,
  }
}

async function evaluateModelBackedJudges(
  input: IndependentJudgeInput,
  heuristic: JudgeEvaluationResult,
): Promise<JudgeReport[]> {
  const agentRuntime = input.agentRuntime
  if (!agentRuntime) {
    return []
  }

  const step = findStep(input.definition, input.nodeId)
  if (!step?.modelContract?.judgeRequired) {
    return []
  }

  const judgeModelHints = step.modelContract.judgeModelHints.length > 0
    ? step.modelContract.judgeModelHints
    : ['judge']
  const forbiddenFamilies = gatherForbiddenFamilies(input)
  const { message, systemPrompt } = buildJudgePrompt(input, heuristic)
  const reports = await Promise.all(
    judgeModelHints.map(modelHint =>
      evaluateSingleModelJudge(input, heuristic, agentRuntime, modelHint, forbiddenFamilies, message, systemPrompt),
    ),
  )
  return [buildQuorumReport(input, heuristic, reports), ...reports]
}

function evaluateParallel(output: Record<string, unknown>, goal: string): JudgeScores {
  const codex = output.codex as Record<string, unknown> | undefined
  const gemini = output.gemini as Record<string, unknown> | undefined
  const codexSummary = typeof codex?.summary === 'string' ? codex.summary : ''
  const geminiSummary = typeof gemini?.summary === 'string' ? gemini.summary : ''
  const codexFamily = extractModelFamily(typeof codex?.modelId === 'string' ? codex.modelId : undefined)
  const geminiFamily = extractModelFamily(typeof gemini?.modelId === 'string' ? gemini.modelId : undefined)
  const distinctFamilies = codexFamily.length > 0 && geminiFamily.length > 0 && codexFamily !== geminiFamily
  const similarity = lexicalSimilarity(codexSummary, geminiSummary)
  const summaryQuality = average([
    codexSummary.length >= 20 ? 1 : codexSummary.length / 20,
    geminiSummary.length >= 20 ? 1 : geminiSummary.length / 20,
  ])

  return {
    coherence: clamp(1 - similarity),
    faithfulness: clamp(distinctFamilies ? 1 : 0.2),
    relevance: clamp(goal.trim().length > 0 && (codexSummary.length > 0 || geminiSummary.length > 0) ? 0.8 : 0.3),
    completeness: clamp(summaryQuality),
    overall: average([
      clamp(1 - similarity),
      distinctFamilies ? 1 : 0.2,
      summaryQuality,
      goal.trim().length > 0 ? 0.8 : 0.3,
    ]),
  }
}

function evaluateDebate(output: Record<string, unknown>): JudgeScores {
  const finalSummary = typeof output.finalSummary === 'string' ? output.finalSummary.trim() : ''
  const disagreementPoints = Array.isArray(output.disagreementPoints) ? output.disagreementPoints : []
  const candidateOptions = Array.isArray(output.candidateOptions) ? output.candidateOptions : []
  const selectedOption = typeof output.selectedOption === 'string' ? output.selectedOption.trim() : ''
  const stabilityAchieved = output.stabilityAchieved === true
  const compensationRequested = output.compensationRequested === true
  const stabilityScore = typeof output.stabilityScore === 'number' ? clamp(output.stabilityScore) : 0

  const baseScores = {
    coherence: clamp(finalSummary.length >= 80 ? 1 : finalSummary.length / 80),
    faithfulness: clamp(disagreementPoints.length > 0 ? 0.9 : 0.3),
    relevance: clamp(candidateOptions.length >= 2 ? 0.9 : 0.4),
    completeness: clamp(selectedOption.length > 0 ? 0.9 : 0.3),
    overall: average([
      finalSummary.length >= 80 ? 1 : finalSummary.length / 80,
      disagreementPoints.length > 0 ? 0.9 : 0.3,
      candidateOptions.length >= 2 ? 0.9 : 0.4,
      selectedOption.length > 0 ? 0.9 : 0.3,
      stabilityAchieved ? Math.max(0.85, stabilityScore) : stabilityScore,
    ]),
  }
  if (!stabilityAchieved || compensationRequested) {
    return {
      ...baseScores,
      overall: Math.min(baseScores.overall, compensationRequested ? 0.34 : 0.59),
    }
  }
  return baseScores
}

function evaluateVerify(output: Record<string, unknown>, state: WorkflowState | null): JudgeScores {
  const summary = typeof output.verificationReceiptSummary === 'string' ? output.verificationReceiptSummary.trim() : ''
  const challengerFamily = extractModelFamily(typeof output.challengerModelId === 'string' ? output.challengerModelId : undefined)
  const parallelOutput = state?.nodes.PARALLEL?.output as Record<string, unknown> | undefined
  const upstreamFamilies = [
    extractModelFamily((parallelOutput?.codex as Record<string, unknown> | undefined)?.modelId as string | undefined),
    extractModelFamily((parallelOutput?.gemini as Record<string, unknown> | undefined)?.modelId as string | undefined),
  ].filter(Boolean)
  const distinctVerifier = challengerFamily.length > 0 && !upstreamFamilies.includes(challengerFamily)
  const oracleResults = Array.isArray(output.oracleResults) ? output.oracleResults : []
  const oraclePass = oracleResults.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).passed === true)
  const compliance = typeof output.complianceCheck === 'string' ? output.complianceCheck.toUpperCase() : 'PASS'

  const baseScores = {
    coherence: clamp(summary.length >= 40 ? 1 : summary.length / 40),
    faithfulness: clamp(distinctVerifier ? 1 : 0.1),
    relevance: clamp(compliance === 'PASS' ? 0.8 : compliance === 'WARN' ? 0.6 : 0.2),
    completeness: clamp(oraclePass ? 1 : 0.5),
    overall: average([
      summary.length >= 40 ? 1 : summary.length / 40,
      distinctVerifier ? 1 : 0.1,
      compliance === 'PASS' ? 0.8 : compliance === 'WARN' ? 0.6 : 0.2,
      oraclePass ? 1 : 0.5,
    ]),
  }
  if (!distinctVerifier) {
    return {
      ...baseScores,
      overall: Math.min(baseScores.overall, 0.3),
    }
  }
  return baseScores
}

function heuristicJudge(input: IndependentJudgeInput): JudgeEvaluationResult {
  if (input.nodeId === 'PARALLEL') {
    return scoresToVerdict(evaluateParallel(input.output, input.invocation.goal))
  }
  if (input.nodeId === 'DEBATE') {
    return scoresToVerdict(evaluateDebate(input.output))
  }
  return scoresToVerdict(evaluateVerify(input.output, input.state))
}

export async function evaluateIndependentJudge(input: IndependentJudgeInput): Promise<JudgeReport[]> {
  if (!['PARALLEL', 'DEBATE', 'VERIFY'].includes(input.nodeId)) {
    return []
  }

  const heuristic = heuristicJudge(input)
  const modelBacked = await evaluateModelBackedJudges(input, heuristic)
  if (modelBacked.length > 0) {
    return modelBacked
  }

  return [{
    judgeReportId: `${input.runId}:${input.nodeId}:independent-judge`,
    judge: 'independent-judge',
    verdict: heuristic.verdict,
    confidence: heuristic.confidence,
    rationale: heuristic.rationale,
    evidenceIds: [],
    createdAt: input.capturedAt,
  }]
}
