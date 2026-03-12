/**
 * Antigravity Workflow Runtime — workflow.verifyRun MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowVerifyRunTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.verifyRun',
    '验证 daemon-owned run 的 receipt / skip decision / release gate 完整性。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.verifyRun(args.runId, workspaceRoot)

        return jsonContent({
          ok: result.ok,
          status: result.status,
          releaseGateEffect: result.releaseGateEffect,
          rationale: result.rationale,
          receiptCount: result.receiptCount,
          handoffCount: result.handoffCount,
          skipDecisionCount: result.skipDecisionCount,
          missingReceiptNodes: result.missingReceiptNodes,
          missingSkipDecisionNodes: result.missingSkipDecisionNodes,
          missingSkipReceiptNodes: result.missingSkipReceiptNodes,
          invariantFailures: result.invariantFailures,
          releaseArtifacts: result.releaseArtifacts,
          verifiedAt: result.verifiedAt,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
