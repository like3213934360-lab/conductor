/**
 * Antigravity Workflow Runtime — workflow.verifyReleaseAttestation MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowVerifyReleaseAttestationTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.verifyReleaseAttestation',
    '验证已导出的 release attestation 的 payload digest 与签名 provenance。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.verifyReleaseAttestation(args.runId, workspaceRoot)
        return jsonContent(result)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
