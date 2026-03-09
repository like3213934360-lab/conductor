/**
 * Conductor AGC — agc.verify_run MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerAgcVerifyRunTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-verify_run',
    '验证 AGC 运行完整性 — 事件回放漂移检测 + 合规重算',
    {
      runId: z.string().describe('运行 ID'),
    },
    async (args) => {
      try {
        const result = await ctx.agcService.verifyRun(args.runId)

        return jsonContent({
          ok: result.ok,
          driftDetected: result.driftDetected,
          complianceAllowed: result.governance.allowed,
          complianceWorstStatus: result.governance.worstStatus,
          findingCount: result.governance.findings.length,
          stateVersion: result.state.version,
          replayedVersion: result.replayedState.version,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
