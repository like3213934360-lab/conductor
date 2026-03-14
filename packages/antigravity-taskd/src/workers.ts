import { spawn } from 'node:child_process'
import * as readline from 'node:readline'
import { buildFileContext } from './file-context.js'
import type { WorkerAdapter, WorkerBackend, WorkerEvent, WorkerRunRequest, WorkerRunResult } from './schema.js'

interface JsonRpcResponse {
  id?: number | string
  result?: unknown
  error?: { message?: string }
  method?: string
  params?: unknown
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * 杀死进程及其整个进程组（子进程 + 孙子进程），防止僵尸进程泄漏。
 * 在 POSIX 系统中，`process.kill(-pid)` 发送信号到整个进程组。
 * 如果进程组 kill 失败（例如权限不足或 Windows），退化为单进程 kill。
 */
function killProcessTree(child: import('node:child_process').ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.killed) return
  try {
    if (child.pid != null) {
      // 杀死整个进程组（pid 取负 = 进程组）
      process.kill(-child.pid, signal)
    }
  } catch {
    // 进程组 kill 失败（Windows 或已退出）→ 降级为直接 kill
    try {
      child.kill(signal)
    } catch {
      // 进程已退出 — 静默忽略
    }
  }
}

function startSyntheticProgress(onEvent: (event: WorkerEvent) => void): () => void {
  let lastSemanticEventAt = Date.now()
  const touch = () => {
    lastSemanticEventAt = Date.now()
  }
  const timer = setInterval(() => {
    if (Date.now() - lastSemanticEventAt < 15_000) return
    touch()
    onEvent({
      type: 'progress',
      timestamp: Date.now(),
      phase: 'thinking',
      message: 'Worker is still progressing',
      progress: 0.15,
    })
  }, 5_000)

  return () => {
    clearInterval(timer)
  }
}

function extractStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap(item => extractStrings(item))
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(item => extractStrings(item))
  }
  return []
}

function appendContext(prompt: string, cwd: string, filePaths: string[]): string {
  const { context } = buildFileContext(cwd, filePaths)
  return context ? `${prompt}\n\n${context}` : prompt
}

// ── JSON-RPC 安全常量 ──────────────────────────────────────────
// CLI 冷启动时可能加载模型 / 下载依赖，防止无限期挂起
const INIT_TIMEOUT_MS = 15_000  // 15s
// 单行 JSON-RPC 消息最大字节数（防止 50MB 巨包阻塞 Event Loop）
const MAX_LINE_BYTES = 10 * 1024 * 1024  // 10MB

class WorkerInitError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`JSON-RPC ${method} timed out after ${timeoutMs}ms (CLI cold start?)`)
    this.name = 'WorkerInitError'
  }
}

/** 包装一个带独立超时的 sendRequest，用于初始化阶段（initialize / thread/start）
 *  修复：timer 泄漏 + loser promise Unhandled Rejection */
function withInitTimeout<T>(promise: Promise<T>, method: string, timeoutMs: number = INIT_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new WorkerInitError(method, timeoutMs)),
      timeoutMs,
    )
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    // 无论谁赢都清理 timer，防止空跑
    clearTimeout(timer)
    // 静默吞掉 loser 的 rejection，防止 Unhandled Promise Rejection
    promise.catch(() => {})
    timeoutPromise.catch(() => {})
  })
}

class CodexAppServerWorkerAdapter implements WorkerAdapter {
  readonly backend: WorkerBackend = 'codex'


