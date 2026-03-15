/**
 * SCOUT Stage — 侦察阶段
 *
 * 职责：
 *  1. Journal replay: 如有恢复数据则跳过侦察
 *  2. 调用 scout worker 生成 shard 分配方案 (ScoutManifest)
 *  3. 超时/失败时使用 fallback manifest 兜底
 *  4. 保存 Journal checkpoint + Provenance input hashes
 *
 * 写入 ctx.manifest
 */
import type { PipelineContext, PipelineStage } from '../pipeline-context.js'
import type { ScoutManifest, TaskStageId } from '../schema.js'
import { listWorkspaceFiles, pickSharedFiles, chunkShardFiles, totalBytes, type WorkspaceFileEntry } from '../file-context.js'
import { buildScoutPrompt } from '../prompts.js'
import { parseStructuredJson } from '../parsing.js'

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function createFallbackScoutManifest(goal: string, relevantFiles: WorkspaceFileEntry[]): ScoutManifest {
  const sharedFiles = pickSharedFiles(relevantFiles.map(file => file.path))
  const shards = chunkShardFiles(relevantFiles).map((filePaths, index) => ({
    shardId: `shard-${index + 1}`,
    filePaths,
    sharedFiles,
  }))
  return {
    goalSummary: goal,
    relevantPaths: relevantFiles.map(file => file.path),
    shards,
    unknowns: [],
    riskFlags: [],
  }
}

function coerceScoutManifest(goal: string, raw: string, workspaceFiles: WorkspaceFileEntry[]): ScoutManifest {
  const parsed = parseStructuredJson<any>(raw)
  if (!parsed) return createFallbackScoutManifest(goal, workspaceFiles)
  const relevantPaths = unique(
    asStringArray(parsed.relevantPaths).filter(path => workspaceFiles.some(file => file.path === path)),
  )
  const shards = Array.isArray(parsed.shards)
    ? parsed.shards.map((shard: any, index: number) => ({
      shardId: typeof shard?.shardId === 'string' ? shard.shardId : `shard-${index + 1}`,
      filePaths: asStringArray(shard?.filePaths).filter(path => relevantPaths.includes(path)),
      sharedFiles: asStringArray(shard?.sharedFiles).slice(0, 5),
    })).filter((shard: any) => shard.filePaths.length > 0)
    : []
  if (relevantPaths.length === 0 || shards.length === 0) {
    return createFallbackScoutManifest(goal, workspaceFiles)
  }
  return {
    goalSummary: typeof parsed.goalSummary === 'string' ? parsed.goalSummary : goal,
    relevantPaths,
    shards,
    unknowns: asStringArray(parsed.unknowns),
    riskFlags: asStringArray(parsed.riskFlags),
  }
}

export { createFallbackScoutManifest }

interface ExecutionProfile {
  kind: 'single' | 'dual' | 'sharded'
}

/** ≤ 6 个文件且 ≤ 300KB 时使用单 worker */
const SINGLE_WORKER_MAX_FILES = 6
const SINGLE_WORKER_MAX_BYTES = 300 * 1024
/** ≤ 20 个文件且 ≤ 900KB 时使用双 worker */
const DUAL_WORKER_MAX_FILES = 20
const DUAL_WORKER_MAX_BYTES = 900 * 1024

export function chooseExecutionProfile(files: WorkspaceFileEntry[]): ExecutionProfile {
  const count = files.length
  const bytes = totalBytes(files)
  if (count <= SINGLE_WORKER_MAX_FILES && bytes <= SINGLE_WORKER_MAX_BYTES) {
    return { kind: 'single' }
  }
  if (count <= DUAL_WORKER_MAX_FILES && bytes <= DUAL_WORKER_MAX_BYTES) {
    return { kind: 'dual' }
  }
  return { kind: 'sharded' }
}

export class ScoutStage implements PipelineStage {
  readonly stageId: TaskStageId = 'SCOUT'

  async execute(ctx: PipelineContext): Promise<void> {
    const { snapshot, cogCtx, fileHintEntries, workspaceFiles } = ctx

    let manifest: ScoutManifest
    if (ctx.resumedManifest) {
      // 📀 Journal Replay: 跳过 SCOUT，使用持久化数据
      manifest = ctx.resumedManifest
      ctx.markStageCompleted('SCOUT', 'Resumed from journal')
    } else {
      ctx.markStageStarted('SCOUT', 'Planning shard graph')
      const scoutPrompt = buildScoutPrompt(
        snapshot.goal,
        snapshot.mode,
        snapshot.fileHints,
        fileHintEntries.map(file => `${file.path} (${file.size} bytes)`),
      )
      try {
        const scoutDecision = cogCtx.routerPolicy.route('scout')
        const scoutResult = await ctx.runWorker(snapshot, scoutDecision.backend, 'scout', scoutPrompt, [], 'SCOUT')
        manifest = coerceScoutManifest(snapshot.goal, scoutResult.text, fileHintEntries)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.warn(`[taskd] SCOUT failed, falling back to auto-shard: ${msg}`)
        manifest = createFallbackScoutManifest(snapshot.goal, fileHintEntries)
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          `SCOUT failed (${msg}), using fallback shard plan`,
        ])
      }
    }

    snapshot.summary.goalSummary = manifest.goalSummary
    snapshot.summary.openQuestions = manifest.unknowns
    snapshot.summary.riskFindings = unique([...snapshot.summary.riskFindings, ...manifest.riskFlags])
    snapshot.artifacts.shardCount = manifest.shards.length

    const stage = snapshot.graph.find(s => s.id === 'SCOUT')
    if (stage) stage.shardIds = manifest.shards.map(shard => shard.shardId)

    ctx.markStageCompleted('SCOUT', `Prepared ${manifest.shards.length} shards`)
    ctx.emitJobEvent('plan.ready', {
      shardCount: manifest.shards.length,
      relevantPaths: manifest.relevantPaths,
      profile: chooseExecutionProfile(
        workspaceFiles.filter(file => manifest.relevantPaths.includes(file.path)),
      ).kind,
    })

    // 🏗️ Journal: SCOUT checkpoint + Provenance: record input hashes
    await ctx.journal.saveCheckpoint(ctx.jobId, 'SCOUT', {
      manifest,
      fileHintEntries: fileHintEntries.map(f => ({ path: f.path, size: f.size })),
    })
    ;(ctx.provenance as any).recordInputFiles(fileHintEntries.map(f => f.path))

    // 写入 ctx 供后续阶段使用
    ctx.manifest = manifest
  }
}
