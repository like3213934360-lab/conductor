/**
 * Antigravity Workflow Runtime — Handoff Protocol
 *
 * 当前主链只保留 artifact/context handoff contract，
 * 不再保留旧的 swarm router / federation bus 演示层。
 */

/** Handoff 打包后的上下文 */
export interface PackedContext {
  sourceAgentId: string
  targetAgentId: string
  taskId: string
  runId: string
  currentStage: string
  conversationSummary: string
  constraints: string[]
  payload: Record<string, unknown>
  packedAt: string
  checksum: string
}

/** Handoff 结果 */
export interface HandoffResult {
  success: boolean
  sourceAgentId: string
  targetAgentId: string
  taskId: string
  transferMs: number
  error?: string
}

export class HandoffProtocol {
  pack(params: {
    sourceAgentId: string
    targetAgentId: string
    taskId: string
    runId: string
    currentStage: string
    conversationSummary: string
    constraints?: string[]
    payload?: Record<string, unknown>
  }): PackedContext {
    const packed: PackedContext = {
      sourceAgentId: params.sourceAgentId,
      targetAgentId: params.targetAgentId,
      taskId: params.taskId,
      runId: params.runId,
      currentStage: params.currentStage,
      conversationSummary: params.conversationSummary,
      constraints: params.constraints ?? [],
      payload: params.payload ?? {},
      packedAt: new Date().toISOString(),
      checksum: '',
    }
    packed.checksum = HandoffProtocol.computeChecksum(packed)
    return packed
  }

  unpack(packed: PackedContext): { valid: boolean; context: PackedContext; error?: string } {
    const expected = HandoffProtocol.computeChecksum(packed)
    if (packed.checksum !== expected) {
      return { valid: false, context: packed, error: `Checksum mismatch: expected ${expected}, got ${packed.checksum}` }
    }
    return { valid: true, context: packed }
  }

  async transfer(
    params: Parameters<HandoffProtocol['pack']>[0],
    transport: (packed: PackedContext) => Promise<boolean>,
  ): Promise<HandoffResult> {
    const start = Date.now()
    const packed = this.pack(params)

    try {
      const delivered = await transport(packed)
      return {
        success: delivered,
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
        taskId: params.taskId,
        transferMs: Date.now() - start,
        error: delivered ? undefined : 'Transport returned false',
      }
    } catch (err) {
      return {
        success: false,
        sourceAgentId: params.sourceAgentId,
        targetAgentId: params.targetAgentId,
        taskId: params.taskId,
        transferMs: Date.now() - start,
        error: String(err),
      }
    }
  }

  static computeChecksum(ctx: PackedContext): string {
    const data = `${ctx.sourceAgentId}:${ctx.targetAgentId}:${ctx.taskId}:${ctx.runId}:${ctx.currentStage}:${ctx.packedAt}`
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      const chr = data.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0
    }
    return `cksum-${Math.abs(hash).toString(36)}`
  }
}
