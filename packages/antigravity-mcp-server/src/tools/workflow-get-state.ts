/**
 * Antigravity Workflow Runtime — workflow.getState MCP 工具
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowGetStateTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.getState',
    '查询 daemon-owned workflow 运行状态，返回 snapshot、invocation 和 workflow definition。',
    {
      runId: z.string().describe('运行 ID'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const run = await ctx.daemonBridge.getRun(args.runId, workspaceRoot)
        return jsonContent({
          runId: run.snapshot.runId,
          invocation: run.invocation,
          definition: {
            workflowId: run.definition.workflowId,
            version: run.definition.version,
            templateName: run.definition.templateName,
            authorityMode: run.definition.authorityMode,
          },
          snapshot: run.snapshot,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
