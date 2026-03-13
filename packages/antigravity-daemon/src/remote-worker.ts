import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as crypto from 'node:crypto'
import { URL } from 'node:url'
import type {
  WorkflowNodeId,
  NodeExecutionContext,
  NodeExecutionResult,
  NodeExecutor,
} from '@anthropic/antigravity-model-core'
import {
  AnalyzeExecutor,
  DebateExecutor,
  HITLExecutor,
  NodeExecutorRegistry,
  ParallelExecutor,
  PersistExecutor,
  SynthesizeExecutor,
  VerifyExecutor,
} from '@anthropic/antigravity-model-core'
import {
  AgentRegistry,
  HandoffProtocol,
  serializeAgentCardAdvertisementSurface,
  type AgentCard,
  type AgentDeliveryMode,
  type AgentHealthStatus,
} from '@anthropic/antigravity-core'
import { createISODateTime } from '@anthropic/antigravity-shared'
import { z } from 'zod'
import type {
  JudgeReport,
  RemoteWorkerCallbackReceipt,
  RemoteWorkerDiscoveryIssue,
  RemoteWorkerListResponse,
  RemoteWorkerSnapshot,
  RemoteWorkerVerification,
  RemoteWorkerVerificationCheck,
  WorkflowDefinition,
} from './schema.js'
import { DEFAULT_SIGNER_POLICY_IDS, TrustRegistryStore } from './trust-registry.js'
import {
  ANTIGRAVITY_AUTHORITY_HOST,
  ANTIGRAVITY_AUTHORITY_OWNER,
  ANTIGRAVITY_CALLBACK_AUTH_SCHEME,
  ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER,
  ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER,
} from './runtime-contract.js'

type RemoteWorkerLifecycle = AgentDeliveryMode
const CALLBACK_AUTH_SCHEME = ANTIGRAVITY_CALLBACK_AUTH_SCHEME
const CALLBACK_SIGNATURE_HEADER = ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER
const CALLBACK_TIMESTAMP_HEADER = ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER

const RemoteWorkerConfigEntrySchema = z.object({
  id: z.string().optional(),
  baseUrl: z.string().url().optional(),
  agentCardUrl: z.string().url().optional(),
  expectedAgentCardSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  requiredAdvertisementSchemaVersion: z.string().optional(),
  maxAdvertisementAgeMs: z.number().int().positive().optional(),
  advertisementTrustPolicyId: z.string().optional(),
  preferredResponseMode: z.enum(['inline', 'poll', 'stream', 'callback']).optional(),
  pollIntervalMs: z.number().int().positive().default(1_000),
  maxPollAttempts: z.number().int().positive().default(30),
  callbackTimeoutMs: z.number().int().positive().default(60_000),
  /** PR-03: Maximum allowed clock skew for callback timestamp freshness (ms). Default 5 minutes. */
  maxCallbackSkewMs: z.number().int().positive().default(300_000),
  bearerToken: z.string().optional(),
  enabled: z.boolean().default(true),
  minTrustScore: z.number().min(0).max(100).default(0),
  preferredNodeIds: z.array(z.string()).default([]),
  allowCapabilities: z.array(z.string()).default([]),
})

const RemoteWorkerConfigSchema = z.array(RemoteWorkerConfigEntrySchema)

type RemoteWorkerConfigEntry = z.infer<typeof RemoteWorkerConfigEntrySchema>

export interface RemoteWorkerTaskRequest {
  taskId: string
  runId: string
  nodeId: string
  capability: string
  taskType?: 'workflow-node' | 'tribunal'
  goal: string
  attempt: number
  authorityOwner: typeof ANTIGRAVITY_AUTHORITY_OWNER
  authorityHost: typeof ANTIGRAVITY_AUTHORITY_HOST
  traceId: string
  files: string[]
  upstreamOutputs: Record<string, Record<string, unknown>>
  constraints: string[]
  acceptedResponseModes: RemoteWorkerLifecycle[]
  tribunal?: {
    subjectNodeId: string
    subjectOutput: Record<string, unknown>
    heuristicBaseline: {
      verdict: JudgeReport['verdict']
      confidence: number
      rationale: string
    }
    forbiddenJudgeModelFamilies: string[]
  }
  callback: {
    callbackToken: string
    callbackUrl: string
    expiresAt: string
    deliveryMode: 'post-json'
    auth: {
      scheme: 'hmac-sha256'
      secret: string
      signatureHeader: string
      timestampHeader: string
      signatureEncoding: 'hex'
    }
  } | null
  handoff: ReturnType<HandoffProtocol['pack']>
}

export interface RemoteTribunalJudgeTask {
  runId: string
  nodeId: string
  goal: string
  capturedAt: string
  subjectOutput: Record<string, unknown>
  upstreamOutputs: Record<string, Record<string, unknown>>
  heuristicBaseline: {
    verdict: JudgeReport['verdict']
    confidence: number
    rationale: string
  }
  forbiddenJudgeModelFamilies: string[]
  maxJurors?: number
  signal?: AbortSignal
}

export interface RemoteTribunalJudgeResult {
  workerId: string
  model?: string
  modelFamily?: string
  responseMode: RemoteWorkerLifecycle
  report: JudgeReport
}

export interface RemoteTribunalDelegationResult {
  reports: RemoteTribunalJudgeResult[]
  failures: string[]
}

interface RemoteWorkerTaskCompletedResponse {
  status: 'completed'
  taskId: string
  output: Record<string, unknown>
  model?: string
  durationMs?: number
}

interface RemoteWorkerTaskPendingResponse {
  status: 'accepted' | 'running'
  taskId: string
  model?: string
  durationMs?: number
  pollAfterMs?: number
  responseMode?: RemoteWorkerLifecycle
  statusEndpoint?: string
  streamEndpoint?: string
}

interface RemoteWorkerTaskFailedResponse {
  status: 'failed'
  taskId: string
  error: string
  model?: string
  durationMs?: number
  detail?: unknown
}

type RemoteWorkerTaskStatusResponse =
  | RemoteWorkerTaskCompletedResponse
  | RemoteWorkerTaskPendingResponse
  | RemoteWorkerTaskFailedResponse

interface RemoteWorkerEntry {
  card: AgentCard
  config: RemoteWorkerConfigEntry
  source: string
  agentCardSha256: string
  agentCardEtag?: string
  agentCardLastModified?: string
  taskEndpoint: string
  taskProtocol: ResolvedTaskProtocol
  verification: RemoteWorkerVerification
  advertisementTrustPolicyId: string
  lastError?: string
}

/** PR-02: Frozen callback auth config derived from verified agent-card advertisement */
interface ResolvedCallbackAuthConfig {
  readonly scheme: 'hmac-sha256'
  readonly signatureHeader: string
  readonly timestampHeader: string
  readonly signatureEncoding: 'hex'
}

interface ResolvedTaskProtocol {
  source: 'agent-card'
  selectedResponseMode: RemoteWorkerLifecycle
  supportedResponseModes: RemoteWorkerLifecycle[]
  statusEndpointTemplate?: string
  streamEndpointTemplate?: string
  /** PR-02: Frozen callback auth surface from discovery. undefined for non-callback workers. */
  callbackAuth?: ResolvedCallbackAuthConfig
}

interface PendingRemoteWorkerCallback {
  callbackToken: string
  runId: string
  taskId: string
  workerId: string
  callbackSecret: string
  expiresAt: string
  /** PR-02: Frozen auth config for this pending callback, used by ingress verification */
  callbackAuthConfig: ResolvedCallbackAuthConfig
  /** PR-03: Maximum allowed clock skew for timestamp freshness check */
  maxCallbackSkewMs: number
  timeout: NodeJS.Timeout
  promise: Promise<RemoteWorkerTaskCompletedResponse>
  resolve: (value: RemoteWorkerTaskCompletedResponse) => void
  reject: (reason?: unknown) => void
}

interface RemoteWorkerCallbackLease {
  callbackToken: string
  callbackUrl: string
  expiresAt: string
  callbackSecret: string
  /** PR-02: Frozen auth config from discovery, carried through lease for task request construction */
  callbackAuthConfig: ResolvedCallbackAuthConfig
  wait(signal?: AbortSignal): Promise<RemoteWorkerTaskCompletedResponse>
  dispose(): void
}

type RemoteWorkerIssueKind = RemoteWorkerDiscoveryIssue['issueKind']

export class RemoteWorkerCallbackError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'RemoteWorkerCallbackError'
    this.statusCode = statusCode
  }
}

class RemoteWorkerVerificationError extends Error {
  readonly issueKind: RemoteWorkerIssueKind