  async run(
    request: WorkerRunRequest,
    onEvent: (event: WorkerEvent) => void,
    signal: AbortSignal,
    softSignal?: AbortSignal,
  ): Promise<WorkerRunResult> {
    const fullPrompt = appendContext(request.prompt, request.cwd, request.filePaths)
    const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    if (!child.stdin || !child.stdout) {
      throw new Error('Codex App Server did not expose stdio handles')
    }

    // 安全网：防止 write-after-close 在 stdin 上变成 uncaught exception
    child.stdin.on('error', () => {})

    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
    let nextId = 1
    let threadId = ''
    let finalText = ''
    let latestDiff = ''
    const changedFiles = new Set<string>()
    const stopSyntheticProgress = startSyntheticProgress(onEvent)
    let turnCompleted = false

    const cleanup = () => {
      stopSyntheticProgress()
      rl.close()
    }

    const touch = (event?: WorkerEvent) => {
      if (event) onEvent(event)
    }

    const sendRequest = async <T>(method: string, params: Record<string, unknown> | undefined): Promise<T> => {
      const id = nextId++
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })
      const responsePromise = new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as T), reject })
      })
      child.stdin!.write(`${payload}\n`)
      return responsePromise
    }

    const abort = () => {
      killProcessTree(child)
    }
    signal.addEventListener('abort', abort, { once: true })

    // soft signal: 通过 JSON-RPC 协议层发 turn/cancel，通知模型停止生成并返回已有内容
    // 修复：严格检查 stdin 可写性 + try/catch 包裹 IPC 调用
    const softAbort = () => {
      try {
        // 三重守卫：进程存活 + threadId 已知 + stdin 管道可写
        if (!child.killed && threadId && child.stdin && !child.stdin.destroyed && child.stdin.writable) {
          sendRequest('turn/cancel', { threadId }).catch(() => {
            // fallback: server 不支持 turn/cancel
            if (!child.killed && child.stdin && !child.stdin.destroyed && child.stdin.writable) {
              sendRequest('$/cancelRequest', { id: nextId - 1 }).catch(() => {})
            }
          })
        }
      } catch {
        // stdin 已关闭或进程已退出 — 静默忽略，绝不允许异常逃逸
      }
    }
    softSignal?.addEventListener('abort', softAbort, { once: true })

    const rl = readline.createInterface({ input: child.stdout })
    const stderrRl = child.stderr ? readline.createInterface({ input: child.stderr }) : null

    stderrRl?.on('line', (line) => {
      if (!line.trim()) return
      touch({
        type: 'progress',
        timestamp: Date.now(),
        phase: 'working',
        message: line.trim(),
        progress: 0.2,
      })
    })

    let completionResolve!: () => void
    let completionReject!: (error: Error) => void
    const completionPromise = new Promise<void>((resolve, reject) => {
      completionResolve = resolve
      completionReject = reject
    })

    const handleItem = (item: any, started: boolean) => {
      if (!item || typeof item !== 'object') return
      const itemType = String(item.type || '')
      switch (itemType) {
        case 'reasoning':
          touch({
            type: 'progress',
            timestamp: Date.now(),
            phase: 'thinking',
            message: extractStrings(item.summary).join(' ').slice(0, 240) || 'Codex reasoning',
            progress: 0.1,
          })
          break
        case 'agentMessage':
          if (!started && typeof item.text === 'string') {
            finalText += `${item.text}\n`
          }
          touch({
            type: 'message',
            timestamp: Date.now(),
            phase: started ? 'working' : 'finalizing',
            message: typeof item.text === 'string' ? item.text.slice(0, 240) : 'Codex message',
            progress: started ? 0.4 : 0.9,
          })
          break
        case 'commandExecution':
          touch({
            type: started ? 'tool_use' : 'tool_result',
            timestamp: Date.now(),
            phase: 'working',
            message: typeof item.command === 'string'
              ? item.command
              : 'Codex command execution',
            progress: started ? 0.45 : 0.55,
            details: {
              command: item.command,
              cwd: item.cwd,
              exitCode: item.exitCode,
            },
          })
          if (!started && typeof item.aggregatedOutput === 'string' && item.aggregatedOutput.trim()) {
            finalText += `${item.aggregatedOutput.trim()}\n`
          }
          break
        case 'fileChange':
          if (Array.isArray(item.changes)) {
            for (const change of item.changes) {
              const target = typeof change?.path === 'string'
                ? change.path
                : typeof change?.newPath === 'string'
                  ? change.newPath
                  : undefined
              if (target) changedFiles.add(target)
            }
          }
          touch({
            type: 'file_change',
            timestamp: Date.now(),
            phase: 'working',
            message: 'Codex updated files',
            progress: started ? 0.6 : 0.75,
            details: { changes: item.changes },
          })
          break
        case 'mcpToolCall':
        case 'dynamicToolCall':
        case 'webSearch':
          touch({
            type: started ? 'tool_use' : 'tool_result',
            timestamp: Date.now(),
            phase: 'working',
            message: item.tool || item.query || item.server || itemType,
            progress: started ? 0.35 : 0.5,
            details: item,
          })
          break
        case 'plan':
          touch({
            type: 'progress',
            timestamp: Date.now(),
            phase: 'thinking',
            message: typeof item.text === 'string' ? item.text.slice(0, 240) : 'Codex plan updated',
            progress: 0.2,
          })
          break
        default:
          break
      }
    }

    rl.on('line', (line) => {
      if (!line.trim()) return
      // 🛡️ 防止巨型 JSON-RPC 包阻塞 Event Loop
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        console.warn(`[taskd] Codex JSON-RPC line exceeds ${MAX_LINE_BYTES} bytes, dropping`)
        return
      }
      let message: JsonRpcResponse
      try {
        message = JSON.parse(line) as JsonRpcResponse
      } catch {
        touch({
          type: 'progress',
          timestamp: Date.now(),
          phase: 'working',
          message: line.trim().slice(0, 240),
          progress: 0.2,
        })
        return
      }

      if (message.id != null) {
        const pendingRequest = pending.get(Number(message.id))
        if (!pendingRequest) return
        pending.delete(Number(message.id))
        if (message.error) {
          pendingRequest.reject(new Error(message.error.message || 'Codex App Server request failed'))
          return
        }
        pendingRequest.resolve(message.result)
        return
      }

      const method = typeof message.method === 'string' ? message.method : ''
      const params = message.params as any
      switch (method) {
        case 'turn/started':
          touch({
            type: 'started',
            timestamp: Date.now(),
            phase: 'thinking',
            message: 'Codex turn started',
            progress: 0.05,
          })
          break
        case 'turn/completed':
          turnCompleted = true
          touch({
            type: 'completed',
            timestamp: Date.now(),
            phase: 'done',
            message: 'Codex turn completed',
            progress: 1,
          })
          completionResolve()
          break
        case 'turn/diff/updated':
          latestDiff = typeof params?.diff === 'string' ? params.diff : latestDiff
          touch({
            type: 'diff_update',
            timestamp: Date.now(),
            phase: 'working',
            message: 'Codex diff updated',
            progress: 0.8,
            details: { diff: latestDiff },
          })
          break
        case 'turn/plan/updated':
          touch({
            type: 'progress',
            timestamp: Date.now(),
            phase: 'thinking',
            message: 'Codex plan updated',
            progress: 0.2,
            details: params,
          })
          break
        case 'item/started':
          handleItem(params?.item, true)
          break
        case 'item/completed':
          handleItem(params?.item, false)
          break
        case 'item/commandExecution/outputDelta':
          touch({
            type: 'progress',
            timestamp: Date.now(),
            phase: 'working',
            message: extractStrings(params).join(' ').slice(0, 240) || 'Codex command output',
            progress: 0.5,
          })
          break
        case 'item/fileChange/outputDelta':
          touch({
            type: 'diff_update',
            timestamp: Date.now(),
            phase: 'working',
            message: 'Codex file change delta',
            progress: 0.7,
            details: params,
          })
          break
        case 'item/reasoning/summaryTextDelta':
        case 'item/reasoning/textDelta':
          touch({
            type: 'progress',
            timestamp: Date.now(),
            phase: 'thinking',
            message: extractStrings(params).join(' ').slice(0, 240) || 'Codex reasoning',
            progress: 0.15,
          })
          break
        case 'error':
          completionReject(new Error(extractStrings(params).join(' ') || 'Codex App Server error'))
          break
        default:
          break
      }
    })

    child.on('error', (error) => {
      completionReject(error)
    })
    child.on('exit', (code, signalName) => {
      if (turnCompleted) return
      const reason = signal.aborted
        ? 'Codex worker aborted'
        : `Codex App Server exited before completion (code=${code}, signal=${signalName ?? 'none'})`
      completionReject(new Error(reason))
    })

    try {
      // ── 初始化阶段带独立 15s 超时，防止冷启动消耗整个 stage budget ──
      await withInitTimeout(
        sendRequest('initialize', {
          clientInfo: {
            name: 'antigravity-taskd',
            version: '0.1.0',
          },
          capabilities: null,
        }),
        'initialize',
      )
      const threadResponse = await withInitTimeout(
        sendRequest<any>('thread/start', {
          cwd: request.cwd,
          approvalPolicy: 'never',
          sandbox: request.mode === 'write' ? 'workspace-write' : 'read-only',
          serviceName: 'antigravity-taskd',
          developerInstructions: `Role=${request.role}. Follow the JSON contract exactly.`,
          ephemeral: true,
          experimentalRawEvents: false,
          persistExtendedHistory: false,
        }),
        'thread/start',
      )
      threadId = String(threadResponse?.thread?.id || '')
      if (!threadId) {
        throw new Error('Codex App Server did not return a thread id')
      }

      await sendRequest('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: fullPrompt,
            text_elements: [],
          },
        ],
      })
      await completionPromise
    } finally {
      cleanup()
      signal.removeEventListener('abort', abort)
      softSignal?.removeEventListener('abort', softAbort)
      if (!child.killed) {
        killProcessTree(child)
      }
    }

    return {
      backend: 'codex',
      workerId: request.workerId,
      text: finalText.trim(),
      diff: latestDiff || undefined,
      changedFiles: [...changedFiles],
    }
  }
}

