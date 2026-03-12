/**
 * Antigravity Workflow Runtime — 自定义错误类
 */
import { WorkflowErrorCode } from './error-codes.js'

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode
  readonly details?: unknown

  constructor(code: WorkflowErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'WorkflowError'
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
export function isWorkflowError(err: unknown): err is WorkflowError {
  return err instanceof WorkflowError
}

/** 将未知错误包装为 WorkflowError */
export function toWorkflowError(err: unknown): WorkflowError {
  if (isWorkflowError(err)) return err
  if (err instanceof Error) {
    return new WorkflowError(WorkflowErrorCode.INTERNAL_ERROR, err.message, { stack: err.stack })
  }
  return new WorkflowError(WorkflowErrorCode.INTERNAL_ERROR, String(err))
}
