/**
 * Antigravity Workflow Runtime — 检查点 Schema 注册表 (CheckpointSchemaRegistry)
 *
 * Workflow Runtime vNext: Lease-Based Workflow Runtime 的 Layer 2。
 * 使用 Zod 对每个节点的 CP-* 输出进行结构验证，
 * 确保 LLM 产出的 JSON 符合预定义的 Schema。
 *
 * SOTA 参考:
 * - OpenAI Structured Outputs: 服务端 JSON Schema 约束
 * - LangGraph: 编译时检查点验证
 * - Zod: TypeScript-first schema validation
 *
 * 强制等级: 10/10 — Schema 验证由代码执行，非提示词依赖
 */

import { z } from 'zod'

// ── CP-ANALYZE Schema ─────────────────────────────────────────────────────────

export const CPAnalyzeSchema = z.object({
  taskType: z.enum(['review', 'implement', 'optimize', 'research', 'debug', 'refactor']),
  toolsAvailable: z.array(z.string()),
  evidenceFiles: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  trustBand: z.enum(['trusted', 'guarded', 'restricted', 'escalated']).optional(),
  routePath: z.enum(['fastTrack', 'debate', 'debateVerify', 'hitl']),
  tokenBudget: z.enum(['S', 'M', 'L']),
  historyHits: z.array(z.string()),
})

export type CPAnalyze = z.infer<typeof CPAnalyzeSchema>

// ── CP-PARALLEL Schema ────────────────────────────────────────────────────────

const ModelOutputSchema = z.object({
  modelId: z.enum(['codex', 'gemini']),
  taskId: z.string().min(1, 'taskId must not be empty'),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  status: z.enum(['success', 'error', 'timeout']),
  outputHash: z.string().min(1, 'outputHash must not be empty'),
  summary: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  optionId: z.string().optional(),
  error: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'success') {
    if (!data.summary || data.summary.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['summary'],
        message: 'summary is required when status=success',
      })
    }
    if (typeof data.confidence !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence is required when status=success',
      })
    }
    if (!data.optionId || data.optionId.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['optionId'],
        message: 'optionId is required when status=success',
      })
    }
  }

  if (data.status !== 'success' && (!data.error || data.error.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['error'],
      message: 'error is required when status is not success',
    })
  }
})

export const CPParallelSchema = z.object({
  executionMode: z.literal('dual_model_parallel'),
  codex: ModelOutputSchema,
  gemini: ModelOutputSchema,
  bothAvailable: z.boolean(),
  disagreementScore: z.number().min(0).max(1),
  skipAllowed: z.literal(false),
  degradedReason: z.string().optional(),
  trustFactors: z.record(z.string(), z.number().min(0).max(1)).optional(),
}).superRefine((data, ctx) => {
  if (data.codex.modelId !== 'codex') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['codex', 'modelId'],
      message: 'codex receipt must declare modelId=codex',
    })
  }

  if (data.gemini.modelId !== 'gemini') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gemini', 'modelId'],
      message: 'gemini receipt must declare modelId=gemini',
    })
  }

  if (data.codex.taskId === data.gemini.taskId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gemini', 'taskId'],
      message: 'codex and gemini taskId must be distinct',
    })
  }

  const bothSucceeded = data.codex.status === 'success' && data.gemini.status === 'success'
  if (data.bothAvailable !== bothSucceeded) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bothAvailable'],
      message: 'bothAvailable must exactly reflect dual success state',
    })
  }

  if (!bothSucceeded && (!data.degradedReason || data.degradedReason.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['degradedReason'],
      message: 'degradedReason is required when either model did not succeed',
    })
  }
})

export type CPParallel = z.infer<typeof CPParallelSchema>

// ── CP-DEBATE Schema ──────────────────────────────────────────────────────────

export const CPDebateSchema = z.object({
  debateRounds: z.number().int().min(1).max(5),
  arguments: z.array(z.object({
    model: z.string(),
    position: z.string(),
    evidence: z.array(z.string()).optional(),
  })),
  convergenceScore: z.number().min(0).max(1),
  collusionCheck: z.enum(['PASS', 'FLAGGED']),
  winner: z.string().optional(),
  finalSummary: z.string().optional(),
})

export type CPDebate = z.infer<typeof CPDebateSchema>

