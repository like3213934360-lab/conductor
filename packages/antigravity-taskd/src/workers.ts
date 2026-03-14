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

class CodexAppServerWorkerAdapter implements WorkerAdapter {
  readonly backend: WorkerBackend = 'codex'

  async run(
    request: WorkerRunRequest,
    onEvent: (event: WorkerEvent) => void,
    signal: AbortSignal,
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
      child.kill('SIGTERM')
    }
    signal.addEventListener('abort', abort, { once: true })

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
      await sendRequest('initialize', {
        clientInfo: {
          name: 'antigravity-taskd',
          version: '0.1.0',
        },
        capabilities: null,
      })
      const threadResponse = await sendRequest<any>('thread/start', {
        cwd: request.cwd,
        approvalPolicy: 'never',
        sandbox: request.mode === 'write' ? 'workspace-write' : 'read-only',
        serviceName: 'antigravity-taskd',
        developerInstructions: `Role=${request.role}. Follow the JSON contract exactly.`,
        ephemeral: true,
        experimentalRawEvents: false,
        persistExtendedHistory: false,
      })
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
      if (!child.killed) {
        child.kill('SIGTERM')
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
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    if (!child.stdout) {
      throw new Error('Gemini CLI did not expose stdout')
    }

    const stopSyntheticProgress = startSyntheticProgress(onEvent)
    let finalText = ''
    const changedFiles = new Set<string>()
    let latestDiff = ''

    const abort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', abort, { once: true })

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
      rl.close()
      stderrRl?.close()
      if (!child.killed) {
        child.kill('SIGTERM')
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
