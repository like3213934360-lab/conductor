/**
 * CheckpointRecoveryService — 断点恢复与脑裂修复
 *
 * V1.1.0 第二战役・战区 2：从 runtime.ts 上帝模块中剥离
 *
 * 职责：
 * - Job 启动时从 Journal 恢复已完成阶段的输出
 * - 检测 VFS-Journal 脑裂并触发 Reflexion 重跑
 * - 跳过已完成的 stage，避免重复计算
 */

import type {
  AggregateAnalysis,
  ScoutManifest,
  ShardAnalysis,
  VerifyAnalysis,
  TaskStageId,
} from './schema.js'
import type { JournalStore, ShardOutcomeRef } from './journal.js'

// ── 恢复结果 ────────────────────────────────────────────────────

/** Journal 恢复出的各阶段快照数据 */
export interface RecoveredCheckpoints {
  /** 从哪个 stage 之后恢复（用于 logging） */
  resumePoint: TaskStageId | null
  /** SCOUT 阶段产出 */
  manifest?: ScoutManifest
  /** SHARD_ANALYZE 阶段产出 */
  shardResults?: ShardAnalysis[]
  /** SHARD_ANALYZE 阶段结果引用 */
  shardOutcomes?: ShardOutcomeRef[]
  /** AGGREGATE 阶段 Merkle Root */
  merkleRoot?: string
  /** AGGREGATE 阶段产出 */
  aggregate?: AggregateAnalysis
  /** VERIFY 阶段产出 */
  verify?: VerifyAnalysis
  /** 脑裂修复：崩溃前 VFS 里尚未落盘的文件路径 */
  vfsPendingPaths: string[]
}

// ── 恢复逻辑 ────────────────────────────────────────────────────

/**
 * 从 Journal 恢复 Job 的所有已完成阶段数据。
 *
 * 1. 查询 resumePoint — 上次崩溃前最后完成的 stage
 * 2. 按顺序加载各 stage 的 checkpoint
 * 3. 检测 VFS-Journal 脑裂（vfsPendingPaths 非空 + verdict=unverified）
 *
 * @returns RecoveredCheckpoints — 所有可恢复的数据，调用方按需跳过已完成阶段
 */
export async function recoverFromJournal(
  journal: JournalStore,
  jobId: string,
): Promise<RecoveredCheckpoints> {
  const result: RecoveredCheckpoints = {
    resumePoint: null,
    vfsPendingPaths: [],
  }

  const resumePoint = await journal.getResumePoint(jobId)
  if (!resumePoint) return result

  result.resumePoint = resumePoint
  console.warn(`[taskd] Resuming job ${jobId} from after ${resumePoint}`)

  const STAGE_ORDER: TaskStageId[] = ['SCOUT', 'SHARD_ANALYZE', 'AGGREGATE', 'VERIFY', 'WRITE', 'FINALIZE']
  const stageIndex = STAGE_ORDER.indexOf(resumePoint)

  // 恢复 SCOUT 数据
  if (stageIndex >= 0) {
    const scoutCp = await journal.loadCheckpoint(jobId, 'SCOUT')
    if (scoutCp) result.manifest = scoutCp.payload.manifest
  }

  // 恢复 SHARD 数据
  if (stageIndex >= 1) {
    const shardCp = await journal.loadCheckpoint(jobId, 'SHARD_ANALYZE')
    if (shardCp) {
      result.shardResults = shardCp.payload.results
      result.shardOutcomes = shardCp.payload.outcomes
    }
  }

  // 恢复 AGGREGATE 数据（含 merkle root）
  if (stageIndex >= 2) {
    const aggCp = await journal.loadCheckpoint(jobId, 'AGGREGATE')
    if (aggCp) {
      result.aggregate = aggCp.payload.aggregate
      result.merkleRoot = aggCp.payload.merkleRoot
    }
  }

  // 恢复 VERIFY 数据 + VFS 脑裂检测
  if (stageIndex >= 3) {
    const verifyCp = await journal.loadCheckpoint(jobId, 'VERIFY')
    if (verifyCp) {
      result.verify = verifyCp.payload.verify
      // 恢复 VFS 脑裂检测标记：若崩溃发生在 Reflexion 期间，
      // vfsPendingPaths 记录了哪些文件尚未成功落盘，需要重跑 Reflexion
      const pendingPaths = verifyCp.payload.vfsPendingPaths
      if (Array.isArray(pendingPaths) && pendingPaths.length > 0) {
        result.vfsPendingPaths = pendingPaths as string[]
      }
    }
  }

  return result
}

/**
 * 检测 VFS-Journal 脑裂并修复 pendingFiles。
 *
 * 当上次崩溃发生在 Reflexion 循环期间：
 * - vfsPendingPaths 记录了哪些文件尚未 commit
 * - verify.verdict === 'unverified' 表示 Reflexion 未完成
 * - 从 aggregate.suggestedEdits 重建文件内容
 * - 重置 verify 为 undefined，强制重跑 VERIFY stage
 *
 * @returns 修复后的 verify（可能被重置为 undefined）和 pendingFiles
 */
export function repairVfsDesync(
  recovered: RecoveredCheckpoints,
  aggregate: AggregateAnalysis,
  mode: string,
): { verify: VerifyAnalysis | undefined; pendingFiles: Record<string, string> } {
  const pendingFiles: Record<string, string> = {}
  let { verify } = recovered

  if (
    recovered.vfsPendingPaths.length > 0 &&
    verify?.verdict === 'unverified' &&
    mode === 'write'
  ) {
    console.warn(
      `[taskd] Detected VFS-Journal desync: ${recovered.vfsPendingPaths.length} file(s) ` +
      `were pending commit at last crash. Re-entering Reflexion.`,
    )
    // 从 AGGREGATE 结果中重建需要落盘的文件内容
    const suggestedEdits = (aggregate as any)?.suggestedEdits as Record<string, string> | undefined
    if (suggestedEdits) {
      for (const p of recovered.vfsPendingPaths) {
        if (suggestedEdits[p]) {
          pendingFiles[p] = suggestedEdits[p]
        }
      }
    }
    // 重置 verify → 强制重跑 VERIFY Worker + Reflexion
    verify = undefined
  }

  return { verify, pendingFiles }
}
