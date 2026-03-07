/**
 * Conductor AGC — MCP Server 工厂
 *
 * Phase 5: 新增 Phase 4 工具 (reflexion/graph/sandbox)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from './context.js'
import { registerAgcRunTool } from './tools/agc-run.js'
import { registerAgcGetStateTool } from './tools/agc-get-state.js'
import { registerAgcVerifyRunTool } from './tools/agc-verify-run.js'
import { registerAgcMemorySearchTool } from './tools/agc-memory-search.js'
import { registerAgcPluginsTool } from './tools/agc-plugins.js'
import { registerPhase4Tools } from './tools/agc-phase4.js'

/**
 * 创建并配置 Conductor MCP Server
 */
export function createConductorServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: 'conductor-agc',
    version: '0.5.0',
  })

  // 注册基础工具
  registerAgcRunTool(server, ctx)
  registerAgcGetStateTool(server, ctx)
  registerAgcVerifyRunTool(server, ctx)

  // Phase 2: 记忆搜索工具
  registerAgcMemorySearchTool(server, ctx)

  // Phase 3: 插件管理工具
  registerAgcPluginsTool(server, ctx)

  // Phase 4: Reflexion + Graph + Sandbox 工具
  registerPhase4Tools(server, ctx)

  return server
}
