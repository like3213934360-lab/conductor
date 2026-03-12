import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowBenchmarkSourcesTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.benchmarkSources',
    '读取或热重载 antigravity-daemon 的 benchmark source registry，查看 registry-first dataset source 配置。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      reload: z.boolean().optional().describe('是否从 workspace 的 benchmark-source-registry.json 热重载'),
    },
    async (args) => {
      try {
        const registry = args.reload
          ? await ctx.daemonBridge.reloadBenchmarkSourceRegistry(args.repoRoot ?? process.cwd())
          : await ctx.daemonBridge.getBenchmarkSourceRegistry(args.repoRoot ?? process.cwd())
        return jsonContent(registry)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