  constructor(issueKind: RemoteWorkerIssueKind, message: string) {
    super(message)
    this.name = 'RemoteWorkerVerificationError'
    this.issueKind = issueKind
  }
}

interface JsonRequestOptions {
  method: 'GET' | 'POST'
  url: string
  body?: unknown
  bearerToken?: string
  signal?: AbortSignal
}

interface JsonResponse<T> {
  statusCode: number
  headers: http.IncomingHttpHeaders
  rawBody: string
  body: T
}

interface RemoteWorkerTransport {
  requestJsonResponse<T>(options: JsonRequestOptions): Promise<JsonResponse<T>>
  requestJson<T>(options: JsonRequestOptions): Promise<T>
  requestTaskStream(
    url: string,
    bearerToken: string | undefined,
    fallbackTaskId: string,
    signal: AbortSignal | undefined,
  ): Promise<RemoteWorkerTaskCompletedResponse>
}

function requestJsonResponse<T>(options: JsonRequestOptions): Promise<JsonResponse<T>> {
  return new Promise<JsonResponse<T>>((resolve, reject) => {
    const target = new URL(options.url)
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
    const transport = target.protocol === 'https:' ? https : http
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method,
      signal: options.signal,
      headers: {
        accept: 'application/json',
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : {}),
        ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(raw || `Remote worker request failed (${res.statusCode})`))
          return
        }
        try {
          resolve({
            statusCode: res.statusCode ?? 200,
            headers: res.headers,
            rawBody: raw,
            body: (raw ? JSON.parse(raw) : {}) as T,
          })
        } catch (error) {
          reject(error)
        }
      })
    })

    req.on('error', reject)
    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const response = await requestJsonResponse<T>(options)
  return response.body
}

function requestTaskStream(
  url: string,
  bearerToken: string | undefined,
  fallbackTaskId: string,
  signal: AbortSignal | undefined,
): Promise<RemoteWorkerTaskCompletedResponse> {
  return new Promise<RemoteWorkerTaskCompletedResponse>((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    let settled = false
    let buffer = ''
    let sseEventName: string | undefined
    let sseDataLines: string[] = []
    let lastPending: RemoteWorkerTaskPendingResponse | undefined

    const finish = (error: Error | null, result?: RemoteWorkerTaskCompletedResponse): void => {
      if (settled) {
        return
      }
      settled = true
      if (error) {
        reject(error)
        return
      }
      resolve(result as RemoteWorkerTaskCompletedResponse)
    }

    const handlePayload = (payload: unknown, eventName?: string): void => {
      try {
        const normalized = normalizeTaskResponse(payload, fallbackTaskId, eventName)
        if (normalized.status === 'completed') {
          finish(null, normalized)
          return
        }
        if (normalized.status === 'failed') {
          finish(new Error(normalized.error))
          return
        }
        lastPending = normalized
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
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
      try {
        handlePayload(JSON.parse(payload), eventName)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const processLine = (line: string): void => {
      if (settled) {
        return
      }
      const trimmed = line.trim()
      if (!trimmed) {
        flushSseEvent()
        return
      }
      if (trimmed.startsWith('{')) {
        try {
          handlePayload(JSON.parse(trimmed))
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
        return
      }
      if (trimmed.startsWith('event:')) {
        sseEventName = trimmed.slice('event:'.length).trim()
        return
      }
      if (trimmed.startsWith('data:')) {
        sseDataLines.push(trimmed.slice('data:'.length).trim())
      }
    }

    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      signal,
      headers: {
        accept: 'text/event-stream, application/x-ndjson, application/json',
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
    }, (res) => {
      if ((res.statusCode ?? 500) >= 400) {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          finish(new Error(Buffer.concat(chunks).toString('utf8') || `Remote worker stream failed (${res.statusCode})`))
        })
        return
      }

      res.on('data', (chunk) => {
        buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        let nextNewline = buffer.indexOf('\n')
        while (nextNewline >= 0) {
          const line = buffer.slice(0, nextNewline).replace(/\r$/, '')
          buffer = buffer.slice(nextNewline + 1)
          processLine(line)
          if (settled) {
            req.destroy()
            return
          }
          nextNewline = buffer.indexOf('\n')
        }
      })

      res.on('end', () => {
        if (buffer.trim()) {
          processLine(buffer.replace(/\r$/, ''))
          buffer = ''
        }
        flushSseEvent()
        if (settled) {
          return
        }
        if (lastPending) {
          finish(new Error(`Remote worker stream ended before terminal result for task ${lastPending.taskId}`))
          return
        }
        finish(new Error('Remote worker stream ended without a terminal lifecycle event'))
      })
    })

    req.on('error', error => finish(error))
    req.end()
  })
}

const DEFAULT_REMOTE_WORKER_TRANSPORT: RemoteWorkerTransport = {
  requestJsonResponse,
  requestJson,
  requestTaskStream,
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function hashAgentCard(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody).digest('hex')
}

function parseDateValue(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function summarizeUpstreamOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value.slice(0, 240)
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value).slice(0, 240)
  }
  return String(value).slice(0, 240)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('Remote worker wait aborted'))
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function createLocalExecutor(nodeId: WorkflowNodeId): NodeExecutor {
  switch (nodeId) {
    case 'ANALYZE':
      return new AnalyzeExecutor()
    case 'PARALLEL':
      return new ParallelExecutor()
    case 'DEBATE':
      return new DebateExecutor()
    case 'VERIFY':
      return new VerifyExecutor()
    case 'SYNTHESIZE':
      return new SynthesizeExecutor()
    case 'PERSIST':
      return new PersistExecutor()
    case 'HITL':
      return new HITLExecutor()
  }
}

function coerceLifecycle(value: unknown, fallback: RemoteWorkerLifecycle): RemoteWorkerLifecycle {
  return value === 'inline' || value === 'poll' || value === 'stream' || value === 'callback' ? value : fallback
}

function coerceTaskId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function coerceErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.message === 'string' && object.message.trim()) {
      return object.message
    }
    if (typeof object.error === 'string' && object.error.trim()) {
      return object.error
    }
  }
  return fallback
}

function getHeaderValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) {
    return value[0]
  }
  return typeof value === 'string' ? value : undefined
}

function buildCallbackSignaturePayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

function extractModelFamily(modelId: string | undefined): string {
  return (modelId ?? '')
    .trim()
    .toLowerCase()
    .split(/[:/@-]/)
    .find(token => token.length > 0) ?? ''
}

function signCallbackPayload(secret: string, timestamp: string, rawBody: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(buildCallbackSignaturePayload(timestamp, rawBody))
    .digest('hex')
}

function hasExpired(expiresAt: string, now: string): boolean {
  return Date.parse(now) > Date.parse(expiresAt)
}

function eventNameToStatus(eventName: string | undefined): RemoteWorkerTaskStatusResponse['status'] | undefined {
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
): RemoteWorkerTaskStatusResponse {
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
      detail: payload.detail,
    }
  }

  throw new Error('Remote worker returned a non-terminal lifecycle payload without a recognized status')
}

function resolveEndpoint(
  value: string | undefined,
  worker: {
    card: AgentCard
    config: Pick<RemoteWorkerConfigEntry, 'baseUrl'>
  },
  variables: Record<string, string>,
): string | undefined {
  if (!value) {
    return undefined
  }
  const replaced = value.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(variables[key] ?? ''))
  if (/^https?:\/\//.test(replaced)) {
    return replaced
  }
  const base = normalizeBaseUrl(worker.config.baseUrl ?? worker.card.endpoint.url)
  if (replaced.startsWith('/')) {
    return `${base}${replaced}`
  }
  return `${base}/${replaced}`
}

function normalizeSupportedResponseModes(modes: AgentDeliveryMode[] | undefined): RemoteWorkerLifecycle[] {
  const normalized = (modes ?? [])
    .filter((mode): mode is RemoteWorkerLifecycle =>
      mode === 'inline' || mode === 'poll' || mode === 'stream' || mode === 'callback')
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['inline']
}

function pickPreferredResponseMode(
  supported: RemoteWorkerLifecycle[],
  preferred?: RemoteWorkerLifecycle,
): RemoteWorkerLifecycle {
  if (preferred && supported.includes(preferred)) {
    return preferred
  }
  const priority: RemoteWorkerLifecycle[] = ['stream', 'callback', 'poll', 'inline']
  return priority.find(mode => supported.includes(mode)) ?? supported[0] ?? 'inline'
}

