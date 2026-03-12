import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TrustRegistryStore } from '../trust-registry.js'

describe('TrustRegistryStore', () => {
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

  it('loads lifecycle-managed trust keys and resolves scoped secrets', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-registry-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'remote-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING',
          scopes: ['remote-worker-advertisement'],
          status: 'active',
          validFrom: '2026-03-01T00:00:00.000Z',
          rotationGroup: 'remote-ads',
        },
      ],
      signerPolicies: [
        {
          policyId: 'remote-advertisement-strict',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['remote-ads'],
          allowedKeyIds: ['remote-signing'],
          allowedIssuers: ['antigravity-lab'],
          maxSignatureAgeMs: 60_000,
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    const snapshot = store.load()
    const resolution = store.resolveHmacKey({
      keyId: 'remote-signing',
      issuer: 'antigravity-lab',
      scope: 'remote-worker-advertisement',
      scheme: 'hmac-sha256',
      requiredStatuses: ['active'],
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })
    const policy = store.resolveSignerPolicy({
      scope: 'remote-worker-advertisement',
      policyId: 'remote-advertisement-strict',
    })

    expect(snapshot.verification.summary).toBe('verified')
    expect(snapshot.keys[0]?.status).toBe('active')
    expect(snapshot.keys[0]?.rotationGroup).toBe('remote-ads')
    expect(snapshot.keys[0]?.hasSecret).toBe(true)
    expect(snapshot.signerPolicies.some(candidate => candidate.policyId === 'remote-advertisement-strict')).toBe(true)
    expect(resolution.ok).toBe(true)
    expect(resolution.secret).toBe('remote-signing-secret')
    expect(policy.ok).toBe(true)
    expect(policy.policy?.requireSignature).toBe(true)
    expect(policy.policy?.allowedKeyStatuses).toEqual(['active'])
    expect(policy.policy?.allowedRotationGroups).toEqual(['remote-ads'])
  })

  it('enforces signer policy and key lifecycle through unified signature evaluation', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-signature-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'remote-signing-v2',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING',
          scopes: ['remote-worker-advertisement'],
          status: 'staged',
          validFrom: '2026-03-10T00:00:00.000Z',
          expiresAt: '2026-03-20T00:00:00.000Z',
          rotationGroup: 'remote-ads',
        },
      ],
      signerPolicies: [
        {
          policyId: 'remote-advertisement-rotation',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active', 'staged'],
          allowedRotationGroups: ['remote-ads'],
          allowedKeyIds: ['remote-signing-v2'],
          allowedIssuers: ['antigravity-lab'],
          maxSignatureAgeMs: 60_000,
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    store.load()
    const payload = JSON.stringify({ id: 'remote-verify', capability: 'verification' })
    const signedAt = new Date().toISOString()
    const signature = crypto.createHmac('sha256', 'remote-signing-secret')
      .update(payload)
      .digest('hex')

    const evaluation = store.evaluateHmacSignatureEnvelope({
      scope: 'remote-worker-advertisement',
      payload,
      policyId: 'remote-advertisement-rotation',
      subjectLabel: 'Remote worker remote-verify advertisement',
      checkPrefix: 'agent-card.advertisement.signature',
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'remote-signing-v2',
        issuer: 'antigravity-lab',
        signedAt,
        signature,
      },
    })

    expect(evaluation.ok).toBe(true)
    expect(evaluation.policy?.allowedKeyStatuses).toEqual(['active', 'staged'])
    expect(evaluation.key?.status).toBe('staged')
    expect(evaluation.checks.some(check => check.checkId === 'agent-card.advertisement.signature.key-lifecycle' && check.ok)).toBe(true)
    expect(evaluation.checks.some(check => check.checkId === 'agent-card.advertisement.signature.key-rotation-group' && check.ok)).toBe(true)
    expect(evaluation.checks.some(check => check.checkId === 'agent-card.advertisement.signature.verify' && check.ok)).toBe(true)
  })

  it('rejects signatures whose key rotation group is outside the signer policy', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-rotation-mismatch-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    process.env.ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING = 'remote-signing-secret'
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'remote-signing-v3',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING',
          scopes: ['remote-worker-advertisement'],
          status: 'active',
          rotationGroup: 'remote-ads.secondary',
        },
      ],
      signerPolicies: [
        {
          policyId: 'remote-advertisement-primary-only',
          scope: 'remote-worker-advertisement',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['remote-ads.primary'],
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    store.load()
    const payload = JSON.stringify({ id: 'remote-verify', capability: 'verification' })
    const signedAt = new Date().toISOString()
    const signature = crypto.createHmac('sha256', 'remote-signing-secret')
      .update(payload)
      .digest('hex')

    const evaluation = store.evaluateHmacSignatureEnvelope({
      scope: 'remote-worker-advertisement',
      payload,
      policyId: 'remote-advertisement-primary-only',
      subjectLabel: 'Remote worker remote-verify advertisement',
      checkPrefix: 'agent-card.advertisement.signature',
      signature: {
        scheme: 'hmac-sha256',
        keyId: 'remote-signing-v3',
        issuer: 'antigravity-lab',
        signedAt,
        signature,
      },
    })

    expect(evaluation.ok).toBe(false)
    expect(evaluation.checks.some(check =>
      check.checkId === 'agent-card.advertisement.signature.key-rotation-group' && check.ok === false
    )).toBe(true)
  })

  it('blocks retired keys and missing secrets as explicit lifecycle failures', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-registry-failure-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [
        {
          keyId: 'registry-test',
          issuer: 'benchmark-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_REGISTRY_TEST',
          scopes: ['benchmark-source-registry'],
          status: 'retired',
          expiresAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    const snapshot = store.load()
    const wrongIssuer = store.resolveHmacKey({
      keyId: 'registry-test',
      issuer: 'antigravity-lab',
      scope: 'benchmark-source-registry',
      scheme: 'hmac-sha256',
    })
    const retiredKey = store.resolveHmacKey({
      keyId: 'registry-test',
      issuer: 'benchmark-lab',
      scope: 'benchmark-source-registry',
      scheme: 'hmac-sha256',
      requiredStatuses: ['active'],
      evaluatedAt: '2026-03-11T00:00:00.000Z',
    })

    expect(snapshot.verification.summary).toBe('warning')
    expect(wrongIssuer.ok).toBe(false)
    expect(wrongIssuer.failure).toBe('issuer-mismatch')
    expect(retiredKey.ok).toBe(false)
    expect(retiredKey.failure).toBe('status-mismatch')
  })

  it('exposes trace-bundle as a first-class signer policy scope and can sign payloads', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-trace-bundle-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    process.env.ANTIGRAVITY_TRUST_KEY_TRACE_BUNDLE = 'trace-bundle-secret'
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.12',
      keys: [
        {
          keyId: 'trace-bundle-signing',
          issuer: 'antigravity-lab',
          envVar: 'ANTIGRAVITY_TRUST_KEY_TRACE_BUNDLE',
          scopes: ['trace-bundle'],
          status: 'active',
          rotationGroup: 'trace-bundle.primary',
        },
      ],
      signerPolicies: [
        {
          policyId: 'trace-bundle-strict',
          scope: 'trace-bundle',
          requireSignature: true,
          allowedKeyStatuses: ['active'],
          allowedRotationGroups: ['trace-bundle.primary'],
          allowedKeyIds: ['trace-bundle-signing'],
          allowedIssuers: ['antigravity-lab'],
          enabled: true,
        },
      ],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    const snapshot = store.load()
    const signing = store.signHmacPayload({
      scope: 'trace-bundle',
      policyId: 'trace-bundle-strict',
      payload: JSON.stringify({ bundleDigest: 'abc123' }),
      signedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:trace-bundle')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:release-attestation')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:invariant-report')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:release-dossier')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:release-bundle')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('trace-bundle-strict')
    expect(signing.ok).toBe(true)
    expect(signing.signature?.keyId).toBe('trace-bundle-signing')
    expect(signing.signature?.issuer).toBe('antigravity-lab')
  })

  it('exposes built-in scope defaults when no explicit signer policy is configured', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-trust-registry-default-policy-'))
    const registryPath = path.join(tempDir, 'trust-registry.json')
    fs.writeFileSync(registryPath, JSON.stringify({
      registryId: 'workspace-trust-registry',
      version: '2026.03.11',
      keys: [],
      signerPolicies: [],
    }, null, 2), 'utf8')

    const store = new TrustRegistryStore(registryPath)
    const snapshot = store.load()
    const defaultRemotePolicy = store.resolveSignerPolicy({
      scope: 'remote-worker-advertisement',
    })
    const defaultBenchmarkPolicy = store.resolveSignerPolicy({
      scope: 'benchmark-source-registry',
    })

    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:remote-worker-advertisement')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:benchmark-source-registry')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:invariant-report')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:release-dossier')
    expect(snapshot.signerPolicies.map(policy => policy.policyId)).toContain('default:release-bundle')
    expect(defaultRemotePolicy.ok).toBe(true)
    expect(defaultRemotePolicy.policy?.requireSignature).toBe(false)
    expect(defaultRemotePolicy.policy?.allowedKeyStatuses).toEqual(['active'])
    expect(defaultBenchmarkPolicy.ok).toBe(true)
    expect(defaultBenchmarkPolicy.policy?.requireSignature).toBe(false)
  })
})
