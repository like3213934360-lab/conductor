/**
 * Conductor AGC — MCP Server 工厂
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from './context.js'
import { registerAgcRunTool } from './tools/agc-run.js'
import { registerAgcGetStateTool } from './tools/agc-get-state.js'
import { registerAgcVerifyRunTool } from './tools/agc-verify-run.js'

/**
 * 创建并配置 Conductor MCP Server
 */
export function createConductorServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: 'conductor-agc',
    version: '0.1.0',
  })

  // 注册基础工具
  registerAgcRunTool(server, ctx)
  registerAgcGetStateTool(server, ctx)
  registerAgcVerifyRunTool(server, ctx)

  return server
}
