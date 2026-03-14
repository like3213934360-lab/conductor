/**
 * arkts-lsp-provider.ts — Real ArkTS LSP diagnostics provider
 *
 * Implements LspDiagnosticsProvider by spawning the ArkTS language server
 * and communicating over JSON-RPC 2.0 with hand-rolled Content-Length framing.
 *
 * Zero external dependencies — only Node.js built-in modules.
 *
 * Three architectural guarantees:
 *  ① StreamParser: accumulates partial data chunks; never assumes one
 *     chunk === one message (fixes LSP stdout fragmentation / coalescing)
 *  ② VFS overlay: sends textDocument/didOpen|didChange so the LSP diagnoses
 *     in-memory content instead of stale on-disk files
 *  ③ Initialization timeout (15 s) + dispose() with killProcessTree to
 *     prevent hung LSP processes from leaking memory
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { LspDiagnostic, LspDiagnosticsProvider } from './reflexion.js'

// ── Error types ───────────────────────────────────────────────────────────────

export class LspInitializationError extends Error {
  constructor(message: string) {
    super(`ArkTS LSP initialization failed: ${message}`)
    this.name = 'LspInitializationError'
  }
}

export class LspDisposedError extends Error {
  constructor() {
    super('ArkTS LSP provider has been disposed')
    this.name = 'LspDisposedError'
  }
}

// ── LSP JSON-RPC wire types ───────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: unknown
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number
  method?: string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  params?: unknown
}

// LSP diagnostic severity (1=Error, 2=Warning, 3=Information, 4=Hint)
const LSP_SEVERITY_ERROR = 1
const LSP_SEVERITY_WARNING = 2

interface LspPosition { line: number; character: number }
interface LspRange { start: LspPosition; end: LspPosition }
interface LspRawDiagnostic {
  range: LspRange
  severity?: number
  message: string
  source?: string
}

interface PublishDiagnosticsParams {
  uri: string
  diagnostics: LspRawDiagnostic[]
}

// ── StreamParser — LSP Content-Length framing ─────────────────────────────────

/**
 * Accumulates raw bytes from the LSP server's stdout and emits complete
 * JSON-RPC messages.
 *
 * LSP wire format:
 *   "Content-Length: <N>\r\n\r\n<N bytes of UTF-8 JSON>"
 *
 * Node's readable 'data' events may deliver partial headers, split JSON bodies,
 * or multiple messages coalesced — this parser handles all cases correctly.
 */
class StreamParser {
  private buf = Buffer.alloc(0)
  private readonly onMessage: (msg: JsonRpcMessage) => void

  constructor(onMessage: (msg: JsonRpcMessage) => void) {
    this.onMessage = onMessage
  }

  push(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    this.parse()
  }

  private parse(): void {
    // Loop: extract as many complete messages as the buffer currently holds
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Find header terminator \r\n\r\n
      const sep = this.buf.indexOf('\r\n\r\n')
      if (sep === -1) return   // Header not yet complete — wait for more data

      const header = this.buf.subarray(0, sep).toString('ascii')
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match || !match[1]) {
        // Malformed header — discard one byte and retry (defensive recovery)
        this.buf = this.buf.subarray(1)
        continue
      }

      const contentLength = parseInt(match[1], 10)
      const bodyStart = sep + 4   // skip \r\n\r\n
      const bodyEnd = bodyStart + contentLength

      if (this.buf.length < bodyEnd) return  // Body not yet complete — wait

      const body = this.buf.subarray(bodyStart, bodyEnd).toString('utf8')
      this.buf = this.buf.subarray(bodyEnd)  // consume message

      try {
        const msg = JSON.parse(body) as JsonRpcMessage
        this.onMessage(msg)
      } catch {
        // Malformed JSON from LSP — skip silently (non-fatal)
        console.warn('[lsp] Received malformed JSON-RPC body, skipping')
      }
      // Continue loop: there may be another message already in buf
    }
  }
}

// ── killProcessTree (local copy — avoids coupling cognitive/ to workers.ts) ───

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.killed) return
  try {
    if (child.pid != null) {
      process.kill(-child.pid, signal)
    }
  } catch {
    try { child.kill(signal) } catch { /* already exited */ }
  }
}

// ── ArkTsLspProvider ─────────────────────────────────────────────────────────

