/**
 * Conductor AGC — Phase 4 MCP 工具注册
 *
 * 4 个 Phase 4 功能工具:
 * 1. agc.reflexion.preview — 预览反思记忆注入
 * 2. agc.reflexion.recall — 召回运行相关反思
 * 3. agc.graph.simulate — DAG 条件边模拟
 * 4. agc.sandbox.validate — 沙箱权限验证
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

/** 注册全部 Phase 4 工具 */
export function registerPhase4Tools(server: McpServer, ctx: ServerContext): void {
  registerReflexionPreviewTool(server, ctx)
  registerGraphSimulateTool(server, ctx)
  registerSandboxValidateTool(server, ctx)
}

// ─── agc.reflexion.preview ────────────────────────

function registerReflexionPreviewTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-reflexion-preview',
    '预览 Reflexion 反思记忆 — 查看将注入到新运行的反思提示',
    {
      goal: z.string().describe('运行目标 (用于相关性匹配)'),
    },
    async (args) => {
      try {
        if (!ctx.runtime) {
          return errorContent(new Error('ConductorRuntime 未配置, Phase 4 工具不可用'))
        }
        const result = ctx.runtime.previewReflexion(args.goal)
        if (!result) {
          return jsonContent({ enabled: false, message: 'Reflexion 未启用' })
        }
        return jsonContent({
          enabled: true,
          promptCount: result.promptCount,
          prompts: result.reflexionPrompts,
          sourceRunIds: result.sourceRunIds,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}

// ─── agc.graph.simulate ──────────────────────────

function registerGraphSimulateTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-graph-simulate',
    'DAG 图条件边模拟 — 预测给定状态下的就绪节点和边评估结果',
    {
      graph: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          name: z.string(),
          dependsOn: z.array(z.string()).default([]),
          input: z.record(z.string(), z.unknown()).default({}),
          skippable: z.boolean().default(false),
          priority: z.number().default(0),
        })).min(1),
        edges: z.array(z.object({
          from: z.string(),
          to: z.string(),
          condition: z.string().optional(),
        })).default([]),
      }).describe('DAG 图定义'),
      nodeStatuses: z.record(z.string(), z.string()).describe('节点状态映射 (nodeId → status)'),
      nodeOutputs: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe('节点输出 (可选, 供条件边评估)'),
    },
    async (args) => {
      try {
        if (!ctx.runtime) {
          return errorContent(new Error('ConductorRuntime 未配置'))
        }
        const result = ctx.runtime.simulateGraph(args.graph, args.nodeStatuses, args.nodeOutputs)
        return jsonContent(result)
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}

// ─── agc.sandbox.validate ────────────────────────

function registerSandboxValidateTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-sandbox-validate',
    '沙箱权限验证 — 检查操作是否被能力沙箱允许',
    {
      operations: z.array(z.object({
        type: z.enum(['fs_read', 'fs_write', 'env', 'network']).describe('操作类型'),
        target: z.string().describe('操作目标 (路径/变量名/空)'),
      })).min(1).describe('待验证操作列表'),
    },
    async (args) => {
      try {
        if (!ctx.runtime) {
          return errorContent(new Error('ConductorRuntime 未配置'))
        }
        const result = ctx.runtime.validateSandbox(args.operations)
        return jsonContent(result)
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
