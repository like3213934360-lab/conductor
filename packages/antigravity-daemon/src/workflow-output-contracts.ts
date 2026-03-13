import { z } from 'zod'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import type { WorkflowStepDefinition } from './schema.js'

const AnalyzeOutputSchema = z.object({
  taskType: z.string().min(1),
  taskAnalysis: z.string().min(50),
  riskAssessment: z.enum(['low', 'medium', 'high', 'critical']),
  routePath: z.enum(['fastTrack', 'debate', 'debateVerify', 'hitl']),
  tokenBudget: z.enum(['S', 'M', 'L']),
  taskClass: z.enum(['analysis', 'code', 'text', 'structured-data', 'governance']),
  verifiabilityClass: z.enum(['low', 'medium', 'high']),
  fileList: z.array(z.string().min(1)).min(1),
  keyConstraints: z.array(z.string().min(8)).min(1),
}).passthrough()

const ParallelWorkerOutputSchema = z.object({
  modelId: z.string().min(1),
  taskId: z.string().min(1),
  status: z.enum(['success', 'error', 'timeout']),
  summary: z.string().min(20).optional(),
  outputHash: z.string().min(32),
  confidence: z.number().min(0).max(100).optional(),
  optionId: z.string().min(1).optional(),
}).passthrough()

const ParallelOutputSchema = z.object({
  executionMode: z.literal('dual_model_parallel'),
  codex: ParallelWorkerOutputSchema,
  gemini: ParallelWorkerOutputSchema,
  bothAvailable: z.boolean(),
  disagreementScore: z.number().min(0).max(1),
  skipAllowed: z.boolean(),
}).passthrough()

const DebateOutputSchema = z.object({
  debateRounds: z.number().int().positive(),
  convergenceScore: z.number().min(0).max(1),
  collusionCheck: z.enum(['PASS', 'WARN', 'FAIL']),
  finalSummary: z.string().min(80),
  winner: z.string().min(1),
  disagreementPoints: z.array(z.string().min(8)).min(1),
  candidateOptions: z.array(z.string().min(1)).min(2),
  selectedOption: z.string().min(1),
}).passthrough()

const OracleResultSchema = z.object({
  tool: z.string().min(1),
  passed: z.boolean(),
  output: z.string().min(1),
  exitCode: z.number().int(),
}).passthrough()

const VerifyOutputSchema = z.object({
  assuranceVerdict: z.enum(['PASS', 'REVISE']),
  verdict: z.enum(['AGREE', 'PARTIAL', 'DISAGREE']),
  challengerModelId: z.string().min(1),
  // PR-01: additive field — pre-extracted model family for distinct-family checks
  challengerModelFamily: z.string().optional(),
  complianceCheck: z.enum(['PASS', 'WARN', 'VIOLATION']),
  verificationReceiptSummary: z.string().min(40),
  findings: z.array(z.object({
    type: z.enum(['warning', 'error', 'info']),
    message: z.string().min(8),
  })).default([]),
  failureReasons: z.array(z.string()).default([]),
  oracleResults: z.array(OracleResultSchema).default([]),
}).passthrough()

const SynthesizeOutputSchema = z.object({
  finalAnswer: z.string().min(80),
  summary: z.string().min(20),
  finalConfidence: z.number().min(0).max(100),
  releaseDecision: z.enum(['release', 'hold']),
  citedEvidenceIds: z.array(z.string().min(1)).min(1),
}).passthrough()

const PersistOutputSchema = z.object({
  manifestUpdated: z.boolean(),
  readAfterWrite: z.boolean(),
  artifactManifest: z.object({
    artifactCount: z.number().int().nonnegative(),
    artifactKinds: z.array(z.string().min(1)).min(1),
  }),
}).passthrough()

const HITLOutputSchema = z.object({
  approvalRequired: z.boolean(),
  gateId: z.string().min(1),
  gateStatus: z.string().min(1),
  hostAction: z.string().min(1),
  approvalRecord: z.object({
    required: z.boolean(),
    status: z.enum(['auto-cleared', 'needs-human-review']),
  }),
}).passthrough()

const OUTPUT_SCHEMA_REGISTRY = {
  'antigravity.output.analyze.v1': AnalyzeOutputSchema,
  'antigravity.output.parallel.v1': ParallelOutputSchema,
  'antigravity.output.debate.v1': DebateOutputSchema,
  'antigravity.output.verify.v1': VerifyOutputSchema,
  'antigravity.output.synthesize.v1': SynthesizeOutputSchema,
  'antigravity.output.persist.v1': PersistOutputSchema,
  'antigravity.output.hitl.v1': HITLOutputSchema,
} as const

function extractModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

function assertDistinctVerifyFamily(output: Record<string, unknown>, state: WorkflowState | null): void {
  // PR-01: prefer pre-extracted challengerModelFamily when available,
  // fallback to deriving from challengerModelId for legacy data.
  const challengerFamily =
    (typeof output.challengerModelFamily === 'string' && output.challengerModelFamily.length > 0)
      ? output.challengerModelFamily
      : extractModelFamily(typeof output.challengerModelId === 'string' ? output.challengerModelId : undefined)
  const parallelOutput = state?.nodes.PARALLEL?.output as Record<string, unknown> | undefined
  const upstreamFamilies = [
    extractModelFamily((parallelOutput?.codex as Record<string, unknown> | undefined)?.modelId as string | undefined),
    extractModelFamily((parallelOutput?.gemini as Record<string, unknown> | undefined)?.modelId as string | undefined),
  ].filter(Boolean)

  if (challengerFamily && upstreamFamilies.includes(challengerFamily)) {
    throw new Error(`VERIFY challenger model family "${challengerFamily}" must be distinct from PARALLEL workers (${upstreamFamilies.join(', ')})`)
  }
}

function assertOraclePassForHighVerifiability(
  step: WorkflowStepDefinition,
  output: Record<string, unknown>,
  state: WorkflowState | null,
): void {
  if (step.id !== 'VERIFY' || step.qualityPolicy.requireOracleForHighVerifiability !== true) {
    return
  }
  const verifiabilityClass = state?.nodes.ANALYZE?.output?.verifiabilityClass
  if (verifiabilityClass !== 'high') {
    return
  }
  const oracleResults = Array.isArray(output.oracleResults) ? output.oracleResults : []
  const hasOraclePass = oracleResults.some(item => item && typeof item === 'object' && (item as Record<string, unknown>).passed === true)
  if (!hasOraclePass) {
    throw new Error('VERIFY requires at least one passing objective oracle for high-verifiability tasks')
  }
}

export function validateWorkflowStepOutput(
  step: WorkflowStepDefinition,
  output: Record<string, unknown>,
  state: WorkflowState | null,
): Record<string, unknown> {
  const schema = OUTPUT_SCHEMA_REGISTRY[step.outputSchemaId as keyof typeof OUTPUT_SCHEMA_REGISTRY]
  if (!schema) {
    throw new Error(`Missing output schema for ${step.id}: ${step.outputSchemaId}`)
  }
  const parsed = schema.safeParse(output)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    throw new Error(`Output schema validation failed for ${step.id}: ${detail}`)
  }

  if (step.id === 'VERIFY') {
    assertDistinctVerifyFamily(parsed.data, state)
  }
  assertOraclePassForHighVerifiability(step, parsed.data, state)

  return parsed.data
}
