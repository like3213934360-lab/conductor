/**
 * Conductor AGC — ServerContext
 *
 * 依赖注入容器，持有所有服务实例。
 * Phase 3: 新增 PluginManager 支持。
 * Phase 6: 新增 AGCRunDriver 依赖（eventStore/checkpointStore/dagEngine/hubService）
 */
import { AGCService } from '@anthropic/conductor-core'
import type { AGCServiceDeps, PluginManager, ConductorRuntime } from '@anthropic/conductor-core'
import type { EventStore } from '@anthropic/conductor-core'
import type { CheckpointStore } from '@anthropic/conductor-core'
import { DagEngine } from '@anthropic/conductor-core'
import type { MemoryManager } from '@anthropic/conductor-persistence'
import type { ConductorHubService } from '@anthropic/conductor-hub-core'

export interface ServerContext {
  agcService: AGCService
  /** Phase 2: 三层记忆管理器（可选） */
  memoryManager?: MemoryManager
  /** Phase 3: 插件管理器（可选） */
  pluginManager?: PluginManager
  /** Phase 5: 统一运行时 Facade（可选，启用后 Phase 4 工具可用） */
  runtime?: ConductorRuntime
  /** Phase 6: AGCRunDriver 所需依赖 */
  eventStore: EventStore
  checkpointStore: CheckpointStore
  dagEngine: DagEngine
  hubService: ConductorHubService
}

/** 兼容别名 */
export type MCPContext = ServerContext

export interface ServerContextDeps extends AGCServiceDeps {
  memoryManager?: MemoryManager
  pluginManager?: PluginManager
  runtime?: ConductorRuntime
  /** Phase 6: ConductorHubService 实例 */
  hubService: ConductorHubService
}

export function createServerContext(deps: ServerContextDeps): ServerContext {
  return {
    agcService: new AGCService(deps),
    memoryManager: deps.memoryManager,
    pluginManager: deps.pluginManager,
    runtime: deps.runtime,
    eventStore: deps.eventStore,
    checkpointStore: deps.checkpointStore,
    dagEngine: new DagEngine(),
    hubService: deps.hubService,
  }
}