// ── CP-VERIFY Schema ──────────────────────────────────────────────────────────

export const CPVerifySchema = z.object({
  assuranceVerdict: z.enum(['PASS', 'REVISE', 'ESCALATE']),
  challengerModelId: z.string().optional(),
  findings: z.array(z.object({
    type: z.enum(['error', 'warning', 'info']),
    message: z.string(),
  })),
  entropyGain: z.number().min(0),
  complianceCheck: z.enum(['PASS', 'VIOLATION']),
  thirdProposal: z.boolean(),
})

export type CPVerify = z.infer<typeof CPVerifySchema>

// ── CP-SYNTHESIZE Schema ──────────────────────────────────────────────────────

export const CPSynthesizeSchema = z.object({
  finalAnswer: z.string().min(1, 'finalAnswer must not be empty'),
  finalConfidence: z.number().min(0).max(100),
  releaseDecision: z.enum(['release', 'revise', 'degrade', 'escalate']).optional(),
  candidateScores: z.record(z.string(), z.number()).optional(),
  templateUsed: z.enum(['T002', 'T003']).optional(),
})

export type CPSynthesize = z.infer<typeof CPSynthesizeSchema>

// ── CP-PERSIST Schema ─────────────────────────────────────────────────────────

export const CPPersistSchema = z.object({
  writtenFiles: z.array(z.string()),
  manifestUpdated: z.boolean(),
  readAfterWrite: z.boolean(),
  trustUpdated: z.boolean().optional(),
  feedbackReports: z.array(z.string()),
})

export type CPPersist = z.infer<typeof CPPersistSchema>

// ── CP-HITL Schema ───────────────────────────────────────────────────────────

export const CPHITLSchema = z.object({
  approvalRequired: z.boolean(),
  gateId: z.string(),
  gateStatus: z.enum(['autoCleared', 'needsHumanReview']),
  hostAction: z.string(),
})

export type CPHITL = z.infer<typeof CPHITLSchema>

// ── Schema 注册表 ─────────────────────────────────────────────────────────────

/** 节点 ID 到 Schema 的映射 */
const CHECKPOINT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  ANALYZE: CPAnalyzeSchema,
  PARALLEL: CPParallelSchema,
  DEBATE: CPDebateSchema,
  VERIFY: CPVerifySchema,
  SYNTHESIZE: CPSynthesizeSchema,
  PERSIST: CPPersistSchema,
  HITL: CPHITLSchema,
}

/** Schema 验证结果 */
export interface SchemaValidationResult {
  valid: boolean
  nodeId: string
  errors?: Array<{ path: string; message: string }>
}

/**
 * CheckpointSchemaRegistry — 检查点输出 Schema 验证
 *
 * 核心职责: 验证每个节点的 CP-* 输出是否符合预定义的 Zod Schema。
 * 这是 Lease-Based Runtime 的 Layer 2，强制等级 10/10。
 */
export class CheckpointSchemaRegistry {
  private readonly schemas: Map<string, z.ZodTypeAny>

  constructor(customSchemas?: Record<string, z.ZodTypeAny>) {
    this.schemas = new Map(Object.entries({
      ...CHECKPOINT_SCHEMAS,
      ...customSchemas,
    }))
  }

  /** 注册自定义节点 Schema */
  register(nodeId: string, schema: z.ZodTypeAny): void {
    this.schemas.set(nodeId, schema)
  }

  /** 验证检查点输出 */
  validate(nodeId: string, output: unknown): SchemaValidationResult {
    const schema = this.schemas.get(nodeId)
    if (!schema) {
      // Fail-closed: 未注册 Schema 的节点默认拒绝 (Codex 审查修复)
      return {
        valid: false,
        nodeId,
        errors: [{ path: '', message: `No schema registered for node ${nodeId}` }],
      }
    }

    const result = schema.safeParse(output)
    if (result.success) {
      return { valid: true, nodeId }
    }

    return {
      valid: false,
      nodeId,
      errors: result.error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }

  /** 检查节点是否已注册 Schema */
  hasSchema(nodeId: string): boolean {
    return this.schemas.has(nodeId)
  }

  /** 获取所有已注册的节点 ID */
  registeredNodes(): string[] {
    return Array.from(this.schemas.keys())
  }
}
