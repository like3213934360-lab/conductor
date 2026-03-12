/**
 * Antigravity Workflow Runtime — OpenTelemetry DAG Tracer
 *
 * 为 DAG 引擎提供标准化可观测性:
 * - 每个 DAG run → root span
 * - 每个 node 执行 → child span
 * - LLM 调用 → GenAI semantic conventions span
 * - Event Sourcing 事件 → OTel span events
 *
 * 参考:
 * - OpenTelemetry GenAI Semantic Conventions (2025)
 * - LangSmith trace 模型
 */

/**
 * GenAI Semantic Conventions (draft, 2025)
 * 参考: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GenAiAttributes = {
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  OPERATION: 'gen_ai.operation.name',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
  RESPONSE_FINISH_REASON: 'gen_ai.response.finish_reasons',
} as const

/** Antigravity DAG 属性 */
export const DagAttributes = {
  RUN_ID: 'antigravity.dag.runId',
  GRAPH_ID: 'antigravity.dag.graphId',
  NODE_ID: 'antigravity.dag.nodeId',
  NODE_NAME: 'antigravity.dag.nodeName',
  NODE_STATUS: 'antigravity.dag.nodeStatus',
  LANE: 'antigravity.dag.lane',
  RISK_LEVEL: 'antigravity.dag.riskLevel',
  DREAD_SCORE: 'antigravity.dag.dreadScore',
  LOOP_ITERATION: 'antigravity.dag.loopIteration',
  EVENT_TYPE: 'antigravity.event.type',
  EVENT_VERSION: 'antigravity.event.version',
} as const

// ── 可观测性接口 (不依赖 OTel 包，允许适配) ────────────────────────

/** 轻量级 Span 接口 (脱离 OTel 具体包) */
export interface ISpan {
  setAttribute(key: string, value: string | number | boolean): void
  setAttributes(attrs: Record<string, string | number | boolean | undefined>): void
  addEvent(name: string, attrs?: Record<string, string | number | boolean>): void
  setStatus(status: { code: 'OK' | 'ERROR'; message?: string }): void
  recordException(error: Error): void
  end(): void
}

/** Tracer 接口 */
export interface ITracer {
  startSpan(name: string, attrs?: Record<string, string | number | boolean>): ISpan
  startChildSpan(parent: ISpan, name: string, attrs?: Record<string, string | number | boolean>): ISpan
}

/** LLM 调用元数据 */
export interface LLMCallMetadata {
  system: string        // e.g. 'deepseek', 'gemini', 'codex'
  model: string         // e.g. 'deepseek-chat'
  operation: 'chat' | 'completion' | 'embedding'
  maxTokens?: number
  temperature?: number
}

/** LLM 使用量 */
export interface LLMUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// ── DAG Engine Tracer ──────────────────────────────────────────────

/** DAG 运行追踪上下文 */
export interface DagTracingContext {
  runId: string
  rootSpan: ISpan
  nodeSpans: Map<string, ISpan>
}

/**
 * DagEngineTracer — DAG 可观测性追踪器
 *
 * 使用方式:
 * 1. const ctx = tracer.startRun(runId, graphId)
 * 2. const nodeSpan = tracer.startNode(ctx, nodeId, nodeName)
 * 3. const llmSpan = tracer.startLLMCall(nodeSpan, metadata)
 * 4. tracer.recordLLMUsage(llmSpan, usage)
 * 5. tracer.endSpan(llmSpan)
 * 6. tracer.recordEvent(nodeSpan, event)
 * 7. tracer.endNode(ctx, nodeId, 'completed')
 * 8. tracer.endRun(ctx, 'completed')
 */
export class DagEngineTracer {
  private readonly tracer: ITracer

  constructor(tracer: ITracer) {
    this.tracer = tracer
  }

  /** 开始 DAG 运行追踪 */
  startRun(runId: string, graphId?: string): DagTracingContext {
    const rootSpan = this.tracer.startSpan(`dag.run`, {
      [DagAttributes.RUN_ID]: runId,
      ...(graphId ? { [DagAttributes.GRAPH_ID]: graphId } : {}),
    })

    return {
      runId,
      rootSpan,
      nodeSpans: new Map(),
    }
  }

  /** 开始节点执行追踪 */
  startNode(
    ctx: DagTracingContext,
    nodeId: string,
    nodeName: string,
    iteration?: number,
  ): ISpan {
    const span = this.tracer.startChildSpan(ctx.rootSpan, `dag.node:${nodeName}`, {
      [DagAttributes.NODE_ID]: nodeId,
      [DagAttributes.NODE_NAME]: nodeName,
      [DagAttributes.NODE_STATUS]: 'running',
      ...(iteration !== undefined ? { [DagAttributes.LOOP_ITERATION]: iteration } : {}),
    })
    ctx.nodeSpans.set(nodeId, span)
    return span
  }

