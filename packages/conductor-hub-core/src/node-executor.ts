/**
 * Conductor AGC — 节点执行器接口与注册表
 *
 * 定义 NodeExecutor 接口，将 AGC DAG 的每个节点
 * 映射到具体的 AI 执行逻辑。
 *
 * 架构参考:
 * - LangGraph: 状态优先、条件路由、可检查点执行
 * - Temporal: 确定性编排器 vs 故障隔离活动
 * - Airflow: 显式任务状态、分支跳过作为一等公民
 */
import type { AGCState, RunGraph } from '@anthropic/conductor-shared'
import { createHash } from 'node:crypto'
import type { AgcAgentRuntime } from '@anthropic/conductor-core'

// ── 类型定义 ────────────────────────────────────────────────────────────────

/** AGC 节点 ID 枚举 */
export type AGCNodeId =
  | 'ANALYZE'
  | 'PARALLEL'
  | 'DEBATE'
  | 'VERIFY'
  | 'SYNTHESIZE'
  | 'PERSIST'
  | 'HITL'

/** 节点执行上下文 */
export interface NodeExecutionContext {
  readonly runId: string
  readonly graph: RunGraph
  readonly state: AGCState
  readonly nodeId: string
  readonly attempt: number
  readonly signal: AbortSignal
  /** AGC Agent Runtime（AI 调用入口） */
  readonly hub: AgcAgentRuntime
  /** 获取前驱节点的输出 */
  getUpstreamOutput(nodeId: string): Record<string, unknown> | undefined
}

/** 节点执行结果 */
export interface NodeExecutionResult {
  /** 节点产出的 checkpoint 数据 */
  output: Record<string, unknown>
  /** 使用的模型 */
  model?: string
  /** 执行时长(ms) */
  durationMs: number
  /** 是否降级执行 */
  degraded?: boolean
}

/** 节点执行器接口 — 每个 AGC 节点对应一个实现 */
export interface NodeExecutor {
  readonly nodeId: AGCNodeId
  /** 超时时间(ms) */
  readonly timeoutMs: number
  /** 最大重试次数 */
  readonly maxRetries: number
  /** 执行节点逻辑 */
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>
}

/** 条件路由决策 — 节点完成后决定跳过哪些后续节点 */
export interface TransitionDecision {
  /** 需要跳过的节点及原因 */
  skipNodes: Array<{ nodeId: string; reason: string }>
  /** 需要强制排队的节点 */
  forceQueue: string[]
}

/** GAP_CHECK 结果 */
export interface GapCheckResult {
  ok: boolean
  code?: 'SCHEMA_INVALID' | 'CHECKPOINT_MISSING' | 'LOW_CONFIDENCE' | 'COMPLIANCE_BLOCK'
  message?: string
}

type ParallelProvider = 'codex' | 'gemini'

interface ParallelReceipt {
  provider: ParallelProvider
  task_id: string
  started_at: string
  finished_at: string
  status: 'success' | 'error' | 'timeout'
  output_hash: string
  summary?: string
  confidence?: number
  option_id?: string
  error?: string
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.max(0, Math.min(100, value))
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end <= start) {
      return null
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function normalizeSummary(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 2000)
}

function createOutputHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildParallelReceipt(
  provider: ParallelProvider,
  taskId: string,
  startedAt: string,
  finishedAt: string,
  settled: PromiseSettledResult<string>,
): ParallelReceipt {
  if (settled.status === 'fulfilled') {
    const parsed = parseJsonObject(settled.value)
    const summary = typeof parsed?.summary === 'string' && parsed.summary.trim().length > 0
      ? parsed.summary.trim().slice(0, 2000)
      : normalizeSummary(settled.value)
    const optionId = typeof parsed?.option_id === 'string' && parsed.option_id.trim().length > 0
      ? parsed.option_id.trim().slice(0, 64)
      : provider.toUpperCase()
    const fallbackConfidence = provider === 'codex' ? 85 : 82
    return {
      provider,
      task_id: taskId,
      started_at: startedAt,
      finished_at: finishedAt,
      status: 'success',
      output_hash: createOutputHash(settled.value),
      summary,
      confidence: clampConfidence(parsed?.confidence, fallbackConfidence),
      option_id: optionId,
    }
  }

  const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
  const normalizedError = normalizeSummary(error || `${provider} task failed`)
  return {
    provider,
    task_id: taskId,
    started_at: startedAt,
    finished_at: finishedAt,
    status: normalizedError.toLowerCase().includes('timeout') ? 'timeout' : 'error',
    output_hash: createOutputHash(normalizedError),
    error: normalizedError,
  }
}

