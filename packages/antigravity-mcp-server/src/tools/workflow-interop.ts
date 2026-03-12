import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowInteropTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.interop',
    '运行 antigravity-daemon 的 Antigravity 互操作 harness。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      suiteIds: z.array(z.string()).optional().describe('可选 suiteId 列表；为空则运行 manifest 中启用的全部互操作套件'),
    },
    async (args) => {
      try {
        const report = await ctx.daemonBridge.runInteropHarness({
          suiteIds: args.suiteIds ?? [],
        }, args.repoRoot ?? process.cwd())
        return jsonContent(report)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
