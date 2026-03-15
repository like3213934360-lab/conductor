/**
 * AGGREGATE Stage — 聚合阶段
 *
 * 职责：
 *  1. Journal replay: 如有恢复数据则跳过聚合
 *  2. 调用 aggregator worker 合并 shard 结果
 *  3. 失败时使用 concat fallback 降级
 *  4. 保存 Journal checkpoint
 *
 * 读取 ctx.shardResults, ctx.merkleRoot
 * 写入 ctx.aggregate
 */
import type { PipelineContext, PipelineStage } from '../pipeline-context.js'
import type { AggregateAnalysis, ShardAnalysis, TaskStageId } from '../schema.js'
import { buildAggregatePrompt } from '../prompts.js'
import { parseStructuredJson } from '../parsing.js'

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function coerceAggregate(raw: string): AggregateAnalysis {
  const parsed = parseStructuredJson<any>(raw)
  return {
    globalSummary: typeof parsed?.globalSummary === 'string' ? parsed.globalSummary : raw.trim().slice(0, 1200),
    agreements: asStringArray(parsed?.agreements),
    conflicts: asStringArray(parsed?.conflicts),
    missingCoverage: asStringArray(parsed?.missingCoverage),
  }
}

// ── 瞬时失败重试（信号感知） ──────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = 2,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw lastError ?? new Error(`${label} aborted before attempt ${attempt}`)
    }
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < maxAttempts) {
        const backoffMs = attempt * 2000
        console.warn(`[taskd] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}, retrying in ${backoffMs}ms`)
        let backoffAbortHandler: (() => void) | undefined
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (backoffAbortHandler && signal) {
              signal.removeEventListener('abort', backoffAbortHandler)
            }
            resolve()
          }, backoffMs)
          if (signal) {
            backoffAbortHandler = () => {
              clearTimeout(timer)
              reject(lastError)
            }
            signal.addEventListener('abort', backoffAbortHandler, { once: true })
          }
        }).catch(() => {
          throw lastError!
        })
      }
    }
  }
  throw lastError!
}

export { withRetry }

export class AggregateStage implements PipelineStage {
  readonly stageId: TaskStageId = 'AGGREGATE'

  async execute(ctx: PipelineContext): Promise<void> {
    const { snapshot, signal, jobId, cogCtx } = ctx
    const shardResults = ctx.shardResults as ShardAnalysis[]

    let aggregate: AggregateAnalysis
    if (ctx.resumedAggregate) {
      // 📀 Journal Replay: 跳过 AGGREGATE
      aggregate = ctx.resumedAggregate
      ctx.markStageCompleted('AGGREGATE', 'Resumed from journal')
    } else {
      ctx.markStageStarted('AGGREGATE', 'Aggregating shard outputs')
      try {
        const aggregateDecision = cogCtx.routerPolicy.route('analyze')
        const aggregateResult = await withRetry(
          () => ctx.runWorker(
            snapshot, aggregateDecision.backend, 'aggregator',
            buildAggregatePrompt(snapshot.goal, shardResults),
            [], 'AGGREGATE',
          ),
          'AGGREGATE',
          2,
          signal,
        )
        aggregate = coerceAggregate(aggregateResult.text)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] AGGREGATE failed, using concat fallback: ${msg}`)
        aggregate = {
          globalSummary: shardResults.map(s => `[${s.shardId}] ${s.summary}`).join('\n\n'),
          agreements: [],
          conflicts: [],
          missingCoverage: [`DEGRADED_AGGREGATION: ${msg}`],
        }
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `AGGREGATE failed (${msg}), using degraded concat fallback`,
        ])
      }
    }

    snapshot.summary.globalSummary = aggregate.globalSummary
    ctx.markStageCompleted('AGGREGATE',
      aggregate.missingCoverage.some(s => s.startsWith('DEGRADED_AGGREGATION')) ? 'Degraded aggregate' : 'Aggregate ready',
    )
    ctx.emitJobEvent('aggregate.completed', {
      conflicts: aggregate.conflicts,
      missingCoverage: aggregate.missingCoverage,
    })

    // 🏗️ Journal: AGGREGATE checkpoint
    if (!ctx.resumedAggregate) {
      await ctx.journal.saveCheckpoint(jobId, 'AGGREGATE', { aggregate, merkleRoot: ctx.merkleRoot ?? '' })
    }

    ctx.aggregate = aggregate
  }
}
