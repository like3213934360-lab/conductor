/**
 * Antigravity Workflow Runtime — 检查点 Schema
 */
import { z } from 'zod'
import { WorkflowStateSchema } from '../state/workflow-state.js'

/** 检查点 DTO */
export const CheckpointDTOSchema = z.object({
  /** 检查点 ID */
  checkpointId: z.string(),
  /** 所属运行 ID */
  runId: z.string(),
  /** 状态版本号（单调递增） */
  version: z.number().int().nonnegative(),
  /** 快照状态 */
  state: z.lazy(() => WorkflowStateSchema),
  /** 创建时间 */
  createdAt: z.string(),
})

export type CheckpointDTO = z.infer<typeof CheckpointDTOSchema>

/** 检查点指针（轻量引用） */
export const CheckpointPointerSchema = z.object({
  /** 检查点 ID */
  checkpointId: z.string(),
  /** 版本号 */
  version: z.number().int().nonnegative(),
  /** 创建时间 */
  createdAt: z.string(),
})

export type CheckpointPointer = z.infer<typeof CheckpointPointerSchema>
