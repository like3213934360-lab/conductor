/**
 * Antigravity Workflow Runtime — workflow.memorySearch MCP 工具
 *
 * 搜索历史记忆（Episodic + Semantic），
 * 返回 Reflexion 提示和相关语义事实。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowMemorySearchTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.memorySearch',
    '搜索 daemon-owned workflow 历史记忆 — Reflexion 提示 + 语义知识图',
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
