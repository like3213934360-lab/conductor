import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerTaskRunTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'task.run',
    'Start a long-running antigravity-taskd job.',
    {
      goal: z.string().describe('Task goal'),
      repoRoot: z.string().optional().describe('Workspace root; defaults to current working directory'),
      files: z.array(z.string()).optional().describe('Optional file hints'),
      mode: z.enum(['analysis', 'write']).optional().describe('Task mode; defaults to analysis'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.taskBridge.createJob({
          goal: args.goal,
          mode: args.mode ?? 'analysis',
          workspaceRoot,
          enableMoA: false,
          fileHints: args.files ?? [],
        }, workspaceRoot)
        return jsonContent(result)
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
