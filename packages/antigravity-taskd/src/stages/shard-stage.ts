/**
 * SHARD_ANALYZE Stage — 分片分析阶段
 *
 * 职责：
 *  1. Journal replay: 如有恢复数据则跳过分片
 *  2. 根据 ExecutionProfile 选择 single/dual/sharded 策略
 *  3. dual 模式：MoA Fusion 或 Racing 自动切换
 *  4. sharded 模式：滑动窗口并发赛马
 *  5. Merkle Tree 完整性证明 + TOCTOU 深冻结
 *  6. 保存 Journal checkpoint
 *
 * 读取 ctx.manifest
 * 写入 ctx.shardResults, ctx.shardOutcomes, ctx.merkleRoot
 */
import type { PipelineContext, PipelineStage, ShardOutcome } from '../pipeline-context.js'
import type { ShardAnalysis, TaskStageId, WorkerBackend } from '../schema.js'
import { pickSharedFiles, totalBytes, type WorkspaceFileEntry } from '../file-context.js'
import { buildShardPrompt, buildFusionPrompt } from '../prompts.js'
import { computeMerkleRoot } from '../merkle.js'
import { DynamicRouterPolicy } from '../cognitive/index.js'
import { createFallbackScoutManifest, chooseExecutionProfile } from './scout-stage.js'

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

const GLOBAL_TOKEN_LIMIT = 2_000_000

export class ShardStage implements PipelineStage {
  readonly stageId: TaskStageId = 'SHARD_ANALYZE'

  async execute(ctx: PipelineContext): Promise<void> {
    const { snapshot, signal, jobId, cogCtx, workspaceFiles } = ctx
    const manifest = ctx.manifest!

    ctx.markStageStarted('SHARD_ANALYZE', 'Running shard analyzers')
    const relevantEntries = workspaceFiles.filter(file => manifest.relevantPaths.includes(file.path))
    const profile = chooseExecutionProfile(relevantEntries)

    if (ctx.resumedShardResults && ctx.resumedShardOutcomes) {
      // 📀 Journal Replay: 跳过 SHARD，使用持久化数据
      ctx.shardResults.push(...ctx.resumedShardResults)
      for (const o of ctx.resumedShardOutcomes) {
        ctx.shardOutcomes.push({ status: o.status as ShardOutcome['status'], shardId: o.shardId, error: o.error, durationMs: o.durationMs })
      }
      ctx.markStageCompleted('SHARD_ANALYZE', 'Resumed from journal')
    } else if (profile.kind === 'single') {
      await this.executeSingle(ctx, manifest, relevantEntries)
    } else if (profile.kind === 'dual') {
      await this.executeDual(ctx, manifest, relevantEntries)
    } else {
      await this.executeSharded(ctx, manifest, relevantEntries)
    }

    // 统计 shard 执行结果
    const succeeded = ctx.shardOutcomes.filter(o => o.status === 'success').length
    const degraded = ctx.shardOutcomes.filter(o => o.status === 'degraded').length
    const failed = ctx.shardOutcomes.filter(o => o.status === 'failed').length

    if (ctx.shardResults.length === 0) {
      throw new Error(`All ${ctx.shardOutcomes.length} shards failed — no results to aggregate`)
    }

    // 🚨 降级阈值防线
    const MAX_DEGRADATION_RATIO = 0.8
    const unhealthyCount = degraded + failed
    const unhealthyRatio = ctx.shardOutcomes.length > 0 ? unhealthyCount / ctx.shardOutcomes.length : 0
    if (unhealthyRatio > MAX_DEGRADATION_RATIO) {
      throw new Error(
        `Shard health below threshold: ${succeeded} success, ${degraded} degraded, ${failed} failed ` +
        `out of ${ctx.shardOutcomes.length} (${Math.round(unhealthyRatio * 100)}% unhealthy, max allowed ${MAX_DEGRADATION_RATIO * 100}%). ` +
        `Refusing to produce a misleading aggregate from insufficient data.`
      )
    }

    // 🌳 Merkle Tree + TOCTOU 防御
    ctx.merkleRoot = ctx.resumedMerkleRoot ?? computeMerkleRoot(ctx.shardResults, jobId)
    for (const result of ctx.shardResults) {
      Object.freeze(result)
    }
    Object.freeze(ctx.shardResults)

    // 🏗️ Journal: SHARD checkpoint
    if (!ctx.resumedShardResults) {
      await ctx.journal.saveCheckpoint(jobId, 'SHARD_ANALYZE', {
        outcomes: ctx.shardOutcomes.map(o => ({ status: o.status, shardId: o.shardId, error: o.error, durationMs: o.durationMs })),
        results: ctx.shardResults,
      })
    }

    if (degraded > 0 || failed > 0) {
      snapshot.summary.riskFindings = unique([
        ...snapshot.summary.riskFindings,
        `Shard analysis: ${succeeded} success, ${degraded} degraded, ${failed} failed out of ${ctx.shardOutcomes.length}`,
      ])
    }

    ctx.markStageCompleted('SHARD_ANALYZE',
      `${ctx.shardResults.length}/${ctx.shardOutcomes.length} shards produced results (${degraded} degraded, ${failed} failed)`,
    )
  }

