/**
 * Conductor Hub Core — 任务分区器 (Task Partitioner)
 *
 * AGC v8.0: 自动将大任务按模型约束拆分为多个子任务。
 *
 * 分区策略:
 * 1. 文件分区 — 按 maxFilesPerInstance 拆分
 * 2. Token 分区 — 按 maxPromptTokens 拆分
 * 3. 维度分区 — 按分析维度拆分
 */

import type { ModelConstraint, AbsPath } from './model-constraints.js'
import { estimateTokens } from './prompt-templates.js'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 调度意图 — 描述"要做什么"（高层）*/
export interface DispatchIntent {
  /** 总目标描述 */
  goal: string
  /** 所有相关文件 */
  files?: readonly AbsPath[]
  /** 分析维度列表 (如 ['architecture', 'compliance', 'memory']) */
  dimensions?: readonly string[]
  /** 分区提示 */
  partitionHint?: 'auto' | 'by_file' | 'by_directory' | 'by_dimension'
}

/** 分区规格 — 描述"一个子任务的作用域" */
export interface PartitionSpec {
  /** 分区轴 */
  axis: 'file' | 'directory' | 'token_budget' | 'dimension'
  /** 分区键 (用于标识) */
  key: string
  /** 该分区的文件路径 */
  filePaths: readonly AbsPath[]
  /** 该分区的维度 (如果按维度分) */
  dimension?: string
}

// ── 核心分区函数 ──────────────────────────────────────────────────────────────

/**
 * 根据模型约束自动分区任务
 *
 * 分区规则 (优先级):
 * 1. 如有 dimensions → 按维度分区
 * 2. 如有 files + model.requiresFilePaths → 按文件分区
 * 3. 如 prompt 超限 → 按 token 预算递归细分
 * 4. 否则 → 单分区
 */
export function partitionIntent(
  intent: DispatchIntent,
  constraint: ModelConstraint,
): PartitionSpec[] {
  const hint = intent.partitionHint ?? 'auto'
  const axes = new Set(constraint.partitionAxes)

  // 维度分区
  if ((hint === 'by_dimension' || hint === 'auto') && intent.dimensions && intent.dimensions.length > 1 && axes.has('dimension')) {
    return partitionByDimension(intent, constraint)
  }

  // 文件分区
  if ((hint === 'by_file' || hint === 'auto') && intent.files && intent.files.length > 0 && axes.has('file')) {
    if (constraint.requiresFilePaths || (constraint.maxFilesPerInstance && intent.files.length > constraint.maxFilesPerInstance)) {
      return partitionByFile(intent.files, constraint)
    }
  }

  // 目录分区
  if (hint === 'by_directory' && intent.files && intent.files.length > 0 && axes.has('directory')) {
    return partitionByDirectory(intent.files, constraint)
  }

  // 单分区
  return [{
    axis: 'dimension',
    key: 'all',
    filePaths: intent.files ?? [],
  }]
}

// ── 分区策略实现 ──────────────────────────────────────────────────────────────

/** 按维度分区 — 每个维度独立子任务，文件 round-robin 分配 */
function partitionByDimension(
  intent: DispatchIntent,
  constraint: ModelConstraint,
): PartitionSpec[] {
  const dims = intent.dimensions!
  const files = intent.files ?? []
  const maxFiles = constraint.maxFilesPerInstance ?? files.length

  // Round-robin 分配文件到各维度
  const perDimFiles: AbsPath[][] = dims.map(() => [])
  for (let i = 0; i < files.length; i++) {
    const dimIndex = i % dims.length
    if (perDimFiles[dimIndex]!.length < maxFiles) {
      perDimFiles[dimIndex]!.push(files[i]!)
    }
  }

  return dims.map((dim, idx) => ({
    axis: 'dimension' as const,
    key: dim,
    filePaths: perDimFiles[idx]!,
    dimension: dim,
  }))
}

/** 按文件分区 — 按 maxFilesPerInstance 切分 */
function partitionByFile(
  files: readonly AbsPath[],
  constraint: ModelConstraint,
): PartitionSpec[] {
  const maxFiles = constraint.maxFilesPerInstance ?? 5
  const partitions: PartitionSpec[] = []

  for (let i = 0; i < files.length; i += maxFiles) {
    const chunk = files.slice(i, i + maxFiles)
    partitions.push({
      axis: 'file',
      key: `files-${Math.floor(i / maxFiles) + 1}`,
      filePaths: chunk,
    })
  }

  return partitions
}

/** 按目录分区 — 按文件所在目录分组 */
function partitionByDirectory(
  files: readonly AbsPath[],
  constraint: ModelConstraint,
): PartitionSpec[] {
  const dirGroups = new Map<string, AbsPath[]>()

  for (const file of files) {
    const dir = file.substring(0, file.lastIndexOf('/')) || '/'
    const group = dirGroups.get(dir) ?? []
    group.push(file)
    dirGroups.set(dir, group)
  }

  const maxFiles = constraint.maxFilesPerInstance ?? 5
  const partitions: PartitionSpec[] = []

  for (const [dir, dirFiles] of dirGroups) {
    // 如果目录内文件超限，进一步按文件拆分
    if (dirFiles.length > maxFiles) {
      for (let i = 0; i < dirFiles.length; i += maxFiles) {
        partitions.push({
          axis: 'directory',
          key: `${dir.split('/').pop()}-${Math.floor(i / maxFiles) + 1}`,
          filePaths: dirFiles.slice(i, i + maxFiles),
        })
      }
    } else {
      partitions.push({
        axis: 'directory',
        key: dir.split('/').pop() ?? 'root',
        filePaths: dirFiles,
      })
    }
  }

  return partitions
}

/**
 * 估算分区的 prompt token 数
 */
export function estimatePartitionTokens(
  goalText: string,
  partition: PartitionSpec,
): number {
  const filePathText = partition.filePaths.join('\n')
  return estimateTokens(goalText) + estimateTokens(filePathText)
}
