/**
 * Antigravity Workflow Runtime — workflow.releaseBundle MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowReleaseBundleTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.releaseBundle',
    '读取当前 run 的 release bundle 统一发布包。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.getReleaseBundle(args.runId, workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
