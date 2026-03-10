/**
 * Conductor AGC — MCP Server 工厂
 *
 * Phase 5: 新增 Phase 4 工具 (reflexion/graph/sandbox)
 * Phase 6: 新增 agc.advance 工具（状态机驱动器）
 * Phase 7: 合并 Hub AI 工具 (ai_ask/ai_codex_task/etc.)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from './context.js'
import { registerAgcRunTool } from './tools/agc-run.js'
import { registerAgcGetStateTool } from './tools/agc-get-state.js'
import { registerAgcVerifyRunTool } from './tools/agc-verify-run.js'
import { registerAgcMemorySearchTool } from './tools/agc-memory-search.js'
import { registerAgcPluginsTool } from './tools/agc-plugins.js'
import { registerPhase4Tools } from './tools/agc-phase4.js'
import { registerAgcAdvanceTool } from './tools/agc-advance.js'
import { registerHubTools } from './tools/hub-tools.js'

/**
 * 创建并配置 Conductor MCP Server (统一 AGC + Hub)
 */
export function createConductorServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: 'conductor',
    version: '0.7.0',
  })

  // Hub AI 工具 (Phase 7: 从 conductor-hub-mcp 合并)
  registerHubTools(server, {
    hubService: ctx.hubService,
    jobManager: ctx.jobManager,
    progressReporter: ctx.progressReporter,
  })

  // AGC 治理工具
  registerAgcRunTool(server, ctx)
  registerAgcGetStateTool(server, ctx)
  registerAgcVerifyRunTool(server, ctx)

  // Phase 2: 记忆搜索工具
  registerAgcMemorySearchTool(server, ctx)

  // Phase 3: 插件管理工具
  registerAgcPluginsTool(server, ctx)

  // Phase 4: Reflexion + Graph + Sandbox 工具
  registerPhase4Tools(server, ctx)

  // Phase 6: AGC 状态机驱动器（100% 工作流执行保证）
  registerAgcAdvanceTool(server, ctx)

  return server
}

