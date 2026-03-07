/**
 * Conductor AGC — PluginManager（插件宿主）
 *
 * 职责:
 * 1. 发现: conductor-plugin-* 命名约定 + 显式路径
 * 2. 激活: 按 priority 排序 + lazy activation
 * 3. 隔离: 超时保护 + try/catch + Capability-based API
 * 4. 审计: 每个生命周期操作记录到 logger
 *
 * 参考:
 * - VSCode Extension Host: 发现/激活/沙箱
 * - Webpack Plugin System: tapable hooks
 * - Rollup PluginDriver: hook 管道
 */
import type {
  ConductorPlugin, PluginStatus, HookName, ConductorHooks,
  ComplianceRuleContribution,
} from './plugin-types.js'
import { HookBus, type HookBusOptions } from './hook-bus.js'
import { createPluginContext } from './plugin-context.js'
import type { CoreLogger } from '../contracts/logger.js'
import { consoleLogger } from '../contracts/logger.js'
import type { ComplianceRule, ComplianceRuleResult, ComplianceContext } from '../compliance/compliance-rule.js'

/** 插件运行时信息 */
interface PluginRuntime {
  plugin: ConductorPlugin
  status: PluginStatus
  activatedAt?: string
  error?: string
}

/** PluginManager 配置 */
export interface PluginManagerOptions {
  /** 数据目录根路径 */
  dataDir: string
  /** 日志实例 */
  logger?: CoreLogger
  /** Hook 总线配置 */
  hookBusOptions?: HookBusOptions
}

/**
 * PluginManager — 插件宿主管理器
 */
export class PluginManager {
  private readonly plugins = new Map<string, PluginRuntime>()
  private readonly hookBus: HookBus
  private readonly logger: CoreLogger
  private readonly dataDir: string

  constructor(options: PluginManagerOptions) {
    this.dataDir = options.dataDir
    this.logger = options.logger ?? consoleLogger
    this.hookBus = new HookBus({
      defaultTimeoutMs: options.hookBusOptions?.defaultTimeoutMs ?? 5000,
      logger: this.logger,
    })
  }

  /**
   * 注册插件（同步，仅注册不激活）
   */
  registerPlugin(plugin: ConductorPlugin): void {
    const pluginId = plugin.manifest.id
    if (this.plugins.has(pluginId)) {
      this.logger.warn(`插件 [${pluginId}] 已注册，跳过重复注册`)
      return
    }

    this.plugins.set(pluginId, {
      plugin,
      status: 'discovered',
    })

    this.logger.info(`插件已注册: ${plugin.manifest.name} (${pluginId}) v${plugin.manifest.version}`)
  }

  /**
   * 批量注册插件
   */
  registerPlugins(plugins: ConductorPlugin[]): void {
    for (const plugin of plugins) {
      this.registerPlugin(plugin)
    }
  }

  /**
   * 激活插件
   *
   * 按 priority 排序后依次激活:
   * 1. 创建受限 PluginContext
   * 2. 调用 plugin.activate()
   * 3. 注册 hooks 到 HookBus
   * 4. 收集 ComplianceRuleContribution
   */
  async activateAll(): Promise<void> {
    // 按 priority 排序（数值越小越先激活）
    const sortedEntries = Array.from(this.plugins.entries())
      .sort((a, b) => (a[1].plugin.priority ?? 100) - (b[1].plugin.priority ?? 100))

    for (const [pluginId, runtime] of sortedEntries) {
      if (runtime.status !== 'discovered') continue
      await this.activatePlugin(pluginId, runtime)
    }
  }

