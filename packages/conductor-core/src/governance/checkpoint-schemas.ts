/**
 * Conductor AGC — 检查点 Schema 注册表 (CheckpointSchemaRegistry)
 *
 * AGC v8.0: Lease-Based Workflow Runtime 的 Layer 2。
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
  task_type: z.enum(['review', 'implement', 'optimize', 'research', 'debug', 'refactor']),
  tools_available: z.array(z.string()),
  evidence_files: z.array(z.string()),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  trust_band: z.enum(['trusted', 'guarded', 'restricted', 'escalated']).optional(),
  route_path: z.enum(['fast_track', 'debate', 'debate_verify', 'hitl']),
  token_budget: z.enum(['S', 'M', 'L']),
  history_hits: z.array(z.string()),
})

export type CPAnalyze = z.infer<typeof CPAnalyzeSchema>

// ── CP-PARALLEL Schema ────────────────────────────────────────────────────────

const ModelOutputSchema = z.object({
  summary: z.string().min(1, 'summary must not be empty'),
  confidence: z.number().min(0).max(100),
  option_id: z.string(),
})

export const CPParallelSchema = z.object({
  codex: ModelOutputSchema.optional(),
  gemini: ModelOutputSchema.optional(),
  dr_value: z.number().min(0).max(1),
  trust_factors: z.record(z.string(), z.number().min(0).max(1)).optional(),
}).refine(
  data => data.codex !== undefined || data.gemini !== undefined,
  { message: 'At least one model output (codex or gemini) is required' },
)

export type CPParallel = z.infer<typeof CPParallelSchema>

// ── CP-DEBATE Schema ──────────────────────────────────────────────────────────

export const CPDebateSchema = z.object({
  debate_rounds: z.number().int().min(1).max(5),
  arguments: z.array(z.object({
    model: z.string(),
    position: z.string(),
    evidence: z.array(z.string()).optional(),
  })),
  convergence_score: z.number().min(0).max(1),
  collusion_check: z.enum(['PASS', 'FLAGGED']),
})

export type CPDebate = z.infer<typeof CPDebateSchema>

// ── CP-VERIFY Schema ──────────────────────────────────────────────────────────

export const CPVerifySchema = z.object({
  assurance_verdict: z.enum(['PASS', 'REVISE', 'ESCALATE']),
  challenger_provider: z.string().optional(),
  findings: z.array(z.object({
    type: z.enum(['error', 'warning', 'info']),
    message: z.string(),
  })),
  entropy_gain: z.number().min(0),
  compliance_check: z.enum(['PASS', 'VIOLATION']),
  third_proposal: z.boolean(),
})

export type CPVerify = z.infer<typeof CPVerifySchema>

// ── CP-SYNTHESIZE Schema ──────────────────────────────────────────────────────

export const CPSynthesizeSchema = z.object({
  final_answer: z.string().min(1, 'final_answer must not be empty'),
  final_confidence: z.number().min(0).max(100),
  release_decision: z.enum(['release', 'revise', 'degrade', 'escalate']).optional(),
  candidate_scores: z.record(z.string(), z.number()).optional(),
  template_used: z.enum(['T002', 'T003']).optional(),
})

export type CPSynthesize = z.infer<typeof CPSynthesizeSchema>

// ── CP-PERSIST Schema ─────────────────────────────────────────────────────────

export const CPPersistSchema = z.object({
  written_files: z.array(z.string()),
  manifest_updated: z.boolean(),
  read_after_write: z.boolean(),
  trust_updated: z.boolean().optional(),
  feedback_reports: z.array(z.string()),
})

export type CPPersist = z.infer<typeof CPPersistSchema>

// ── Schema 注册表 ─────────────────────────────────────────────────────────────

/** 节点 ID 到 Schema 的映射 */
const CHECKPOINT_SCHEMAS: Record<string, z.ZodTypeAny> = {
  ANALYZE: CPAnalyzeSchema,
  PARALLEL: CPParallelSchema,
  DEBATE: CPDebateSchema,
  VERIFY: CPVerifySchema,
  SYNTHESIZE: CPSynthesizeSchema,
  PERSIST: CPPersistSchema,
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
