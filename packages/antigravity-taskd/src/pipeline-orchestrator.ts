/**
 * Pipeline Orchestrator — V1.1.0 Chain of Responsibility
 *
 * 纯粹的阶段驱动器：按顺序 execute 每个 PipelineStage。
 * 不包含任何 AI 推理或文件解析逻辑。
 * 职责：
 *  1. 按注册顺序调用各阶段
 *  2. 在阶段间检查 AbortSignal（throw 而非 return！）
 *  3. 异常透传（不吞没错误）
 */
import type { PipelineContext, PipelineStage } from './pipeline-context.js'

export class PipelineOrchestrator {
  private readonly stages: PipelineStage[]

  constructor(stages: PipelineStage[]) {
    this.stages = stages
  }

  async run(ctx: PipelineContext): Promise<void> {
    for (const stage of this.stages) {
      // 🛡️ 严格中断：throw 而非 return
      // 如果使用 return，timeout 触发的 abort 会导致 pipeline 静默退出，
      // job 停留在非终态（zombie），永远不会被 catch 处理。
      if (ctx.signal.aborted) {
        throw new Error('[Pipeline] Aborted before stage execution')
      }
      await stage.execute(ctx)
    }
    // 最终执行完毕后再检测一次
    if (ctx.signal.aborted) {
      throw new Error('[Pipeline] Aborted after final stage')
    }
  }
}
