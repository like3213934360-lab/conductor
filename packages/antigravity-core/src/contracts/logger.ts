/**
 * Antigravity Workflow Runtime — 日志接口
 */

export interface CoreLogger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/** 默认控制台日志实现 */
export const consoleLogger: CoreLogger = {
  debug: (msg, meta) => console.debug(`[Workflow] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[Workflow] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[Workflow] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[Workflow] ${msg}`, meta ?? ''),
}