  /** 结束节点执行追踪 */
  endNode(ctx: DagTracingContext, nodeId: string, status: string): void {
    const span = ctx.nodeSpans.get(nodeId)
    if (!span) return
    span.setAttribute(DagAttributes.NODE_STATUS, status)
    span.setStatus({
      code: status === 'completed' ? 'OK' : 'ERROR',
      ...(status === 'failed' ? { message: `Node ${nodeId} failed` } : {}),
    })
    span.end()
    ctx.nodeSpans.delete(nodeId)
  }

  /** 开始 LLM 调用追踪 (GenAI Semantic Conventions) */
  startLLMCall(parentSpan: ISpan, metadata: LLMCallMetadata): ISpan {
    const attrs: Record<string, string | number | boolean | undefined> = {
      [GenAiAttributes.SYSTEM]: metadata.system,
      [GenAiAttributes.REQUEST_MODEL]: metadata.model,
      [GenAiAttributes.OPERATION]: metadata.operation,
    }
    if (metadata.maxTokens !== undefined) attrs[GenAiAttributes.REQUEST_MAX_TOKENS] = metadata.maxTokens
    if (metadata.temperature !== undefined) attrs[GenAiAttributes.REQUEST_TEMPERATURE] = metadata.temperature

    return this.tracer.startChildSpan(parentSpan, `gen_ai.${metadata.operation}`, attrs as Record<string, string | number | boolean>)
  }

  /** 记录 LLM Token 使用量 */
  recordLLMUsage(span: ISpan, usage: LLMUsage): void {
    span.setAttributes({
      [GenAiAttributes.USAGE_INPUT_TOKENS]: usage.inputTokens,
      [GenAiAttributes.USAGE_OUTPUT_TOKENS]: usage.outputTokens,
      [GenAiAttributes.USAGE_TOTAL_TOKENS]: usage.totalTokens,
    })
  }

  /** 记录 Event Sourcing 事件到 Span */
  recordEvent(
    span: ISpan,
    eventType: string,
    eventVersion: number,
    payload?: Record<string, string | number | boolean>,
  ): void {
    span.addEvent(eventType, {
      [DagAttributes.EVENT_TYPE]: eventType,
      [DagAttributes.EVENT_VERSION]: eventVersion,
      ...payload,
    })
  }

  /** 记录风险路由决策 */
  recordRiskDecision(ctx: DagTracingContext, lane: string, riskLevel: string, dreadScore: number): void {
    ctx.rootSpan.setAttributes({
      [DagAttributes.LANE]: lane,
      [DagAttributes.RISK_LEVEL]: riskLevel,
      [DagAttributes.DREAD_SCORE]: dreadScore,
    })
  }

  /** 结束 DAG 运行追踪 */
  endRun(ctx: DagTracingContext, finalStatus: 'completed' | 'failed'): void {
    // 结束所有未关闭的 node span
    for (const [nodeId, span] of ctx.nodeSpans) {
      span.setAttribute(DagAttributes.NODE_STATUS, 'abandoned')
      span.setStatus({ code: 'ERROR', message: `Run ended while node ${nodeId} was still active` })
      span.end()
    }
    ctx.nodeSpans.clear()

    ctx.rootSpan.setStatus({
      code: finalStatus === 'completed' ? 'OK' : 'ERROR',
    })
    ctx.rootSpan.end()
  }

  /** 通用 Span 结束 */
  endSpan(span: ISpan, error?: Error): void {
    if (error) {
      span.recordException(error)
      span.setStatus({ code: 'ERROR', message: error.message })
    } else {
      span.setStatus({ code: 'OK' })
    }
    span.end()
  }
}

// ── NoOp 实现 (默认/无 OTel 环境) ──────────────────────────────────

/** 空操作 Span — OTel 未配置时使用 */
export class NoOpSpan implements ISpan {
  setAttribute(): void { /* noop */ }
  setAttributes(): void { /* noop */ }
  addEvent(): void { /* noop */ }
  setStatus(): void { /* noop */ }
  recordException(): void { /* noop */ }
  end(): void { /* noop */ }
}

/** 空操作 Tracer */
export class NoOpTracer implements ITracer {
  startSpan(): ISpan { return new NoOpSpan() }
  startChildSpan(): ISpan { return new NoOpSpan() }
}

/** 创建默认 tracer (无 OTel 依赖时降级为 NoOp) */
export function createDefaultTracer(): DagEngineTracer {
  return new DagEngineTracer(new NoOpTracer())
}
