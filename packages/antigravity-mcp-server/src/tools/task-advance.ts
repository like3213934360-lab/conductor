import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerTaskAdvanceTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'task.advance',
    'Read the latest task snapshot and recent events for a taskd job.',
    {
      jobId: z.string().describe('Task job ID'),
      repoRoot: z.string().optional().describe('Workspace root; defaults to current working directory'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const snapshot = await ctx.taskBridge.getJob(args.jobId, workspaceRoot)
        return jsonContent({
          jobId: snapshot.jobId,
          status: snapshot.status,
          currentStageId: snapshot.currentStageId,
          workers: snapshot.workers,
          recentEvents: snapshot.recentEvents,
          nextCursor: snapshot.recentEvents.at(-1)?.sequence ?? 0,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