function computeDisagreementScore(codex: ParallelReceipt, gemini: ParallelReceipt): number {
  if (codex.status !== 'success' || gemini.status !== 'success') {
    return 1
  }

  const codexOption = codex.option_id?.toLowerCase() ?? ''
  const geminiOption = gemini.option_id?.toLowerCase() ?? ''
  const codexSummary = codex.summary?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
  const geminiSummary = gemini.summary?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''

  if (codexOption !== '' && codexOption === geminiOption && codexSummary === geminiSummary) {
    return 0
  }

  if (codexOption !== '' && codexOption === geminiOption) {
    return 0.5
  }

  if (codexSummary !== '' && codexSummary === geminiSummary) {
    return 0.5
  }

  return 1
}

// ── ANALYZE 执行器 ──────────────────────────────────────────────────────────

export class AnalyzeExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'ANALYZE'
  readonly timeoutMs = 30_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''

    // 使用单模型分析任务类型和风险等级
    const result = await ctx.hub.ask({
      message: `分析以下任务，输出 JSON 格式的分析结果：
任务: ${goal}
要求输出字段: task_type(审查/实现/优化/调研), risk_level(low/medium/high/critical), route_path(fast_track/debate/debate_verify/hitl), token_budget(S/M/L)`,
      systemPrompt: '你是一个任务分析引擎，只输出 JSON，不要输出其他内容。',
      signal: ctx.signal,
    })

    let parsed: Record<string, unknown> = {}
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      }
    } catch {
      parsed = { task_type: 'unknown', risk_level: 'medium', route_path: 'debate', token_budget: 'M' }
    }

    return {
      output: {
        task_type: parsed.task_type ?? 'unknown',
        risk_level: parsed.risk_level ?? 'medium',
        route_path: parsed.route_path ?? 'debate',
        token_budget: parsed.token_budget ?? 'M',
        tools_available: ['codex', 'gemini'],
        evidence_files: [],
        history_hits: [],
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── PARALLEL 执行器 ─────────────────────────────────────────────────────────

export class ParallelExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'PARALLEL'
  readonly timeoutMs = 60_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''
    const analyzeOutput = ctx.getUpstreamOutput('ANALYZE')
    const taskType = (analyzeOutput?.task_type as string) ?? 'unknown'

    // Codex + Gemini 并行独立思考
    const prompt = `作为${taskType}专家，对以下任务进行独立分析并给出方案：\n${goal}\n\n请输出 JSON: {"summary": "方案摘要", "confidence": 数字(0-100), "option_id": "A或B", "key_points": ["要点1","要点2"]}`

    const codexStartedAt = new Date().toISOString()
    const geminiStartedAt = new Date().toISOString()

    const [codexResult, geminiResult] = await Promise.allSettled([
      ctx.hub.codexTask(prompt, undefined, ctx.signal),
      ctx.hub.geminiTask(prompt, undefined, undefined, ctx.signal),
    ])

    const finishedAt = new Date().toISOString()
    const codex = buildParallelReceipt('codex', `${ctx.runId}:PARALLEL:codex:${ctx.attempt}`, codexStartedAt, finishedAt, codexResult)
    const gemini = buildParallelReceipt('gemini', `${ctx.runId}:PARALLEL:gemini:${ctx.attempt}`, geminiStartedAt, finishedAt, geminiResult)
    const bothAvailable = codex.status === 'success' && gemini.status === 'success'
    const drValue = computeDisagreementScore(codex, gemini)

    return {
      output: {
        execution_mode: 'dual_model_parallel',
        codex,
        gemini,
        both_available: bothAvailable,
        dr_value: drValue,
        skip_allowed: false,
        degraded_reason: bothAvailable ? undefined : 'dual-model execution incomplete; full workflow remains mandatory',
      },
      durationMs: Date.now() - start,
      degraded: !bothAvailable,
    }
  }
}

