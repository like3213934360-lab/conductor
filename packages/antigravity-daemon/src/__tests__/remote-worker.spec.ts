import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  signAgentCardAdvertisementSurface,
  type AgentCard,
} from '@anthropic/antigravity-core'
import type { NodeExecutionContext } from '@anthropic/antigravity-model-core'
import { RemoteWorkerDirectory } from '../remote-worker.js'
import { TrustRegistryStore } from '../trust-registry.js'

type MockHeaders = Record<string, string | string[] | undefined>

interface MockRequest {
  method?: string
  url?: string
  headers: MockHeaders
  [Symbol.asyncIterator](): AsyncIterator<Buffer>
}

interface MockResponse {
  writeHead(statusCode: number, headers?: MockHeaders): void
  write(chunk: string | Buffer): void
  end(chunk?: string | Buffer): void
}

type MockRemoteWorkerHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

interface MockResponseResult {
  statusCode: number
  headers: MockHeaders
  rawBody: string
}

interface MockRemoteWorkerTransport {
  requestJsonResponse<T>(options: {
    method: 'GET' | 'POST'
    url: string
    body?: unknown
    bearerToken?: string
    signal?: AbortSignal
  }): Promise<{
    statusCode: number
    headers: MockHeaders
    rawBody: string
    body: T
  }>
  requestJson<T>(options: {
    method: 'GET' | 'POST'
    url: string
    body?: unknown
    bearerToken?: string
    signal?: AbortSignal
  }): Promise<T>
  requestTaskStream(
    url: string,
    bearerToken: string | undefined,
    fallbackTaskId: string,
    signal: AbortSignal | undefined,
  ): Promise<{
    status: 'completed'
    taskId: string
    output: Record<string, unknown>
    model?: string
    durationMs?: number
  }>
}

function createContext(): NodeExecutionContext {
  return {
    runId: 'run-1',
    graph: {
      nodes: [
        { id: 'ANALYZE', dependsOn: [] },
        { id: 'VERIFY', dependsOn: ['ANALYZE'] },
      ],
      edges: [{ from: 'ANALYZE', to: 'VERIFY' }],
    },
    state: {
      capturedContext: {
        metadata: {
          goal: 'Verify the answer',
          files: [],
        },
      },
    },
    nodeId: 'VERIFY',
    attempt: 1,
    signal: new AbortController().signal,
    agentRuntime: {} as never,
    getUpstreamOutput: (nodeId: string) => nodeId === 'ANALYZE'
      ? { taskType: 'audit' }
      : undefined,
  } as unknown as NodeExecutionContext
}

function createMockRequest(
  method: string,
  url: string,
  headers: MockHeaders,
  body?: string,
): MockRequest {
  const chunks = body ? [Buffer.from(body, 'utf8')] : []
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
}

class MockResponseCollector implements MockResponse {
  statusCode = 200
  headers: MockHeaders = {}
  private readonly chunks: Buffer[] = []
  private ended = false
  private readonly donePromise: Promise<void>
  private resolveDone!: () => void

  constructor() {
    this.donePromise = new Promise<void>((resolve) => {
      this.resolveDone = resolve
    })
  }

  writeHead(statusCode: number, headers?: MockHeaders): void {
    this.statusCode = statusCode
    if (headers) {
      this.headers = { ...this.headers, ...headers }
    }
  }

  write(chunk: string | Buffer): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'))
  }

  end(chunk?: string | Buffer): void {
    if (chunk !== undefined) {
      this.write(chunk)
    }
    if (this.ended) {
      return
    }
    this.ended = true
    this.resolveDone()
  }

  async result(): Promise<MockResponseResult> {
    await this.donePromise
    return {
      statusCode: this.statusCode,
      headers: this.headers,
      rawBody: Buffer.concat(this.chunks).toString('utf8'),
    }
  }
}

async function dispatchMockRemoteWorkerRequest(
  handler: MockRemoteWorkerHandler,
  req: MockRequest,
): Promise<MockResponseResult> {
  const res = new MockResponseCollector()
  await Promise.resolve(handler(req, res))
  return res.result()
}

function coerceLifecycle(
  value: unknown,
  fallback: 'inline' | 'poll' | 'stream' | 'callback',
): 'inline' | 'poll' | 'stream' | 'callback' {
  return value === 'inline' || value === 'poll' || value === 'stream' || value === 'callback'
    ? value
    : fallback
}

function coerceTaskId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function coerceErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error
    }
  }
  return fallback
}

function eventNameToStatus(eventName: string | undefined): 'accepted' | 'running' | 'completed' | 'failed' | undefined {
  switch (eventName) {
    case 'task.completed':
    case 'completed':
      return 'completed'
    case 'task.failed':
    case 'failed':
      return 'failed'
    case 'task.running':
    case 'running':
      return 'running'
    case 'task.accepted':
    case 'accepted':
      return 'accepted'
    default:
      return undefined
  }
}

