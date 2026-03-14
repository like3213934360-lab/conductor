import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerTaskGetStateTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'task.getState',
    'Read the latest antigravity-taskd job snapshot.',
    {
      jobId: z.string().describe('Task job ID'),
      repoRoot: z.string().optional().describe('Workspace root; defaults to current working directory'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        return jsonContent(await ctx.taskBridge.getJob(args.jobId, workspaceRoot))
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
