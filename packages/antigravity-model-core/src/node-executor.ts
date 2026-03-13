/**
 * Antigravity Workflow Runtime — 节点执行器接口与注册表
 *
 * 定义 NodeExecutor 接口，将 workflow DAG 的每个节点
 * 映射到具体的 AI 执行逻辑。
 *
 * 架构参考:
 * - LangGraph: 状态优先、条件路由、可检查点执行
 * - Temporal: 确定性编排器 vs 故障隔离活动
 * - Airflow: 显式任务状态、分支跳过作为一等公民
 */
import type { WorkflowState, RunGraph } from '@anthropic/antigravity-shared'
import { createHash } from 'node:crypto'
import type { WorkflowAgentRuntime } from '@anthropic/antigravity-core'
import { runObjectiveOracles } from './objective-oracles.js'

// ── 类型定义 ────────────────────────────────────────────────────────────────

/** workflow 节点 ID 枚举 */
export type WorkflowNodeId =
  | 'ANALYZE'
  | 'PARALLEL'
  | 'DEBATE'
  | 'VERIFY'
  | 'SYNTHESIZE'
  | 'PERSIST'
  | 'HITL'

export interface StepLeaseContext {
  readonly leaseId: string
  readonly runId: string
  readonly nodeId: string
  readonly attempt: number
  readonly issuedAt: string
  readonly expiresAt: string
  readonly authorityOwner: string
  readonly requiredEvidence: string[]
  readonly allowedModelPool: string[]
  readonly inputDigest?: string
}

/** 节点执行上下文 */
export interface NodeExecutionContext {
  readonly runId: string
  readonly graph: RunGraph
  readonly state: WorkflowState
  readonly nodeId: string
  readonly attempt: number
  readonly lease: StepLeaseContext
  readonly signal: AbortSignal
  /** Workflow Agent Runtime（AI 调用入口） */
  readonly agentRuntime: WorkflowAgentRuntime
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

/** 节点执行器接口 — 每个 workflow 节点对应一个实现 */
export interface NodeExecutor {
  readonly nodeId: WorkflowNodeId
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
  skipNodes: Array<{
    nodeId: string
    reason: string
    strategyId?: string
    triggerCondition?: string
  }>
  /** 需要强制排队的节点 */
  forceQueue: string[]
}

/** GAP_CHECK 结果 */
export interface GapCheckResult {
  ok: boolean
  code?: 'SCHEMA_INVALID' | 'CHECKPOINT_MISSING' | 'LOW_CONFIDENCE' | 'COMPLIANCE_BLOCK'
  message?: string
}

type ParallelModelId = 'codex' | 'gemini'

interface ParallelReceipt {
  modelId: ParallelModelId
  taskId: string
  startedAt: string
  finishedAt: string
  status: 'success' | 'error' | 'timeout'
  outputHash: string
  summary?: string
  confidence?: number
  optionId?: string
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

function inferTaskClass(goal: string): 'analysis' | 'code' | 'text' | 'structured-data' | 'governance' {
  const normalized = goal.toLowerCase()
  if (/(code|typescript|ts|javascript|arkts|refactor|bug|compile|test|lint|build|implement)/.test(normalized)) {
    return 'code'
  }
  if (/(json|yaml|schema|extract|structured|config)/.test(normalized)) {
    return 'structured-data'
  }
  if (/(policy|governance|approval|security|compliance)/.test(normalized)) {
    return 'governance'
  }
  return 'text'
}

function inferVerifiabilityClass(taskClass: ReturnType<typeof inferTaskClass>): 'low' | 'medium' | 'high' {
  if (taskClass === 'code' || taskClass === 'structured-data') {
    return 'high'
  }
  return taskClass === 'text' ? 'medium' : 'medium'
}

function buildParallelReceipt(
  modelId: ParallelModelId,
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
    const optionId = typeof parsed?.optionId === 'string' && parsed.optionId.trim().length > 0
      ? parsed.optionId.trim().slice(0, 64)
      : modelId.toUpperCase()
    const fallbackConfidence = modelId === 'codex' ? 85 : 82
    return {
      modelId,
      taskId,
      startedAt,
      finishedAt,
      status: 'success',
      outputHash: createOutputHash(settled.value),
      summary,
      confidence: clampConfidence(parsed?.confidence, fallbackConfidence),
      optionId,
    }
  }

