/**
 * Conductor Hub Core — Pre-Flight 校验器 (Preflight Validator)
 *
 * AGC v8.0: TypeScript 品牌类型强制 — 只有通过校验的任务才能进入执行器。
 *
 * 设计参考:
 * - OpenAI Agents SDK: JSON Schema 级别约束
 * - Rust Typestate Pattern: 类型状态编程
 */

import type { ModelConstraint, AbsPath, PromptTemplateId } from './model-constraints.js'
import { isAbsolutePath } from './model-constraints.js'
import type { RenderedPrompt } from './prompt-templates.js'
import type { PartitionSpec } from './task-partitioner.js'
import type { SubTask, SubTaskType } from './parallel-executor.js'

// ── Validated 品牌类型 (Typestate) ──────────────────────────────────────────

declare const __validated: unique symbol

/** 通过 preflight 校验的子任务 — 唯一允许进入 executor 的类型 */
export type ValidatedSubTask = SubTask & {
  readonly [__validated]: true
  /** 约束元数据 */
  readonly _meta: {
    constraint: ModelConstraint
    partition: PartitionSpec
    prompt: RenderedPrompt
  }
}

// ── 校验错误 ──────────────────────────────────────────────────────────────────

export interface PreflightError {
  /** 错误类别 */
  category: 'missing_files' | 'prompt_too_long' | 'relative_path' | 'too_many_files' | 'no_partition' | 'template_missing_fields'
  /** 错误描述 */
  message: string
  /** 关联的任务 ID */
  taskId?: string
}

export class PreflightValidationError extends Error {
  constructor(
    public readonly errors: PreflightError[],
  ) {
    const summary = errors.map(e => `[${e.category}] ${e.message}`).join('; ')
    super(`Preflight 校验失败 (${errors.length} 个错误): ${summary}`)
    this.name = 'PreflightValidationError'
  }
}

// ── Planned SubTask (预校验结构) ──────────────────────────────────────────────

/** 计划中的子任务 — preflight 的输入 */
export interface PlannedSubTask {
  /** 任务 ID */
  id: string
  /** 使用的模型约束 */
  constraint: ModelConstraint
  /** 分区规格 */
  partition: PartitionSpec
  /** 渲染后的 prompt */
  prompt: RenderedPrompt
  /** 工作目录 */
  workingDir?: AbsPath
}

// ── Pre-Flight 校验 ──────────────────────────────────────────────────────────

/**
 * Pre-Flight 校验 — 阻塞检查
 *
 * 通过后返回 ValidatedSubTask[]，失败则抛出 PreflightValidationError。
 *
 * 检查项:
 * 1. requiresFilePaths → 文件路径非空
 * 2. 所有路径必须是绝对路径
 * 3. 文件数 ≤ maxFilesPerInstance
 * 4. estimatedTokens ≤ maxPromptTokens
 * 5. 分区非空
 */
export function validatePlan(plans: readonly PlannedSubTask[]): ValidatedSubTask[] {
  const errors: PreflightError[] = []

  if (plans.length === 0) {
    errors.push({ category: 'no_partition', message: '计划为空，至少需要一个子任务' })
    throw new PreflightValidationError(errors)
  }

  const validated: ValidatedSubTask[] = []

  for (const plan of plans) {
    const taskErrors = validateSinglePlan(plan)
    if (taskErrors.length > 0) {
      errors.push(...taskErrors)
    } else {
      // 转换为 SubTask + 品牌标记
      const subTask: SubTask = {
        id: plan.id,
        type: plan.constraint.executor as SubTaskType,
        prompt: plan.prompt.user,
        working_dir: plan.workingDir as string | undefined,
        file_paths: plan.partition.filePaths.length > 0
          ? [...plan.partition.filePaths]
          : undefined,
        timeout_ms: plan.constraint.timeoutMs,
      }

      // 品牌标记 — 标识已通过校验
      const result = Object.assign(subTask, {
        [__validated]: true as const,
        _meta: {
          constraint: plan.constraint,
          partition: plan.partition,
          prompt: plan.prompt,
        },
      }) as ValidatedSubTask

      validated.push(result)
    }
  }

  if (errors.length > 0) {
    throw new PreflightValidationError(errors)
  }

  return validated
}

/** 校验单个计划 */
function validateSinglePlan(plan: PlannedSubTask): PreflightError[] {
  const errors: PreflightError[] = []
  const { constraint, partition, prompt } = plan

  // 1. 文件路径必须性检查
  if (constraint.requiresFilePaths && partition.filePaths.length === 0) {
    errors.push({
      category: 'missing_files',
      message: `模型 ${constraint.model} 要求提供文件路径，但分区 "${partition.key}" 文件列表为空`,
      taskId: plan.id,
    })
  }

  // 2. 绝对路径检查
  for (const filePath of partition.filePaths) {
    if (!isAbsolutePath(filePath)) {
      errors.push({
        category: 'relative_path',
        message: `文件路径必须是绝对路径: ${filePath}`,
        taskId: plan.id,
      })
    }
  }

  // 3. 文件数上限检查
  if (constraint.maxFilesPerInstance && partition.filePaths.length > constraint.maxFilesPerInstance) {
    errors.push({
      category: 'too_many_files',
      message: `模型 ${constraint.model} 每实例最多 ${constraint.maxFilesPerInstance} 个文件，当前 ${partition.filePaths.length} 个`,
      taskId: plan.id,
    })
  }

  // 4. Token 上限检查
  if (prompt.estimatedTokens > constraint.maxPromptTokens) {
    errors.push({
      category: 'prompt_too_long',
      message: `Prompt 估算 ${prompt.estimatedTokens} tokens，超过模型 ${constraint.model} 上限 ${constraint.maxPromptTokens}`,
      taskId: plan.id,
    })
  }

  return errors
}

// ── 便捷函数 ──────────────────────────────────────────────────────────────────

/**
 * 一键校验: 从计划生成 SubTask — 失败抛异常
 */
export function planToValidatedTasks(plans: readonly PlannedSubTask[]): ValidatedSubTask[] {
  return validatePlan(plans)
}