function normalizeTaskResponse(
  raw: unknown,
  fallbackTaskId: string,
  eventName?: string,
): {
  status: 'accepted' | 'running' | 'completed' | 'failed'
  taskId: string
  output?: Record<string, unknown>
  error?: string
  model?: string
  durationMs?: number
  pollAfterMs?: number
  responseMode?: 'inline' | 'poll' | 'stream' | 'callback'
  statusEndpoint?: string
  streamEndpoint?: string
} {
  const base = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!base) {
    throw new Error('Remote worker returned an invalid lifecycle payload')
  }

  const event = typeof base.event === 'string' ? base.event : eventName
  const payload = base.data && typeof base.data === 'object'
    ? base.data as Record<string, unknown>
    : base
  const status = typeof payload.status === 'string'
    ? payload.status
    : eventNameToStatus(event) ?? (payload.output && typeof payload.output === 'object' ? 'completed' : undefined)

  if (status === 'completed') {
    if (!payload.output || typeof payload.output !== 'object') {
      throw new Error('Remote worker completed without output')
    }
    return {
      status: 'completed',
      taskId: coerceTaskId(payload.taskId ?? base.taskId, fallbackTaskId),
      output: payload.output as Record<string, unknown>,
      model: typeof payload.model === 'string' ? payload.model : undefined,
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
    }
  }

  if (status === 'accepted' || status === 'running') {
    return {
      status,
      taskId: coerceTaskId(payload.taskId ?? base.taskId, fallbackTaskId),
      model: typeof payload.model === 'string' ? payload.model : undefined,
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
      pollAfterMs: typeof payload.pollAfterMs === 'number' ? payload.pollAfterMs : undefined,
      responseMode: typeof payload.responseMode === 'string'
        ? coerceLifecycle(payload.responseMode, 'poll')
        : undefined,
      statusEndpoint: typeof payload.statusEndpoint === 'string' ? payload.statusEndpoint : undefined,
      streamEndpoint: typeof payload.streamEndpoint === 'string' ? payload.streamEndpoint : undefined,
    }
  }

  if (status === 'failed') {
    return {
      status: 'failed',
      taskId: coerceTaskId(payload.taskId ?? base.taskId, fallbackTaskId),
      error: coerceErrorMessage(payload.error ?? payload.message ?? base.error, 'Remote worker execution failed'),
      model: typeof payload.model === 'string' ? payload.model : undefined,
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
    }
  }

  throw new Error('Remote worker returned a non-terminal lifecycle payload without a recognized status')
}

function parseStreamResult(
  rawBody: string,
  fallbackTaskId: string,
): {
  status: 'completed'
  taskId: string
  output: Record<string, unknown>
  model?: string
  durationMs?: number
} {
  let sseEventName: string | undefined
  let sseDataLines: string[] = []
  let lastPending:
    | ReturnType<typeof normalizeTaskResponse>
    | undefined
  let terminal:
    | ReturnType<typeof normalizeTaskResponse>
    | undefined

  const handlePayload = (payload: unknown, eventName?: string): void => {
    const normalized = normalizeTaskResponse(payload, fallbackTaskId, eventName)
    if (normalized.status === 'completed') {
      terminal = normalized
      return
    }
    if (normalized.status === 'failed') {
      throw new Error(normalized.error ?? 'Remote worker stream failed')
    }
    lastPending = normalized
  }

  const flushSseEvent = (): void => {
    if (sseDataLines.length === 0) {
      sseEventName = undefined
      return
    }
    const payload = sseDataLines.join('\n')
    sseDataLines = []
    const eventName = sseEventName
    sseEventName = undefined
    handlePayload(JSON.parse(payload), eventName)
  }

  for (const line of rawBody.split(/\n/)) {
    const trimmed = line.replace(/\r$/, '').trim()
    if (!trimmed) {
      flushSseEvent()
      continue
    }
    if (trimmed.startsWith('{')) {
      handlePayload(JSON.parse(trimmed))
      continue
    }
    if (trimmed.startsWith('event:')) {
      sseEventName = trimmed.slice('event:'.length).trim()
      continue
    }
    if (trimmed.startsWith('data:')) {
      sseDataLines.push(trimmed.slice('data:'.length).trim())
    }
  }

  flushSseEvent()
  if (terminal?.status === 'completed') {
    return {
      status: 'completed',
      taskId: terminal.taskId,
      output: terminal.output as Record<string, unknown>,
      model: terminal.model,
      durationMs: terminal.durationMs,
    }
  }
  if (lastPending) {
    throw new Error(`Remote worker stream ended before terminal result for task ${lastPending.taskId}`)
  }
  throw new Error('Remote worker stream ended without a terminal lifecycle event')
}

