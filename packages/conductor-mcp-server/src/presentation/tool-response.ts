/**
 * Conductor AGC — MCP 工具响应序列化
 */

/** 将对象转为 MCP text content */
export function jsonContent(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** 将错误转为 MCP 错误响应 */
export function errorContent(error: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof Error && 'code' in error
    ? { code: (error as { code: string }).code, message }
    : { message }

  return {
    content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
    isError: true,
  }
}
