/**
 * Conductor AGC — AgcAgentRuntime 契约接口
 *
 * Phase 7: 依赖反转 — AGCRunDriver 和 NodeExecutor 通过此接口
 * 访问 AI 能力，不再直接依赖 ConductorHubService。
 *
 * 实现方: conductor-hub-core 的 ConductorHubService
 * 消费方: agc-run-driver.ts, node-executor.ts
 */

/** AI 调用结果 */
export interface AgcAskResult {
  text: string
  usedModel: string
  didFallback?: boolean
  warningLines: string[]
}

/** Consensus 投票结果 */
export interface AgcConsensusResult {
  judgeText: string
  judgeModel: string
  candidates: Array<{
    label: string
    text: string
    score?: number
  }>
  totalMs: number
}

/**
 * AGC 运行时 — 节点执行器访问 AI 能力的统一接口
 *
 * 特点:
 * - 纯 AI 调用语义，不含文件上下文注入（由 MCP 工具层处理）
 * - 支持 AbortSignal 取消
 * - 最小化接口: 仅暴露 AGCRunDriver 实际使用的 4 个方法
 */
export interface AgcAgentRuntime {
  /** 单模型智能路由查询 */
  ask(options: {
    message: string
    provider?: string
    systemPrompt?: string
    signal?: AbortSignal
  }): Promise<AgcAskResult>

  /** 通过 Codex CLI 执行编码任务 */
  codexTask(task: string, workingDir?: string, signal?: AbortSignal): Promise<string>

  /** 通过 Gemini CLI 执行推理任务 */
  geminiTask(prompt: string, model?: string, workingDir?: string, signal?: AbortSignal): Promise<string>

  /** 多模型投票引擎 */
  consensus(options: {
    message: string
    criteria?: string
    providers?: string[]
    judge?: string
  }): Promise<AgcConsensusResult>
}
