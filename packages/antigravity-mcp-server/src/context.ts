/**
 * Antigravity MCP — ServerContext
 *
 * 新架构下 MCP server 只保留两类依赖：
 * - host-facing model tools
 * - daemon bridge
 */
import {
  AntigravityModelService,
  ProgressReporter,
  AsyncJobManager,
} from '@anthropic/antigravity-model-core'
import { AntigravityDaemonBridge } from './daemon-bridge.js'

export interface ServerContext {
  antigravityService: AntigravityModelService
  jobManager: AsyncJobManager
  progressReporter: ProgressReporter
  daemonBridge: AntigravityDaemonBridge
}

export type MCPContext = ServerContext

export interface ServerContextDeps {
  antigravityService: AntigravityModelService
}

export function createServerContext(deps: ServerContextDeps): ServerContext {
  const antigravityService = deps.antigravityService
  const progressReporter = new ProgressReporter()
  const jobManager = new AsyncJobManager(antigravityService, progressReporter)

  return {
    antigravityService,
    jobManager,
    progressReporter,
    daemonBridge: new AntigravityDaemonBridge(),
  }
}
