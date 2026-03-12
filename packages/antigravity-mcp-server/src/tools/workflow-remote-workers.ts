import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowRemoteWorkersTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.remoteWorkers',
    '列出 antigravity-daemon 发现到的 remote workers、agent-card advertisement/task protocol surface、verification 摘要以及发现失败项。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workers = await ctx.daemonBridge.listRemoteWorkers(args.repoRoot ?? process.cwd())
        return jsonContent(workers)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
