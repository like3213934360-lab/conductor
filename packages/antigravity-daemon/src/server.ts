import * as fs from 'node:fs'
import * as http from 'node:http'
import { URL } from 'node:url'
import type { AntigravityDaemonRuntime } from './runtime.js'
import { RemoteWorkerCallbackError } from './remote-worker.js'

export interface DaemonServerStartOptions {
  socketPath: string
  callbackHost?: string
  callbackPort?: number
  callbackBaseUrl?: string
}

export interface DaemonServerHandle {
  readonly controlServer: http.Server
  readonly callbackServer: http.Server
  readonly callbackIngressBaseUrl: string
  close(callback?: (error?: Error | null) => void): void
}

export interface DaemonControlDispatchRequest {
  method: string
  requestPath: string
  body?: unknown
}

export interface DaemonCallbackDispatchRequest {
  method: string
  requestPath: string
  rawBody: string
  parsedBody: unknown
  headers: Record<string, string | string[] | undefined>
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) {
    return {}
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function readRawJsonBody(req: http.IncomingMessage): Promise<{ rawBody: string; parsedBody: unknown }> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const rawBody = Buffer.concat(chunks).toString('utf8')
  return {
    rawBody,
    parsedBody: rawBody ? JSON.parse(rawBody) : {},
  }
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function parseRunId(url: URL): { runId: string; action?: string } | null {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'runs' || !parts[1]) {
    return null
  }
  return {
    runId: decodeURIComponent(parts[1]),
    action: parts[2],
  }
}

function parseCallbackToken(url: URL): string | null {
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'remote-worker-callbacks' || !parts[1]) {
    return null
  }
  return decodeURIComponent(parts[1])
}

