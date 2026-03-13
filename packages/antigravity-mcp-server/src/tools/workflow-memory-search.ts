/**
 * Antigravity Workflow Runtime — workflow.memorySearch MCP 工具
 *
 * 搜索历史记忆（Episodic + Semantic keyword recall）。
 * 实验性能力 — 仅提供查询接口，不参与运行时决策。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowMemorySearchTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.memorySearch',
    '搜索 daemon keyword 记忆（实验性，不参与运行时决策）',
    {
      query: z.string().describe('搜索查询（目标描述或关键词）'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      files: z.array(z.string()).optional().describe('相关文件路径'),
      topK: z.number().int().positive().optional().describe('返回结果数量'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const recall = await ctx.daemonBridge.searchMemory({
          query: args.query,
          files: args.files ?? [],
          topK: args.topK ?? 5,
        }, workspaceRoot)
        return jsonContent(recall)
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