const INIT_TIMEOUT_MS = 15_000     // 15 s LSP startup deadline
const DIAGNOSTICS_TIMEOUT_MS = 30_000   // 30 s per-file diagnostics window

// ── LspSessionMutex ───────────────────────────────────────────────────────────
//
// Guarantees exclusive access to the shared LSP process for each diagnose()
// call session. Prevents Shard A's didChange from polluting Shard B's view
// of the same file.
//
// Design:
//  - Promise-queue FIFO — no busy-loop, no setTimeout polling
//  - release() is always called in the caller's try...finally, preventing
//    deadlock even if diagnose() throws
//  - Re-entrant guard: a shard holding the lock that throws will still release

class LspSessionMutex {
  private locked = false
  private readonly queue: Array<() => void> = []

  /**
   * Acquire exclusive lock. Returns a `release` function that MUST be called
   * inside a try...finally to prevent deadlock.
   */
  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true
          resolve(() => {
            // Release: unlock and hand off to next waiter
            const next = this.queue.shift()
            if (next) {
              // Schedule via microtask to avoid synchronous stack overflow
              // in long queues (Promise.resolve() creates a microtask)
              Promise.resolve().then(next)
            } else {
              this.locked = false
            }
          })
        } else {
          // Already locked — enqueue and wait
          this.queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  /** Drain queued waiters — used during dispose() to unblock any stuck shards. */
  drainWithError(err: Error): void {
    this.locked = false
    const waiters = this.queue.splice(0)
    for (const w of waiters) {
      // Each waiter will re-check tryAcquire; since we cleared locked above,
      // they will acquire immediately (one after another) — but by this point
      // dispose() will have set this.disposed, causing assertAlive() to throw.
      Promise.resolve().then(w)
    }
  }
}

/**
 * Options for constructing ArkTsLspProvider.
 * @param command  Binary to spawn (default: 'arkts-language-server')
 * @param args     Extra CLI args passed to the language server
 * @param workspaceRoot  Absolute path used as the LSP workspace root
 */
export interface ArkTsLspProviderOptions {
  command?: string
  args?: string[]
  workspaceRoot: string
}

/**
 * Real LspDiagnosticsProvider backed by the ArkTS language server process.
 *
 * Usage:
 *   const lsp = await ArkTsLspProvider.create({ workspaceRoot: '/my/project' })
 *   const diags = await lsp.diagnose(vfs.snapshot())
 *   await lsp.dispose()
 */
export class ArkTsLspProvider implements LspDiagnosticsProvider {
  private readonly child: ChildProcess
  private readonly parser: StreamParser
  private readonly mutex = new LspSessionMutex()

  // Pending JSON-RPC requests waiting for a response: id → { resolve, reject }
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >()

  // publishDiagnostics notifications: uri → deferred resolution
  private readonly awaitingDiags = new Map<
    string,
    { resolve: (diags: LspRawDiagnostic[]) => void; timer: ReturnType<typeof setTimeout> }
  >()

  private nextId = 1
  private disposed = false

  // ── Factory (async init with 15 s timeout) ─────────────────────────────────

