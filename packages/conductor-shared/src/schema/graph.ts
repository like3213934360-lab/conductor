/**
 * Conductor AGC — DAG 图定义 Schema
 *
 * 使用 Zod 定义 DAG 图的节点和边结构，
 * 作为 Event Sourcing 和 MCP Tool 的单一真实来源。
 */
import { z } from 'zod'

/** DAG 节点定义 */
export const GraphNodeSchema = z.object({
  /** 节点唯一标识 */
  id: z.string(),
  /** 节点名称（人类可读） */
  name: z.string(),
  /** 负责执行的模型标识 */
  model: z.string().optional(),
  /** 前置依赖节点 ID 列表 */
  dependsOn: z.array(z.string()).default([]),
  /** 节点输入参数 */
  input: z.record(z.string(), z.unknown()).default({}),
  /** 是否可跳过（路由短路时） */
  skippable: z.boolean().default(false),
})

export type GraphNode = z.infer<typeof GraphNodeSchema>

/** DAG 边定义 */
export const GraphEdgeSchema = z.object({
  /** 源节点 ID */
  from: z.string(),
  /** 目标节点 ID */
  to: z.string(),
  /** 条件表达式（可选，用于条件路由） */
  condition: z.string().optional(),
})

export type GraphEdge = z.infer<typeof GraphEdgeSchema>

/** 完整的运行图定义 */
export const RunGraphSchema = z.object({
  /** 图中所有节点 */
  nodes: z.array(GraphNodeSchema).min(1),
  /** 图中所有边（空数组 = 按 dependsOn 自动推断） */
  edges: z.array(GraphEdgeSchema).default([]),
})

export type RunGraph = z.infer<typeof RunGraphSchema>
