/**
 * Antigravity Workflow Runtime — workflow.certificationRecord MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowCertificationRecordTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.certificationRecord',
    '读取当前 run 的 certification record 最终认证证明。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.getCertificationRecord(args.runId, workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
