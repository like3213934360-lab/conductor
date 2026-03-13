import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentCard } from '@anthropic/antigravity-core'
import { RemoteWorkerDirectory } from '../remote-worker.js'
import { TrustRegistryStore } from '../trust-registry.js'

/**
 * PR-14: strict trust mode tests.
 *
 * Uses a minimal mock transport that serves agent cards via /.well-known/agent-card.json.
 * The mock can optionally include ETag/Last-Modified headers — without them,
 * the worker gets `summary: 'warning'` due to warnVerification checks.
 */

type MockHeaders = Record<string, string | string[] | undefined>

function createTransport(
  baseUrl: string,
  card: AgentCard,
  agentCardHeaders: MockHeaders = {},
) {
  async function requestJsonResponse<T>(options: {
    method: 'GET' | 'POST'
    url: string
    body?: unknown
    bearerToken?: string
    signal?: AbortSignal
  }): Promise<{ statusCode: number; headers: MockHeaders; rawBody: string; body: T }> {
    const target = new URL(options.url)
    const url = `${target.pathname}${target.search}`
    if (options.method === 'GET' && target.origin === baseUrl && url === '/.well-known/agent-card.json') {
      const rawBody = JSON.stringify(card)
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...agentCardHeaders },
        rawBody,
        body: JSON.parse(rawBody) as T,
      }
    }
    throw new Error(`Unexpected request: ${options.method} ${options.url}`)
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
      return (await requestJsonResponse<T>(options)).body
    },
    async requestTaskStream() {
      throw new Error('Not implemented in strict trust tests')
    },
  }
}

