/**
 * Antigravity Workflow Runtime — MCP Server 工厂
 *
 * 新架构: schema-first 工具目录 + daemon-owned workflow authority。
 *
 * 环境变量:
 *   CONDUCTOR_TOOL_DOMAINS — 逗号分隔的域过滤 (例: "model,workflow")
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from './context.js'
import { registerSearchTool, registerToolCatalog, resolveEnabledDomains } from './tool-registry.js'


/**
 * 创建并配置 Antigravity MCP Server
 *
 * 默认模式: model + workflow + debug 全量注册
 */
export function createAntigravityMcpServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: 'antigravity',
    version: '0.8.0',
  })

  const domains = resolveEnabledDomains()
  const modelCtx = {
    antigravityService: ctx.antigravityService,
    jobManager: ctx.jobManager,
    progressReporter: ctx.progressReporter,
  }

  registerToolCatalog(server, ctx, modelCtx, domains)
  registerSearchTool(server, domains)

  console.error(`[Antigravity Workflow Runtime] 已注册工具域: ${domains.join(', ')}`)

  return server
}
