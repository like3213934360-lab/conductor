import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowTraceExportTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.traceExport',
    '导出 daemon-owned run 的 replayable trace bundle。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const bundle = await ctx.daemonBridge.exportTraceBundle(
          args.runId,
          args.repoRoot ?? process.cwd(),
        )
        return jsonContent(bundle)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