function createMockRemoteWorkerTransport(
  baseUrl: string,
  card: AgentCard,
  agentCardHeaders: MockHeaders,
  handler: MockRemoteWorkerHandler,
): MockRemoteWorkerTransport {
  async function requestJsonResponse<T>(options: {
    method: 'GET' | 'POST'
    url: string
    body?: unknown
    bearerToken?: string
    signal?: AbortSignal
  }): Promise<{
    statusCode: number
    headers: MockHeaders
    rawBody: string
    body: T
  }> {
    const target = new URL(options.url)
    const url = `${target.pathname}${target.search}`
    const headers: MockHeaders = {
      accept: 'application/json',
      ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
      ...(options.body === undefined ? {} : {
        'content-type': 'application/json',
      }),
    }

    if (options.method === 'GET' && target.origin === baseUrl && url === '/.well-known/agent-card.json') {
      const rawBody = JSON.stringify(card)
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...agentCardHeaders },
        rawBody,
        body: JSON.parse(rawBody) as T,
      }
    }

    const response = await dispatchMockRemoteWorkerRequest(
      handler,
      createMockRequest(
        options.method,
        url,
        headers,
        options.body === undefined ? undefined : JSON.stringify(options.body),
      ),
    )
    if (response.statusCode >= 400) {
      throw new Error(response.rawBody || `Remote worker request failed (${response.statusCode})`)
    }
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      rawBody: response.rawBody,
      body: (response.rawBody ? JSON.parse(response.rawBody) : {}) as T,
    }
  }

  return {
    requestJsonResponse,
    async requestJson<T>(options: {
      method: 'GET' | 'POST'
      url: string
      body?: unknown
      bearerToken?: string
      signal?: AbortSignal
    }) {
      const response = await requestJsonResponse<T>(options)
      return response.body
    },
    async requestTaskStream(url, bearerToken, fallbackTaskId) {
      const target = new URL(url)
      const response = await dispatchMockRemoteWorkerRequest(
        handler,
        createMockRequest(
          'GET',
          `${target.pathname}${target.search}`,
          {
            accept: 'text/event-stream, application/x-ndjson, application/json',
            ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
          },
        ),
      )
      if (response.statusCode >= 400) {
        throw new Error(response.rawBody || `Remote worker stream failed (${response.statusCode})`)
      }
      return parseStreamResult(response.rawBody, fallbackTaskId)
    },
  }
}

