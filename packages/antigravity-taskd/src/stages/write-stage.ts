/**
 * WRITE + FINALIZE Stage — 写入 + 收尾阶段
 *
 * 职责：
 *  1. Governance Gate: 强制授权检查
 *  2. 批量串行写入（WRITE_BATCH_SIZE 分批）
 *  3. FINALIZE: 组装终极答案 + SLSA Provenance
 *  4. Journal 清理 + 完成事件发射
 *
 * 读取 ctx.manifest, ctx.aggregate, ctx.verify, ctx.shardOutcomes
 * 写入 ctx.writeAnalysis
 */
import type { PipelineContext, PipelineStage } from '../pipeline-context.js'
import type { TaskStageId, WriteAnalysis } from '../schema.js'
import { buildWritePrompt, buildFinalAnswer } from '../prompts.js'
import { parseStructuredJson } from '../parsing.js'

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function coerceWrite(raw: string): WriteAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    changePlan: typeof parsed?.changePlan === 'string' ? parsed.changePlan : raw.trim().slice(0, 800),
    targetFiles: asStringArray(parsed?.targetFiles),
    executionLog: asStringArray(parsed?.executionLog),
    diffSummary: typeof parsed?.diffSummary === 'string' ? parsed.diffSummary : raw.trim().slice(0, 800),
  }
}

const WRITE_BATCH_SIZE = 3

function nowIso(): string {
  return new Date().toISOString()
}

export class WriteStage implements PipelineStage {
  readonly stageId: TaskStageId = 'WRITE'

  async execute(ctx: PipelineContext): Promise<void> {
    const { snapshot, signal, jobId } = ctx
    const manifest = ctx.manifest!
    const aggregate = ctx.aggregate!
    const verify = ctx.verify!
    const degraded = ctx.shardOutcomes.filter(o => o.status === 'degraded').length

    // ── WRITE 阶段（仅 write 模式） ──────────────────────────────
    let writeAnalysis: WriteAnalysis | undefined
    if (snapshot.mode === 'write') {
      // 🛡️ Governance Gate
      const govDecision = await ctx.governance.authorize({
        aggregate, verify, merkleRoot: ctx.merkleRoot ?? '',
        shardCount: ctx.shardOutcomes.length,
        degradedShards: degraded,
        jobMode: snapshot.mode,
      })
      if (!govDecision.authorized) {
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `Governance BLOCKED write: ${govDecision.reason}`,
        ])
        throw new Error(`Governance rejected write: ${govDecision.reason}`)
      }
      if (govDecision.warnings.length > 0) {
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `Governance warnings: ${govDecision.warnings.join(', ')}`,
        ])
      }

      const writeStage = snapshot.graph.find(s => s.id === 'WRITE')
      if (writeStage) writeStage.status = 'pending'
      ctx.markStageStarted('WRITE', 'Running batched writer')
      ctx.emitJobEvent('write.started', {})

      const writeTargetFiles = unique([
        ...snapshot.artifacts.changedFiles,
        ...manifest.relevantPaths.slice(0, 12),
      ])

      // 将目标文件切分成 batch
      const writeBatches: string[][] = []
      for (let i = 0; i < writeTargetFiles.length; i += WRITE_BATCH_SIZE) {
        writeBatches.push(writeTargetFiles.slice(i, i + WRITE_BATCH_SIZE))
      }

      const batchResults: WriteAnalysis[] = []
      const allChangedFiles: string[] = []
      let lastDiff = ''

      for (let batchIdx = 0; batchIdx < writeBatches.length; batchIdx++) {
        const batch = writeBatches[batchIdx]
        if (signal.aborted) break

        ctx.emitJobEvent('worker.progress', {
          phase: 'working',
          message: `Write batch ${batchIdx + 1}/${writeBatches.length} (${batch.length} files)`,
          progress: batchIdx / writeBatches.length,
        })

        try {
          const writeResult = await ctx.runWorker(
            snapshot, 'codex', 'writer',
            buildWritePrompt(snapshot.goal, aggregate, verify, batch),
            batch, 'WRITE',
          )
          const parsed = coerceWrite(writeResult.text)
          batchResults.push(parsed)
          allChangedFiles.push(...parsed.targetFiles, ...writeResult.changedFiles)
          if (writeResult.diff) lastDiff = writeResult.diff
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          console.warn(`[taskd] write batch ${batchIdx + 1} failed: ${msg}`)
          snapshot.summary.riskFindings = unique([
            ...snapshot.summary.riskFindings,
            `Write batch ${batchIdx + 1}/${writeBatches.length} failed: ${msg}`,
          ])
        }
      }

      writeAnalysis = {
        changePlan: batchResults.map(r => r.changePlan).filter(Boolean).join('\n---\n'),
        targetFiles: unique(batchResults.flatMap(r => r.targetFiles)),
        executionLog: batchResults.flatMap(r => r.executionLog),
        diffSummary: batchResults.map(r => r.diffSummary).filter(Boolean).join('\n'),
      }

      snapshot.artifacts.changedFiles = unique([...snapshot.artifacts.changedFiles, ...allChangedFiles])
      if (lastDiff) snapshot.artifacts.latestDiff = lastDiff

      ctx.markStageCompleted('WRITE',
        `${batchResults.length}/${writeBatches.length} batches completed`,
      )
      ctx.emitJobEvent('write.completed', {
        targetFiles: writeAnalysis.targetFiles,
        diffSummary: writeAnalysis.diffSummary,
        batchCount: writeBatches.length,
        successCount: batchResults.length,
      })
    }

    if (signal.aborted) return

    // ── FINALIZE 阶段 ────────────────────────────────────────────
    ctx.markStageStarted('FINALIZE', 'Composing final answer')
    snapshot.summary.finalAnswer = buildFinalAnswer(
      manifest,
      aggregate,
      verify,
      writeAnalysis ? { targetFiles: writeAnalysis.targetFiles, diffSummary: writeAnalysis.diffSummary } : undefined,
    )

    // 📜 SLSA Provenance
    if (writeAnalysis) {
      ;(ctx.provenance as any).recordOutputFiles(writeAnalysis.targetFiles)
    }
    const signedAttestation = ctx.provenance.assemble(snapshot)

    // 🏗️ Journal: WRITE checkpoint
    if (writeAnalysis) {
      await ctx.journal.saveCheckpoint(jobId, 'WRITE', { writeResults: [writeAnalysis] })
    }

    ctx.markStageCompleted('FINALIZE', 'Completed')
    snapshot.status = 'completed'
    snapshot.updatedAt = nowIso()

    // 🗑️ Journal 清理
    ctx.journal.purgeCheckpoints(jobId)
    ctx.emitJobEvent('job.completed', {
      verdict: snapshot.summary.verdict,
      changedFiles: snapshot.artifacts.changedFiles,
      slsaProvenance: signedAttestation,
    })

    ctx.writeAnalysis = writeAnalysis
  }
}