async function listenOnSocket(server: http.Server, socketPath: string): Promise<void> {
  if (socketPath.startsWith('/') && fs.existsSync(socketPath)) {
    fs.rmSync(socketPath, { force: true })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function listenOnTcp(server: http.Server, host: string, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve daemon callback listener address')
  }
  return address.port
}

function closeServers(servers: http.Server[], callback?: (error?: Error | null) => void): void {
  let remaining = servers.length
  let firstError: Error | null = null
  if (remaining === 0) {
    callback?.(null)
    return
  }
  for (const server of servers) {
    server.close(error => {
      if (!firstError && error) {
        firstError = error
      }
      remaining -= 1
      if (remaining === 0) {
        callback?.(firstError)
      }
    })
  }
}

export async function dispatchAntigravityDaemonControlRequest(
  runtime: AntigravityDaemonRuntime,
  request: DaemonControlDispatchRequest,
): Promise<{ statusCode: number; payload: unknown }> {
  const method = request.method ?? 'GET'
  const url = new URL(request.requestPath ?? '/', 'http://localhost')

  if (method === 'GET' && url.pathname === '/health') {
    return { statusCode: 200, payload: { ok: true } }
  }

  if (method === 'GET' && url.pathname === '/manifest') {
    return { statusCode: 200, payload: runtime.getManifest() }
  }

  if (method === 'GET' && url.pathname === '/policy-pack') {
    return { statusCode: 200, payload: runtime.getPolicyPack() }
  }

  if (method === 'GET' && url.pathname === '/trust-registry') {
    return { statusCode: 200, payload: runtime.getTrustRegistry() }
  }

  if (method === 'GET' && url.pathname === '/benchmark-source-registry') {
    return { statusCode: 200, payload: runtime.getBenchmarkSourceRegistry() }
  }

  if (method === 'GET' && url.pathname === '/transparency-ledger') {
    return { statusCode: 200, payload: await runtime.getTransparencyLedger() }
  }

  if (method === 'POST' && url.pathname === '/memory/search') {
    return { statusCode: 200, payload: runtime.searchMemory(request.body) }
  }

  if (method === 'POST' && url.pathname === '/policy-pack/reload') {
    return { statusCode: 200, payload: runtime.refreshPolicyPack() }
  }

  if (method === 'POST' && url.pathname === '/trust-registry/reload') {
    return { statusCode: 200, payload: await runtime.refreshTrustRegistry() }
  }

  if (method === 'POST' && url.pathname === '/benchmark-source-registry/reload') {
    return { statusCode: 200, payload: runtime.refreshBenchmarkSourceRegistry() }
  }

  if (method === 'POST' && url.pathname === '/verify-transparency-ledger') {
    return { statusCode: 200, payload: await runtime.verifyTransparencyLedger() }
  }

  if (method === 'GET' && url.pathname === '/remote-workers') {
    return { statusCode: 200, payload: runtime.listRemoteWorkers() }
  }

  if (method === 'POST' && url.pathname === '/remote-workers/refresh') {
    return { statusCode: 200, payload: await runtime.refreshRemoteWorkers() }
  }

  if (method === 'POST' && url.pathname === '/runs/start') {
    return { statusCode: 200, payload: await runtime.startRun(request.body as never) }
  }

  if (method === 'POST' && url.pathname === '/benchmark') {
    return { statusCode: 200, payload: await runtime.runBenchmark(request.body) }
  }

  if (method === 'POST' && url.pathname === '/interop-harness') {
    return { statusCode: 200, payload: await runtime.runInteropHarness(request.body) }
  }

  const parsedRun = parseRunId(url)
  if (!parsedRun) {
    return { statusCode: 404, payload: { error: 'Not found' } }
  }

  if (method === 'GET' && !parsedRun.action) {
    const run = await runtime.getRun(parsedRun.runId)
    if (!run) {
      return { statusCode: 404, payload: { error: 'Run not found' } }
    }
    return { statusCode: 200, payload: run }
  }

  if (method === 'GET' && parsedRun.action === 'session') {
    return { statusCode: 200, payload: await runtime.getRunSession(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'session' && url.pathname.endsWith('/heartbeat')) {
    return { statusCode: 200, payload: await runtime.recordStepHeartbeat(parsedRun.runId, request.body) }
  }

  if (method === 'POST' && parsedRun.action === 'session' && url.pathname.endsWith('/prepare-completion')) {
    return { statusCode: 200, payload: await runtime.prepareStepCompletionReceipt(parsedRun.runId, request.body) }
  }

  if (method === 'POST' && parsedRun.action === 'session' && url.pathname.endsWith('/commit-completion')) {
    return { statusCode: 200, payload: await runtime.commitStepCompletionReceipt(parsedRun.runId, request.body) }
  }

  if (method === 'GET' && parsedRun.action === 'stream') {
    const cursor = Number(url.searchParams.get('cursor') ?? '0')
    return {
      statusCode: 200,
      payload: await runtime.streamRun({
        runId: parsedRun.runId,
        cursor: Number.isFinite(cursor) ? cursor : 0,
      }),
    }
  }

  if (method === 'POST' && parsedRun.action === 'verify') {
    return { statusCode: 200, payload: await runtime.verifyRun(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-trace-bundle') {
    return { statusCode: 200, payload: await runtime.verifyTraceBundle(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'release-attestation') {
    return { statusCode: 200, payload: await runtime.getReleaseAttestation(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'release-artifacts') {
    return { statusCode: 200, payload: await runtime.getReleaseArtifacts(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'policy-report') {
    return { statusCode: 200, payload: await runtime.getPolicyReport(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'invariant-report') {
    return { statusCode: 200, payload: await runtime.getInvariantReport(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'release-dossier') {
    return { statusCode: 200, payload: await runtime.getReleaseDossier(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'release-bundle') {
    return { statusCode: 200, payload: await runtime.getReleaseBundle(parsedRun.runId) }
  }

  if (method === 'GET' && parsedRun.action === 'certification-record') {
    return { statusCode: 200, payload: await runtime.getCertificationRecord(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-release-attestation') {
    return { statusCode: 200, payload: await runtime.verifyReleaseAttestation(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-release-artifacts') {
    return { statusCode: 200, payload: await runtime.verifyReleaseArtifacts(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-policy-report') {
    return { statusCode: 200, payload: await runtime.verifyPolicyReport(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-invariant-report') {
    return { statusCode: 200, payload: await runtime.verifyInvariantReport(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-release-dossier') {
    return { statusCode: 200, payload: await runtime.verifyReleaseDossier(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-release-bundle') {
    return { statusCode: 200, payload: await runtime.verifyReleaseBundle(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'verify-certification-record') {
    return { statusCode: 200, payload: await runtime.verifyCertificationRecord(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'approve') {
    return {
      statusCode: 200,
      payload: await runtime.approveGate({
        ...(request.body as Record<string, unknown>),
        runId: parsedRun.runId,
      }),
    }
  }

  if (method === 'POST' && parsedRun.action === 'cancel') {
    return { statusCode: 200, payload: await runtime.cancelRun(parsedRun.runId) }
  }

  if (method === 'POST' && parsedRun.action === 'replay') {
    return {
      statusCode: 200,
      payload: await runtime.replayRun({
        ...(request.body as Record<string, unknown>),
        runId: parsedRun.runId,
      }),
    }
  }

  if (method === 'POST' && parsedRun.action === 'resume') {
    return {
      statusCode: 200,
      payload: await runtime.resumeRun({
        ...(request.body as Record<string, unknown>),
        runId: parsedRun.runId,
      }),
    }
  }

  if (method === 'POST' && parsedRun.action === 'export-trace-bundle') {
    return { statusCode: 200, payload: await runtime.exportTraceBundle(parsedRun.runId) }
  }

  return { statusCode: 404, payload: { error: 'Not found' } }
}

export function dispatchAntigravityDaemonCallbackRequest(
  runtime: AntigravityDaemonRuntime,
  request: DaemonCallbackDispatchRequest,
): { statusCode: number; payload: unknown } {
  const method = request.method ?? 'GET'
  const url = new URL(request.requestPath ?? '/', 'http://localhost')
  const callbackToken = parseCallbackToken(url)
  if (method !== 'POST' || !callbackToken) {
    return { statusCode: 404, payload: { error: 'Not found' } }
  }

  return {
    statusCode: 202,
    payload: runtime.receiveRemoteWorkerCallback(
      callbackToken,
      request.parsedBody,
      request.rawBody,
      request.headers,
    ),
  }
}

export function createInMemoryAntigravityDaemonTransport(runtime: AntigravityDaemonRuntime): {
  request<T>(request: DaemonControlDispatchRequest): Promise<T>
} {
  return {
    async request<T>(request: DaemonControlDispatchRequest): Promise<T> {
      const { statusCode, payload } = await dispatchAntigravityDaemonControlRequest(runtime, request)
      if (statusCode >= 400) {
        const error = payload as { error?: string }
        throw new Error(typeof error.error === 'string' ? error.error : `Daemon request failed (${statusCode})`)
      }
      return payload as T
    },
  }
}

export async function startAntigravityDaemonServer(
  runtime: AntigravityDaemonRuntime,
  options: DaemonServerStartOptions,
): Promise<DaemonServerHandle> {
  const controlServer = http.createServer(async (req, res) => {
    try {
      const body = req.method === 'POST' ? await readJsonBody(req) : undefined
      const response = await dispatchAntigravityDaemonControlRequest(runtime, {
        method: req.method ?? 'GET',
        requestPath: req.url ?? '/',
        body,
      })
      writeJson(res, response.statusCode, response.payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 500, { error: message })
    }
  })

  const callbackServer = http.createServer(async (req, res) => {
    try {
      const { rawBody, parsedBody } = await readRawJsonBody(req)
      const response = dispatchAntigravityDaemonCallbackRequest(runtime, {
        method: req.method ?? 'GET',
        requestPath: req.url ?? '/',
        rawBody,
        parsedBody,
        headers: req.headers,
      })
      writeJson(res, response.statusCode, response.payload)
    } catch (error) {
      if (error instanceof RemoteWorkerCallbackError) {
        writeJson(res, error.statusCode, { error: error.message })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 500, { error: message })
    }
  })

  await listenOnSocket(controlServer, options.socketPath)
  const callbackHost = options.callbackHost ?? '127.0.0.1'
  const callbackPort = await listenOnTcp(callbackServer, callbackHost, options.callbackPort ?? 0)
  const callbackIngressBaseUrl = options.callbackBaseUrl?.replace(/\/$/, '') ?? `http://${callbackHost}:${callbackPort}`
  runtime.setCallbackIngressBaseUrl(callbackIngressBaseUrl)

  return {
    controlServer,
    callbackServer,
    callbackIngressBaseUrl,
    close(callback) {
      closeServers([controlServer, callbackServer], callback)
    },
  }
}