describe('RemoteWorkerDirectory', () => {
  let tempDir: string | undefined

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ANTIGRAVITY_TRUST_KEY')) {
        delete process.env[key]
      }
    }
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = undefined
  })

  async function setupDirectory(
    config: Record<string, unknown> | ((context: { baseUrl: string; card: AgentCard }) => Record<string, unknown>),
    handler: MockRemoteWorkerHandler,
  ): Promise<{ directory: RemoteWorkerDirectory; baseUrl: string; card: AgentCard }> {
    const baseUrl = 'http://remote-worker.test'
    const card: AgentCard = {
      id: 'remote-verify',
      name: 'Remote Verify Worker',
      version: '1.0.0',
      description: 'Remote worker for verification',
      capabilities: [{ id: 'verification', description: 'verification', proficiency: 90 }],
      endpoint: { protocol: 'http', url: baseUrl },
      trustScore: 92,
      activeTasks: 0,
      maxConcurrency: 4,
      lastHeartbeat: new Date().toISOString(),
      health: 'healthy',
    }

    const resolvedConfig = typeof config === 'function' ? config({ baseUrl, card }) : config
    const configWithExtras = resolvedConfig as (Record<string, unknown> & {
      taskProtocol?: AgentCard['taskProtocol']
      advertisement?: AgentCard['advertisement']
      agentCardHeaders?: MockHeaders
      trustRegistrySignerPolicies?: Array<Record<string, unknown>>
    })
    card.taskProtocol = configWithExtras.taskProtocol
    card.advertisement = configWithExtras.advertisement

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-remote-worker-'))
    const configPath = path.join(tempDir, 'remote-workers.json')
    const trustRegistryPath = path.join(tempDir, 'trust-registry.json')
    fs.writeFileSync(configPath, JSON.stringify([
      {
        id: 'remote-verify',
        baseUrl,
        allowCapabilities: ['verification'],
        preferredNodeIds: ['VERIFY'],
        minTrustScore: 80,
        ...resolvedConfig,
      },
    ], null, 2), 'utf8')

    fs.writeFileSync(trustRegistryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'remote-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING',
          scopes: ['remote-worker-advertisement'],
          status: 'active',
          rotationGroup: 'remote-advertisements.primary',
        },
      ],
      signerPolicies: configWithExtras.trustRegistrySignerPolicies ?? [],
    }, null, 2), 'utf8')

    const trustRegistry = new TrustRegistryStore(trustRegistryPath)
    trustRegistry.load()
    const directory = new RemoteWorkerDirectory(
      configPath,
      trustRegistry,
      createMockRemoteWorkerTransport(
        baseUrl,
        card,
        configWithExtras.agentCardHeaders ?? {},
        handler,
      ),
    )
    await directory.refresh()
    return { directory, baseUrl, card }
  }

  it('delegates over inline lifecycle when the worker returns a terminal result immediately', async () => {
    const publishedAt = new Date(Date.now() - 60_000).toISOString()
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    const { directory, card } = await setupDirectory({
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['inline'],
        preferredResponseMode: 'inline',
      },
      advertisement: {
        schemaVersion: 'a2a.agent-card.v1',
        publishedAt,
        expiresAt,
      },
      agentCardHeaders: {
        etag: '"agent-card-v1"',
        'last-modified': 'Tue, 11 Mar 2026 00:00:00 GMT',
      },
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          nodeId: string
          capability: string
          authorityOwner: string
          acceptedResponseModes: string[]
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'completed',
          taskId: 'task-inline-1',
          output: {
            assuranceVerdict: 'PASS',
            complianceCheck: 'PASS',
            delegatedNode: payload.nodeId,
            delegatedCapability: payload.capability,
            delegatedAuthority: payload.authorityOwner,
            acceptedModes: payload.acceptedResponseModes,
          },
          model: 'remote-verify-model',
        }))
        return
      }
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.workers).toHaveLength(1)
    expect(listing.discoveryIssues).toEqual([])
    expect(listing.workers[0]?.agentCardVersion).toBe('1.0.0')
    expect(listing.workers[0]?.agentCardSchemaVersion).toBe('a2a.agent-card.v1')
    expect(listing.workers[0]?.agentCardPublishedAt).toBe(publishedAt)
    expect(listing.workers[0]?.agentCardExpiresAt).toBe(expiresAt)
    expect(listing.workers[0]?.agentCardSha256).toBe(createHash('sha256').update(JSON.stringify(card)).digest('hex'))
    expect(listing.workers[0]?.agentCardEtag).toBe('"agent-card-v1"')
    expect(listing.workers[0]?.agentCardLastModified).toBe('Tue, 11 Mar 2026 00:00:00 GMT')
    expect(listing.workers[0]?.selectedResponseMode).toBe('inline')
    expect(listing.workers[0]?.supportedResponseModes).toEqual(['inline'])
    expect(listing.workers[0]?.verification.summary).toBe('verified')
    expect(listing.workers[0]?.verification.checks.some(check => check.checkId === 'task-protocol.task-endpoint' && check.ok)).toBe(true)
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(true)

    const result = await directory.delegate({
      id: 'VERIFY',
      capability: 'verification',
    }, createContext())

    expect(result?.model).toBe('remote-verify-model')
    expect(result?.output.delegatedNode).toBe('VERIFY')
    expect((result?.output.remoteWorker as { selectedResponseMode: string }).selectedResponseMode).toBe('inline')
    expect((result?.output.acceptedModes as string[])).toEqual(['inline'])
  })

  it('pins the agent-card digest and advertisement schema when the worker matches expected metadata', async () => {
    const publishedAt = new Date(Date.now() - 10_000).toISOString()
    const advertisement = {
      schemaVersion: 'a2a.agent-card.v2',
      publishedAt,
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'remote-signing',
        issuer: 'antigravity-lab',
        signedAt: new Date().toISOString(),
        signature: '',
      },
    } satisfies NonNullable<AgentCard['advertisement']>
    const taskProtocol = {
      taskEndpoint: '/a2a/tasks',
      supportedResponseModes: ['poll', 'inline'],
      preferredResponseMode: 'poll',
      statusEndpointTemplate: '/a2a/tasks/{taskId}',
    } satisfies NonNullable<AgentCard['taskProtocol']>
    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'

    const { directory } = await setupDirectory(({ card }) => ({
      advertisement: {
        ...advertisement,
        signature: {
          ...advertisement.signature,
          signature: signAgentCardAdvertisementSurface({
            ...card,
            taskProtocol,
            advertisement,
          }, 'remote-signing-secret'),
        },
      },
      taskProtocol,
      expectedAgentCardSha256: createHash('sha256').update(JSON.stringify({
        ...card,
        taskProtocol,
        advertisement: {
          ...advertisement,
          signature: {
            ...advertisement.signature,
            signature: signAgentCardAdvertisementSurface({
              ...card,
              taskProtocol,
              advertisement,
            }, 'remote-signing-secret'),
          },
        },
      })).digest('hex'),
      requiredAdvertisementSchemaVersion: 'a2a.agent-card.v2',
      advertisementTrustPolicyId: 'remote-advertisement-strict',
      maxAdvertisementAgeMs: 60_000,
      trustRegistrySignerPolicies: [
        {
          policyId: 'remote-advertisement-strict',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedKeyIds: ['remote-signing'],
          allowedIssuers: ['antigravity-lab'],
          maxSignatureAgeMs: 60_000,
          enabled: true,
        },
      ],
      agentCardHeaders: {
        etag: '"agent-card-v2"',
        'last-modified': 'Tue, 11 Mar 2026 00:00:00 GMT',
      },
    }), async (_req, res) => {
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.discoveryIssues).toEqual([])
    expect(listing.workers).toHaveLength(1)
    expect(listing.workers[0]?.verification.summary).toBe('verified')
    expect(listing.workers[0]?.verification.checks.some(check => check.checkId === 'agent-card.sha256-pin' && check.ok)).toBe(true)
    expect(listing.workers[0]?.verification.checks.some(check => check.checkId === 'agent-card.advertisement.schema-version' && check.ok)).toBe(true)
    expect(listing.workers[0]?.verification.checks.some(check => check.checkId === 'agent-card.advertisement.max-age' && check.ok)).toBe(true)
    expect(listing.workers[0]?.verification.checks.some(check => check.checkId === 'agent-card.advertisement.signature.verify' && check.ok)).toBe(true)
    expect(listing.workers[0]?.advertisementTrustPolicyId).toBe('remote-advertisement-strict')
    expect(listing.workers[0]?.agentCardAdvertisementSignatureKeyId).toBe('remote-signing')
    expect(listing.workers[0]?.agentCardAdvertisementSignatureIssuer).toBe('antigravity-lab')
  })

  it('classifies invalid advertisement signatures as auth discovery issues', async () => {
    const advertisement = {
      schemaVersion: 'a2a.agent-card.v2',
      publishedAt: new Date().toISOString(),
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'remote-signing',
        issuer: 'antigravity-lab',
        signedAt: new Date().toISOString(),
        signature: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
    } satisfies NonNullable<AgentCard['advertisement']>

    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'

    const { directory } = await setupDirectory({
      advertisementTrustPolicyId: 'remote-advertisement-strict',
      trustRegistrySignerPolicies: [
        {
          policyId: 'remote-advertisement-strict',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['remote-advertisements.primary'],
          allowedKeyIds: ['remote-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
      ],
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['inline'],
        preferredResponseMode: 'inline',
      },
      advertisement,
    }, async (_req, res) => {
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.workers).toHaveLength(0)
    expect(listing.discoveryIssues).toHaveLength(1)
    expect(listing.discoveryIssues[0]?.issueKind).toBe('auth')
    expect(listing.discoveryIssues[0]?.advertisementTrustPolicyId).toBe('remote-advertisement-strict')
    expect(listing.discoveryIssues[0]?.requiredAdvertisementSignature).toBe(true)
    expect(listing.discoveryIssues[0]?.allowedAdvertisementKeyStatuses).toEqual(['active'])
    expect(listing.discoveryIssues[0]?.allowedAdvertisementRotationGroups).toEqual(['remote-advertisements.primary'])
    expect(listing.discoveryIssues[0]?.allowedAdvertisementKeyIds).toEqual(['remote-signing'])
    expect(listing.discoveryIssues[0]?.allowedAdvertisementIssuers).toEqual(['antigravity-lab'])
    expect(listing.discoveryIssues[0]?.error).toMatch(/advertisement signature verified|signature/)
  })

  it('polls a remote worker until the task reaches a terminal result', async () => {
    const taskStates = new Map<string, number>()
    const { directory } = await setupDirectory({
      preferredResponseMode: 'poll',
      pollIntervalMs: 5,
      maxPollAttempts: 5,
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['poll', 'inline'],
        preferredResponseMode: 'poll',
        statusEndpointTemplate: '/a2a/tasks/{taskId}',
      },
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { taskId: string }
        taskStates.set(payload.taskId, 0)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'accepted',
          taskId: payload.taskId,
          pollAfterMs: 1,
        }))
        return
      }

      if (req.method === 'GET' && req.url?.startsWith('/a2a/tasks/')) {
        const taskId = req.url.split('/').pop() as string
        const count = taskStates.get(taskId) ?? 0
        taskStates.set(taskId, count + 1)
        res.writeHead(200, { 'content-type': 'application/json' })
        if (count < 1) {
          res.end(JSON.stringify({
            status: 'running',
            taskId,
            pollAfterMs: 1,
          }))
          return
        }
        res.end(JSON.stringify({
          status: 'completed',
          taskId,
          output: {
            assuranceVerdict: 'PASS',
            lifecycle: 'poll',
          },
          model: 'remote-poll-worker',
        }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.discoveryIssues).toEqual([])
    expect(listing.workers[0]?.selectedResponseMode).toBe('poll')
    expect(listing.workers[0]?.supportedResponseModes).toEqual(['poll', 'inline'])
    expect(listing.workers[0]?.statusEndpointTemplate).toBe('/a2a/tasks/{taskId}')

    const result = await directory.delegate({
      id: 'VERIFY',
      capability: 'verification',
    }, createContext())

    expect(result?.output.lifecycle).toBe('poll')
    expect((result?.output.remoteWorker as { selectedResponseMode: string }).selectedResponseMode).toBe('poll')
    expect(result?.model).toBe('remote-poll-worker')
  })

  it('consumes a streaming lifecycle until the worker emits a terminal event', async () => {
    const { directory } = await setupDirectory({
      preferredResponseMode: 'stream',
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['stream', 'poll', 'inline'],
        preferredResponseMode: 'stream',
        streamEndpointTemplate: '/a2a/tasks/{taskId}/stream',
      },
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { taskId: string }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'accepted',
          taskId: payload.taskId,
          streamEndpoint: `/a2a/tasks/${payload.taskId}/stream`,
        }))
        return
      }

      if (req.method === 'GET' && req.url?.startsWith('/a2a/tasks/') && req.url.endsWith('/stream')) {
        const taskId = req.url.split('/')[3] as string
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: task.running\n')
        res.write(`data: ${JSON.stringify({ taskId, status: 'running' })}\n\n`)
        setTimeout(() => {
          res.write('event: task.completed\n')
          res.write(`data: ${JSON.stringify({
            taskId,
            output: {
              assuranceVerdict: 'PASS',
              lifecycle: 'stream',
            },
            model: 'remote-stream-worker',
          })}\n\n`)
          res.end()
        }, 5)
        return
      }

      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.discoveryIssues).toEqual([])
    expect(listing.workers[0]?.selectedResponseMode).toBe('stream')
    expect(listing.workers[0]?.supportedResponseModes).toEqual(['stream', 'poll', 'inline'])
    expect(listing.workers[0]?.streamEndpointTemplate).toBe('/a2a/tasks/{taskId}/stream')

    const result = await directory.delegate({
      id: 'VERIFY',
      capability: 'verification',
    }, createContext())

    expect(result?.output.lifecycle).toBe('stream')
    expect((result?.output.remoteWorker as { selectedResponseMode: string }).selectedResponseMode).toBe('stream')
    expect(result?.model).toBe('remote-stream-worker')
  })

  it('waits for callback lifecycle completion through the daemon-issued callback lease', async () => {
    let directoryRef: RemoteWorkerDirectory | undefined
    let callbackPayload: {
      callbackToken: string
      callbackUrl: string
      expiresAt: string
      deliveryMode: string
      auth: {
        scheme: string
        secret: string
        signatureHeader: string
        timestampHeader: string
        signatureEncoding: string
      }
    } | undefined
    let acceptedResponseModes: string[] | undefined

    const { directory } = await setupDirectory({
      preferredResponseMode: 'callback',
      callbackTimeoutMs: 250,
      agentCardHeaders: {
        etag: '"agent-card-callback"',
        'last-modified': 'Tue, 11 Mar 2026 00:00:00 GMT',
      },
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['callback', 'poll', 'inline'],
        preferredResponseMode: 'callback',
        callback: {
          authSchemes: ['hmac-sha256'],
          signatureHeader: 'x-antigravity-callback-signature',
          timestampHeader: 'x-antigravity-callback-timestamp',
          signatureEncoding: 'hex',
        },
      },
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          taskId: string
          callback: {
            callbackToken: string
            callbackUrl: string
            expiresAt: string
            deliveryMode: string
            auth: {
              scheme: string
              secret: string
              signatureHeader: string
              timestampHeader: string
              signatureEncoding: string
            }
          } | null
          acceptedResponseModes: string[]
        }
        callbackPayload = payload.callback ?? undefined
        acceptedResponseModes = payload.acceptedResponseModes
        setTimeout(() => {
          const rawBody = JSON.stringify({
            status: 'completed',
            taskId: payload.taskId,
            output: {
              assuranceVerdict: 'PASS',
              lifecycle: 'callback',
            },
            model: 'remote-callback-worker',
          })
          const timestamp = new Date().toISOString()
          const signature = createHmac('sha256', payload.callback?.auth.secret ?? '')
            .update(`${timestamp}.${rawBody}`)
            .digest('hex')
          directoryRef?.receiveCallback(
            payload.callback?.callbackToken ?? 'missing',
            JSON.parse(rawBody),
            rawBody,
            {
              [payload.callback?.auth.timestampHeader ?? 'x-antigravity-callback-timestamp']: timestamp,
              [payload.callback?.auth.signatureHeader ?? 'x-antigravity-callback-signature']: signature,
            },
          )
        }, 5)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'accepted',
          taskId: payload.taskId,
          responseMode: 'callback',
        }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    directoryRef = directory
    directory.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const listing = directory.list()
    expect(listing.discoveryIssues).toEqual([])
    expect(listing.workers[0]?.selectedResponseMode).toBe('callback')
    expect(listing.workers[0]?.supportedResponseModes).toEqual(['callback', 'poll', 'inline'])
    expect(listing.workers[0]?.taskProtocolSource).toBe('agent-card')
    expect(listing.workers[0]?.verification.summary).toBe('verified')
    expect(listing.workers[0]?.callbackTimeoutMs).toBe(250)
    expect(listing.workers[0]?.callbackUrlTemplate).toBe('http://127.0.0.1:45123/remote-worker-callbacks/{callbackToken}')

    const result = await directory.delegate({
      id: 'VERIFY',
      capability: 'verification',
    }, createContext())

    expect(callbackPayload?.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:45123\/remote-worker-callbacks\//)
    expect(callbackPayload?.deliveryMode).toBe('post-json')
    expect(callbackPayload?.auth.scheme).toBe('hmac-sha256')
    expect(acceptedResponseModes).toEqual(['callback', 'poll', 'inline'])
    expect(result?.output.lifecycle).toBe('callback')
    expect((result?.output.remoteWorker as { selectedResponseMode: string }).selectedResponseMode).toBe('callback')
    expect(result?.model).toBe('remote-callback-worker')
  })

  it('rejects callback deliveries with an invalid signature', async () => {
    let receivedError: Error | undefined
    const { directory } = await setupDirectory({
      preferredResponseMode: 'callback',
      callbackTimeoutMs: 25,
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['callback', 'poll', 'inline'],
        preferredResponseMode: 'callback',
        callback: {
          authSchemes: ['hmac-sha256'],
          signatureHeader: 'x-antigravity-callback-signature',
          timestampHeader: 'x-antigravity-callback-timestamp',
          signatureEncoding: 'hex',
        },
      },
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          taskId: string
          callback: {
            callbackToken: string
            auth: {
              timestampHeader: string
              signatureHeader: string
            }
          } | null
        }
        setTimeout(() => {
          const rawBody = JSON.stringify({
            status: 'completed',
            taskId: payload.taskId,
            output: { assuranceVerdict: 'PASS' },
          })
          try {
            directory.receiveCallback(
              payload.callback?.callbackToken ?? 'missing',
              JSON.parse(rawBody),
              rawBody,
              {
                [payload.callback?.auth.timestampHeader ?? 'x-antigravity-callback-timestamp']: new Date().toISOString(),
                [payload.callback?.auth.signatureHeader ?? 'x-antigravity-callback-signature']: 'invalid-signature',
              },
            )
          } catch (error) {
            receivedError = error instanceof Error ? error : new Error(String(error))
          }
        }, 5)

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'accepted',
          taskId: payload.taskId,
          responseMode: 'callback',
        }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    directory.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    await expect(directory.delegate({
      id: 'VERIFY',
      capability: 'verification',
    }, createContext())).rejects.toThrow(/timed out/)
    expect(receivedError?.message).toMatch(/signature verification/)
  })

  it('delegates tribunal tasks over callback lifecycle and normalizes remote juror reports', async () => {
    let directoryRef: RemoteWorkerDirectory | undefined
    let callbackPayload: {
      callbackToken: string
      callbackUrl: string
      auth: {
        secret: string
        signatureHeader: string
        timestampHeader: string
      }
    } | undefined

    const { directory } = await setupDirectory(({ card }) => {
      card.capabilities = [
        ...card.capabilities,
        { id: 'tribunal-judge', description: 'tribunal', proficiency: 95 },
      ]
      return {
        allowCapabilities: ['tribunal-judge'],
        preferredNodeIds: ['VERIFY'],
        preferredResponseMode: 'callback',
        callbackTimeoutMs: 250,
        taskProtocol: {
          taskEndpoint: '/a2a/tasks',
          supportedResponseModes: ['callback', 'poll', 'inline'],
          preferredResponseMode: 'callback',
          callback: {
            authSchemes: ['hmac-sha256'],
            signatureHeader: 'x-antigravity-callback-signature',
            timestampHeader: 'x-antigravity-callback-timestamp',
            signatureEncoding: 'hex',
          },
        },
      }
    }, async (req, res) => {
      if (req.method === 'POST' && req.url === '/a2a/tasks') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          taskId: string
          taskType: string
          capability: string
          tribunal?: {
            subjectNodeId: string
            heuristicBaseline: {
              verdict: string
            }
          }
          callback?: {
            callbackToken: string
            callbackUrl: string
            auth: {
              secret: string
              signatureHeader: string
              timestampHeader: string
            }
          } | null
        }
        callbackPayload = payload.callback ?? undefined
        expect(payload.taskType).toBe('tribunal')
        expect(payload.capability).toBe('tribunal-judge')
        expect(payload.tribunal?.subjectNodeId).toBe('VERIFY')
        expect(payload.tribunal?.heuristicBaseline.verdict).toBe('agree')

        setTimeout(() => {
          const rawBody = JSON.stringify({
            status: 'completed',
            taskId: payload.taskId,
            output: {
              verdict: 'agree',
              confidence: 0.91,
              rationale: 'Remote callback juror accepts the verification result.',
              evidenceIds: ['tribunal-1'],
              issues: [],
              model: 'judge-pro',
              modelFamily: 'judge',
            },
            model: 'judge-pro',
          })
          const timestamp = new Date().toISOString()
          const signature = createHmac('sha256', payload.callback?.auth.secret ?? '')
            .update(`${timestamp}.${rawBody}`)
            .digest('hex')
          directoryRef?.receiveCallback(
            payload.callback?.callbackToken ?? 'missing',
            JSON.parse(rawBody),
            rawBody,
            {
              [payload.callback?.auth.timestampHeader ?? 'x-antigravity-callback-timestamp']: timestamp,
              [payload.callback?.auth.signatureHeader ?? 'x-antigravity-callback-signature']: signature,
            },
          )
        }, 5)

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          status: 'accepted',
          taskId: payload.taskId,
          responseMode: 'callback',
        }))
        return
      }

      res.writeHead(404)
      res.end()
    })

    directoryRef = directory
    directory.setCallbackIngressBaseUrl('http://127.0.0.1:45123')

    const result = await directory.delegateTribunal({
      runId: 'run-tribunal',
      nodeId: 'VERIFY',
      goal: 'Verify the answer',
      capturedAt: '2026-03-12T00:00:00.000Z',
      subjectOutput: {
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
      },
      upstreamOutputs: {
        PARALLEL: {
          codex: { modelId: 'codex' },
          gemini: { modelId: 'gemini' },
        },
      },
      heuristicBaseline: {
        verdict: 'agree',
        confidence: 0.82,
        rationale: 'Heuristic baseline agrees.',
      },
      forbiddenJudgeModelFamilies: ['codex', 'gemini'],
      maxJurors: 1,
    })

    expect(callbackPayload?.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:45123\/remote-worker-callbacks\//)
    expect(result.failures).toEqual([])
    expect(result.reports).toHaveLength(1)
    expect(result.reports[0]?.responseMode).toBe('callback')
    expect(result.reports[0]?.modelFamily).toBe('judge')
    expect(result.reports[0]?.report.verdict).toBe('agree')
  })

  it('records discovery issues instead of synthesizing protocol metadata when the agent card omits taskProtocol', async () => {
    const { directory } = await setupDirectory({}, async (_req, res) => {
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.workers).toHaveLength(0)
    expect(listing.discoveryIssues).toHaveLength(1)
    expect(listing.discoveryIssues[0]?.issueKind).toBe('protocol')
    expect(listing.discoveryIssues[0]?.error).toMatch(/taskProtocol advertisement/)
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(false)
  })

  it('classifies invalid callback auth advertisements as auth discovery issues', async () => {
    const { directory } = await setupDirectory({
      preferredResponseMode: 'callback',
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['callback', 'poll', 'inline'],
        preferredResponseMode: 'callback',
        callback: {
          authSchemes: ['hmac-sha256'],
          signatureHeader: 'x-antigravity-callback-signature',
        },
      },
    }, async (_req, res) => {
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.workers).toHaveLength(0)
    expect(listing.discoveryIssues).toHaveLength(1)
    expect(listing.discoveryIssues[0]?.issueKind).toBe('auth')
    expect(listing.discoveryIssues[0]?.error).toMatch(/callback\.timestampHeader/)
  })

  it('surfaces advertisement verification failures as classified discovery issues', async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString()
    const { directory } = await setupDirectory({
      expectedAgentCardSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      requiredAdvertisementSchemaVersion: 'a2a.agent-card.v3',
      maxAdvertisementAgeMs: 5_000,
      taskProtocol: {
        taskEndpoint: '/a2a/tasks',
        supportedResponseModes: ['inline'],
        preferredResponseMode: 'inline',
      },
      advertisement: {
        schemaVersion: 'a2a.agent-card.v1',
        publishedAt: new Date(Date.now() - 30_000).toISOString(),
        expiresAt: expiredAt,
      },
    }, async (_req, res) => {
      res.writeHead(404)
      res.end()
    })

    const listing = directory.list()
    expect(listing.workers).toHaveLength(0)
    expect(listing.discoveryIssues).toHaveLength(1)
    expect(listing.discoveryIssues[0]?.issueKind).toBe('agent-card')
    expect(listing.discoveryIssues[0]?.expectedAgentCardSha256).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(listing.discoveryIssues[0]?.expectedAdvertisementSchemaVersion).toBe('a2a.agent-card.v3')
    expect(listing.discoveryIssues[0]?.error).toMatch(/agent-card/)
  })
})
