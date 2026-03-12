/**
 * Antigravity Workflow Runtime — 运行请求/响应 Schema
 */
import { z } from 'zod'
import { RunGraphSchema } from './graph.js'

/** 运行元数据 */
export const RunMetadataSchema = z.object({
  /** 任务描述/目标 */
  goal: z.string(),
  /** 项目根目录 */
  repoRoot: z.string().optional(),
  /** 相关文件路径 */
  files: z.array(z.string()).default([]),
  /** 发起者标识 */
  initiator: z.string().default('user'),
  /** 创建时间 */
  createdAt: z.string().optional(),
})

export type RunMetadata = z.infer<typeof RunMetadataSchema>

/** 运行选项 */
export const RunOptionsSchema = z.object({
  /** 风险提示（预设风险等级） */
  riskHint: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  /** Token 预算上限 */
  tokenBudget: z.number().positive().optional(),
  /** 强制完整路径执行（禁用任何路由级跳过） */
  forceFullPath: z.boolean().optional(),
  /** 启用的插件 ID 列表 */
  plugins: z.array(z.string()).default([]),
  /** 是否启用调试模式 */
  debug: z.boolean().default(false),
})

export type RunOptions = z.infer<typeof RunOptionsSchema>

/** 启动运行请求 */
export const RunRequestSchema = z.object({
  /** 可选的自定义运行 ID */
  runId: z.string().optional(),
  /** DAG 图定义 */
  graph: RunGraphSchema,
  /** 运行元数据 */
  metadata: RunMetadataSchema,
  /** 运行选项 */
  options: RunOptionsSchema.optional(),
})

export type RunRequest = z.infer<typeof RunRequestSchema>

/** 查询状态请求 */
export const GetStateRequestSchema = z.object({
  /** 运行 ID */
  runId: z.string(),
})

export type GetStateRequest = z.infer<typeof GetStateRequestSchema>

/** 验证运行请求 */
export const VerifyRunRequestSchema = z.object({
  /** 运行 ID */
  runId: z.string(),
  /** 指定要执行的验证门禁 */
  gates: z.array(z.string()).optional(),
})

export type VerifyRunRequest = z.infer<typeof VerifyRunRequestSchema>