  // ── single 模式 ─────────────────────────────────────────────────
  private async executeSingle(ctx: PipelineContext, manifest: any, relevantEntries: WorkspaceFileEntry[]): Promise<void> {
    const { snapshot, cogCtx, jobId } = ctx
    const shard = manifest.shards[0] ?? createFallbackScoutManifest(snapshot.goal, relevantEntries).shards[0]
    if (!shard) throw new Error('No shard available for analysis')
    const singleDecision = cogCtx.routerPolicy.route('analyze')
    ctx.emitJobEvent('shard.started', { shardId: shard.shardId, backends: [singleDecision.backend] })
    const outcome = await ctx.runWorkerSafe(
      snapshot, singleDecision.backend, 'analyzer',
      buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths),
      unique([...shard.sharedFiles, ...shard.filePaths]),
      'SHARD_ANALYZE', shard.shardId,
    )
    ctx.shardOutcomes.push(outcome)
    if (outcome.result) ctx.shardResults.push(outcome.result)
    ctx.emitJobEvent('shard.completed', {
      shardId: shard.shardId, backend: singleDecision.backend, outcome: outcome.status,
    })
  }

  // ── dual 模式（MoA Fusion / Racing 自动切换） ──────────────────
  private async executeDual(ctx: PipelineContext, manifest: any, relevantEntries: WorkspaceFileEntry[]): Promise<void> {
    const { snapshot, signal, jobId, cogCtx } = ctx
    const estimatedShardTokens = Math.ceil(totalBytes(relevantEntries) / 4)
    const burnRate = snapshot.totalTokensUsed / GLOBAL_TOKEN_LIMIT
    const isHighComplexity = estimatedShardTokens > 5_000
    const isBudgetSafe = burnRate < 0.5
    const fusionQuality = cogCtx.routerPolicy instanceof DynamicRouterPolicy
      ? cogCtx.routerPolicy.getFusionQuality()
      : { shouldAutoFuse: true }
    const useFusionMode = (snapshot.enableMoA || (isHighComplexity && isBudgetSafe)) && fusionQuality.shouldAutoFuse
    const shardFilePaths = manifest.relevantPaths.length > 0 ? manifest.relevantPaths : relevantEntries.map((file: WorkspaceFileEntry) => file.path)
    const sharedFiles = pickSharedFiles(shardFilePaths)
    const shardId = 'shard-1'
    const shardPrompt = buildShardPrompt(snapshot.goal, shardId, shardFilePaths)
    const allFilePaths = unique([...sharedFiles, ...shardFilePaths])

    const topCandidates = cogCtx.routerPolicy.routeMulti('analyze', 0, undefined, 2)
    const racingBackends = topCandidates.map(c => c.backend)
    ctx.emitJobEvent('shard.started', { shardId, backends: racingBackends })

    // 组装 RacingCandidate 数组
    const candidates = topCandidates.map(decision => ({
      backend: decision.backend,
      run: async (raceSignal: AbortSignal): Promise<ShardOutcome> => {
        const raceCtrl = new AbortController()
        const propagateAbort = () => raceCtrl.abort()
        raceSignal.addEventListener('abort', propagateAbort, { once: true })
        try {
          return await ctx.runWorkerSafe(
            snapshot, decision.backend, 'analyzer',
            shardPrompt, allFilePaths,
            'SHARD_ANALYZE', `${shardId}:${decision.backend}`,
          )
        } finally {
          raceSignal.removeEventListener('abort', propagateAbort)
        }
      },
      validate: (outcome: ShardOutcome): boolean => {
        if (outcome.status === 'failed') return false
        if (!outcome.result) return false
        if (!outcome.result.summary || outcome.result.summary.length < 10) return false
        return true
      },
      onAborted: () => {
        console.log(`[taskd] 🏁 Racing loser: ${decision.backend} aborted for shard ${shardId}`)
      },
    }))

    try {
      if (useFusionMode) {
        await this.executeMoAFusion(ctx, candidates, shardId, allFilePaths, shardPrompt, estimatedShardTokens, burnRate)
      } else {
        // 🏎️ RACING MODE
        const raceResult = await cogCtx.racingExecutor.race<ShardOutcome>(candidates, signal, 'analyze')
        const winnerOutcome = raceResult.result
        ctx.shardOutcomes.push(winnerOutcome)
        if (winnerOutcome.result) ctx.shardResults.push(winnerOutcome.result)
        ctx.emitJobEvent('shard.completed', {
          shardId,
          backend: raceResult.winner,
          outcome: winnerOutcome.status,
          racingElapsedMs: raceResult.elapsedMs,
          abortedBackends: raceResult.abortedBackends,
        })
        console.log(`[taskd] 🏆 Racing winner: ${raceResult.winner} (${raceResult.elapsedMs}ms), aborted: [${raceResult.abortedBackends.join(', ')}]`)
      }
    } catch (raceError) {
      console.warn(`[taskd] All racing candidates failed for shard ${shardId}:`, raceError)
      ctx.shardOutcomes.push({
        status: 'failed',
        shardId,
        error: raceError instanceof Error ? raceError.message : String(raceError),
        durationMs: 0,
      })
    }
  }

  // ── MoA Fusion 子流程 ──────────────────────────────────────────
  private async executeMoAFusion(
    ctx: PipelineContext,
    candidates: any[],
    shardId: string,
    allFilePaths: string[],
    shardPrompt: string,
    estimatedShardTokens: number,
    burnRate: number,
  ): Promise<void> {
    const { snapshot, signal, jobId, cogCtx } = ctx
    console.log(`[taskd] 🧬 MoA Fusion mode activated for shard ${shardId} (estimatedTokens=${estimatedShardTokens}, burnRate=${burnRate.toFixed(3)})`)

    const FUSION_TIMEOUT_MS = 120_000
    const fusionResult = await cogCtx.racingExecutor.fuse<ShardOutcome>(candidates, signal, FUSION_TIMEOUT_MS, 'analyze')

    if (fusionResult.canFuse) {
      const draftTexts = fusionResult.drafts.map((d: any, i: number) => {
        const analysis = d.result.result
        return analysis ? JSON.stringify(analysis) : `[Draft ${i + 1}: no analysis from ${d.backend}]`
      })
      const synthesizerCandidates = cogCtx.routerPolicy.routeMulti('verify', 0, undefined, 1)
      const synthesizerBackend = synthesizerCandidates[0]?.backend ?? 'codex'
      const fusionPrompt = buildFusionPrompt(draftTexts[0]!, draftTexts[1]!, snapshot.goal)

      console.log(`[taskd] 🧬 Sending fusion prompt to synthesizer: ${synthesizerBackend}`)
      const synthOutcome = await ctx.runWorkerSafe(
        snapshot, synthesizerBackend, 'analyzer',
        fusionPrompt, allFilePaths,
        'SHARD_ANALYZE', `${shardId}:fusion:${synthesizerBackend}`,
      )

      if (synthOutcome.status !== 'failed' && synthOutcome.result) {
        ctx.shardOutcomes.push(synthOutcome)
        ctx.shardResults.push(synthOutcome.result)
        ctx.emitJobEvent('shard.completed', {
          shardId,
          mode: 'fusion',
          synthesizer: synthesizerBackend,
          proposers: fusionResult.drafts.map((d: any) => d.backend),
          outcome: synthOutcome.status,
          fusionElapsedMs: fusionResult.elapsedMs,
        })
        console.log(`[taskd] 🧬 Fusion complete: ${synthesizerBackend} synthesized ${fusionResult.drafts.length} drafts (${fusionResult.elapsedMs}ms)`)

        // 📊 融合质量追踪
        if (cogCtx.routerPolicy instanceof DynamicRouterPolicy) {
          const fusionConf = synthOutcome.result.confidence ?? 0
          const draftConfs = fusionResult.drafts
            .map((d: any) => d.result.result?.confidence ?? 0)
            .filter((c: number) => c > 0)
          if (draftConfs.length > 0) {
            cogCtx.routerPolicy.ingestFusionQuality(fusionConf, draftConfs)
            const avgDraft = draftConfs.reduce((a: number, b: number) => a + b, 0) / draftConfs.length
            const delta = fusionConf - avgDraft
            console.log(`[taskd] 📊 Fusion quality delta: ${delta > 0 ? '+' : ''}${delta.toFixed(3)} (fused=${fusionConf.toFixed(3)}, avgDraft=${avgDraft.toFixed(3)})`)
          }
        }
      } else {
        // 🛡️ 降级回退 1：fusion 失败 → 采纳第一份草稿
        console.warn(`[taskd] 🧬 Fusion synthesizer failed, falling back to first draft`)
        const fallback = fusionResult.drafts[0]!
        ctx.shardOutcomes.push(fallback.result)
        if (fallback.result.result) ctx.shardResults.push(fallback.result.result)
        ctx.emitJobEvent('shard.completed', {
          shardId, backend: fallback.backend, outcome: fallback.result.status,
          degraded: 'fusion_synthesizer_failed',
        })
      }
    } else {
      // 🛡️ 降级回退 2：只有 1 份草稿 → 跳过融合
      console.log(`[taskd] 🧬 Only ${fusionResult.drafts.length} draft(s) passed validation, skipping fusion`)
      const singleDraft = fusionResult.drafts[0]!
      ctx.shardOutcomes.push(singleDraft.result)
      if (singleDraft.result.result) ctx.shardResults.push(singleDraft.result.result)
      ctx.emitJobEvent('shard.completed', {
        shardId, backend: singleDraft.backend, outcome: singleDraft.result.status,
        degraded: 'single_draft_only',
      })
    }
  }

  // ── sharded 模式（每 Shard 独立赛马） ─────────────────────────
  private async executeSharded(ctx: PipelineContext, manifest: any, relevantEntries: WorkspaceFileEntry[]): Promise<void> {
    const { snapshot, signal, jobId, cogCtx } = ctx
    const shards = manifest.shards.length > 0 ? manifest.shards : createFallbackScoutManifest(snapshot.goal, relevantEntries).shards
    const MAX_CONCURRENT_RACES = 2

    const queue = [...shards]
    const racePool = Array.from({ length: MAX_CONCURRENT_RACES }, async () => {
      while (queue.length > 0) {
        const shard = queue.shift()
        if (!shard) return

        const shardPrompt = buildShardPrompt(snapshot.goal, shard.shardId, shard.filePaths)
        const allFilePaths = unique([...shard.sharedFiles, ...shard.filePaths])
        const topCandidates = cogCtx.routerPolicy.routeMulti('analyze', 0, undefined, 2)

        ctx.emitJobEvent('shard.started', {
          shardId: shard.shardId,
          backends: topCandidates.map((c: any) => c.backend),
        })

        const candidates = topCandidates.map((decision: any) => ({
          backend: decision.backend,
          run: async (raceSignal: AbortSignal): Promise<ShardOutcome> => {
            const raceCtrl = new AbortController()
            const propagateAbort = () => raceCtrl.abort()
            raceSignal.addEventListener('abort', propagateAbort, { once: true })
            try {
              return await ctx.runWorkerSafe(
                snapshot, decision.backend, 'analyzer',
                shardPrompt, allFilePaths,
                'SHARD_ANALYZE', `${shard.shardId}:${decision.backend}`,
              )
            } finally {
              raceSignal.removeEventListener('abort', propagateAbort)
            }
          },
          validate: (outcome: ShardOutcome): boolean => {
            if (outcome.status === 'failed' || !outcome.result) return false
            return !!(outcome.result.summary && outcome.result.summary.length >= 10)
          },
          onAborted: () => {
            console.log(`[taskd] 🏁 Racing loser: ${decision.backend} aborted for shard ${shard.shardId}`)
          },
        }))

        try {
          const raceResult = await cogCtx.racingExecutor.race<ShardOutcome>(candidates, signal, 'analyze')
          ctx.shardOutcomes.push(raceResult.result)
          if (raceResult.result.result) ctx.shardResults.push(raceResult.result.result)
          ctx.emitJobEvent('shard.completed', {
            shardId: shard.shardId,
            backend: raceResult.winner,
            outcome: raceResult.result.status,
            racingElapsedMs: raceResult.elapsedMs,
          })
        } catch {
          ctx.shardOutcomes.push({
            status: 'failed', shardId: shard.shardId,
            error: 'All racing candidates failed', durationMs: 0,
          })
        }
      }
    })
    await Promise.all(racePool)
  }
}
