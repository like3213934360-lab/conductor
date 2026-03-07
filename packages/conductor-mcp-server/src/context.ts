/**
 * Conductor AGC — ServerContext
 *
 * 依赖注入容器，持有所有服务实例。
 * Phase 3: 新增 PluginManager 支持。
 */
import { AGCService } from '@anthropic/conductor-core'
import type { AGCServiceDeps, PluginManager, ConductorRuntime } from '@anthropic/conductor-core'
import type { MemoryManager } from '@anthropic/conductor-persistence'

export interface ServerContext {
  agcService: AGCService
  /** Phase 2: 三层记忆管理器（可选） */
  memoryManager?: MemoryManager
  /** Phase 3: 插件管理器（可选） */
  pluginManager?: PluginManager
  /** Phase 5: 统一运行时 Facade（可选，启用后 Phase 4 工具可用） */
  runtime?: ConductorRuntime
}

/** 兼容别名 */
export type MCPContext = ServerContext

export interface ServerContextDeps extends AGCServiceDeps {
  memoryManager?: MemoryManager
  pluginManager?: PluginManager
  runtime?: ConductorRuntime
}

export function createServerContext(deps: ServerContextDeps): ServerContext {
  return {
    agcService: new AGCService(deps),
    memoryManager: deps.memoryManager,
    pluginManager: deps.pluginManager,
    runtime: deps.runtime,
  }
}
