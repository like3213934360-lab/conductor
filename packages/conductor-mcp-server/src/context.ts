/**
 * Conductor AGC — ServerContext
 *
 * 依赖注入容器，持有所有服务实例。
 */
import { AGCService } from '@anthropic/conductor-core'
import type { AGCServiceDeps } from '@anthropic/conductor-core'

export interface ServerContext {
  agcService: AGCService
}

export function createServerContext(deps: AGCServiceDeps): ServerContext {
  return {
    agcService: new AGCService(deps),
  }
}