function createVerificationCheck(
  checkId: string,
  ok: boolean,
  severity: RemoteWorkerVerificationCheck['severity'],
  message: string,
): RemoteWorkerVerificationCheck {
  return { checkId, ok, severity, message }
}

function buildRemoteWorkerVerification(checks: RemoteWorkerVerificationCheck[]): RemoteWorkerVerification {
  return {
    verifiedAt: createISODateTime(),
    summary: checks.some(check => check.severity === 'warn' && check.ok === false) ? 'warning' : 'verified',
    checks,
  }
}

function assertVerification(
  checks: RemoteWorkerVerificationCheck[],
  checkId: string,
  condition: boolean,
  issueKind: RemoteWorkerIssueKind,
  message: string,
): void {
  checks.push(createVerificationCheck(checkId, condition, condition ? 'info' : 'error', message))
  if (!condition) {
    throw new RemoteWorkerVerificationError(issueKind, message)
  }
}

function warnVerification(
  checks: RemoteWorkerVerificationCheck[],
  checkId: string,
  condition: boolean,
  message: string,
): void {
  checks.push(createVerificationCheck(checkId, condition, condition ? 'info' : 'warn', message))
}

function applyTrustSignatureEvaluation(
  checks: RemoteWorkerVerificationCheck[],
  evaluation: ReturnType<TrustRegistryStore['evaluateHmacSignatureEnvelope']>,
  issueKind: RemoteWorkerIssueKind,
): void {
  for (const check of evaluation.checks) {
    checks.push(createVerificationCheck(check.checkId, check.ok, check.severity, check.message))
    if (!check.ok && check.severity === 'error') {
      throw new RemoteWorkerVerificationError(issueKind, check.message)
    }
  }
}

function resolveTaskProtocol(
  card: AgentCard,
  entry: RemoteWorkerConfigEntry,
  checks: RemoteWorkerVerificationCheck[],
): ResolvedTaskProtocol {
  const advertised = card.taskProtocol
  assertVerification(
    checks,
    'task-protocol.advertised',
    Boolean(advertised),
    'protocol',
    `Remote worker ${card.id} ${advertised ? 'advertised taskProtocol metadata.' : 'is missing taskProtocol advertisement'}`,
  )
  assertVerification(
    checks,
    'task-protocol.task-endpoint',
    Boolean(advertised?.taskEndpoint && advertised.taskEndpoint.trim()),
    'protocol',
    `Remote worker ${card.id} ${advertised?.taskEndpoint?.trim() ? `advertised task endpoint ${advertised.taskEndpoint}.` : 'is missing taskProtocol.taskEndpoint'}`,
  )
  const verifiedProtocol = card.taskProtocol as NonNullable<AgentCard['taskProtocol']>

  const supportedResponseModes = normalizeSupportedResponseModes(verifiedProtocol.supportedResponseModes)
  assertVerification(
    checks,
    'task-protocol.supported-response-modes',
    supportedResponseModes.length > 0,
    'protocol',
    `Remote worker ${card.id} supports response modes: ${supportedResponseModes.join(', ') || 'none'}.`,
  )
  warnVerification(
    checks,
    'task-protocol.preferred-response-mode',
    !verifiedProtocol.preferredResponseMode || supportedResponseModes.includes(verifiedProtocol.preferredResponseMode),
    verifiedProtocol.preferredResponseMode
      ? `Remote worker ${card.id} preferred response mode is ${verifiedProtocol.preferredResponseMode}.`
      : `Remote worker ${card.id} did not advertise a preferred response mode; daemon will select one.`,
  )
  const callbackCapableModes = verifiedProtocol.callback?.authSchemes?.includes(CALLBACK_AUTH_SCHEME)
    ? supportedResponseModes
    : supportedResponseModes.filter(mode => mode !== 'callback')
  assertVerification(
    checks,
    'task-protocol.callback-auth-scheme',
    !supportedResponseModes.includes('callback') || Boolean(verifiedProtocol.callback?.authSchemes?.includes(CALLBACK_AUTH_SCHEME)),
    'auth',
    !supportedResponseModes.includes('callback')
      ? `Remote worker ${card.id} does not advertise callback delivery.`
      : `Remote worker ${card.id} ${verifiedProtocol.callback?.authSchemes?.includes(CALLBACK_AUTH_SCHEME) ? `advertised ${CALLBACK_AUTH_SCHEME} callback auth.` : 'supports callback delivery but is missing hmac-sha256 callback auth advertisement'}`,
  )
  assertVerification(
    checks,
    'task-protocol.callback-signature-header',
    !supportedResponseModes.includes('callback') || Boolean(verifiedProtocol.callback?.signatureHeader),
    'auth',
    !supportedResponseModes.includes('callback')
      ? `Remote worker ${card.id} does not require callback signature headers.`
      : `Remote worker ${card.id} ${verifiedProtocol.callback?.signatureHeader ? `advertised callback signature header ${verifiedProtocol.callback.signatureHeader}.` : 'supports callback delivery but is missing callback.signatureHeader'}`,
  )
  assertVerification(
    checks,
    'task-protocol.callback-timestamp-header',
    !supportedResponseModes.includes('callback') || Boolean(verifiedProtocol.callback?.timestampHeader),
    'auth',
    !supportedResponseModes.includes('callback')
      ? `Remote worker ${card.id} does not require callback timestamp headers.`
      : `Remote worker ${card.id} ${verifiedProtocol.callback?.timestampHeader ? `advertised callback timestamp header ${verifiedProtocol.callback.timestampHeader}.` : 'supports callback delivery but is missing callback.timestampHeader'}`,
  )
  warnVerification(
    checks,
    'task-protocol.callback-signature-encoding',
    !supportedResponseModes.includes('callback') || verifiedProtocol.callback?.signatureEncoding === 'hex',
    !supportedResponseModes.includes('callback')
      ? `Remote worker ${card.id} does not require callback signature encoding metadata.`
      : `Remote worker ${card.id} ${verifiedProtocol.callback?.signatureEncoding === 'hex' ? 'advertised hex callback signatures.' : 'did not advertise hex callback signatures.'}`,
  )
  const selectedResponseMode = pickPreferredResponseMode(
    callbackCapableModes.length > 0 ? callbackCapableModes : ['inline'],
    entry.preferredResponseMode ?? verifiedProtocol.preferredResponseMode,
  )
  const pollEndpointPresent = Boolean(verifiedProtocol.statusEndpointTemplate)
  if (selectedResponseMode === 'poll') {
    assertVerification(
      checks,
      'task-protocol.poll-status-endpoint',
      pollEndpointPresent,
      'protocol',
      pollEndpointPresent
        ? `Remote worker ${card.id} advertised poll status endpoint ${verifiedProtocol.statusEndpointTemplate}.`
        : `Remote worker ${card.id} selected poll delivery but is missing statusEndpointTemplate`,
    )
  } else {
    checks.push(createVerificationCheck(
      'task-protocol.poll-status-endpoint',
      true,
      'info',
      !supportedResponseModes.includes('poll')
        ? `Remote worker ${card.id} does not require poll status endpoints.`
        : pollEndpointPresent
          ? `Remote worker ${card.id} advertised poll status endpoint ${verifiedProtocol.statusEndpointTemplate}.`
          : `Remote worker ${card.id} will rely on runtime-provided status endpoints if it falls back to poll delivery.`,
    ))
  }
  const streamEndpointPresent = Boolean(verifiedProtocol.streamEndpointTemplate)
  if (selectedResponseMode === 'stream') {
    assertVerification(
      checks,
      'task-protocol.stream-endpoint',
      streamEndpointPresent,
      'protocol',
      streamEndpointPresent
        ? `Remote worker ${card.id} advertised stream endpoint ${verifiedProtocol.streamEndpointTemplate}.`
        : `Remote worker ${card.id} selected stream delivery but is missing streamEndpointTemplate`,
    )
  } else {
    checks.push(createVerificationCheck(
      'task-protocol.stream-endpoint',
      true,
      'info',
      !supportedResponseModes.includes('stream')
        ? `Remote worker ${card.id} does not require stream endpoints.`
        : streamEndpointPresent
          ? `Remote worker ${card.id} advertised stream endpoint ${verifiedProtocol.streamEndpointTemplate}.`
          : `Remote worker ${card.id} will rely on runtime-provided stream endpoints if it falls back to stream delivery.`,
    ))
  }
  const callbackAuth = verifiedProtocol.callback?.authSchemes?.includes(CALLBACK_AUTH_SCHEME)
    ? verifiedProtocol.callback
    : undefined

  return {
    source: 'agent-card',
    selectedResponseMode,
    supportedResponseModes: callbackCapableModes.length > 0 ? callbackCapableModes : ['inline'],
    statusEndpointTemplate: verifiedProtocol.statusEndpointTemplate,
    streamEndpointTemplate: verifiedProtocol.streamEndpointTemplate,
    // PR-02: freeze callback auth surface from verified agent-card advertisement
    callbackAuth: callbackAuth ? {
      scheme: CALLBACK_AUTH_SCHEME,
      signatureHeader: callbackAuth.signatureHeader ?? CALLBACK_SIGNATURE_HEADER,
      timestampHeader: callbackAuth.timestampHeader ?? CALLBACK_TIMESTAMP_HEADER,
      signatureEncoding: 'hex',
    } satisfies ResolvedCallbackAuthConfig : undefined,
  }
}

