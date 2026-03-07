/**
 * Conductor AGC — 自定义错误类
 */
import { AGCErrorCode } from './error-codes.js'

export class AGCError extends Error {
  readonly code: AGCErrorCode
  readonly details?: unknown

  constructor(code: AGCErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AGCError'
    this.code = code
    this.details = details
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    }
  }
}

/** 类型守卫 */
export function isAGCError(err: unknown): err is AGCError {
  return err instanceof AGCError
}

/** 将未知错误包装为 AGCError */
export function toAGCError(err: unknown): AGCError {
  if (isAGCError(err)) return err
  if (err instanceof Error) {
    return new AGCError(AGCErrorCode.INTERNAL_ERROR, err.message, { stack: err.stack })
  }
  return new AGCError(AGCErrorCode.INTERNAL_ERROR, String(err))
}
