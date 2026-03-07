/**
 * Conductor AGC — ServerContext
 *
 * 依赖注入容器，持有所有服务实例。
 * Phase 2: 新增 MemoryManager 支持。
 */
import { AGCService } from '@anthropic/conductor-core'
import type { AGCServiceDeps } from '@anthropic/conductor-core'
import type { MemoryManager } from '@anthropic/conductor-persistence'

export interface ServerContext {
  agcService: AGCService
  /** Phase 2: 三层记忆管理器（可选，向后兼容） */
  memoryManager?: MemoryManager
}

export interface ServerContextDeps extends AGCServiceDeps {
  memoryManager?: MemoryManager
}

export function createServerContext(deps: ServerContextDeps): ServerContext {
  return {
    agcService: new AGCService(deps),
    memoryManager: deps.memoryManager,
  }
}
