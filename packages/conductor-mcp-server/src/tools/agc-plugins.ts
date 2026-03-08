/**
 * Conductor AGC — agc.plugins MCP 工具
 *
 * 查询已加载的插件列表及其状态。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent } from '../presentation/tool-response.js'

export function registerAgcPluginsTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc-plugins',
    '查询已加载的 Conductor 插件列表、状态和 Hook 统计',
    {
      status: z.enum(['all', 'active', 'failed', 'discovered']).optional()
        .describe('过滤插件状态'),
    },
    async (args) => {
      const filterStatus = args.status ?? 'all'

      if (!ctx.pluginManager) {
        return jsonContent({
          plugins: [],
          message: '插件系统未启用',
          hookStats: {},
        })
      }

      const allPlugins = ctx.pluginManager.listPlugins()
      const filtered = filterStatus === 'all'
        ? allPlugins
        : allPlugins.filter(p => p.status === filterStatus)

      const hookStats = ctx.pluginManager.getHookStats()

      return jsonContent({
        totalRegistered: allPlugins.length,
        activeCount: allPlugins.filter(p => p.status === 'active').length,
        failedCount: allPlugins.filter(p => p.status === 'failed').length,
        plugins: filtered,
        hookStats,
      })
    },
  )
}