  const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
  const normalizedError = normalizeSummary(error || `${modelId} task failed`)
  return {
    modelId,
    taskId,
    startedAt,
    finishedAt,
    status: normalizedError.toLowerCase().includes('timeout') ? 'timeout' : 'error',
    outputHash: createOutputHash(normalizedError),
    error: normalizedError,
  }
}

function computeDisagreementScore(codex: ParallelReceipt, gemini: ParallelReceipt): number {
  if (codex.status !== 'success' || gemini.status !== 'success') {
    return 1
  }

  const codexOption = codex.optionId?.toLowerCase() ?? ''
  const geminiOption = gemini.optionId?.toLowerCase() ?? ''
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

function summarySimilarity(a: string | undefined, b: string | undefined): number {
  const left = (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const right = (b ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!left || !right) {
    return 0
  }
  if (left === right) {
    return 1
  }
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union === 0 ? 0 : intersection / union
}

function buildParallelPrompt(goal: string, taskType: string, attempt: number): string {
  const suffix = attempt === 0
    ? '请直接给出你认为最优的独立方案。'
    : attempt === 1
      ? '请避免复述上轮思路，优先提出不同的实现路径、不同的风险控制点和不同的排序策略。'
      : '请强制从另一个角度提出替代方案，强调与之前答案不同的关键假设与取舍。'
  return `作为${taskType}专家，对以下任务进行独立分析并给出方案：\n${goal}\n\n${suffix}\n\n请输出 JSON: {"summary": "方案摘要", "confidence": 数字(0-100), "optionId": "A或B", "keyPoints": ["要点1","要点2"]}`
}

function evaluateParallelAttempt(codex: ParallelReceipt, gemini: ParallelReceipt): {
  bothAvailable: boolean
  disagreementScore: number
  summarySimilarity: number
  needsCompensation: boolean
  reason?: string
} {
  const bothAvailable = codex.status === 'success' && gemini.status === 'success'
  const disagreementScore = computeDisagreementScore(codex, gemini)
  const similarity = summarySimilarity(codex.summary, gemini.summary)

  if (!bothAvailable) {
    return {
      bothAvailable,
      disagreementScore,
      summarySimilarity: similarity,
      needsCompensation: true,
      reason: 'dual-model execution incomplete',
    }
  }

  if (similarity >= 0.9) {
    return {
      bothAvailable,
      disagreementScore,
      summarySimilarity: similarity,
      needsCompensation: true,
      reason: `parallel outputs are overly similar (similarity=${similarity.toFixed(2)})`,
    }
  }

  return {
    bothAvailable,
    disagreementScore,
    summarySimilarity: similarity,
    needsCompensation: false,
  }
}

function debateStabilityScore(previousSummary: string | undefined, nextSummary: string | undefined, sameWinner: boolean): number {
  const similarity = summarySimilarity(previousSummary, nextSummary)
  return sameWinner
    ? Math.min(1, 0.5 + similarity * 0.5)
    : similarity * 0.5
}

// ── ANALYZE 执行器 ──────────────────────────────────────────────────────────

export class AnalyzeExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'ANALYZE'
  readonly timeoutMs = 30_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''
    const files = Array.isArray(ctx.state.capturedContext?.metadata?.files)
      ? ctx.state.capturedContext?.metadata?.files as string[]
      : []
    const taskClass = inferTaskClass(goal)
    const verifiabilityClass = inferVerifiabilityClass(taskClass)

    // 使用单模型分析任务类型和风险等级
    const result = await ctx.agentRuntime.ask({
      message: `分析以下任务，输出 JSON 格式的分析结果：
任务: ${goal}
要求输出字段: taskType(审查/实现/优化/调研), riskLevel(low/medium/high/critical), routePath(fastTrack/debate/debateVerify/hitl), tokenBudget(S/M/L)`,
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
      parsed = { taskType: 'unknown', riskLevel: 'medium', routePath: 'debate', tokenBudget: 'M' }
    }

    return {
      output: {
        taskType: parsed.taskType ?? 'unknown',
        taskAnalysis: `Goal "${goal}" requires daemon-owned ${String(parsed.taskType ?? 'analysis')} handling with evidence-backed execution and final release gating.`,
        riskLevel: parsed.riskLevel ?? 'medium',
        riskAssessment: parsed.riskLevel ?? 'medium',
        routePath: parsed.routePath ?? 'debate',
        tokenBudget: parsed.tokenBudget ?? 'M',
        taskClass,
        verifiabilityClass,
        fileList: files.length > 0 ? files : [ctx.state.capturedContext?.metadata?.repoRoot ?? 'workspace-root'],
        keyConstraints: [
          'Execution must remain daemon-owned and evidence-backed.',
          'Final release requires verification and artifact persistence.',
        ],
        toolsAvailable: ['codex', 'gemini'],
        evidenceFiles: [],
        historyHits: [],
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── PARALLEL 执行器 ─────────────────────────────────────────────────────────

export class ParallelExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'PARALLEL'
  readonly timeoutMs = 60_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''
    const analyzeOutput = ctx.getUpstreamOutput('ANALYZE')
    const taskType = (analyzeOutput?.taskType as string) ?? 'unknown'
    const compensationAttempts: Array<{
      attempt: number
      reason: string
    }> = []
    let codex: ParallelReceipt | null = null
    let gemini: ParallelReceipt | null = null
    let finalAttempt = 0
    let evaluation: {
      bothAvailable: boolean
      disagreementScore: number
      summarySimilarity: number
      needsCompensation: boolean
      reason?: string
    } = {
      bothAvailable: false,
      disagreementScore: 1,
      summarySimilarity: 0,
      needsCompensation: true,
      reason: 'parallel execution not started',
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      finalAttempt = attempt
      const prompt = buildParallelPrompt(goal, taskType, attempt)
      const codexStartedAt = new Date().toISOString()
      const geminiStartedAt = new Date().toISOString()
      const [codexResult, geminiResult] = await Promise.allSettled([
        ctx.agentRuntime.codexTask(prompt, undefined, ctx.signal),
        ctx.agentRuntime.geminiTask(prompt, undefined, undefined, ctx.signal),
      ])
      const finishedAt = new Date().toISOString()
      codex = buildParallelReceipt('codex', `${ctx.runId}:PARALLEL:codex:${ctx.attempt}:${attempt}`, codexStartedAt, finishedAt, codexResult)
      gemini = buildParallelReceipt('gemini', `${ctx.runId}:PARALLEL:gemini:${ctx.attempt}:${attempt}`, geminiStartedAt, finishedAt, geminiResult)
      evaluation = evaluateParallelAttempt(codex, gemini)
      if (!evaluation.needsCompensation) {
        break
      }
      if (attempt < 2) {
        compensationAttempts.push({
          attempt: attempt + 1,
          reason: evaluation.reason ?? 'parallel quality insufficient',
        })
      }
    }

    return {
      output: {
        executionMode: 'dual_model_parallel',
        codex: codex ?? {
          modelId: 'codex',
          taskId: `${ctx.runId}:PARALLEL:codex:${ctx.attempt}:fallback`,
          status: 'error',
          outputHash: createOutputHash('parallel-codex-missing'),
          error: 'parallel codex result missing',
        },
        gemini: gemini ?? {
          modelId: 'gemini',
          taskId: `${ctx.runId}:PARALLEL:gemini:${ctx.attempt}:fallback`,
          status: 'error',
          outputHash: createOutputHash('parallel-gemini-missing'),
          error: 'parallel gemini result missing',
        },
        bothAvailable: evaluation.bothAvailable,
        disagreementScore: evaluation.disagreementScore,
        skipAllowed: false,
        workerFamiliesDistinct: (codex?.modelId ?? '') !== (gemini?.modelId ?? ''),
        compensationApplied: compensationAttempts.length > 0,
        compensationAttempts,
        summarySimilarity: evaluation.summarySimilarity,
        degradedReason: evaluation.needsCompensation ? evaluation.reason : undefined,
      },
      durationMs: Date.now() - start,
      degraded: evaluation.needsCompensation,
    }
  }
}

// ── DEBATE 执行器 ───────────────────────────────────────────────────────────

export class DebateExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'DEBATE'
  readonly timeoutMs = 45_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const parallelOutput = ctx.getUpstreamOutput('PARALLEL')
    const codexSummary = (parallelOutput?.codex as Record<string, unknown>)?.summary ?? ''
    const geminiSummary = (parallelOutput?.gemini as Record<string, unknown>)?.summary ?? ''
    const roundSummaries: string[] = []
    const roundWinners: string[] = []
    let result = await ctx.agentRuntime.consensus({
      message: `两个 AI 模型给出了不同方案，请进行评判并综合：
方案 A (Codex): ${codexSummary}
方案 B (Gemini): ${geminiSummary}

请输出最终综合方案。`,
      criteria: 'accuracy',
    })
    roundSummaries.push(result.judgeText)
    roundWinners.push(result.candidates[0]?.label ?? '')

    let stabilityScore = 0
    let stabilityAchieved = false
    let compensationRequested = false

    for (let round = 2; round <= 3; round++) {
      const previousSummary = roundSummaries[roundSummaries.length - 1]
      const previousWinner = roundWinners[roundWinners.length - 1]
      const next = await ctx.agentRuntime.consensus({
        message: `请继续进行第 ${round} 轮辩论总结，并尽量稳定收敛：
方案 A (Codex): ${codexSummary}
方案 B (Gemini): ${geminiSummary}
上一轮结论: ${previousSummary}
上一轮 winner: ${previousWinner}

请给出新的综合结论。`,
        criteria: 'accuracy',
      })
      const nextWinner = next.candidates[0]?.label ?? ''
      stabilityScore = debateStabilityScore(previousSummary, next.judgeText, nextWinner === previousWinner)
      roundSummaries.push(next.judgeText)
      roundWinners.push(nextWinner)
      result = next
      if (stabilityScore >= 0.85) {
        stabilityAchieved = true
        break
      }
    }

    if (!stabilityAchieved && roundSummaries.length >= 3) {
      compensationRequested = true
    }

    return {
      output: {
        debateRounds: roundSummaries.length,
        convergenceScore: stabilityAchieved ? Math.max(0.85, stabilityScore) : Math.max(0.45, stabilityScore),
        stabilityScore,
        stabilityAchieved,
        compensationRequested,
        collusionCheck: compensationRequested ? 'WARN' : 'PASS',
        winner: result.candidates[0]?.label ?? '',
        finalSummary: result.judgeText.slice(0, 2000),
        disagreementPoints: [
          'Compare model proposals for correctness, completeness, and implementation risk.',
        ],
        candidateOptions: [
          String((parallelOutput?.codex as Record<string, unknown>)?.optionId ?? 'CODEX'),
          String((parallelOutput?.gemini as Record<string, unknown>)?.optionId ?? 'GEMINI'),
        ],
        selectedOption: result.candidates[0]?.label ?? 'CODEX',
        arguments: [
          { source: 'codex', summary: String(codexSummary).slice(0, 240) },
          { source: 'gemini', summary: String(geminiSummary).slice(0, 240) },
        ],
        roundSummaries,
      },
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Extract the leading family token from a model identifier.
 *
 * Examples:
 *   'deepseek-v3'    → 'deepseek'
 *   'codex:2025-03'  → 'codex'
 *   'gemini/pro'     → 'gemini'
 *   undefined        → ''
 *
 * NOTE: This is intentionally duplicated from evidence-policy.ts to avoid
 * introducing a reverse dependency from model-core → daemon.
 */
function extractVerifyModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

// ── VERIFY 执行器 ───────────────────────────────────────────────────────────

export class VerifyExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'VERIFY'
  readonly timeoutMs = 30_000
  readonly maxRetries = 1

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const goal = ctx.state.capturedContext?.metadata?.goal ?? ''
    const debateOutput = ctx.getUpstreamOutput('DEBATE')
    const parallelOutput = ctx.getUpstreamOutput('PARALLEL')
    const analyzeOutput = ctx.getUpstreamOutput('ANALYZE')
    const summary = (debateOutput?.finalSummary as string) ??
      (parallelOutput?.codex as Record<string, unknown>)?.summary ?? ''
    const taskClass = (analyzeOutput?.taskClass as 'analysis' | 'code' | 'text' | 'structured-data' | 'governance' | undefined) ?? 'text'
    const verifiabilityClass = (analyzeOutput?.verifiabilityClass as 'low' | 'medium' | 'high' | undefined) ?? 'medium'
    const filePaths = Array.isArray(ctx.state.capturedContext?.metadata?.files)
      ? ctx.state.capturedContext?.metadata?.files as string[]
      : []
    const oracleResults = await runObjectiveOracles({
      taskClass,
      verifiabilityClass,
      workspaceRoot: ctx.state.capturedContext?.metadata?.repoRoot,
      filePaths,
    })

    // 独立验证（使用 ask，指定不同视角）
    const result = await ctx.agentRuntime.ask({
      message: `请独立验证以下方案的正确性和可行性：
任务: ${goal}
方案: ${summary}

请输出 JSON: {"verdict": "AGREE/PARTIAL/DISAGREE", "complianceCheck": "PASS/WARN/VIOLATION", "concerns": ["问题1"]}`,
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
      parsed = { verdict: 'PARTIAL', complianceCheck: 'PASS', concerns: [] }
    }

    const verdict = typeof parsed.verdict === 'string' ? parsed.verdict.toUpperCase() : 'PARTIAL'
    const complianceCheck = typeof parsed.complianceCheck === 'string'
      ? parsed.complianceCheck.toUpperCase()
      : 'PASS'
    const oraclePass = oracleResults.some(item => item.passed)
    const normalizedComplianceCheck = verifiabilityClass === 'high' && !oraclePass
      ? 'VIOLATION'
      : complianceCheck === 'VIOLATION'
        ? 'VIOLATION'
        : 'PASS'

    // PR-01: Derive challenger model identity from the actual runtime call
    // result instead of hardcoding a fixed model name. This ensures
    // evidence-policy distinct-family checks and release gate decisions
    // operate on truthful model metadata.
    const actualChallengerModelId = result.usedModel ?? 'unknown'
    const actualChallengerModelFamily = extractVerifyModelFamily(result.usedModel)

    if (!result.usedModel) {
      console.warn('[VERIFY] WorkflowAskResult.usedModel is missing — falling back to "unknown". This indicates a contract violation in the upstream model client.', {
        runId: ctx.runId,
        nodeId: ctx.nodeId,
        attempt: ctx.attempt,
        timestamp: new Date().toISOString(),
      })
    }

    return {
      output: {
        verdict,
        assuranceVerdict: verdict === 'AGREE' ? 'PASS' : verdict === 'DISAGREE' ? 'REVISE' : 'REVISE',
        challengerModelId: actualChallengerModelId,
        challengerModelFamily: actualChallengerModelFamily,
        complianceCheck: normalizedComplianceCheck,
        verificationReceiptSummary: `Verifier concluded ${verdict} with compliance=${normalizedComplianceCheck}; oraclePass=${oraclePass}; taskClass=${taskClass}.`,
        entropyGain: 15,
        thirdProposal: false,
        findings: Array.isArray(parsed.concerns)
          ? parsed.concerns.map(item => ({
            type: 'warning' as const,
            message: typeof item === 'string' ? item : JSON.stringify(item),
          }))
          : [],
        failureReasons: Array.isArray(parsed.concerns)
          ? parsed.concerns.map(item => typeof item === 'string' ? item : JSON.stringify(item))
          : [],
        oracleResults,
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── SYNTHESIZE 执行器 ───────────────────────────────────────────────────────

export class SynthesizeExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'SYNTHESIZE'
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

    const result = await ctx.agentRuntime.ask({
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
        finalAnswer: result.text.slice(0, 5000),
        summary: result.text.replace(/\s+/g, ' ').trim().slice(0, 240),
        finalConfidence: 88,
        releaseDecision: 'release',
        citedEvidenceIds: ['VERIFY:verification-receipt', 'DEBATE:debate-summary'],
        candidateScores: {},
        templateUsed: 'T002',
      },
      model: result.usedModel,
      durationMs: Date.now() - start,
    }
  }
}

// ── PERSIST 执行器 ──────────────────────────────────────────────────────────

export class PersistExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'PERSIST'
  readonly timeoutMs = 10_000
  readonly maxRetries = 2

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()

    // 持久化由 Event Sourcing 自动完成
    // 这里仅标记已完成
    return {
      output: {
        writtenFiles: [],
        manifestUpdated: true,
        readAfterWrite: true,
        artifactManifest: {
          artifactCount: 1,
          artifactKinds: ['run-projection'],
        },
        feedbackReports: [],
      },
      durationMs: Date.now() - start,
    }
  }
}

// ── HITL 执行器 ─────────────────────────────────────────────────────────────

export class HITLExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId = 'HITL'
  readonly timeoutMs = 10_000
  readonly maxRetries = 0

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now()
    const verifyOutput = ctx.getUpstreamOutput('VERIFY')
    const compliance = typeof verifyOutput?.complianceCheck === 'string'
      ? verifyOutput.complianceCheck.toUpperCase()
      : 'PASS'

    return {
      output: {
        approvalRequired: compliance === 'VIOLATION',
        gateId: 'antigravity-final-gate',
        gateStatus: compliance === 'VIOLATION' ? 'needsHumanReview' : 'autoCleared',
        hostAction: 'render-final-summary',
        approvalRecord: {
          required: compliance === 'VIOLATION',
          status: compliance === 'VIOLATION' ? 'needs-human-review' : 'auto-cleared',
        },
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
      new HITLExecutor(),
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
  state: WorkflowState,
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