  /**
   * 激活单个插件
   */
  private async activatePlugin(pluginId: string, runtime: PluginRuntime): Promise<void> {
    const plugin = runtime.plugin
    runtime.status = 'activating'

    try {
      // 1. 创建受限上下文
      const ctx = createPluginContext(
        pluginId,
        plugin.manifest.name,
        this.dataDir,
        this.logger,
        plugin.manifest.permissions,
      )

      // 2. 激活插件
      if (plugin.activate) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            plugin.activate(ctx),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`插件 [${pluginId}] 激活超时`)),
                10000,
              )
            }),
          ])
        } finally {
          if (timer !== undefined) clearTimeout(timer)
        }
      }

      // 3. 注册 hooks
      if (plugin.hooks) {
        const priority = plugin.priority ?? 100
        const hookNames = Object.keys(plugin.hooks) as HookName[]
        for (const hookName of hookNames) {
          const fn = plugin.hooks[hookName]
          if (fn) {
            this.hookBus.register(
              hookName,
              pluginId,
              priority,
              fn as ConductorHooks[typeof hookName],
            )
          }
        }
      }

      runtime.status = 'active'
      runtime.activatedAt = new Date().toISOString()

      this.logger.info(`插件已激活: ${plugin.manifest.name}`, {
        pluginId,
        hookCount: plugin.hooks ? Object.keys(plugin.hooks).length : 0,
        ruleCount: plugin.rules?.length ?? 0,
      })
    } catch (err) {
      runtime.status = 'failed'
      runtime.error = String(err)
      this.logger.error(`插件激活失败: ${plugin.manifest.name}`, {
        pluginId,
        error: String(err),
      })
    }
  }

  /**
   * 停用所有插件
   */
  async deactivateAll(): Promise<void> {
    for (const [pluginId, runtime] of this.plugins.entries()) {
      if (runtime.status !== 'active') continue

      try {
        if (runtime.plugin.deactivate) {
          await runtime.plugin.deactivate()
        }
        this.hookBus.unregister(pluginId)
        runtime.status = 'deactivated'
        this.logger.info(`插件已停用: ${runtime.plugin.manifest.name}`)
      } catch (err) {
        this.logger.error(`插件停用异常: ${runtime.plugin.manifest.name}`, {
          error: String(err),
        })
      }
    }
  }

  /**
   * 获取 HookBus 实例（用于 AGCService 调用 hooks）
   */
  getHookBus(): HookBus {
    return this.hookBus
  }

  /**
   * 收集所有活跃插件贡献的合规规则
   *
   * 将 ComplianceRuleContribution 转换为标准 ComplianceRule 接口，
   * 支持超时保护和条件过滤。
   */
  collectComplianceRules(): ComplianceRule[] {
    const rules: ComplianceRule[] = []

    for (const [pluginId, runtime] of this.plugins.entries()) {
      if (runtime.status !== 'active') continue
      if (!runtime.plugin.rules) continue

      for (const contribution of runtime.plugin.rules) {
        // 将 ComplianceRuleContribution 适配为 ComplianceRule
        const rule: ComplianceRule = {
          id: `${pluginId}/${contribution.id}`,
          name: `[${runtime.plugin.manifest.name}] ${contribution.name}`,
          defaultLevel: contribution.defaultLevel,
          evaluate: async (ctx: ComplianceContext): Promise<ComplianceRuleResult> => {
            // 超时保护 + clearTimeout
            const timeoutMs = contribution.timeoutMs ?? 5000
            let timer: ReturnType<typeof setTimeout> | undefined
            let result: Omit<ComplianceRuleResult, 'ruleId' | 'ruleName'>
            try {
              result = await Promise.race([
                contribution.evaluate({
                  runId: ctx.state.runId,
                  state: ctx.state,
                  graph: ctx.graph,
                  metadata: ctx.metadata,
                }),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () => reject(new Error(`规则 [${contribution.id}] 超时 (${timeoutMs}ms)`)),
                    timeoutMs,
                  )
                }),
              ])
            } finally {
              if (timer !== undefined) clearTimeout(timer)
            }

            // 注入 ruleId/ruleName（避免插件自报漂移）
            return {
              ...result,
              ruleId: `${pluginId}/${contribution.id}`,
              ruleName: `[${runtime.plugin.manifest.name}] ${contribution.name}`,
            }
          },
        }
        rules.push(rule)
      }
    }

    // 按 enforce + order 排序
    return rules.sort((a, b) => {
      // 简化排序：按 ID 字母序
      return a.id.localeCompare(b.id)
    })
  }

  /**
   * 查询所有已注册插件的状态
   */
  listPlugins(): Array<{
    id: string
    name: string
    version: string
    status: PluginStatus
    hookCount: number
    ruleCount: number
    activatedAt?: string
    error?: string
  }> {
    const result: Array<{
      id: string
      name: string
      version: string
      status: PluginStatus
      hookCount: number
      ruleCount: number
      activatedAt?: string
      error?: string
    }> = []

    for (const [_pluginId, runtime] of this.plugins.entries()) {
      result.push({
        id: runtime.plugin.manifest.id,
        name: runtime.plugin.manifest.name,
        version: runtime.plugin.manifest.version,
        status: runtime.status,
        hookCount: runtime.plugin.hooks ? Object.keys(runtime.plugin.hooks).length : 0,
        ruleCount: runtime.plugin.rules?.length ?? 0,
        activatedAt: runtime.activatedAt,
        error: runtime.error,
      })
    }

    return result
  }

  /**
   * 获取 Hook 统计
   */
  getHookStats(): Record<string, number> {
    return this.hookBus.getStats()
  }
}
