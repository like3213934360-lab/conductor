/**
 * Conductor AGC — agc.get_state MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerAgcGetStateTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-get_state',
    '查询 AGC 运行状态 — 通过事件回放还原完整状态快照',
    {
      runId: z.string().describe('运行 ID'),
    },
    async (args) => {
      try {
        const state = await ctx.agcService.getState(args.runId)

        if (!state) {
          return errorContent(new Error(`运行 ${args.runId} 不存在`))
        }

        return jsonContent(state)
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
