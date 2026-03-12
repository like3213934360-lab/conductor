import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'

export function registerWorkflowPolicyPackTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.policyPack',
    '读取 antigravity-daemon 当前生效的 policy-as-code pack。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      reload: z.boolean().optional().describe('是否先从本地 policy-pack.json 热重载再返回'),
    },
    async (args) => {
      const policyPack = args.reload
        ? await ctx.daemonBridge.reloadPolicyPack(args.repoRoot ?? process.cwd())
        : await ctx.daemonBridge.getPolicyPack(args.repoRoot ?? process.cwd())
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(policyPack, null, 2),
        }],
      }
    },
  )
}