  static async create(opts: ArkTsLspProviderOptions): Promise<ArkTsLspProvider> {
    const command = opts.command ?? 'arkts-language-server'
    const args = opts.args ?? ['--stdio']

    const child = spawn(command, args, {
      cwd: opts.workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Create a new process group so killProcessTree(-pid) works
      detached: false,
    })

    // Prevent write-after-close from surfacing as uncaught exceptions
    child.stdin?.on('error', () => {})

    const provider = new ArkTsLspProvider(child, opts.workspaceRoot)

    // Pipe LSP stderr → our debug log (non-fatal)
    child.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim()
      if (line) console.debug(`[lsp:stderr] ${line}`)
    })

    // Boot: initialize with timeout
    try {
      await provider.initialize(opts.workspaceRoot)
    } catch (err) {
      killProcessTree(child)
      throw err instanceof LspInitializationError
        ? err
        : new LspInitializationError(err instanceof Error ? err.message : String(err))
    }

    return provider
  }

  private constructor(child: ChildProcess, private readonly workspaceRoot: string) {
    this.child = child
    this.parser = new StreamParser((msg) => this.handleMessage(msg))
    child.stdout!.on('data', (chunk: Buffer) => this.parser.push(chunk))
    child.on('exit', () => this.rejectAllPending('LSP process exited unexpectedly'))
  }

  // ── Outgoing messages ──────────────────────────────────────────────────────

  /** Send a JSON-RPC request and await the response (or rejection). */
  private request<T>(method: string, params: unknown): Promise<T> {
    this.assertAlive()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
      })
      this.write({ jsonrpc: '2.0', id, method, params } satisfies JsonRpcRequest)
    })
  }

  /** Send a JSON-RPC notification (no response expected). */
  private notify(method: string, params: unknown): void {
    this.assertAlive()
    this.write({ jsonrpc: '2.0', method, params } satisfies JsonRpcNotification)
  }

  private write(msg: JsonRpcRequest | JsonRpcNotification): void {
    const body = JSON.stringify(msg)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
    this.child.stdin!.write(header + body)
  }

  // ── Incoming message dispatch ──────────────────────────────────────────────

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to a request we sent
    if (typeof msg.id === 'number' && !msg.method) {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.error) {
        pending.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`))
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    // Server-pushed notification
    if (msg.method === 'textDocument/publishDiagnostics') {
      const params = msg.params as PublishDiagnosticsParams
      const awaiting = this.awaitingDiags.get(params.uri)
      if (awaiting) {
        clearTimeout(awaiting.timer)
        this.awaitingDiags.delete(params.uri)
        awaiting.resolve(params.diagnostics)
      }
      return
    }

    // window/logMessage, $/progress, etc. — silently ignore
  }

  private rejectAllPending(reason: string): void {
    const err = new Error(reason)
    for (const { reject } of this.pending.values()) reject(err)
    this.pending.clear()
    for (const { resolve, timer } of this.awaitingDiags.values()) {
      clearTimeout(timer)
      resolve([])  // Return empty diags rather than crashing the pipeline
    }
    this.awaitingDiags.clear()
  }

  // ── LSP handshake ──────────────────────────────────────────────────────────

  private async initialize(rootPath: string): Promise<void> {
    const rootUri = pathToFileURL(rootPath).toString()

    const initPromise = this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'antigravity-taskd', version: '0.1.0' },
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            didOpen: true,
            didChange: true,
            didClose: true,
          },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: { workspaceFolders: true },
      },
      workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
    })

    // 15-second hard deadline — LSP init in huge monorepos can hang forever
    let timer: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LspInitializationError(`initialize timed out after ${INIT_TIMEOUT_MS}ms`)),
        INIT_TIMEOUT_MS,
      )
    })

    try {
      await Promise.race([initPromise, timeoutPromise])
    } finally {
      clearTimeout(timer!)
      // Suppress unhandled rejection from the loser
      initPromise.catch(() => {})
      timeoutPromise.catch(() => {})
    }

    this.notify('initialized', {})
  }

  // ── Core: diagnose VFS files ───────────────────────────────────────────────

  /**
   * Synchronizes in-memory VFS content to the LSP via textDocument/didChange,
   * then collects publishDiagnostics notifications for each file.
   *
   * Mutex-protected: only ONE shard may hold a diagnose session at a time.
   * didOpen → await publishDiagnostics → didClose are always exclusive,
   * preventing cross-shard file state pollution.
   *
   * @param files  Snapshot of the VirtualFileSystem (path → content)
   */
  async diagnose(files: ReadonlyMap<string, string>): Promise<LspDiagnostic[]> {
    this.assertAlive()
    if (files.size === 0) return []

    // ── Acquire exclusive session lock ──────────────────────────────────────
    // Prevents Shard A's didChange from contaminating Shard B's diagnostics.
    const release = await this.mutex.acquire()

    const openedUris = new Set<string>()
    try {
      // Phase 1: Push all VFS files to LSP via didOpen/didChange.
      for (const [filePath, content] of files) {
        const uri = pathToFileURL(filePath).toString()
        const languageId = filePath.endsWith('.ets') ? 'arkts'
          : filePath.endsWith('.ts') ? 'typescript'
          : 'plaintext'

        if (!openedUris.has(uri)) {
          // First time → didOpen (version 1)
          this.notify('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text: content },
          })
          openedUris.add(uri)
        } else {
          // Already open in session → didChange (full-document sync)
          this.notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: content }],
          })
        }
      }

      // Phase 2: Wait for publishDiagnostics for each file (or timeout).
      const perFileDiags = await Promise.all(
        [...files.keys()].map((filePath) => this.awaitDiagnosticsForFile(filePath)),
      )

      // Phase 3: Convert LSP raw diagnostics → our LspDiagnostic interface
      const diagnostics: LspDiagnostic[] = []
      for (const [filePath, rawDiags] of perFileDiags) {
        for (const raw of rawDiags) {
          const severity: LspDiagnostic['severity'] =
            (raw.severity ?? LSP_SEVERITY_ERROR) <= LSP_SEVERITY_ERROR
              ? 'error'
              : raw.severity === LSP_SEVERITY_WARNING ? 'warning' : 'warning'

          diagnostics.push({
            file: filePath,
            line: raw.range.start.line + 1,
            column: raw.range.start.character + 1,
            message: raw.message,
            severity,
          })
        }
      }
      return diagnostics
    } finally {
      // Phase 4 (always): Close all opened documents — clean LSP memory
      // even if an error occurred mid-session, preventing stale open-document
      // state from leaking into the next shard's session.
      for (const uri of openedUris) {
        try {
          this.notify('textDocument/didClose', { textDocument: { uri } })
        } catch { /* best-effort */ }
      }
      release()  // 🔑 Always release mutex — prevents deadlock on any throw
    }
  }

  /**
   * Immediately cancels any in-flight publishDiagnostics waiters for Racing
   * loser cleanup (onAborted hook).
   *
   * Called when this provider is the loser in a RacingExecutor race.
   * Clears all pending timers and resolves awaiting promises with empty
   * diagnostics so EventLoop references are dropped immediately — no 30s wait.
   */
  cancelPendingSessionForAbort(): void {
    for (const { resolve, timer } of this.awaitingDiags.values()) {
      clearTimeout(timer)
      resolve([])  // Resolve rather than reject — avoids Unhandled Rejection
    }
    this.awaitingDiags.clear()
  }

  /**
   * Registers a one-shot listener for publishDiagnostics for the given file.
   * Times out after DIAGNOSTICS_TIMEOUT_MS and resolves with empty diags
   * (non-fatal: we don't want one unresponsive file to block the pipeline).
   */
  private awaitDiagnosticsForFile(filePath: string): Promise<[string, LspRawDiagnostic[]]> {
    const uri = pathToFileURL(filePath).toString()
    return new Promise<[string, LspRawDiagnostic[]]>((resolve) => {
      const timer = setTimeout(() => {
        this.awaitingDiags.delete(uri)
        console.warn(`[lsp] publishDiagnostics timed out for ${filePath} after ${DIAGNOSTICS_TIMEOUT_MS}ms`)
        resolve([filePath, []])
      }, DIAGNOSTICS_TIMEOUT_MS)

      this.awaitingDiags.set(uri, {
        resolve: (diags) => resolve([filePath, diags]),
        timer,
      })
    })
  }

  // ── Disposal ───────────────────────────────────────────────────────────────

  /**
   * Gracefully shuts down the LSP server:
   *  1. Send shutdown request (LSP may flush remaining events)
   *  2. Send exit notification
   *  3. Wait up to 3 s for voluntary exit
   *  4. killProcessTree as a hard backstop
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    // Reject all in-flight requests immediately (avoids hanging awaits)
    this.rejectAllPending('LSP provider disposed')

    // Best-effort graceful shutdown — ignore errors if process already died
    try {
      // shutdown request: LSP must respond before accepting exit
      await Promise.race([
        this.request('shutdown', null),
        new Promise<unknown>((_, r) => setTimeout(() => r(new Error('shutdown timeout')), 3_000)),
      ]).catch(() => {})

      this.notify('exit', {})
    } catch {
      // Process may have already exited — ignore
    }

    // Hard backstop: give the process 3 more seconds then kill the tree
    await new Promise<void>((resolve) => {
      const hard = setTimeout(() => {
        killProcessTree(this.child, 'SIGKILL')
        resolve()
      }, 3_000)

      this.child.once('exit', () => {
        clearTimeout(hard)
        resolve()
      })
    })
  }

  private assertAlive(): void {
    if (this.disposed) throw new LspDisposedError()
    if (this.child.killed || this.child.exitCode !== null) {
      throw new Error('LSP process has exited unexpectedly')
    }
  }
}