function buildAcceptedResponseModes(lifecycle: RemoteWorkerLifecycle): RemoteWorkerLifecycle[] {
  switch (lifecycle) {
    case 'inline':
      return ['inline']
    case 'poll':
      return ['poll', 'inline']
    case 'stream':
      return ['stream', 'poll', 'callback', 'inline']
    case 'callback':
      return ['callback', 'poll', 'inline']
  }
}

async function discoverRemoteWorker(
  entry: RemoteWorkerConfigEntry,
  trustRegistry: TrustRegistryStore,
  transport: RemoteWorkerTransport,
): Promise<RemoteWorkerEntry> {
  const baseUrl = entry.baseUrl ? normalizeBaseUrl(entry.baseUrl) : undefined
  const source = entry.agentCardUrl ?? `${baseUrl ?? ''}/.well-known/agent-card.json`
  const response = await transport.requestJsonResponse<AgentCard>({
    method: 'GET',
    url: source,
    bearerToken: entry.bearerToken,
  })
  const card = response.body
  const checks: RemoteWorkerVerificationCheck[] = []
  const responseHeaders = response.headers as Record<string, string | string[] | undefined>
  const contentType = getHeaderValue(responseHeaders, 'content-type')
  assertVerification(
    checks,
    'agent-card.http-content-type',
    typeof contentType === 'string' && contentType.toLowerCase().includes('application/json'),
    'agent-card',
    `Remote worker agent card responded with content-type ${contentType ?? 'missing'}.`,
  )
  const agentCardSha256 = hashAgentCard(response.rawBody)
  const agentCardEtag = getHeaderValue(responseHeaders, 'etag') ?? undefined
  const agentCardLastModified = getHeaderValue(responseHeaders, 'last-modified') ?? undefined
  warnVerification(
    checks,
    'agent-card.http-etag',
    Boolean(agentCardEtag),
    agentCardEtag
      ? `Remote worker ${card.id} advertised ETag ${agentCardEtag}.`
      : `Remote worker ${card.id} did not advertise an ETag for its agent card.`,
  )
  warnVerification(
    checks,
    'agent-card.http-last-modified',
    Boolean(agentCardLastModified),
    agentCardLastModified
      ? `Remote worker ${card.id} advertised Last-Modified ${agentCardLastModified}.`
      : `Remote worker ${card.id} did not advertise Last-Modified metadata for its agent card.`,
  )
  assertVerification(
    checks,
    'agent-card.sha256-pin',
    !entry.expectedAgentCardSha256 || agentCardSha256.toLowerCase() === entry.expectedAgentCardSha256.toLowerCase(),
    'agent-card',
    entry.expectedAgentCardSha256
      ? `Remote worker ${card.id} agent-card sha256 is ${agentCardSha256}.`
      : `Remote worker ${card.id} agent-card sha256 computed as ${agentCardSha256}.`,
  )
  assertVerification(
    checks,
    'agent-card.id',
    Boolean(card.id && card.id.trim()),
    'agent-card',
    `Remote worker agent card ${card.id?.trim() ? `advertised id ${card.id}.` : 'is missing a stable id.'}`,
  )
  assertVerification(
    checks,
    'agent-card.name',
    Boolean(card.name && card.name.trim()),
    'agent-card',
    `Remote worker ${card.id} ${card.name?.trim() ? `advertised name ${card.name}.` : 'is missing an agent-card name.'}`,
  )
  assertVerification(
    checks,
    'agent-card.version',
    Boolean(card.version && card.version.trim()),
    'agent-card',
    `Remote worker ${card.id} ${card.version?.trim() ? `advertised version ${card.version}.` : 'is missing an agent-card version.'}`,
  )
  assertVerification(
    checks,
    'agent-card.endpoint-protocol',
    card.endpoint.protocol === 'http',
    'agent-card',
    `Remote worker ${card.id} endpoint protocol is ${card.endpoint.protocol}.`,
  )
  assertVerification(
    checks,
    'agent-card.endpoint-url',
    Boolean(card.endpoint.url && /^https?:\/\//.test(card.endpoint.url)),
    'agent-card',
    `Remote worker ${card.id} ${/^https?:\/\//.test(card.endpoint.url) ? `advertised HTTP endpoint ${card.endpoint.url}.` : 'is missing a valid HTTP endpoint URL.'}`,
  )
  assertVerification(
    checks,
    'agent-card.capabilities',
    Array.isArray(card.capabilities) && card.capabilities.length > 0,
    'agent-card',
    `Remote worker ${card.id} ${Array.isArray(card.capabilities) && card.capabilities.length > 0 ? `advertised ${card.capabilities.length} capability entries.` : 'did not advertise any capabilities.'}`,
  )
  warnVerification(
    checks,
    'routing.config-id-alignment',
    !entry.id || entry.id === card.id,
    entry.id
      ? `Configured worker id ${entry.id} ${entry.id === card.id ? 'matches' : `overrides advertised id ${card.id}`}.`
      : `Configured worker id will use the advertised id ${card.id}.`,
  )
  const advertisedCapabilityIds = new Set(card.capabilities.map(capability => capability.id))
  assertVerification(
    checks,
    'routing.capability-overlap',
    entry.allowCapabilities.length === 0 || entry.allowCapabilities.some(capability => advertisedCapabilityIds.has(capability)),
    'routing',
    entry.allowCapabilities.length === 0
      ? `Remote worker ${card.id} delegates using all advertised capabilities.`
      : `Remote worker ${card.id} ${entry.allowCapabilities.some(capability => advertisedCapabilityIds.has(capability)) ? `matches configured capabilities ${entry.allowCapabilities.join(', ')}.` : `does not advertise any configured capabilities: ${entry.allowCapabilities.join(', ')}`}`,
  )
  assertVerification(
    checks,
    'routing.trust-threshold',
    card.trustScore >= entry.minTrustScore,
    'routing',
    `Remote worker ${card.id} trust score ${card.trustScore} ${card.trustScore >= entry.minTrustScore ? `meets` : `is below`} configured minimum ${entry.minTrustScore}.`,
  )
  const advertisementTrustPolicyId = entry.advertisementTrustPolicyId
    ?? DEFAULT_SIGNER_POLICY_IDS['remote-worker-advertisement']
  const advertisementTrustPolicy = trustRegistry.resolveSignerPolicy({
    scope: 'remote-worker-advertisement',
    policyId: entry.advertisementTrustPolicyId,
  })
  assertVerification(
    checks,
    'agent-card.advertisement.trust-policy',
    advertisementTrustPolicy.ok,
    'auth',
    advertisementTrustPolicy.message,
  )
  warnVerification(
    checks,
    'agent-card.advertisement.trust-policy-id',
    true,
    `Remote worker ${card.id} advertisement signer policy is ${advertisementTrustPolicy.policy?.policyId ?? advertisementTrustPolicyId}.`,
  )
  if (
    entry.requiredAdvertisementSchemaVersion
    || advertisementTrustPolicy.policy?.requireSignature
    || card.advertisement
  ) {
    assertVerification(
      checks,
      'agent-card.advertisement.present',
      Boolean(card.advertisement),
      'agent-card',
      card.advertisement
        ? `Remote worker ${card.id} advertised schema version ${card.advertisement.schemaVersion}.`
        : `Remote worker ${card.id} is missing advertisement metadata.`,
    )
  }
  if (card.advertisement) {
    assertVerification(
      checks,
      'agent-card.advertisement.schema-version',
      !entry.requiredAdvertisementSchemaVersion || card.advertisement.schemaVersion === entry.requiredAdvertisementSchemaVersion,
      'agent-card',
      `Remote worker ${card.id} advertisement schema version is ${card.advertisement.schemaVersion}.`,
    )
    const publishedAt = parseDateValue(card.advertisement.publishedAt)
    assertVerification(
      checks,
      'agent-card.advertisement.published-at',
      publishedAt !== null,
      'agent-card',
      `Remote worker ${card.id} advertisement publishedAt is ${card.advertisement.publishedAt}.`,
    )
    const expiresAt = parseDateValue(card.advertisement.expiresAt)
    assertVerification(
      checks,
      'agent-card.advertisement.expires-at',
      !card.advertisement.expiresAt || expiresAt !== null,
      'agent-card',
      card.advertisement.expiresAt
        ? `Remote worker ${card.id} advertisement expiresAt is ${card.advertisement.expiresAt}.`
        : `Remote worker ${card.id} advertisement does not expire.`,
    )
    assertVerification(
      checks,
      'agent-card.advertisement.not-expired',
      !card.advertisement.expiresAt || (expiresAt !== null && expiresAt > Date.now()),
      'agent-card',
      card.advertisement.expiresAt
        ? `Remote worker ${card.id} advertisement expiration ${card.advertisement.expiresAt} is still valid.`
        : `Remote worker ${card.id} advertisement does not declare an expiration deadline.`,
    )
    if (entry.maxAdvertisementAgeMs && publishedAt !== null) {
      assertVerification(
        checks,
        'agent-card.advertisement.max-age',
        Date.now() - publishedAt <= entry.maxAdvertisementAgeMs,
        'agent-card',
        `Remote worker ${card.id} advertisement age budget is ${entry.maxAdvertisementAgeMs}ms.`,
      )
    }
    const signatureEvaluation = trustRegistry.evaluateHmacSignatureEnvelope({
      scope: 'remote-worker-advertisement',
      payload: serializeAgentCardAdvertisementSurface(card),
      signature: card.advertisement.signature,
      policyId: entry.advertisementTrustPolicyId,
      subjectLabel: `Remote worker ${card.id} advertisement`,
      checkPrefix: 'agent-card.advertisement.signature',
    })
    applyTrustSignatureEvaluation(checks, signatureEvaluation, 'auth')
  }
  const taskProtocol = resolveTaskProtocol(card, entry, checks)
  const advertisedTaskEndpoint = card.taskProtocol?.taskEndpoint
  const taskEndpoint = resolveEndpoint(advertisedTaskEndpoint, {
    card,
    config: entry,
  }, {})
  assertVerification(
    checks,
    'task-protocol.task-endpoint-resolved',
    Boolean(taskEndpoint),
    'protocol',
    `Remote worker ${entry.id ?? card.id} ${taskEndpoint ? `resolved task endpoint ${taskEndpoint}.` : 'did not resolve a usable task endpoint.'}`,
  )
  return {
    card: {
      ...card,
      id: entry.id ?? card.id,
    },
    config: {
      ...entry,
    },
    source,
    agentCardSha256,
    agentCardEtag,
    agentCardLastModified,
    taskEndpoint: taskEndpoint as string,
    taskProtocol,
    verification: buildRemoteWorkerVerification(checks),
    advertisementTrustPolicyId: advertisementTrustPolicy.policy?.policyId ?? advertisementTrustPolicyId,
  }
}

async function resolveRemoteTask(
  worker: RemoteWorkerEntry,
  initial: RemoteWorkerTaskStatusResponse,
  signal: AbortSignal | undefined,
  callbackLease?: RemoteWorkerCallbackLease,
  transport: RemoteWorkerTransport = DEFAULT_REMOTE_WORKER_TRANSPORT,
): Promise<RemoteWorkerTaskCompletedResponse> {
  if (initial.status === 'completed') {
    callbackLease?.dispose()
    return initial
  }
  if (initial.status === 'failed') {
    callbackLease?.dispose()
    throw new Error(initial.error)
  }

  const variables = { taskId: initial.taskId }
  const responseMode = initial.responseMode ?? worker.taskProtocol.selectedResponseMode
  const statusEndpoint = resolveEndpoint(
    initial.statusEndpoint ?? worker.taskProtocol.statusEndpointTemplate,
    worker,
    variables,
  )
  const streamEndpoint = resolveEndpoint(
    initial.streamEndpoint ?? worker.taskProtocol.streamEndpointTemplate,
    worker,
    variables,
  )

  if (responseMode === 'inline') {
    callbackLease?.dispose()
    throw new Error(`Remote worker ${worker.card.id} requested async lifecycle but is configured for inline delivery`)
  }

  if (responseMode === 'callback') {
    if (!callbackLease) {
      throw new Error(`Remote worker ${worker.card.id} selected callback delivery without a callback lease`)
    }
    return callbackLease.wait(signal)
  }

  callbackLease?.dispose()

  if (responseMode === 'stream' && streamEndpoint) {
    return transport.requestTaskStream(streamEndpoint, worker.config.bearerToken, initial.taskId, signal)
  }

  if (!statusEndpoint) {
    throw new Error(`Remote worker ${worker.card.id} did not provide a status endpoint for ${responseMode} lifecycle`)
  }

  let pending = initial
  for (let attempt = 0; attempt < worker.config.maxPollAttempts; attempt += 1) {
    await sleep(pending.pollAfterMs ?? worker.config.pollIntervalMs, signal)
    const response = normalizeTaskResponse(await transport.requestJson<unknown>({
      method: 'GET',
      url: statusEndpoint,
      bearerToken: worker.config.bearerToken,
      signal,
    }), initial.taskId)

    if (response.status === 'completed') {
      return response
    }
    if (response.status === 'failed') {
      throw new Error(response.error)
    }
    pending = response
  }

  throw new Error(`Remote worker ${worker.card.id} did not complete task ${initial.taskId} within ${worker.config.maxPollAttempts} polls`)
}

function normalizeRemoteTribunalJudgeResult(
  worker: RemoteWorkerEntry,
  task: RemoteTribunalJudgeTask,
  response: RemoteWorkerTaskCompletedResponse,
  responseMode: RemoteWorkerLifecycle,
): RemoteTribunalJudgeResult {
  const output = response.output
  const verdict = output.verdict
  const confidence = output.confidence
  const rationale = output.rationale
  if (
    verdict !== 'agree' &&
    verdict !== 'partial' &&
    verdict !== 'disagree' &&
    verdict !== 'needs_human'
  ) {
    throw new Error(`Remote tribunal worker ${worker.card.id} returned invalid verdict`)
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(`Remote tribunal worker ${worker.card.id} returned invalid confidence`)
  }
  if (typeof rationale !== 'string' || rationale.trim().length < 8) {
    throw new Error(`Remote tribunal worker ${worker.card.id} returned invalid rationale`)
  }

  const evidenceIds = Array.isArray(output.evidenceIds)
    ? output.evidenceIds.filter((item): item is string => typeof item === 'string')
    : []
  const issues = Array.isArray(output.issues)
    ? output.issues.filter((item): item is string => typeof item === 'string')
    : []
  const model = typeof output.model === 'string'
    ? output.model
    : response.model
  const modelFamily = typeof output.modelFamily === 'string'
    ? extractModelFamily(output.modelFamily)
    : extractModelFamily(model)

  return {
    workerId: worker.card.id,
    model,
    modelFamily,
    responseMode,
    report: {
      judgeReportId: `${task.runId}:${task.nodeId}:tribunal:${worker.card.id}`,
      judge: `tribunal:remote:${worker.card.id}${model ? `:${model}` : ''}`,
      verdict,
      confidence,
      rationale: issues.length > 0
        ? `${rationale}; issues=${issues.join(' | ')}`
        : rationale,
      evidenceIds,
      createdAt: task.capturedAt,
    },
  }
}

export class RemoteWorkerDirectory {
  private readonly configPath: string
  private readonly trustRegistry: TrustRegistryStore
  private readonly registry = new AgentRegistry()
  private readonly workers = new Map<string, RemoteWorkerEntry>()
  private readonly discoveryIssues = new Map<string, RemoteWorkerDiscoveryIssue>()
  private readonly pendingCallbacks = new Map<string, PendingRemoteWorkerCallback>()
  /** PR-03: Replay cache — completed callback tokens mapped to receivedAt timestamp */
  private readonly completedCallbackTokens = new Map<string, string>()
  private callbackIngressBaseUrl?: string
  private refreshedAt = new Date(0).toISOString()
  /** PR-14: strict trust mode — only verified workers can be delegated */
  private readonly strictTrustMode: boolean

  constructor(
    configPath: string,
    trustRegistry: TrustRegistryStore,
    private readonly transport: RemoteWorkerTransport = DEFAULT_REMOTE_WORKER_TRANSPORT,
    /** PR-14: enable strict trust mode (default: false for backward compat) */
    strictTrustMode: boolean = false,
  ) {
    this.configPath = configPath
    this.trustRegistry = trustRegistry
    this.strictTrustMode = strictTrustMode
  }

  async refresh(): Promise<void> {
    this.registry.listAll().forEach(worker => {
      this.registry.unregister(worker.id)
    })
    this.workers.clear()
    this.discoveryIssues.clear()

    const config = this.readConfig()
    for (const entry of config) {
      if (!entry.enabled) {
        continue
      }
      try {
        const discovered = await discoverRemoteWorker(entry, this.trustRegistry, this.transport)
        this.registry.register(discovered.card)
        this.workers.set(discovered.card.id, discovered)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const issueKind: RemoteWorkerIssueKind = error instanceof RemoteWorkerVerificationError
          ? error.issueKind
          : 'discovery'
        const advertisementTrustPolicy = this.trustRegistry.resolveSignerPolicy({
          scope: 'remote-worker-advertisement',
          policyId: entry.advertisementTrustPolicyId,
        })
        const fallbackId = entry.id ?? entry.baseUrl ?? entry.agentCardUrl ?? `remote-worker-${this.discoveryIssues.size + 1}`
        const endpoint = entry.baseUrl ?? 'unknown'
        const agentCardUrl = entry.agentCardUrl ?? (entry.baseUrl ? `${normalizeBaseUrl(entry.baseUrl)}/.well-known/agent-card.json` : 'unknown')
        this.discoveryIssues.set(fallbackId, {
          id: fallbackId,
          issueKind,
          endpoint,
          agentCardUrl,
          expectedAgentCardSha256: entry.expectedAgentCardSha256,
          expectedAdvertisementSchemaVersion: entry.requiredAdvertisementSchemaVersion,
          advertisementTrustPolicyId: advertisementTrustPolicy.policy?.policyId ?? entry.advertisementTrustPolicyId,
          requiredAdvertisementSignature: advertisementTrustPolicy.policy?.requireSignature,
          allowedAdvertisementKeyStatuses: advertisementTrustPolicy.policy?.allowedKeyStatuses ?? [],
          allowedAdvertisementRotationGroups: advertisementTrustPolicy.policy?.allowedRotationGroups ?? [],
          allowedAdvertisementKeyIds: advertisementTrustPolicy.policy?.allowedKeyIds ?? [],
          allowedAdvertisementIssuers: advertisementTrustPolicy.policy?.allowedIssuers ?? [],
          error: message,
          capabilities: entry.allowCapabilities,
          preferredNodeIds: entry.preferredNodeIds,
          minTrustScore: entry.minTrustScore,
          detectedAt: new Date().toISOString(),
        })
      }
    }
    this.refreshedAt = new Date().toISOString()
  }

  list(): RemoteWorkerListResponse {
    return {
      refreshedAt: this.refreshedAt,
      workers: Array.from(this.workers.values()).map(worker => this.toSnapshot(worker)),
      discoveryIssues: Array.from(this.discoveryIssues.values()),
      /** PR-14: expose current trust mode */
      trustMode: this.strictTrustMode ? 'strict' as const : 'relaxed' as const,
    }
  }

  setCallbackIngressBaseUrl(baseUrl: string): void {
    this.callbackIngressBaseUrl = normalizeBaseUrl(baseUrl)
  }

  getCallbackIngressBaseUrl(): string | undefined {
    return this.callbackIngressBaseUrl
  }

  receiveCallback(
    callbackToken: string,
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): RemoteWorkerCallbackReceipt {
    // PR-03: Replay protection — check completed tokens BEFORE pending lookup
    // so that duplicates of already-completed callbacks get 409, not 410
    const previousReceivedAt = this.completedCallbackTokens.get(callbackToken)
    if (previousReceivedAt) {
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} rejected: duplicate delivery (originally received at ${previousReceivedAt})`,
        409,
      )
    }

    const pending = this.pendingCallbacks.get(callbackToken)
    if (!pending) {
      throw new RemoteWorkerCallbackError(`Unknown or expired remote worker callback token: ${callbackToken}`, 410)
    }

    const receivedAt = createISODateTime()
    if (hasExpired(pending.expiresAt, receivedAt)) {
      this.deletePendingCallback(callbackToken)
      throw new RemoteWorkerCallbackError(`Remote worker callback token expired for task ${pending.taskId}`, 410)
    }

    // PR-02: use frozen callback auth config instead of hardcoded constants
    const resolvedAuth = pending.callbackAuthConfig
    const timestamp = getHeaderValue(headers, resolvedAuth.timestampHeader)
    const signature = getHeaderValue(headers, resolvedAuth.signatureHeader)
    if (!timestamp || !signature) {
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} is missing signed callback headers`,
        401,
      )
    }
    if (!Number.isFinite(Date.parse(timestamp))) {
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} provided an invalid callback timestamp`,
        401,
      )
    }

    const expectedSignature = signCallbackPayload(pending.callbackSecret, timestamp, rawBody)
    const actualBuffer = Buffer.from(signature, 'utf8')
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8')
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} failed signature verification`,
        401,
      )
    }

    // PR-03: Freshness check — reject stale or future-skewed timestamps
    const timestampMs = Date.parse(timestamp)
    const nowMs = Date.now()
    const deltaMs = Math.abs(nowMs - timestampMs)
    if (deltaMs > pending.maxCallbackSkewMs) {
      const direction = timestampMs < nowMs ? 'stale' : 'skewed'
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} rejected: timestamp is ${direction} (delta=${deltaMs}ms, max=${pending.maxCallbackSkewMs}ms)`,
        401,
      )
    }

    const normalized = normalizeTaskResponse(payload, pending.taskId)
    if (normalized.status === 'accepted' || normalized.status === 'running') {
      throw new RemoteWorkerCallbackError(
        `Remote worker callback ${callbackToken} did not include a terminal task result`,
        422,
      )
    }

    this.deletePendingCallback(callbackToken)
    // PR-03: Record completed token for replay detection
    this.completedCallbackTokens.set(callbackToken, receivedAt)
    if (normalized.status === 'failed') {
      pending.reject(new Error(normalized.error))
    } else if (normalized.status === 'completed') {
      pending.resolve(normalized)
    }

    return {
      callbackToken,
      runId: pending.runId,
      taskId: pending.taskId,
      workerId: pending.workerId,
      status: normalized.status,
      verifiedSignature: true,
      receivedAt,
    }
  }

  canDelegate(step: { id: string; capability: string }): boolean {
    return this.selectWorkersByCapability(step).length > 0
  }

  async delegate(
    step: { id: string; capability: string },
    ctx: NodeExecutionContext,
  ): Promise<NodeExecutionResult | null> {
    const selected = this.selectWorker(step)
    if (!selected) {
      return null
    }

    const traceId = `${ctx.runId}:${ctx.nodeId}:${ctx.attempt}:remote`
    const taskId = `${ctx.runId}:${ctx.nodeId}:${ctx.attempt}`
    const upstreamOutputs = Object.fromEntries(
      (ctx.graph.nodes.find(node => node.id === ctx.nodeId)?.dependsOn ?? []).map(dep => [
        dep,
        ctx.getUpstreamOutput(dep) ?? {},
      ]),
    )
    const handoff = new HandoffProtocol().pack({
      sourceAgentId: ANTIGRAVITY_AUTHORITY_OWNER,
      targetAgentId: selected.card.id,
      taskId,
      runId: ctx.runId,
      currentStage: ctx.nodeId,
      conversationSummary: Object.entries(upstreamOutputs)
        .map(([nodeId, output]) => `${nodeId}: ${summarizeUpstreamOutput(output)}`)
        .join('\n'),
      constraints: [
        'authority=antigravity-daemon',
        'host=antigravity',
        `node=${ctx.nodeId}`,
        `capability=${step.capability}`,
        `delivery=${selected.taskProtocol.selectedResponseMode}`,
      ],
      payload: upstreamOutputs,
    })

    const startedAt = Date.now()
    const callbackLease = selected.taskProtocol.selectedResponseMode === 'callback' && selected.taskProtocol.callbackAuth
      ? this.createCallbackLease(ctx.runId, selected.card.id, taskId, selected.config.callbackTimeoutMs, selected.taskProtocol.callbackAuth, selected.config.maxCallbackSkewMs)
      : undefined
    try {
      const initial = normalizeTaskResponse(await this.transport.requestJson<unknown>({
        method: 'POST',
        url: selected.taskEndpoint,
        bearerToken: selected.config.bearerToken,
        signal: ctx.signal,
        body: {
          taskId,
          runId: ctx.runId,
          nodeId: ctx.nodeId,
          capability: step.capability,
          goal: String(ctx.state.capturedContext?.metadata?.goal ?? ''),
          attempt: ctx.attempt,
          authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
          authorityHost: ANTIGRAVITY_AUTHORITY_HOST,
          traceId,
          files: Array.isArray(ctx.state.capturedContext?.metadata?.files)
            ? ctx.state.capturedContext?.metadata?.files as string[]
            : [],
          upstreamOutputs,
          constraints: handoff.constraints,
          acceptedResponseModes: buildAcceptedResponseModes(selected.taskProtocol.selectedResponseMode),
          callback: callbackLease ? {
            callbackToken: callbackLease.callbackToken,
            callbackUrl: callbackLease.callbackUrl,
            expiresAt: callbackLease.expiresAt,
            deliveryMode: 'post-json',
            // PR-02: use frozen auth config from discovery
            auth: {
              scheme: callbackLease.callbackAuthConfig.scheme,
              secret: callbackLease.callbackSecret,
              signatureHeader: callbackLease.callbackAuthConfig.signatureHeader,
              timestampHeader: callbackLease.callbackAuthConfig.timestampHeader,
              signatureEncoding: callbackLease.callbackAuthConfig.signatureEncoding,
            },
          } : null,
          handoff,
        } satisfies RemoteWorkerTaskRequest,
      }), taskId)
      const response = await resolveRemoteTask(selected, initial, ctx.signal, callbackLease, this.transport)
      selected.lastError = undefined
      const delegatedLifecycle = initial.status === 'accepted' || initial.status === 'running'
        ? (initial.responseMode ?? selected.taskProtocol.selectedResponseMode)
        : selected.taskProtocol.selectedResponseMode

      return {
        output: {
          ...response.output,
          remoteWorker: {
            id: selected.card.id,
            name: selected.card.name,
            taskId: response.taskId,
            taskEndpoint: selected.taskEndpoint,
            selectedResponseMode: delegatedLifecycle,
            delegated: true,
          },
        },
        model: response.model ?? `remote:${selected.card.id}`,
        durationMs: response.durationMs ?? (Date.now() - startedAt),
      }
    } catch (error) {
      callbackLease?.dispose()
      selected.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async delegateTribunal(
    task: RemoteTribunalJudgeTask,
  ): Promise<RemoteTribunalDelegationResult> {
    const candidates = this.selectWorkersByCapability({
      id: task.nodeId,
      capability: 'tribunal-judge',
    }, task.maxJurors ?? 2)
    if (candidates.length === 0) {
      return { reports: [], failures: [] }
    }

    const settled = await Promise.allSettled(
      candidates.map(worker => this.dispatchTribunalJudge(worker, task)),
    )

    const reports: RemoteTribunalJudgeResult[] = []
    const failures: string[] = []
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        reports.push(result.value)
        continue
      }
      failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
    }

    return { reports, failures }
  }

  createExecutorRegistry(definition: WorkflowDefinition): NodeExecutorRegistry {
    const registry = new NodeExecutorRegistry()
    for (const step of definition.steps) {
      if (!this.canDelegate(step)) {
        continue
      }
      const local = registry.get(step.id) ?? createLocalExecutor(step.id as WorkflowNodeId)
      registry.register(new RemoteAwareNodeExecutor(step.id as WorkflowNodeId, step.capability, local, this))
    }
    return registry
  }

  private readConfig(): RemoteWorkerConfigEntry[] {
    if (!fs.existsSync(this.configPath)) {
      return []
    }
    const raw = fs.readFileSync(this.configPath, 'utf8').trim()
    if (!raw) {
      return []
    }
    return RemoteWorkerConfigSchema.parse(JSON.parse(raw))
  }

  /**
   * PR-14: Compute delegation eligibility with reason.
   * Returns { delegable, blockReason } reflecting the current trust mode.
   */
  private getDelegationEligibility(worker: RemoteWorkerEntry): {
    delegable: boolean
    blockReason?: 'worker_not_healthy' | 'trust_score_below_min' | 'verification_not_verified'
  } {
    if (worker.card.health !== 'healthy') {
      return { delegable: false, blockReason: 'worker_not_healthy' }
    }
    if (worker.card.trustScore < worker.config.minTrustScore) {
      return { delegable: false, blockReason: 'trust_score_below_min' }
    }
    if (this.strictTrustMode && worker.verification.summary !== 'verified') {
      return { delegable: false, blockReason: 'verification_not_verified' }
    }
    return { delegable: true }
  }

  /**
   * PR-14: Check if a worker passes delegation criteria for the current trust mode.
   * In strict mode, only 'verified' workers are delegable.
   * In relaxed mode, both 'verified' and 'warning' workers are delegable.
   */
  private isDelegable(worker: RemoteWorkerEntry): boolean {
    return this.getDelegationEligibility(worker).delegable
  }

  private selectWorkersByCapability(
    step: { id: string; capability: string },
    limit?: number,
  ): RemoteWorkerEntry[] {
    const candidates = Array.from(this.workers.values())
      .filter(worker => worker.card.health === 'healthy')
      .filter(worker => worker.card.trustScore >= worker.config.minTrustScore)
      .filter(worker => worker.card.capabilities.some(capability => capability.id === step.capability))
      .filter(worker => worker.config.allowCapabilities.length === 0 || worker.config.allowCapabilities.includes(step.capability))
      .filter(worker => worker.config.preferredNodeIds.length === 0 || worker.config.preferredNodeIds.includes(step.id))
      // PR-14: strict trust mode — only verified workers can be delegated
      .filter(worker => this.isDelegable(worker))
      .sort((left, right) => right.card.trustScore - left.card.trustScore)

    return typeof limit === 'number'
      ? candidates.slice(0, limit)
      : candidates
  }

  private selectWorker(step: { id: string; capability: string }): RemoteWorkerEntry | null {
    return this.selectWorkersByCapability(step, 1)[0] ?? null
  }

  private async dispatchTribunalJudge(
    worker: RemoteWorkerEntry,
    task: RemoteTribunalJudgeTask,
  ): Promise<RemoteTribunalJudgeResult> {
    const traceId = `${task.runId}:${task.nodeId}:tribunal:${worker.card.id}`
    const taskId = `${task.runId}:${task.nodeId}:tribunal:${worker.card.id}`
    const upstreamOutputs = task.upstreamOutputs
    const handoff = new HandoffProtocol().pack({
      sourceAgentId: ANTIGRAVITY_AUTHORITY_OWNER,
      targetAgentId: worker.card.id,
      taskId,
      runId: task.runId,
      currentStage: `${task.nodeId}:TRIBUNAL`,
      conversationSummary: Object.entries(upstreamOutputs)
        .map(([nodeId, output]) => `${nodeId}: ${summarizeUpstreamOutput(output)}`)
        .join('\n'),
      constraints: [
        'authority=antigravity-daemon',
        'host=antigravity',
        `node=${task.nodeId}`,
        'capability=tribunal-judge',
        `delivery=${worker.taskProtocol.selectedResponseMode}`,
      ],
      payload: {
        subjectOutput: task.subjectOutput,
        upstreamOutputs,
        heuristicBaseline: task.heuristicBaseline,
      },
    })

    const callbackLease = worker.taskProtocol.selectedResponseMode === 'callback' && worker.taskProtocol.callbackAuth
      ? this.createCallbackLease(task.runId, worker.card.id, taskId, worker.config.callbackTimeoutMs, worker.taskProtocol.callbackAuth, worker.config.maxCallbackSkewMs)
      : undefined

    try {
      const initial = normalizeTaskResponse(await this.transport.requestJson<unknown>({
        method: 'POST',
        url: worker.taskEndpoint,
        bearerToken: worker.config.bearerToken,
        signal: task.signal,
        body: {
          taskId,
          runId: task.runId,
          nodeId: task.nodeId,
          capability: 'tribunal-judge',
          taskType: 'tribunal',
          goal: task.goal,
          attempt: 0,
          authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
          authorityHost: ANTIGRAVITY_AUTHORITY_HOST,
          traceId,
          files: [],
          upstreamOutputs,
          constraints: handoff.constraints,
          acceptedResponseModes: buildAcceptedResponseModes(worker.taskProtocol.selectedResponseMode),
          tribunal: {
            subjectNodeId: task.nodeId,
            subjectOutput: task.subjectOutput,
            heuristicBaseline: task.heuristicBaseline,
            forbiddenJudgeModelFamilies: task.forbiddenJudgeModelFamilies,
          },
          callback: callbackLease ? {
            callbackToken: callbackLease.callbackToken,
            callbackUrl: callbackLease.callbackUrl,
            expiresAt: callbackLease.expiresAt,
            deliveryMode: 'post-json',
            // PR-02: use frozen auth config from discovery
            auth: {
              scheme: callbackLease.callbackAuthConfig.scheme,
              secret: callbackLease.callbackSecret,
              signatureHeader: callbackLease.callbackAuthConfig.signatureHeader,
              timestampHeader: callbackLease.callbackAuthConfig.timestampHeader,
              signatureEncoding: callbackLease.callbackAuthConfig.signatureEncoding,
            },
          } : null,
          handoff,
        } satisfies RemoteWorkerTaskRequest,
      }), taskId)
      const response = await resolveRemoteTask(worker, initial, task.signal, callbackLease, this.transport)
      worker.lastError = undefined
      const delegatedLifecycle = initial.status === 'accepted' || initial.status === 'running'
        ? (initial.responseMode ?? worker.taskProtocol.selectedResponseMode)
        : worker.taskProtocol.selectedResponseMode
      return normalizeRemoteTribunalJudgeResult(worker, task, response, delegatedLifecycle)
    } catch (error) {
      callbackLease?.dispose()
      worker.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  private createCallbackLease(runId: string, workerId: string, taskId: string, timeoutMs: number, callbackAuthConfig: ResolvedCallbackAuthConfig, maxCallbackSkewMs: number): RemoteWorkerCallbackLease {
    if (!this.callbackIngressBaseUrl) {
      throw new Error(`Remote worker ${workerId} requires callback delivery before callback ingress is configured`)
    }

    const callbackToken = `${taskId}:${crypto.randomUUID()}`
    const callbackSecret = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + timeoutMs).toISOString()
    let resolveCallback!: (value: RemoteWorkerTaskCompletedResponse) => void
    let rejectCallback!: (reason?: unknown) => void
    const promise = new Promise<RemoteWorkerTaskCompletedResponse>((resolve, reject) => {
      resolveCallback = resolve
      rejectCallback = reject
    })
    const timeout = setTimeout(() => {
      this.pendingCallbacks.delete(callbackToken)
      rejectCallback(new Error(`Remote worker callback timed out for task ${taskId}`))
    }, timeoutMs)

    this.pendingCallbacks.set(callbackToken, {
      callbackToken,
      runId,
      taskId,
      workerId,
      callbackSecret,
      expiresAt,
      callbackAuthConfig,
      maxCallbackSkewMs,
      timeout,
      promise,
      resolve: resolveCallback,
      reject: rejectCallback,
    })

    return {
      callbackToken,
      callbackUrl: `${this.callbackIngressBaseUrl}/remote-worker-callbacks/${encodeURIComponent(callbackToken)}`,
      expiresAt,
      callbackSecret,
      callbackAuthConfig,
      wait: async (signal?: AbortSignal) => {
        if (!signal) {
          return promise
        }
        if (signal.aborted) {
          this.deletePendingCallback(callbackToken)
          throw new Error(`Remote worker callback aborted for task ${taskId}`)
        }

        return new Promise<RemoteWorkerTaskCompletedResponse>((resolve, reject) => {
          const onAbort = (): void => {
            this.deletePendingCallback(callbackToken)
            reject(new Error(`Remote worker callback aborted for task ${taskId}`))
          }

          signal.addEventListener('abort', onAbort, { once: true })
          promise.then(
            value => {
              signal.removeEventListener('abort', onAbort)
              resolve(value)
            },
            error => {
              signal.removeEventListener('abort', onAbort)
              reject(error)
            },
          )
        })
      },
      dispose: () => {
        this.deletePendingCallback(callbackToken)
      },
    }
  }

  private deletePendingCallback(callbackToken: string): void {
    const pending = this.pendingCallbacks.get(callbackToken)
    if (!pending) {
      return
    }
    clearTimeout(pending.timeout)
    this.pendingCallbacks.delete(callbackToken)
  }

  private toSnapshot(worker: RemoteWorkerEntry): RemoteWorkerSnapshot {
    return {
      id: worker.card.id,
      name: worker.card.name,
      agentCardVersion: worker.card.version,
      agentCardSchemaVersion: worker.card.advertisement?.schemaVersion,
      agentCardPublishedAt: worker.card.advertisement?.publishedAt,
      agentCardExpiresAt: worker.card.advertisement?.expiresAt,
      agentCardAdvertisementSignatureKeyId: worker.card.advertisement?.signature?.keyId,
      agentCardAdvertisementSignatureIssuer: worker.card.advertisement?.signature?.issuer,
      agentCardAdvertisementSignedAt: worker.card.advertisement?.signature?.signedAt,
      advertisementTrustPolicyId: worker.advertisementTrustPolicyId,
      agentCardSha256: worker.agentCardSha256,
      agentCardEtag: worker.agentCardEtag,
      agentCardLastModified: worker.agentCardLastModified,
      endpoint: worker.card.endpoint.url,
      taskEndpoint: worker.taskEndpoint,
      selectedResponseMode: worker.taskProtocol.selectedResponseMode,
      supportedResponseModes: worker.taskProtocol.supportedResponseModes,
      taskProtocolSource: worker.taskProtocol.source,
      statusEndpointTemplate: worker.taskProtocol.statusEndpointTemplate,
      streamEndpointTemplate: worker.taskProtocol.streamEndpointTemplate,
      callbackUrlTemplate: worker.taskProtocol.selectedResponseMode === 'callback' && this.callbackIngressBaseUrl
        ? `${this.callbackIngressBaseUrl}/remote-worker-callbacks/{callbackToken}`
        : undefined,
      callbackAuthScheme: worker.taskProtocol.callbackAuth?.scheme,
      callbackSignatureHeader: worker.taskProtocol.callbackAuth?.signatureHeader,
      callbackTimestampHeader: worker.taskProtocol.callbackAuth?.timestampHeader,
      callbackSignatureEncoding: worker.taskProtocol.callbackAuth?.signatureEncoding,
      pollIntervalMs: worker.taskProtocol.selectedResponseMode === 'inline' || worker.taskProtocol.selectedResponseMode === 'callback'
        ? undefined
        : worker.config.pollIntervalMs,
      maxPollAttempts: worker.taskProtocol.selectedResponseMode === 'inline' || worker.taskProtocol.selectedResponseMode === 'callback'
        ? undefined
        : worker.config.maxPollAttempts,
      callbackTimeoutMs: worker.taskProtocol.selectedResponseMode === 'callback'
        ? worker.config.callbackTimeoutMs
        : undefined,
      maxCallbackSkewMs: worker.taskProtocol.selectedResponseMode === 'callback'
        ? worker.config.maxCallbackSkewMs
        : undefined,
      capabilities: worker.card.capabilities.map(capability => capability.id),
      health: worker.card.health as AgentHealthStatus,
      trustScore: worker.card.trustScore,
      source: worker.source,
      preferredNodeIds: worker.config.preferredNodeIds,
      verification: worker.verification,
      lastError: worker.lastError,
      ...(() => {
        const { delegable, blockReason } = this.getDelegationEligibility(worker)
        return { delegable, delegationBlockReason: blockReason }
      })(),
    }
  }
}

class RemoteAwareNodeExecutor implements NodeExecutor {
  readonly nodeId: WorkflowNodeId
  readonly timeoutMs: number
  readonly maxRetries: number

  constructor(
    nodeId: WorkflowNodeId,
    private readonly capability: string,
    private readonly local: NodeExecutor,
    private readonly directory: RemoteWorkerDirectory,
    /** P1-5: 'fallback' (default) silently degrades; 'fail-closed' propagates remote errors */
    private readonly federationFailPolicy: 'fallback' | 'fail-closed' = 'fallback',
  ) {
    this.nodeId = nodeId
    this.timeoutMs = local.timeoutMs
    this.maxRetries = local.maxRetries
  }

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    try {
      const remote = await this.directory.delegate({
        id: this.nodeId,
        capability: this.capability,
      }, ctx)
      if (remote) {
        return remote
      }
    } catch (error) {
      // P1-5: fail-closed mode — propagate remote worker errors instead of masking
      if (this.federationFailPolicy === 'fail-closed') {
        throw error
      }
      const fallback = await this.local.execute(ctx)
      return {
        ...fallback,
        degraded: true,
        output: {
          ...fallback.output,
          remoteWorkerFallback: {
            nodeId: this.nodeId,
            reason: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }

    return this.local.execute(ctx)
  }
}
