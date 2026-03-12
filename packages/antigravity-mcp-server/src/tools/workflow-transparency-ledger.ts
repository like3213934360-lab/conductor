/**
 * Antigravity Workflow Runtime — workflow.transparencyLedger MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowTransparencyLedgerTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.transparencyLedger',
    '读取 workspace 级 transparency ledger 及其 head entry。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.getTransparencyLedger(workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
