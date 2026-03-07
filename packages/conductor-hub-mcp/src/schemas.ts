/**
 * MCP tool 输入校验 Schema (zod)
 *
 * 用于 ai_parallel_tasks handler 的运行时类型校验,
 * 替代 `as` 强转, 确保非法输入被清晰拒绝。
 */
import { z } from 'zod'

/** 支持的子任务类型 */
export const SubTaskTypeSchema = z.enum(['codex', 'gemini', 'ask', 'multi_ask', 'consensus'])

/** 单个子任务的校验 schema */
export const SubTaskSchema = z.object({
  id: z.string().optional(),
  type: SubTaskTypeSchema,
  prompt: z.string().min(1, '提示词不能为空'),
  model: z.string().optional(),
  working_dir: z.string().optional(),
  provider: z.string().optional(),
  system_prompt: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
  // multi_ask / consensus 专用字段
  file_paths: z.array(z.string()).optional(),
  providers: z.array(z.string()).optional(),
  criteria: z.string().optional(),
  judge: z.string().optional(),
})

/** ai_parallel_tasks 完整输入的校验 schema */
export const ParallelTasksInputSchema = z.object({
  tasks: z.array(SubTaskSchema).min(1, '至少需要一个任务').max(8, '最多 8 个任务'),
  max_concurrency: z.number().int().min(1).max(4).optional(),
})

export type ValidatedParallelInput = z.infer<typeof ParallelTasksInputSchema>
