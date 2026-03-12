import * as path from 'path'
import type { LanguageClient } from 'vscode-languageclient/node'

const ACE_LANGUAGE_ID: Record<string, string> = {
  '.ets': 'deveco.apptool.ets',
  '.ts': 'deveco.apptool.ts',
  '.js': 'deveco.apptool.js',
  '.json': 'deveco.apptool.json',
  '.css': 'deveco.apptool.css',
  '.hml': 'deveco.apptool.hml',
}

export function getAceLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return ACE_LANGUAGE_ID[ext] ?? 'deveco.apptool.unknown'
}

type PendingResolver = (value: any) => void
const pendingRequests = new Map<string, PendingResolver>()

let requestIdCounter = 0
export function nextRequestId(): string {
  return `req-${++requestIdCounter}-${Date.now()}`
}

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