class GeminiStreamJsonWorkerAdapter implements WorkerAdapter {
  readonly backend: WorkerBackend = 'gemini'

  async run(
    request: WorkerRunRequest,
    onEvent: (event: WorkerEvent) => void,
    signal: AbortSignal,
    softSignal?: AbortSignal,
  ): Promise<WorkerRunResult> {
    const fullPrompt = appendContext(request.prompt, request.cwd, request.filePaths)
    const args = [
      '-p',
      fullPrompt,
      '--output-format',
      'stream-json',
      '--approval-mode',
      request.mode === 'write' ? 'yolo' : 'plan',
    ]
    const child = spawn('gemini', args, {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],  // stdin 改为 pipe 以支持 Ctrl-C 软中断
      env: { ...process.env },
    })
    if (!child.stdout) {
      throw new Error('Gemini CLI did not expose stdout')
    }

    // 安全网：防止 write-after-close 变成 uncaught exception
    child.stdin?.on('error', () => {})

    const stopSyntheticProgress = startSyntheticProgress(onEvent)
    let finalText = ''
    const changedFiles = new Set<string>()
    let latestDiff = ''

    const abort = () => killProcessTree(child)
    signal.addEventListener('abort', abort, { once: true })

    // soft signal: 先尝试 stdin 发 Ctrl-C（\x03），比 SIGINT 更可控；
    // 如果 stdin 不可用则 fallback 到 SIGINT。
    // 设计权衡：Gemini CLI 对 SIGINT 的行为不确定（可能直接退出不输出），
    // 而 stdin Ctrl-C 会被 readline 层处理，更可能触发 graceful flush。
    const softAbort = () => {
      try {
        if (!child.killed) {
          // 优先通过 stdin 发送 Ctrl-C
          if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write('\x03')
          } else {
            // stdin 不可用时退化为 SIGINT
            child.kill('SIGINT')
          }
        }
      } catch {
        // 进程已退出 — 静默忽略
      }
    }
    softSignal?.addEventListener('abort', softAbort, { once: true })

    const rl = readline.createInterface({ input: child.stdout })
    const stderrRl = child.stderr ? readline.createInterface({ input: child.stderr }) : null
    stderrRl?.on('line', (line) => {
      if (!line.trim()) return
      onEvent({
        type: 'progress',
        timestamp: Date.now(),
        phase: 'working',
        message: line.trim(),
        progress: 0.2,
      })
    })

    const completionPromise = new Promise<void>((resolve, reject) => {
      rl.on('line', (line) => {
        if (!line.trim()) return
        // 🛡️ 防止巨型 JSON 包阻塞 Event Loop
        if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
          console.warn(`[taskd] Gemini JSON line exceeds ${MAX_LINE_BYTES} bytes, dropping`)
          return
        }
        let parsed: any
        try {
          parsed = JSON.parse(line)
        } catch {
          finalText += `${line.trim()}\n`
          onEvent({
            type: 'message',
            timestamp: Date.now(),
            phase: 'working',
            message: line.trim().slice(0, 240),
            progress: 0.5,
          })
          return
        }

        const eventType = String(parsed?.type || parsed?.event || '')
        const extractedText = extractStrings(parsed).join(' ').trim()
        switch (eventType) {
          case 'init':
            onEvent({
              type: 'started',
              timestamp: Date.now(),
              phase: 'thinking',
              message: 'Gemini stream initialized',
              progress: 0.05,
            })
            break
          case 'message':
            if (extractedText) finalText += `${extractedText}\n`
            onEvent({
              type: 'message',
              timestamp: Date.now(),
              phase: 'working',
              message: extractedText.slice(0, 240) || 'Gemini message',
              progress: 0.45,
            })
            break
          case 'tool_use':
            onEvent({
              type: 'tool_use',
              timestamp: Date.now(),
              phase: 'tool_use',
              message: extractedText.slice(0, 240) || 'Gemini tool use',
              progress: 0.4,
              details: parsed,
            })
            break
          case 'tool_result':
            for (const text of extractStrings(parsed)) {
              const match = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/)
              if (match) changedFiles.add(match[0])
            }
            onEvent({
              type: 'tool_result',
              timestamp: Date.now(),
              phase: 'working',
              message: extractedText.slice(0, 240) || 'Gemini tool result',
              progress: 0.6,
              details: parsed,
            })
            break
          case 'result':
            if (extractedText) finalText += `${extractedText}\n`
            latestDiff = typeof parsed?.diff === 'string' ? parsed.diff : latestDiff
            onEvent({
              type: 'completed',
              timestamp: Date.now(),
              phase: 'done',
              message: 'Gemini completed',
              progress: 1,
            })
            resolve()
            break
          case 'error':
            reject(new Error(extractedText || 'Gemini stream-json error'))
            break
          default:
            if (extractedText) {
              finalText += `${extractedText}\n`
              onEvent({
                type: 'progress',
                timestamp: Date.now(),
                phase: 'thinking',
                message: extractedText.slice(0, 240),
                progress: 0.25,
              })
            }
            break
        }
      })

      child.on('error', reject)
      child.on('exit', (code, signalName) => {
        if (signal.aborted) {
          reject(new Error('Gemini worker aborted'))
          return
        }
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`Gemini CLI exited before completion (code=${code}, signal=${signalName ?? 'none'})`))
      })
    })

    try {
      await completionPromise
    } finally {
      stopSyntheticProgress()
      signal.removeEventListener('abort', abort)
      softSignal?.removeEventListener('abort', softAbort)
      rl.close()
      stderrRl?.close()
      if (!child.killed) {
        killProcessTree(child)
      }
    }

    return {
      backend: 'gemini',
      workerId: request.workerId,
      text: finalText.trim(),
      diff: latestDiff || undefined,
      changedFiles: [...changedFiles],
    }
  }
}

export function createWorkerAdapters(): Record<WorkerBackend, WorkerAdapter> {
  return {
    codex: new CodexAppServerWorkerAdapter(),
    gemini: new GeminiStreamJsonWorkerAdapter(),
  }
}
