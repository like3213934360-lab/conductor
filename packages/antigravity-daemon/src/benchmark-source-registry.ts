import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import {
  BenchmarkDatasetSourceRegistryFileSchema,
  type BenchmarkDatasetSourceRegistryEntry,
  type BenchmarkDatasetSourceRegistryFile,
  type BenchmarkDatasetSourceRegistryFileInput,
  type BenchmarkDatasetSourceRegistrySignature,
} from './benchmark-dataset.js'
import type {
  BenchmarkSourceRegistrySnapshot,
  BenchmarkSourceRegistryVerification,
  BenchmarkSourceRegistryVerificationCheck,
} from './schema.js'
import { TrustRegistryStore } from './trust-registry.js'

function createCheck(
  checkId: string,
  ok: boolean,
  severity: BenchmarkSourceRegistryVerificationCheck['severity'],
  message: string,
): BenchmarkSourceRegistryVerificationCheck {
  return { checkId, ok, severity, message }
}

function summarizeVerification(
  checks: BenchmarkSourceRegistryVerificationCheck[],
): BenchmarkSourceRegistryVerification['summary'] {
  return checks.some(check => !check.ok && check.severity !== 'info')
    ? 'warning'
    : 'verified'
}

function normalizeTags(tags: string[]): string[] {
  return [...tags].sort((left, right) => left.localeCompare(right))
}

function normalizeSourceForSignature(source: BenchmarkDatasetSourceRegistryEntry): BenchmarkDatasetSourceRegistryEntry {
  return {
    sourceId: source.sourceId,
    location: source.location,
    enabled: source.enabled,
    required: source.required,
    authEnvVar: source.authEnvVar,
    expectedDatasetId: source.expectedDatasetId,
    expectedVersion: source.expectedVersion,
    expectedSha256: source.expectedSha256,
    cacheTtlMs: source.cacheTtlMs,
    allowStaleOnError: source.allowStaleOnError,
    description: source.description,
    tags: normalizeTags(source.tags),
    locked: source.locked,
  }
}

function serializeRegistryPayload(
  file: Pick<BenchmarkDatasetSourceRegistryFileInput, 'registryId' | 'version' | 'trustPolicyId' | 'sources'>,
): string {
  const normalized = BenchmarkDatasetSourceRegistryFileSchema.parse({
    registryId: file.registryId,
    version: file.version,
    trustPolicyId: file.trustPolicyId,
    sources: file.sources,
  })
  return JSON.stringify({
    registryId: normalized.registryId,
    version: normalized.version,
    trustPolicyId: normalized.trustPolicyId,
    sources: normalized.sources
      .map(normalizeSourceForSignature)
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
  })
}

function digestRegistryPayload(payload: string): string {
  return crypto.createHash('sha256').update(payload).digest('hex')
}

function createVerification(
  parsed: BenchmarkDatasetSourceRegistryFile | null,
  payloadDigestSha256: string | undefined,
  trustRegistry: TrustRegistryStore,
): BenchmarkSourceRegistryVerification {
  const verifiedAt = new Date().toISOString()
  const checks: BenchmarkSourceRegistryVerificationCheck[] = []
  const trustPolicy = trustRegistry.resolveSignerPolicy({
    scope: 'benchmark-source-registry',
    policyId: parsed?.trustPolicyId,
  })

  if (!parsed) {
    checks.push(createCheck(
      'registry.present',
      true,
      'info',
      'No benchmark source registry file configured in the workspace.',
    ))
    return {
      verifiedAt,
      summary: 'verified',
      checks,
    }
  }

  checks.push(createCheck(
    'registry.present',
    true,
    'info',
    `Loaded benchmark source registry ${parsed.registryId} v${parsed.version}.`,
  ))
  checks.push(createCheck(
    'registry.signer-policy',
    trustPolicy.ok,
    trustPolicy.ok ? 'info' : 'error',
    trustPolicy.message,
  ))
  checks.push(createCheck(
    'registry.digest',
    Boolean(payloadDigestSha256),
    'info',
    payloadDigestSha256
      ? `Registry digest computed as ${payloadDigestSha256}.`
      : 'Registry digest unavailable.',
  ))
  checks.push(createCheck(
    'registry.signer-policy-id',
    Boolean(trustPolicy.policy?.policyId),
    trustPolicy.policy ? 'info' : 'error',
    trustPolicy.policy
      ? `Benchmark source registry signer policy is ${trustPolicy.policy.policyId}.`
      : `Benchmark source registry signer policy ${parsed.trustPolicyId} could not be resolved.`,
  ))
  const signatureEvaluation = trustRegistry.evaluateHmacSignatureEnvelope({
    scope: 'benchmark-source-registry',
    payload: serializeRegistryPayload(parsed),
    signature: parsed.signature as BenchmarkDatasetSourceRegistrySignature | undefined,
    policyId: parsed.trustPolicyId,
    subjectLabel: `Benchmark source registry ${parsed.registryId}`,
    checkPrefix: 'registry.signature',
    requireSignature: parsed.sources.some(source => source.locked),
  })
  checks.push(...signatureEvaluation.checks.map(check =>
    createCheck(check.checkId, check.ok, check.severity, check.message),
  ))

  return {
    verifiedAt,
    summary: summarizeVerification(checks),
    checks,
  }
}

