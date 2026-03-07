/**
 * Conductor AGC — HookBus（钩子总线）
 *
 * 强类型 Hook 管道，支持三种执行模式:
 * - waterfall: 前一个输出是后一个输入（串行管道）
 * - parallel:  全部并行执行（无依赖）
 * - bail:      第一个非空返回值中断执行
 * - series:    串行执行，无返回值传递
 *
 * 学术参考:
 * - Tapable (Webpack): https://github.com/webpack/tapable
 * - Rollup Plugin Pipeline: https://rollupjs.org/plugin-development/
 *
 * 安全特性:
 * - 每个 hook 调用带超时保护 (AbortSignal 兼容)
 * - 单个插件异常不影响其他插件
 * - 执行耗时审计日志
 */
import type { ConductorHooks, HookName, HookMode } from './plugin-types.js'
import { HookModes } from './plugin-types.js'
import type { CoreLogger } from '../contracts/logger.js'
import { consoleLogger } from '../contracts/logger.js'

/** Hook 函数类型（任意 hook 的通用签名） */
type AnyHookFn = (...args: unknown[]) => unknown | Promise<unknown>

/** 注册的 Hook 条目 */
interface HookEntry {
  pluginName: string
  priority: number
  fn: AnyHookFn
  timeoutMs: number
}

/** HookBus 配置 */
export interface HookBusOptions {
  /** Hook 默认超时（毫秒），默认 5000 */
  defaultTimeoutMs?: number
  /** 日志实例 */
  logger?: CoreLogger
}

/**
 * HookBus — 强类型 Hook 管道执行器
 *
 * 使用方式:
 * ```ts
 * const bus = new HookBus()
 * bus.register('afterRisk', 'my-plugin', 100, async (ctx) => { ... })
 * await bus.call('afterRisk', riskContext)
 * ```
 */
export class HookBus {
  private readonly hooks = new Map<HookName, HookEntry[]>()
  private readonly defaultTimeoutMs: number
  private readonly logger: CoreLogger

