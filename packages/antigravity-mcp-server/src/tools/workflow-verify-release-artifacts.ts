/**
 * Antigravity Workflow Runtime — workflow.verifyReleaseArtifacts MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowVerifyReleaseArtifactsTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.verifyReleaseArtifacts',
    '验证统一 release artifact surface 的完整性与签名状态。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.verifyReleaseArtifacts(args.runId, workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
