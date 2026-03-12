/**
 * Antigravity Workflow Runtime — WorkflowAgentRuntime 契约接口
 *
 * WorkflowRunDriver 和 NodeExecutor 通过此接口访问 AI 能力，
 * 不再直接依赖 AntigravityModelService。
 *
 * 实现方: antigravity-model-core 的 AntigravityModelService
 * 消费方: workflow-run-driver.ts, node-executor.ts
 */

/** AI 调用结果 */
export interface WorkflowAskResult {
  text: string
  usedModel: string
  didFallback?: boolean
  warningLines: string[]
}

/** Consensus 投票结果 */
export interface WorkflowConsensusResult {
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
 * Workflow 运行时 — 节点执行器访问 AI 能力的统一接口
 *
 * 特点:
 * - 纯 AI 调用语义，不含文件上下文注入（由 MCP 工具层处理）
 * - 支持 AbortSignal 取消
 * - 最小化接口: 仅暴露 WorkflowRunDriver 实际使用的 4 个方法
 */
export interface WorkflowAgentRuntime {
  /** 单模型智能路由查询 */
  ask(options: {
    message: string
    modelHint?: string
    systemPrompt?: string
    signal?: AbortSignal
  }): Promise<WorkflowAskResult>

  /** 通过 Codex CLI 执行编码任务 */
  codexTask(task: string, workingDir?: string, signal?: AbortSignal): Promise<string>

  /** 通过 Gemini CLI 执行推理任务 */
  geminiTask(prompt: string, model?: string, workingDir?: string, signal?: AbortSignal): Promise<string>

  /** 多模型投票引擎 */
  consensus(options: {
    message: string
    criteria?: string
    modelHints?: string[]
    judgeModelHint?: string
  }): Promise<WorkflowConsensusResult>
}
