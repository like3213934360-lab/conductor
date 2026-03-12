/**
 * Antigravity Workflow Runtime — workflow.verifyTransparencyLedger MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowVerifyTransparencyLedgerTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.verifyTransparencyLedger',
    '校验 workspace transparency ledger 的 append-only hash chain。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.verifyTransparencyLedger(workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
