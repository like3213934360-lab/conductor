/**
 * Antigravity Workflow Runtime — stdio 入口
 *
 * 启动 MCP Server，通过 stdio 与宿主 LLM 通信。
 */
import * as path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServerContext } from './context.js'
import { createAntigravityMcpServer } from './server.js'
import { AntigravityModelService } from '@anthropic/antigravity-model-core'

async function main(): Promise<void> {
  const dataDir = process.env['ANTIGRAVITY_DATA_DIR'] ?? path.join(process.cwd(), '.antigravity-data')
  const ctx = createServerContext({
    antigravityService: new AntigravityModelService(),
  })
  console.error('[Antigravity Workflow Runtime] MCP server 启动: daemon-backed workflow authority enabled')
  console.error(`[Antigravity Workflow Runtime] 数据目录: ${dataDir}`)

  const server = createAntigravityMcpServer(ctx)
  const transport = new StdioServerTransport()

  process.once('exit', () => {
    ctx.daemonBridge.dispose()
  })

  await server.connect(transport)
  console.error('[Antigravity Workflow Runtime] MCP Server 已启动 (stdio, daemon-owned workflow authority)')
}

main().catch((err) => {
  console.error('[Antigravity Workflow Runtime] 启动失败:', err)
  process.exit(1)
})