function createEmptySnapshot(
  registryPath: string,
  trustRegistry: TrustRegistryStore,
): BenchmarkSourceRegistrySnapshot {
  return {
    registryId: 'workspace-benchmark-source-registry',
    version: '1.0.0',
    sourcePath: fs.existsSync(registryPath) ? registryPath : undefined,
    loadedAt: new Date().toISOString(),
    trustPolicyId: 'default:benchmark-source-registry',
    verification: createVerification(null, undefined, trustRegistry),
    sources: [],
  }
}

function mapSnapshotSource(source: BenchmarkDatasetSourceRegistryEntry): BenchmarkSourceRegistrySnapshot['sources'][number] {
  return {
    sourceId: source.sourceId,
    location: source.location,
    enabled: source.enabled,
    required: source.required,
    authEnvVar: source.authEnvVar,
    expectedDatasetId: source.expectedDatasetId,
    expectedVersion: source.expectedVersion,
    expectedSha256: source.expectedSha256,
    cacheTtlMs: source.cacheTtlMs,
    allowStaleOnError: source.allowStaleOnError,
    description: source.description,
    tags: source.tags,
    locked: source.locked,
  }
}

export function signBenchmarkSourceRegistryPayload(
  file: Pick<BenchmarkDatasetSourceRegistryFileInput, 'registryId' | 'version' | 'trustPolicyId' | 'sources'>,
  secret: string,
): string {
  return crypto.createHmac('sha256', secret).update(serializeRegistryPayload(file)).digest('hex')
}

export function loadBenchmarkSourceRegistryFile(
  registryPath: string,
  trustRegistry: TrustRegistryStore,
): BenchmarkSourceRegistrySnapshot {
  if (!fs.existsSync(registryPath)) {
    return createEmptySnapshot(registryPath, trustRegistry)
  }

  const raw = fs.readFileSync(registryPath, 'utf8').trim()
  if (!raw) {
    return createEmptySnapshot(registryPath, trustRegistry)
  }

  const parsed = BenchmarkDatasetSourceRegistryFileSchema.parse(JSON.parse(raw))
  const payloadDigestSha256 = digestRegistryPayload(serializeRegistryPayload(parsed))
  return {
    registryId: parsed.registryId,
    version: parsed.version,
    sourcePath: registryPath,
    loadedAt: new Date().toISOString(),
    trustPolicyId: parsed.trustPolicyId,
    digestSha256: payloadDigestSha256,
    signature: parsed.signature ? {
      scheme: parsed.signature.scheme,
      keyId: parsed.signature.keyId,
      issuer: parsed.signature.issuer,
      signedAt: parsed.signature.signedAt,
    } : undefined,
    verification: createVerification(parsed, payloadDigestSha256, trustRegistry),
    sources: parsed.sources.map(mapSnapshotSource),
  }
}

export class BenchmarkSourceRegistryStore {
  private snapshot: BenchmarkSourceRegistrySnapshot

  constructor(
    private readonly registryPath: string,
    private readonly trustRegistry: TrustRegistryStore,
  ) {
    this.snapshot = loadBenchmarkSourceRegistryFile(registryPath, trustRegistry)
  }

  load(): BenchmarkSourceRegistrySnapshot {
    this.snapshot = loadBenchmarkSourceRegistryFile(this.registryPath, this.trustRegistry)
    return this.snapshot
  }

  reload(): BenchmarkSourceRegistrySnapshot {
    return this.load()
  }

  getSnapshot(): BenchmarkSourceRegistrySnapshot {
    return this.snapshot
  }

  asMap(): Map<string, BenchmarkDatasetSourceRegistryEntry> {
    return new Map(this.snapshot.sources.map(source => [source.sourceId, {
      sourceId: source.sourceId,
      location: source.location,
      enabled: source.enabled,
      required: source.required,
      authEnvVar: source.authEnvVar,
      expectedDatasetId: source.expectedDatasetId,
      expectedVersion: source.expectedVersion,
      expectedSha256: source.expectedSha256,
      cacheTtlMs: source.cacheTtlMs,
      allowStaleOnError: source.allowStaleOnError,
      description: source.description,
      tags: source.tags,
      locked: source.locked,
    }]))
  }
}
