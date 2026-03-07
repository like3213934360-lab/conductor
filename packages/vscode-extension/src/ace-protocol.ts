import * as path from 'path'
import type { LanguageClient } from 'vscode-languageclient/node'

// ace-server 内部语言 ID 映射
// ace-server 使用 "deveco.apptool.*" 格式的语言 ID，而非标准的 "arkts"、"typescript" 等。
// isValidateFile() 守卫使用这些 ID 来验证文件类型，传入错误的 ID 会导致
// hover、definition 等功能被阻断。
const ACE_LANGUAGE_ID: Record<string, string> = {
  '.ets': 'deveco.apptool.ets',
  '.ts': 'deveco.apptool.ts',
  '.js': 'deveco.apptool.js',
  '.json': 'deveco.apptool.json',
  '.css': 'deveco.apptool.css',
  '.hml': 'deveco.apptool.hml',
}

/** 根据文件路径获取 ace-server 内部语言 ID */
export function getAceLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return ACE_LANGUAGE_ID[ext] ?? 'deveco.apptool.unknown'
}

// ace-server 异步通知桥接层
// ace-server 不使用标准 LSP request/response，而是用自定义 notification 协议：
//   客户端发送 aceProject/onAsync* 通知 → 服务端处理后回发同名通知（含 result）

type PendingResolver = (value: any) => void

/** 通过 requestId 维护待处理的 Promise resolver */
const pendingRequests = new Map<string, PendingResolver>()

let requestIdCounter = 0
export function nextRequestId(): string {
  return `req-${++requestIdCounter}-${Date.now()}`
}

/**
 * 发送 ace-server 自定义通知并等待响应。
 * ace-server 内部协议格式：{params: {...}, requestId: "..."}
 * 响应通过同名通知返回，包含 {requestId: "...", result: ...}
 */
export function sendAceRequest(
  client: LanguageClient,
  method: string,
  params: any,
  logFn: (msg: string) => void,
  timeoutMs = 10000,
): Promise<any> {
  return new Promise((resolve) => {
    const requestId = nextRequestId()
    logFn(`→ ${method} [${requestId}]`)

    pendingRequests.set(requestId, resolve)
    client.sendNotification(method, {
      params,
      requestId,
    })

    setTimeout(() => {
      if (pendingRequests.get(requestId) === resolve) {
        pendingRequests.delete(requestId)
        logFn(`⏰ ${method} [${requestId}] 超时`)
        resolve(null)
      }
    }, timeoutMs)
  })
}

/**
 * 注册 ace-server 响应通知监听器。
 * ace-server worker 处理完后，main process 通过同名通知回发结果：
 *   sendNotification(method, {requestId, result, traceId})
 * 我们通过 requestId 匹配对应的 Promise resolver。
 */
export function registerAceResponseListeners(
  client: LanguageClient,
  logFn: (msg: string) => void,
): void {
  const methods = [
    'aceProject/onAsyncHover',
    'aceProject/onAsyncDefinition',
    'aceProject/onAsyncDocumentHighlight',
    'aceProject/onAsyncCompletion',
    'aceProject/onAsyncCompletionResolve',
    'aceProject/onAsyncSignatureHelp',
    'aceProject/onAsyncCodeAction',
    'aceProject/onAsyncDocumentLinks',
    'aceProject/onAsyncFindUsages',
    'aceProject/onAsyncImplementation',
    'aceProject/onAsyncPrepareRename',
    'aceProject/onAsyncRename',
  ]

  for (const method of methods) {
    client.onNotification(method, (data: any) => {
      const reqId = data?.requestId
      logFn(`← ${method} [${reqId}] hasResult=${!!data?.result}`)
      if (reqId && pendingRequests.has(reqId)) {
        const resolver = pendingRequests.get(reqId)!
        pendingRequests.delete(reqId)
        resolver(data?.result ?? data)
      }
    })
  }
}