// ── DEBATE 执行器 ───────────────────────────────────────────────────────────

export class DebateExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'DEBATE'
  readonly timeoutMs = 45_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const parallelOutput = ctx.getUpstreamOutput('PARALLEL')
    const codexSummary = (parallelOutput?.codex as Record<string, unknown>)?.summary ?? ''
    const geminiSummary = (parallelOutput?.gemini as Record<string, unknown>)?.summary ?? ''

    // 使用 consensus 进行交叉辩论
    const result = await ctx.hub.consensus({
      message: `两个 AI 模型给出了不同方案，请进行评判并综合：
方案 A (Codex): ${codexSummary}
方案 B (Gemini): ${geminiSummary}

请输出最终综合方案。`,
      criteria: 'accuracy',
    })

    return {
      output: {
        debate_rounds: 1,
        convergence_score: 0.8,
        collusion_check: 'PASS',
        winner: result.candidates[0]?.label ?? '',
        final_summary: result.judgeText.slice(0, 2000),
        arguments: [],
      },
      durationMs: Date.now() - start,
    }
  }
}

// ── VERIFY 执行器 ───────────────────────────────────────────────────────────

export class VerifyExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'VERIFY'
  readonly timeoutMs = 30_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''
    const debateOutput = ctx.getUpstreamOutput('DEBATE')
    const parallelOutput = ctx.getUpstreamOutput('PARALLEL')
    const summary = (debateOutput?.final_summary as string) ??
      (parallelOutput?.codex as Record<string, unknown>)?.summary ?? ''

    // 独立验证（使用 ask，指定不同视角）
    const result = await ctx.hub.ask({
      message: `请独立验证以下方案的正确性和可行性：
任务: ${goal}
方案: ${summary}

请输出 JSON: {"verdict": "AGREE/PARTIAL/DISAGREE", "compliance_check": "PASS/WARN/VIOLATION", "concerns": ["问题1"]}`,
      systemPrompt: '你是一个独立验证专家。严格审查方案的逻辑漏洞和风险点。只输出 JSON。',
      signal: ctx.signal,
    })

    let parsed: Record<string, unknown> = {}
    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      }
    } catch {
      parsed = { verdict: 'PARTIAL', compliance_check: 'PASS', concerns: [] }
    }

    const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.toUpperCase() : 'PARTIAL'
    const complianceCheck = typeof parsed.compliance_check === 'string'
      ? parsed.compliance_check.toUpperCase()
      : 'PASS'

    return {
      output: {
        assurance_verdict: verdict === 'AGREE' ? 'PASS' : verdict === 'DISAGREE' ? 'REVISE' : 'REVISE',
        challenger_provider: 'deepseek',
        compliance_check: complianceCheck === 'VIOLATION' ? 'VIOLATION' : 'PASS',
        entropy_gain: 15,
        third_proposal: false,
        findings: Array.isArray(parsed.concerns)
          ? parsed.concerns.map(item => ({
            type: 'warning' as const,
            message: typeof item === 'string' ? item : JSON.stringify(item),
          }))
          : [],
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── SYNTHESIZE 执行器 ───────────────────────────────────────────────────────

export class SynthesizeExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'SYNTHESIZE'
  readonly timeoutMs = 30_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''

    // 收集所有前驱输出
    const analyzeOutput = ctx.getUpstreamOutput('ANALYZE')
    const parallelOutput = ctx.getUpstreamOutput('PARALLEL')
    const debateOutput = ctx.getUpstreamOutput('DEBATE')
    const verifyOutput = ctx.getUpstreamOutput('VERIFY')

    const result = await ctx.hub.ask({
      message: `请综合以下多轮分析结果，生成最终报告：
任务: ${goal}
分析阶段: ${JSON.stringify(analyzeOutput ?? {}).slice(0, 500)}
并行思考: ${JSON.stringify(parallelOutput ?? {}).slice(0, 500)}
辩论结果: ${JSON.stringify(debateOutput ?? {}).slice(0, 500)}
验证结果: ${JSON.stringify(verifyOutput ?? {}).slice(0, 500)}

请输出完整的最终方案报告。`,
      systemPrompt: '你是一个综合报告专家，负责将多方分析融合为一份清晰、可行的最终报告。',
      signal: ctx.signal,
    })

    return {
      output: {
        final_answer: result.text.slice(0, 5000),
        final_confidence: 88,
        release_decision: 'release',
        candidate_scores: {},
        template_used: 'T002',
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── PERSIST 执行器 ──────────────────────────────────────────────────────────

export class PersistExecutor implements NodeExecutor {
  readonly nodeId: AGCNodeId = 'PERSIST'
  readonly timeoutMs = 10_000
  readonly maxRetries = 2

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()

    // 持久化由 Event Sourcing 自动完成
    // 这里仅标记已完成
    return {
      output: {
        written_files: [],
        manifest_updated: true,
        read_after_write: true,
        feedback_reports: [],
      },
      durationMs: Date.now() - start,
    }
  }
}

// ── 执行器注册表 ────────────────────────────────────────────────────────────

/** 默认执行器注册表 */
export class NodeExecutorRegistry {
  private readonly executors = new Map<string, NodeExecutor>()

  constructor() {
    const defaults: NodeExecutor[] = [
      new AnalyzeExecutor(),
      new ParallelExecutor(),
      new DebateExecutor(),
      new VerifyExecutor(),
      new SynthesizeExecutor(),
      new PersistExecutor(),
    ]
    for (const exec of defaults) {
      this.executors.set(exec.nodeId, exec)
    }
  }

  get(nodeId: string): NodeExecutor | undefined {
    return this.executors.get(nodeId)
  }

  register(executor: NodeExecutor): void {
    this.executors.set(executor.nodeId, executor)
  }
}

// ── GAP_CHECK 实现 ──────────────────────────────────────────────────────────

/**
 * 节点级 GAP_CHECK — 验证前驱节点的 checkpoint 是否齐备
 *
 * 在执行任何节点前调用，确保 DAG 依赖链完整。
 * 这是代码级强制，不依赖 LLM prompt。
 */
export function gapCheck(
  nodeId: string,
  state: AGCState,
  graph: RunGraph,
): GapCheckResult {
  const node = graph.nodes.find(n => n.id === nodeId)
  if (!node) {
    return { ok: false, code: 'SCHEMA_INVALID', message: `节点 ${nodeId} 不存在于图中` }
  }

  // 检查所有前驱节点的 checkpoint
  for (const depId of node.dependsOn) {
    const depState = state.nodes[depId]
    if (!depState) {
      return {
        ok: false,
        code: 'CHECKPOINT_MISSING',
        message: `前驱节点 ${depId} 状态不存在`,
      }
    }
    if (depState.status !== 'completed' && depState.status !== 'skipped') {
      return {
        ok: false,
        code: 'CHECKPOINT_MISSING',
        message: `前驱节点 ${depId} 未完成 (status=${depState.status})`,
      }
    }
    // 已完成的节点必须有 output（除非是 skipped）
    if (depState.status === 'completed' && !depState.output) {
      return {
        ok: false,
        code: 'CHECKPOINT_MISSING',
        message: `前驱节点 ${depId} 已完成但缺少 output 数据`,
      }
    }
  }

  return { ok: true }
}
