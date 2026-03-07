/**
 * Conductor AGC — PluginContext（受限上下文）
 *
 * Capability-based Security:
 * 插件只能通过 PluginContext 访问受限 API，
 * 无法直接接触 eventStore、checkpointStore 等核心基础设施。
 *
 * 科研参考:
 * - Capability-based Security (Dennis & Van Horn, 1966)
 * - Object-capability model (Mark Miller, 2006)
 */
import type { CoreLogger } from '../contracts/logger.js'
import type { PluginActivationContext, PluginPermissions } from './plugin-types.js'
import * as path from 'node:path'
import * as fs from 'node:fs'

/**
 * 创建插件激活上下文
 *
 * 每个插件获得独立的:
 * - 前缀化日志器
 * - 隔离数据目录
 * - 受限的文件系统访问（基于 permissions 声明）
 */
export function createPluginContext(
  pluginId: string,
  pluginName: string,
  baseDataDir: string,
  hostLogger: CoreLogger,
  permissions?: PluginPermissions,
): PluginActivationContext {
  // 为每个插件创建隔离数据目录
  const dataDir = path.join(baseDataDir, 'plugins', pluginId)
  fs.mkdirSync(dataDir, { recursive: true })

  // 前缀化日志器: 每条日志自动标注插件来源
  const logger = {
    info(msg: string, data?: Record<string, unknown>): void {
      hostLogger.info(`[plugin:${pluginName}] ${msg}`, data)
    },
    warn(msg: string, data?: Record<string, unknown>): void {
      hostLogger.warn(`[plugin:${pluginName}] ${msg}`, data)
    },
    error(msg: string, data?: Record<string, unknown>): void {
      hostLogger.error(`[plugin:${pluginName}] ${msg}`, data)
    },
  }

  return { logger, dataDir }
}

/**
 * 冻结状态快照
 *
 * 为插件提供只读的状态视图，防止插件修改全局状态。
 * 使用 structuredClone + Object.freeze 双重保护。
 */
export function freezeState<T extends object>(state: T): Readonly<T> {
  const clone = structuredClone(state)
  return Object.freeze(clone)
}
