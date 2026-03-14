import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerTaskListTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'task.list',
    'List recent antigravity-taskd jobs for the current workspace.',
    {
      repoRoot: z.string().optional().describe('Workspace root; defaults to current working directory'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        return jsonContent(await ctx.taskBridge.listJobs(workspaceRoot))
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