  constructor(options?: HookBusOptions) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 5000
    this.logger = options?.logger ?? consoleLogger
  }

  /**
   * 注册 Hook 处理函数
   */
  register<K extends HookName>(
    hookName: K,
    pluginName: string,
    priority: number,
    fn: ConductorHooks[K],
    timeoutMs?: number,
  ): void {
    const entries = this.hooks.get(hookName) ?? []
    entries.push({
      pluginName,
      priority,
      fn: fn as AnyHookFn,
      timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
    })
    // 按优先级排序（数值越小越先执行）
    entries.sort((a, b) => a.priority - b.priority)
    this.hooks.set(hookName, entries)
  }

  /**
   * 移除某个插件的所有 Hook
   */
  unregister(pluginName: string): void {
    for (const [key, entries] of this.hooks.entries()) {
      const filtered = entries.filter(e => e.pluginName !== pluginName)
      if (filtered.length === 0) {
        this.hooks.delete(key)
      } else {
        this.hooks.set(key, filtered)
      }
    }
  }

  /**
   * 调用 Hook — 根据 HookMode 自动选择执行模式
   *
   * @returns waterfall 模式返回最终值，bail 模式返回第一个非空值，其他模式无返回值
   */
  async call<K extends HookName>(
    hookName: K,
    ...args: Parameters<ConductorHooks[K]>
  ): Promise<unknown> {
    const entries = this.hooks.get(hookName)
    if (!entries || entries.length === 0) {
      // waterfall 模式返回第一个参数原样
      return args[0]
    }

    const mode: HookMode = HookModes[hookName]

    switch (mode) {
      case 'waterfall':
        return this.executeWaterfall(hookName, entries, args)
      case 'parallel':
        return this.executeParallel(hookName, entries, args)
      case 'bail':
        return this.executeBail(hookName, entries, args)
      case 'series':
        return this.executeSeries(hookName, entries, args)
      default:
        return this.executeSeries(hookName, entries, args)
    }
  }

  /**
   * Waterfall: 前一个输出是后一个输入
   * 如果 hook 返回 undefined/void，保持上一个值
   */
  private async executeWaterfall(
    hookName: HookName,
    entries: HookEntry[],
    args: unknown[],
  ): Promise<unknown> {
    let current = args[0]
    const restArgs = args.slice(1)

    for (const entry of entries) {
      const start = Date.now()
      try {
        // 深拷贝输入，防止插件半修改后抛错导致状态污染
        const frozenInput = typeof current === 'object' && current !== null
          ? structuredClone(current)
          : current
        const result = await this.runWithTimeout(
          entry.pluginName,
          hookName,
          (signal) => entry.fn(frozenInput, ...restArgs, signal),
          entry.timeoutMs,
        )
        // waterfall: 非 undefined 返回值覆盖 current
        if (result !== undefined && result !== null) {
          current = result
        }
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'ok')
      } catch (err) {
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'error')
        this.logger.error(`Hook [${hookName}] 插件 [${entry.pluginName}] 异常`, {
          error: String(err),
        })
        // waterfall: 异常时保持 current 不变，继续
      }
    }
    return current
  }

  /**
   * Parallel: 全部并行执行，等待全部完成
   */
  private async executeParallel(
    hookName: HookName,
    entries: HookEntry[],
    args: unknown[],
  ): Promise<void> {
    const promises = entries.map(async (entry) => {
      const start = Date.now()
      try {
        await this.runWithTimeout(
          entry.pluginName,
          hookName,
          (signal) => entry.fn(...args, signal),
          entry.timeoutMs,
        )
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'ok')
      } catch (err) {
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'error')
        this.logger.error(`Hook [${hookName}] 插件 [${entry.pluginName}] 异常`, {
          error: String(err),
        })
      }
    })
    await Promise.allSettled(promises)
  }

  /**
   * Bail: 第一个非空返回值中断执行
   */
  private async executeBail(
    hookName: HookName,
    entries: HookEntry[],
    args: unknown[],
  ): Promise<unknown> {
    for (const entry of entries) {
      const start = Date.now()
      try {
        const result = await this.runWithTimeout(
          entry.pluginName,
          hookName,
          (signal) => entry.fn(...args, signal),
          entry.timeoutMs,
        )
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'ok')
        if (result !== undefined && result !== null) {
          return result // bail: 立即返回
        }
      } catch (err) {
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'error')
        this.logger.error(`Hook [${hookName}] 插件 [${entry.pluginName}] 异常`, {
          error: String(err),
        })
        // bail: 异常时继续下一个
      }
    }
    return undefined
  }

  /**
   * Series: 串行执行，无返回值传递
   */
  private async executeSeries(
    hookName: HookName,
    entries: HookEntry[],
    args: unknown[],
  ): Promise<void> {
    for (const entry of entries) {
      const start = Date.now()
      try {
        await this.runWithTimeout(
          entry.pluginName,
          hookName,
          (signal) => entry.fn(...args, signal),
          entry.timeoutMs,
        )
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'ok')
      } catch (err) {
        this.logHookExecution(hookName, entry.pluginName, Date.now() - start, 'error')
        this.logger.error(`Hook [${hookName}] 插件 [${entry.pluginName}] 异常`, {
          error: String(err),
        })
        // series: 异常时继续
      }
    }
  }

  /**
   * 超时保护执行器 — AbortController 协作取消
   *
   * 科研升级 A (TC39 Stage 4 AbortController):
   *
   * 原实现 Promise.race 的问题:
   * - 超时后底层 Promise 仍在运行，占用资源
   * - Hook 无法感知已被取消，继续执行副作用
   *
   * 新实现:
   * - 创建 AbortController，将 signal 传给 Hook
   * - 超时触发 controller.abort() → signal.aborted = true
   * - Hook 可通过 signal.throwIfAborted() 检查取消状态
   * - clearTimeout 防止 timer 泄漏
   */
  private async runWithTimeout(
    pluginName: string,
    hookName: string,
    fn: (signal: AbortSignal) => unknown | Promise<unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        Promise.resolve(fn(controller.signal)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            // AbortController 协作取消: 通知底层停止工作
            controller.abort(new Error(
              `插件 [${pluginName}] hook [${hookName}] 超时 (${timeoutMs}ms)`,
            ))
            reject(new Error(
              `插件 [${pluginName}] hook [${hookName}] 超时 (${timeoutMs}ms)`,
            ))
          }, timeoutMs)
        }),
      ])
    } finally {
      // 无论成功/超时/异常，都清理 timer
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }

  /** Hook 执行审计日志 */
  private logHookExecution(
    hookName: string,
    pluginName: string,
    durationMs: number,
    result: 'ok' | 'error',
  ): void {
    if (durationMs > 1000) {
      this.logger.warn(`Hook [${hookName}] 插件 [${pluginName}] 耗时 ${durationMs}ms`, {
        hookName, pluginName, durationMs, result,
      })
    }
  }

  /** 获取已注册 Hook 的统计信息 */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {}
    for (const [key, entries] of this.hooks.entries()) {
      stats[key] = entries.length
    }
    return stats
  }
}
