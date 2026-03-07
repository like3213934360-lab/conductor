/**
 * Conductor AGC — stdio 入口
 *
 * 启动 MCP Server，通过 stdio 与宿主 LLM 通信。
 * 用法:
 *   node dist/main.js
 *   # 或通过 MCP 配置文件注册
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServerContext } from './context.js'
import { createConductorServer } from './server.js'
import { InMemoryEventStore } from './adapters/in-memory-event-store.js'
import { InMemoryCheckpointStore } from './adapters/in-memory-checkpoint-store.js'

async function main(): Promise<void> {
  // 依赖注入: Phase 1 使用内存存储
  const ctx = createServerContext({
    eventStore: new InMemoryEventStore(),
    checkpointStore: new InMemoryCheckpointStore(),
  })

  const server = createConductorServer(ctx)
  const transport = new StdioServerTransport()

  await server.connect(transport)
  console.error('[Conductor AGC] MCP Server 已启动 (stdio)')
}

main().catch((err) => {
  console.error('[Conductor AGC] 启动失败:', err)
  process.exit(1)
})
