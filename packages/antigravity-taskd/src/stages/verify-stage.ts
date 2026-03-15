/**
 * VERIFY Stage — 验证阶段 (含 Reflexion loop + VFS 脑裂恢复)
 *
 * 职责：
 *  1. VFS 脑裂检测与恢复
 *  2. 调用 reviewer worker（含 retry）
 *  3. LSP Reflexion 闭环（最多 MAX_STEPS=2 轮）
 *  4. ReflexionFailedError 降级处理
 *  5. 保存 Journal checkpoint
 *
 * 读取 ctx.aggregate, ctx.shardResults
 * 写入 ctx.verify, ctx.pendingFiles
 */
import type { PipelineContext, PipelineStage } from '../pipeline-context.js'
import type { ShardAnalysis, TaskStageId, VerifyAnalysis } from '../schema.js'
import { buildVerifyPrompt } from '../prompts.js'
import { parseStructuredJson } from '../parsing.js'
import {
  DefaultReflexionStateMachine,
  ReflexionFailedError,
} from '../cognitive/index.js'
import { withRetry } from './aggregate-stage.js'

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function coerceVerify(raw: string): VerifyAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    verdict: typeof parsed?.verdict === 'string' ? parsed.verdict : 'warn',
    coverageGaps: asStringArray(parsed?.coverageGaps),
    riskFindings: asStringArray(parsed?.riskFindings),
    followups: asStringArray(parsed?.followups),
  }
}

export class VerifyStage implements PipelineStage {
  readonly stageId: TaskStageId = 'VERIFY'

  async execute(ctx: PipelineContext): Promise<void> {
    const { snapshot, signal, jobId, cogCtx } = ctx
    const aggregate = ctx.aggregate!
    const shardResults = ctx.shardResults

    ctx.markStageStarted('VERIFY', 'Running reviewer with LSP reflexion')
    const verifyDecision = cogCtx.routerPolicy.route('verify')
    let verify: VerifyAnalysis
    let resumedVerify = ctx.resumedVerify

    const reflexion = new DefaultReflexionStateMachine()

    // 脑裂恢复：vfsPendingPaths 有记录 + verdict 为 unverified → 重建 pendingFiles
    if (
      ctx.resumedVfsPendingPaths.length > 0 &&
      resumedVerify?.verdict === 'unverified' &&
      snapshot.mode === 'write'
    ) {
      console.warn(
        `[taskd] Detected VFS-Journal desync: ${ctx.resumedVfsPendingPaths.length} file(s) ` +
        `were pending commit at last crash. Re-entering Reflexion.`,
      )
      const suggestedEdits = (aggregate as any)?.suggestedEdits as Record<string, string> | undefined
      if (suggestedEdits) {
        for (const p of ctx.resumedVfsPendingPaths) {
          if (suggestedEdits[p]) {
            ctx.pendingFiles[p] = suggestedEdits[p]
          }
        }
      }
      resumedVerify = undefined
    }

    try {
      const verifyResult = await withRetry(
        () => ctx.runWorker(
          snapshot, verifyDecision.backend, 'reviewer',
          buildVerifyPrompt(snapshot.goal, aggregate, shardResults),
          [], 'VERIFY',
        ),
        'VERIFY',
        2,
        signal,
      )
      verify = coerceVerify(verifyResult.text)

      // ── LSP Reflexion loop（仅 write 模式且有生成文件时触发） ──
      if (snapshot.mode === 'write' && Object.keys(ctx.pendingFiles).length > 0) {
        while (!reflexion.exhausted) {
          const step = await reflexion.step(
            cogCtx.vfs,
            ctx.pendingFiles,
            snapshot.goal,
            cogCtx.lsp,
          )

          if (step.verdict === 'pass') {
            await cogCtx.vfs.commit()
            console.info(`[taskd] Reflexion passed after ${step.attempt} step(s)`)
            break
          }

          if (step.verdict === 'retry' && step.patchPrompt) {
            console.warn(`[taskd] Reflexion retry ${step.attempt}/${reflexion.MAX_STEPS}: ${step.diagnostics.length} errors`)
            const generateDecision = cogCtx.routerPolicy.route('generate')
            const patchResult = await ctx.runWorker(
              snapshot, generateDecision.backend, 'writer',
              step.patchPrompt,
              [], 'VERIFY',
            )
            Object.assign(ctx.pendingFiles, { 'patch_result.ts': patchResult.text })
          }
        }
      }
    } catch (error) {
      if (error instanceof ReflexionFailedError) {
        const msg = `Reflexion failed after ${error.steps.length} steps`
        console.warn(`[taskd] ${msg}`)
        verify = {
          verdict: 'unverified',
          coverageGaps: [`REFLEXION_FAILED: ${msg}`],
          riskFindings: [msg],
          followups: error.lastDiagnostics.map(d => `Fix: [${d.file}:${d.line}] ${d.message}`),
        }
      } else {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] VERIFY failed, skipping verification: ${msg}`)
        verify = {
          verdict: 'unverified',
          coverageGaps: [`VERIFY_SKIPPED: ${msg}`],
          riskFindings: [`Verification skipped: ${msg}`],
          followups: [],
        }
      }
      snapshot.summary.riskFindings = unique([
        ...snapshot.summary.riskFindings,
        verify.riskFindings[0] ?? 'VERIFY_SKIPPED',
      ])
    } finally {
      cogCtx.blackboard.dispose()
    }

    snapshot.summary.verdict = verify.verdict
    snapshot.summary.coverageGaps = verify.coverageGaps
    snapshot.summary.riskFindings = unique([...snapshot.summary.riskFindings, ...verify.riskFindings])
    snapshot.summary.openQuestions = unique([...snapshot.summary.openQuestions, ...verify.followups])
    ctx.markStageCompleted('VERIFY', verify.verdict)
    ctx.emitJobEvent('verify.completed', {
      verdict: verify.verdict,
      coverageGaps: verify.coverageGaps,
      riskFindings: verify.riskFindings,
    })

    // 🏗️ Journal: VERIFY checkpoint
    await ctx.journal.saveCheckpoint(jobId, 'VERIFY', {
      verify,
      vfsPendingPaths: Object.keys(ctx.pendingFiles),
    })

    ctx.verify = verify
  }
}
