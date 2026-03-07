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
  /** 三模型审计: 节点优先级 (数值越大越先调度, 默认 0) */
  priority: z.number().default(0),
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
}).superRefine((data, ctx) => {
  // 三模型审计: 重复 node ID 校验
  const nodeIds = new Set<string>()
  for (const node of data.nodes) {
    if (nodeIds.has(node.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `重复的节点 ID: ${node.id}`,
        path: ['nodes'],
      })
    }
    nodeIds.add(node.id)
  }

  // 三模型审计: 边端点引用校验
  for (let i = 0; i < data.edges.length; i++) {
    const edge = data.edges[i]!
    if (!nodeIds.has(edge.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `边 [${i}] 的 from 节点不存在: ${edge.from}`,
        path: ['edges', i, 'from'],
      })
    }
    if (!nodeIds.has(edge.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `边 [${i}] 的 to 节点不存在: ${edge.to}`,
        path: ['edges', i, 'to'],
      })
    }
  }

  // 三模型审计: dependsOn 引用校验
  for (const node of data.nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `节点 ${node.id} 的 dependsOn 引用不存在: ${dep}`,
          path: ['nodes'],
        })
      }
    }
  }
})

export type RunGraph = z.infer<typeof RunGraphSchema>
