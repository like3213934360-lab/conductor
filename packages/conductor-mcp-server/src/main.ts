/**
 * Conductor AGC — stdio 入口
 *
 * 启动 MCP Server，通过 stdio 与宿主 LLM 通信。
 *
 * Phase 2: 自动检测数据目录，优先使用持久化存储，
 * 无 better-sqlite3 时回退到内存模式。
 */
import * as path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServerContext } from './context.js'
import { createConductorServer } from './server.js'
import { InMemoryEventStore } from './adapters/in-memory-event-store.js'
import { InMemoryCheckpointStore } from './adapters/in-memory-checkpoint-store.js'
import { ConductorHubService } from '@anthropic/conductor-hub-core'

async function main(): Promise<void> {
  const dataDir = process.env['CONDUCTOR_DATA_DIR'] ?? path.join(process.cwd(), '.conductor-data')
  let ctx

  try {
    // Phase 2: 尝试使用持久化存储
    const {
      JsonlEventStore,
      SqliteClient,
      SqliteCheckpointStore,
      MemoryManager,
      runMigrations,
    } = await import('@anthropic/conductor-persistence')

    const sqliteClient = new SqliteClient({ dataDir })
    runMigrations(sqliteClient.getDatabase())

    const eventStore = new JsonlEventStore({ dataDir })
    const checkpointStore = new SqliteCheckpointStore(sqliteClient.getDatabase())
    const memoryManager = new MemoryManager({ db: sqliteClient.getDatabase() })
    const hubService = new ConductorHubService()

    ctx = createServerContext({ eventStore, checkpointStore, memoryManager, hubService })

    console.error('[Conductor AGC] 持久化模式启动 (JSONL + SQLite)')
    console.error(`[Conductor AGC] 数据目录: ${dataDir}`)
  } catch {
    // 回退到内存模式（无 better-sqlite3 原生模块时）
    console.error('[Conductor AGC] 持久化模块不可用，回退到内存模式')
    ctx = createServerContext({
      eventStore: new InMemoryEventStore(),
      checkpointStore: new InMemoryCheckpointStore(),
      hubService: new ConductorHubService(),
    })
  }

  const server = createConductorServer(ctx)
  const transport = new StdioServerTransport()

  await server.connect(transport)
  console.error('[Conductor AGC] MCP Server 已启动 (stdio)')
}

main().catch((err) => {
  console.error('[Conductor AGC] 启动失败:', err)
  process.exit(1)
})
