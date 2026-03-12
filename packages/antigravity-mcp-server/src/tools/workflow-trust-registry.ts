import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowTrustRegistryTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.trustRegistry',
    '读取或热重载 antigravity-daemon 的 trust registry，查看签名 key、signer policy、issuer、scope 与 secret 解算状态。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      reload: z.boolean().optional().describe('是否从 workspace 的 trust-registry.json 热重载'),
    },
    async (args) => {
      try {
        const snapshot = args.reload
          ? await ctx.daemonBridge.reloadTrustRegistry(args.repoRoot ?? process.cwd())
          : await ctx.daemonBridge.getTrustRegistry(args.repoRoot ?? process.cwd())
        return jsonContent(snapshot)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