describe('PR-14: strict trust mode — delegation filtering', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = undefined
  })

  async function setup(opts: {
    strictTrustMode: boolean
    card?: Partial<AgentCard>
    configOverrides?: Record<string, unknown>
    /** Include ETag + Last-Modified headers so worker gets 'verified' summary */
    includeHttpMeta?: boolean
  }) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr14-strict-'))
    const baseUrl = 'http://remote-worker.test'
    const publishedAt = new Date(Date.now() - 60_000).toISOString()
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()

    const card: AgentCard = {
      id: 'remote-verify',
      name: 'Remote Verify Worker',
      version: '1.0.0',
      description: 'Remote verification worker',
      capabilities: [{ id: 'verification', description: 'verification', proficiency: 90 }],
      endpoint: { protocol: 'http', url: baseUrl },
      trustScore: 92,
      activeTasks: 0,
      maxConcurrency: 4,
      lastHeartbeat: new Date().toISOString(),
      health: 'healthy',
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
      ...opts.card,
    }

    // When includeHttpMeta is true, provide ETag + Last-Modified so all warn checks pass
    const agentCardHeaders: MockHeaders = opts.includeHttpMeta !== false
      ? { etag: '"abc123"', 'last-modified': new Date().toUTCString() }
      : {}

    const configPath = path.join(tempDir, 'remote-workers.json')
    const trustRegistryPath = path.join(tempDir, 'trust-registry.json')
    fs.writeFileSync(configPath, JSON.stringify([{
      id: 'remote-verify',
      baseUrl,
      allowCapabilities: ['verification'],
      preferredNodeIds: ['VERIFY'],
      minTrustScore: 80,
      ...opts.configOverrides,
    }], null, 2), 'utf8')
    fs.writeFileSync(trustRegistryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [],
      signerPolicies: [],
    }, null, 2), 'utf8')

    const trustRegistry = new TrustRegistryStore(trustRegistryPath)
    trustRegistry.load()
    const directory = new RemoteWorkerDirectory(
      configPath,
      trustRegistry,
      createTransport(baseUrl, card, agentCardHeaders) as any,
      opts.strictTrustMode,
    )
    await directory.refresh()
    return { directory, card }
  }

  // ─── Positive: verified worker delegable in strict mode ────────────────

  it('strict mode: verified worker is delegable', async () => {
    const { directory } = await setup({ strictTrustMode: true, includeHttpMeta: true })
    const list = directory.list()
    expect(list.workers.length).toBe(1)
    expect(list.workers[0]!.verification.summary).toBe('verified')
    expect(list.workers[0]!.delegable).toBe(true)
    expect(list.workers[0]!.delegationBlockReason).toBeUndefined()
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(true)
  })

  // ─── Negative: warning worker not delegable in strict mode ─────────────

  it('strict mode: warning worker (missing ETag/Last-Modified) not delegable', async () => {
    const { directory } = await setup({ strictTrustMode: true, includeHttpMeta: false })
    const list = directory.list()
    expect(list.workers.length).toBe(1)
    expect(list.workers[0]!.verification.summary).toBe('warning')
    expect(list.workers[0]!.delegable).toBe(false)
    expect(list.workers[0]!.delegationBlockReason).toBe('verification_not_verified')
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(false)
  })

  it('strict mode: degraded health worker not delegable', async () => {
    const { directory } = await setup({
      strictTrustMode: true,
      includeHttpMeta: true,
      card: { health: 'degraded' },
    })
    const list = directory.list()
    expect(list.workers[0]!.delegable).toBe(false)
    expect(list.workers[0]!.delegationBlockReason).toBe('worker_not_healthy')
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(false)
  })

  it('strict mode: below minTrustScore goes to discoveryIssues (not workers)', async () => {
    const { directory } = await setup({
      strictTrustMode: true,
      includeHttpMeta: true,
      card: { trustScore: 50 },
    })
    const list = directory.list()
    // Worker fails assertVerification during discovery → goes to discoveryIssues
    expect(list.workers.length).toBe(0)
    expect(list.discoveryIssues.length).toBe(1)
    expect(list.discoveryIssues[0]!.issueKind).toBe('routing')
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(false)
  })

  // ─── Relaxed mode backward compatibility ───────────────────────────────

  it('relaxed mode: warning worker IS delegable', async () => {
    const { directory } = await setup({ strictTrustMode: false, includeHttpMeta: false })
    const list = directory.list()
    expect(list.workers[0]!.verification.summary).toBe('warning')
    expect(list.workers[0]!.delegable).toBe(true)
    expect(list.workers[0]!.delegationBlockReason).toBeUndefined()
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(true)
  })

  it('default strictTrustMode is false (backward compat)', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr14-strict-'))
    const baseUrl = 'http://remote-worker.test'
    const card: AgentCard = {
      id: 'remote-verify', name: 'Worker', version: '1.0.0', description: 'test',
      capabilities: [{ id: 'verification', description: 'verification', proficiency: 90 }],
      endpoint: { protocol: 'http', url: baseUrl }, trustScore: 92,
      activeTasks: 0, maxConcurrency: 4, lastHeartbeat: new Date().toISOString(), health: 'healthy',
      taskProtocol: { taskEndpoint: '/a2a/tasks', supportedResponseModes: ['inline'] },
      advertisement: { schemaVersion: 'a2a.agent-card.v1', publishedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    }
    const configPath = path.join(tempDir, 'remote-workers.json')
    const trustRegistryPath = path.join(tempDir, 'trust-registry.json')
    fs.writeFileSync(configPath, JSON.stringify([{ id: 'remote-verify', baseUrl, allowCapabilities: ['verification'], preferredNodeIds: ['VERIFY'], minTrustScore: 80 }]))
    fs.writeFileSync(trustRegistryPath, JSON.stringify({ registryId: 'test', version: '1.0', keys: [], signerPolicies: [] }))
    const trustRegistry = new TrustRegistryStore(trustRegistryPath)
    trustRegistry.load()
    // Omit 4th param — should default to false (relaxed)
    const directory = new RemoteWorkerDirectory(configPath, trustRegistry, createTransport(baseUrl, card, { etag: '"abc"', 'last-modified': new Date().toUTCString() }) as any)
    await directory.refresh()
    expect(directory.list().trustMode).toBe('relaxed')
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(true)
  })

  // ─── list() trustMode field ────────────────────────────────────────────

  it('list() shows trustMode strict', async () => {
    const { directory } = await setup({ strictTrustMode: true, includeHttpMeta: true })
    expect(directory.list().trustMode).toBe('strict')
  })

  it('list() shows trustMode relaxed', async () => {
    const { directory } = await setup({ strictTrustMode: false, includeHttpMeta: true })
    expect(directory.list().trustMode).toBe('relaxed')
  })

  // ─── Edge: warning worker visible but not delegable in strict ──────────

  it('strict mode: warning worker visible in list but canDelegate returns false', async () => {
    const { directory } = await setup({ strictTrustMode: true, includeHttpMeta: false })
    const list = directory.list()
    expect(list.workers.length).toBe(1)
    expect(list.workers[0]!.id).toBe('remote-verify')
    expect(list.workers[0]!.verification.summary).toBe('warning')
    // Observable: delegable is false with clear reason
    expect(list.workers[0]!.delegable).toBe(false)
    expect(list.workers[0]!.delegationBlockReason).toBe('verification_not_verified')
    expect(directory.canDelegate({ id: 'VERIFY', capability: 'verification' })).toBe(false)
  })
})
