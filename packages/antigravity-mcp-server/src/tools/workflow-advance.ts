/**
 * Antigravity Workflow Runtime — workflow.advance MCP 工具
 *
 * 读取 daemon-owned run session 的增量时间线。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowAdvanceTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.advance',
    '读取 daemon-owned run session 的增量 timeline；不会直接接管 DAG 执行 authority。',
    {
      runId: z.string().describe('Workflow 运行 ID（来自 workflow.run 的返回值）'),
      cursor: z.number().int().nonnegative().optional().describe('上次读取后的 timeline cursor'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const response = await ctx.daemonBridge.streamRun(
          args.runId,
          args.cursor ?? 0,
          workspaceRoot,
        )

        return jsonContent({
          runId: args.runId,
          nextCursor: response.nextCursor,
          terminal: response.snapshot.status === 'completed' ||
            response.snapshot.status === 'failed' ||
            response.snapshot.status === 'cancelled' ||
            response.snapshot.status === 'paused_for_human',
          snapshot: response.snapshot,
          entries: response.entries,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
