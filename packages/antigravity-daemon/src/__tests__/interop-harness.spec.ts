import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InteropHarness } from '../interop-harness.js'

const AGENT_CARD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('interop harness', () => {
  let tempDir: string | undefined

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = undefined
  })

  it('runs the built-in interop suites with the default manifest', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-interop-harness-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(dataDir, { recursive: true })

    const harness = new InteropHarness({
      projectionPath: path.join(dataDir, 'run-projection.json'),
      authorityOwner: 'antigravity-daemon',
      authorityHost: 'antigravity',
      callbackIngressBaseUrl: 'http://127.0.0.1:45123',
      callbackAuthScheme: 'hmac-sha256',
      hasManifestOperation: (operationId) =>
        operationId === 'StreamRun' ||
        operationId === 'ReceiveRemoteWorkerCallback' ||
        operationId === 'ReloadTrustRegistry' ||
        operationId === 'GetRunSession' ||
        operationId === 'PrepareStepCompletionReceipt' ||
        operationId === 'CommitStepCompletionReceipt',
      getTrustRegistry: () => ({
        registryId: 'workspace-trust-registry',
        version: '2026.03.11',
        loadedAt: '2026-03-11T00:00:00.000Z',
        verification: {
          verifiedAt: '2026-03-11T00:00:00.000Z',
          summary: 'verified',
          checks: [],
        },
        keys: [],
        signerPolicies: [
          { policyId: 'default:remote-worker-advertisement', scope: 'remote-worker-advertisement', enabled: true, requireSignature: false, allowedKeyStatuses: ['active'], allowedRotationGroups: [], allowedKeyIds: [], allowedIssuers: [] },
          { policyId: 'default:benchmark-source-registry', scope: 'benchmark-source-registry', enabled: true, requireSignature: false, allowedKeyStatuses: ['active'], allowedRotationGroups: [], allowedKeyIds: [], allowedIssuers: [] },
        ],
      }),
      listRemoteWorkers: () => ({
        refreshedAt: '2026-03-11T00:00:00.000Z',
        workers: [{
          agentCardVersion: '1.0.0',
          agentCardSchemaVersion: 'a2a.agent-card.v1',
          agentCardPublishedAt: '2026-03-11T00:00:00.000Z',
          agentCardAdvertisementSignatureKeyId: 'interop-signing',
          agentCardAdvertisementSignatureIssuer: 'antigravity-lab',
          agentCardAdvertisementSignedAt: '2026-03-11T00:00:00.000Z',
          agentCardSha256: AGENT_CARD_SHA,
          selectedResponseMode: 'callback',
          supportedResponseModes: ['callback', 'poll', 'inline'],
          taskProtocolSource: 'agent-card',
          verification: { summary: 'verified' },
          health: 'healthy',
        }],
        discoveryIssues: [],
      }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, path.join(dataDir, 'interop-manifest.json'))

    const report = await harness.run({ suiteIds: [] })

    expect(report.harnessId).toBe('antigravity-daemon-interop-harness')
    expect(report.ok).toBe(true)
    expect(report.suites.length).toBeGreaterThanOrEqual(3)
  })

  it('loads workspace interop-manifest.json and narrows to selected suites', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-interop-manifest-'))
    const dataDir = path.join(tempDir, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    const manifestPath = path.join(dataDir, 'interop-manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      harnessId: 'workspace-interop-harness',
      manifestVersion: '2026.03.11',
      suites: [
        {
          suiteId: 'authority-surface',
          name: 'Workspace Authority Surface',
        },
        {
          suiteId: 'durable-runtime-surface',
          enabled: false,
        },
      ],
    }, null, 2), 'utf8')

    const harness = new InteropHarness({
      projectionPath: path.join(dataDir, 'run-projection.json'),
      authorityOwner: 'antigravity-daemon',
      authorityHost: 'antigravity',
      callbackIngressBaseUrl: 'http://127.0.0.1:45123',
      callbackAuthScheme: 'hmac-sha256',
      hasManifestOperation: (operationId) =>
        operationId === 'StreamRun' ||
        operationId === 'ReceiveRemoteWorkerCallback' ||
        operationId === 'ReloadTrustRegistry' ||
        operationId === 'GetRunSession' ||
        operationId === 'PrepareStepCompletionReceipt' ||
        operationId === 'CommitStepCompletionReceipt',
      getTrustRegistry: () => ({
        registryId: 'workspace-trust-registry',
        version: '2026.03.11',
        loadedAt: '2026-03-11T00:00:00.000Z',
        verification: {
          verifiedAt: '2026-03-11T00:00:00.000Z',
          summary: 'verified',
          checks: [],
        },
        keys: [],
        signerPolicies: [
          { policyId: 'default:remote-worker-advertisement', scope: 'remote-worker-advertisement', enabled: true, requireSignature: false, allowedKeyStatuses: ['active'], allowedRotationGroups: [], allowedKeyIds: [], allowedIssuers: [] },
          { policyId: 'default:benchmark-source-registry', scope: 'benchmark-source-registry', enabled: true, requireSignature: false, allowedKeyStatuses: ['active'], allowedRotationGroups: [], allowedKeyIds: [], allowedIssuers: [] },
        ],
      }),
      listRemoteWorkers: () => ({
        refreshedAt: '2026-03-11T00:00:00.000Z',
        workers: [{
          agentCardVersion: '1.0.0',
          agentCardSchemaVersion: 'a2a.agent-card.v1',
          agentCardPublishedAt: '2026-03-11T00:00:00.000Z',
          agentCardAdvertisementSignatureKeyId: 'interop-signing',
          agentCardAdvertisementSignedAt: '2026-03-11T00:00:00.000Z',
          agentCardSha256: AGENT_CARD_SHA,
          selectedResponseMode: 'poll',
          supportedResponseModes: ['poll', 'inline'],
          taskProtocolSource: 'agent-card',
          verification: { summary: 'verified' },
          health: 'healthy',
        }],
        discoveryIssues: [],
      }),
      hasEventStreaming: () => true,
      hasCheckpointRecovery: () => true,
    }, manifestPath)

    const report = await harness.run({ suiteIds: ['authority-surface'] })

    expect(report.harnessId).toBe('workspace-interop-harness')
    expect(report.manifestVersion).toBe('2026.03.11')
    expect(report.sourcePath).toBe(manifestPath)
    expect(report.suites).toHaveLength(1)
    expect(report.suites[0]?.name).toBe('Workspace Authority Surface')
  })
})
