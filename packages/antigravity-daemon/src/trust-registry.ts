import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import { z } from 'zod'
import type {
  TrustRegistryKeySnapshot,
  TrustRegistryKeyStatus,
  TrustRegistryScope,
  TrustRegistrySignerPolicySnapshot,
  TrustRegistrySnapshot,
  TrustRegistryVerification,
  TrustRegistryVerificationCheck,
} from './schema.js'

const TrustRegistryScopeFileSchema = z.enum([
  'remote-worker-advertisement',
  'benchmark-source-registry',
  'trace-bundle',
  'release-attestation',
  'invariant-report',
  'policy-report',
  'release-dossier',
  'release-bundle',
  'certification-record',
])

const TrustRegistryKeyStatusFileSchema = z.enum([
  'active',
  'staged',
  'retired',
])

export const TrustRegistryFileKeySchema = z.object({
  keyId: z.string().min(1),
  scheme: z.literal('hmac-sha256').default('hmac-sha256'),
  issuer: z.string().min(1).optional(),
  envVar: z.string().min(1).optional(),
  description: z.string().optional(),
  scopes: z.array(TrustRegistryScopeFileSchema).default([]),
  status: TrustRegistryKeyStatusFileSchema.default('active'),
  validFrom: z.string().optional(),
  expiresAt: z.string().optional(),
  rotationGroup: z.string().min(1).optional(),
})

export type TrustRegistryFileKey = z.infer<typeof TrustRegistryFileKeySchema>

export const TrustRegistryFileSignerPolicySchema = z.object({
  policyId: z.string().min(1),
  scope: TrustRegistryScopeFileSchema,
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  requireSignature: z.boolean().default(false),
  allowedKeyStatuses: z.array(TrustRegistryKeyStatusFileSchema).default(['active']),
  allowedRotationGroups: z.array(z.string().min(1)).default([]),
  allowedKeyIds: z.array(z.string().min(1)).default([]),
  allowedIssuers: z.array(z.string().min(1)).default([]),
  maxSignatureAgeMs: z.number().int().positive().optional(),
})

export type TrustRegistryFileSignerPolicy = z.infer<typeof TrustRegistryFileSignerPolicySchema>

export const DEFAULT_SIGNER_POLICY_IDS: Record<TrustRegistryScope, string> = {
  'remote-worker-advertisement': 'default:remote-worker-advertisement',
  'benchmark-source-registry': 'default:benchmark-source-registry',
  'trace-bundle': 'default:trace-bundle',
  'release-attestation': 'default:release-attestation',
  'invariant-report': 'default:invariant-report',
  'policy-report': 'default:policy-report',
  'release-dossier': 'default:release-dossier',
  'release-bundle': 'default:release-bundle',
  'certification-record': 'default:certification-record',
}

const DEFAULT_SIGNER_POLICIES: TrustRegistryFileSignerPolicy[] = [
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['remote-worker-advertisement'],
    scope: 'remote-worker-advertisement',
    description: 'Default signer policy for remote worker advertisement verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['benchmark-source-registry'],
    scope: 'benchmark-source-registry',
    description: 'Default signer policy for benchmark source registry verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['trace-bundle'],
    scope: 'trace-bundle',
    description: 'Default signer policy for trace bundle signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['release-attestation'],
    scope: 'release-attestation',
    description: 'Default signer policy for release attestation signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['invariant-report'],
    scope: 'invariant-report',
    description: 'Default signer policy for invariant report signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['policy-report'],
    scope: 'policy-report',
    description: 'Default signer policy for policy report signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['release-dossier'],
    scope: 'release-dossier',
    description: 'Default signer policy for release dossier signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['release-bundle'],
    scope: 'release-bundle',
    description: 'Default signer policy for release bundle signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
  {
    policyId: DEFAULT_SIGNER_POLICY_IDS['certification-record'],
    scope: 'certification-record',
    description: 'Default signer policy for certification record signing and verification.',
    enabled: true,
    requireSignature: false,
    allowedKeyStatuses: ['active'],
    allowedRotationGroups: [],
    allowedKeyIds: [],
    allowedIssuers: [],
  },
]

export const TrustRegistryFileSchema = z.object({
  registryId: z.string().default('workspace-trust-registry'),
  version: z.string().default('1.0.0'),
  keys: z.array(TrustRegistryFileKeySchema).default([]),
  signerPolicies: z.array(TrustRegistryFileSignerPolicySchema).default([]),
})

export type TrustRegistryFile = z.infer<typeof TrustRegistryFileSchema>
export type TrustRegistryFileInput = z.input<typeof TrustRegistryFileSchema>

export type TrustKeyLookupFailure =
  | 'not-found'
  | 'issuer-mismatch'
  | 'scope-mismatch'
  | 'status-mismatch'
  | 'not-yet-valid'
  | 'expired'
  | 'missing-env-var'
  | 'missing-secret'

export interface TrustKeyLookupResult {
  ok: boolean
  failure?: TrustKeyLookupFailure
  key?: TrustRegistryKeySnapshot
  secret?: string
  message: string
}

export type TrustSignerPolicyLookupFailure =
  | 'not-found'
  | 'scope-mismatch'
  | 'disabled'

export interface TrustSignerPolicyLookupResult {
  ok: boolean
  failure?: TrustSignerPolicyLookupFailure
  policy?: TrustRegistrySignerPolicySnapshot
  message: string
}

interface ResolveTrustKeyOptions {
  keyId: string
  scheme: 'hmac-sha256'
  scope: TrustRegistryScope
  issuer?: string
  requiredStatuses?: TrustRegistryKeyStatus[]
  evaluatedAt?: string
}

interface ResolveSignerPolicyOptions {
  scope: TrustRegistryScope
  policyId?: string
}

export interface HmacSignatureEnvelope {
  scheme: 'hmac-sha256'
  keyId: string
  issuer?: string
  signedAt: string
  signature: string
}

export interface TrustSignatureEvaluationCheck {
  checkId: string
  ok: boolean
  severity: TrustRegistryVerificationCheck['severity']
  message: string
}

export interface EvaluateHmacSignatureEnvelopeOptions {
  scope: TrustRegistryScope
  payload: string
  signature?: HmacSignatureEnvelope
  policyId?: string
  subjectLabel: string
  checkPrefix: string
  requireSignature?: boolean
}

export interface TrustSignatureEvaluationResult {
  ok: boolean
  signatureRequired: boolean
  policy?: TrustRegistrySignerPolicySnapshot
  key?: TrustRegistryKeySnapshot
  checks: TrustSignatureEvaluationCheck[]
}

export interface SignHmacPayloadOptions {
  scope: TrustRegistryScope
  payload: string
  policyId?: string
  signedAt?: string
}

export interface TrustSigningResult {
  ok: boolean
  signatureRequired: boolean
  policy?: TrustRegistrySignerPolicySnapshot
  key?: TrustRegistryKeySnapshot
  signature?: HmacSignatureEnvelope
  checks: TrustSignatureEvaluationCheck[]
  message: string
}

function createCheck(
  checkId: string,
  ok: boolean,
  severity: TrustRegistryVerificationCheck['severity'],
  message: string,
): TrustRegistryVerificationCheck {
  return { checkId, ok, severity, message }
}

function createSignatureCheck(
  checkId: string,
  ok: boolean,
  severity: TrustRegistryVerificationCheck['severity'],
  message: string,
): TrustSignatureEvaluationCheck {
  return { checkId, ok, severity, message }
}

function summarizeVerification(
  checks: TrustRegistryVerificationCheck[],
): TrustRegistryVerification['summary'] {
  return checks.some(check => !check.ok && check.severity !== 'info')
    ? 'warning'
    : 'verified'
}

function summarizeSignatureEvaluation(
  checks: TrustSignatureEvaluationCheck[],
): boolean {
  return checks.every(check => check.ok || check.severity === 'info')
}

function parseDateValue(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function describeKeyStatuses(statuses: TrustRegistryKeyStatus[]): string {
  return statuses.join(', ')
}

function statusPriority(status: TrustRegistryKeyStatus): number {
  switch (status) {
    case 'active':
      return 0
    case 'staged':
      return 1
    case 'retired':
      return 2
  }
}

function toSnapshotKey(key: TrustRegistryFileKey): TrustRegistryKeySnapshot {
  return {
    keyId: key.keyId,
    scheme: key.scheme,
    issuer: key.issuer,
    envVar: key.envVar,
    description: key.description,
    scopes: key.scopes,
    status: key.status,
    validFrom: key.validFrom,
    expiresAt: key.expiresAt,
    rotationGroup: key.rotationGroup,
    hasSecret: Boolean(key.envVar && process.env[key.envVar]),
  }
}

function toSnapshotSignerPolicy(policy: TrustRegistryFileSignerPolicy): TrustRegistrySignerPolicySnapshot {
  return {
    policyId: policy.policyId,
    scope: policy.scope,
    description: policy.description,
    enabled: policy.enabled,
    requireSignature: policy.requireSignature,
    allowedKeyStatuses: [...policy.allowedKeyStatuses],
    allowedRotationGroups: [...policy.allowedRotationGroups],
    allowedKeyIds: [...policy.allowedKeyIds],
    allowedIssuers: [...policy.allowedIssuers],
    maxSignatureAgeMs: policy.maxSignatureAgeMs,
  }
}

function buildSignerPolicies(parsed: TrustRegistryFile | null): TrustRegistrySignerPolicySnapshot[] {
  const policies = new Map<string, TrustRegistrySignerPolicySnapshot>()
  for (const policy of DEFAULT_SIGNER_POLICIES) {
    policies.set(policy.policyId, toSnapshotSignerPolicy(policy))
  }
  for (const policy of parsed?.signerPolicies ?? []) {
    policies.set(policy.policyId, toSnapshotSignerPolicy(policy))
  }
  return [...policies.values()].sort((left, right) => {
    if (left.scope === right.scope) {
      return left.policyId.localeCompare(right.policyId)
    }
    return left.scope.localeCompare(right.scope)
  })
}

function isKeyValidAt(key: Pick<TrustRegistryKeySnapshot, 'validFrom' | 'expiresAt'>, evaluatedAtMs: number): boolean {
  const validFrom = parseDateValue(key.validFrom)
  if (validFrom !== null && evaluatedAtMs < validFrom) {
    return false
  }
  const expiresAt = parseDateValue(key.expiresAt)
  if (expiresAt !== null && evaluatedAtMs > expiresAt) {
    return false
  }
  return true
}

function sortKeysForResolution(keys: TrustRegistryKeySnapshot[]): TrustRegistryKeySnapshot[] {
  return [...keys].sort((left, right) => {
    if (left.keyId !== right.keyId) {
      return left.keyId.localeCompare(right.keyId)
    }
    if ((left.issuer ?? '') !== (right.issuer ?? '')) {
      return (left.issuer ?? '').localeCompare(right.issuer ?? '')
    }
    const statusOrder = statusPriority(left.status) - statusPriority(right.status)
    if (statusOrder !== 0) {
      return statusOrder
    }
    return (left.validFrom ?? '').localeCompare(right.validFrom ?? '')
  })
}

function createVerification(parsed: TrustRegistryFile | null): TrustRegistryVerification {
  const verifiedAt = new Date().toISOString()
  const checks: TrustRegistryVerificationCheck[] = []
  const policies = buildSignerPolicies(parsed)
  const evaluatedAtMs = Date.parse(verifiedAt)

  if (!parsed) {
    checks.push(createCheck(
      'trust-registry.present',
      true,
      'info',
      'No trust registry configured in the workspace. Daemon defaults still expose signer policy scopes, but signed benchmark sources and signed remote worker advertisements require explicit trust registry keys.',
    ))
    checks.push(createCheck(
      'trust-registry.policy-count',
      true,
      'info',
      `Trust registry exposes ${policies.length} built-in signer policy scope(s).`,
    ))
    return {
      verifiedAt,
      summary: 'verified',
      checks,
    }
  }

  const keys = parsed.keys.map(toSnapshotKey)
  checks.push(createCheck(
    'trust-registry.present',
    true,
    'info',
    `Loaded trust registry ${parsed.registryId} v${parsed.version}.`,
  ))
  checks.push(createCheck(
    'trust-registry.key-count',
    true,
    'info',
    `Trust registry declares ${keys.length} key(s).`,
  ))
  checks.push(createCheck(
    'trust-registry.policy-count',
    true,
    'info',
    `Trust registry exposes ${policies.length} signer policy scope(s).`,
  ))

  const identities = new Set<string>()
  for (const key of keys) {
    const identity = `${key.scheme}:${key.keyId}:${key.issuer ?? 'default'}`
    const unique = !identities.has(identity)
    identities.add(identity)
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.unique`,
      unique,
      unique ? 'info' : 'error',
      unique
        ? `Trust key ${key.keyId} is uniquely declared.`
        : `Duplicate trust key declaration for ${key.keyId}.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.scopes`,
      key.scopes.length > 0,
      key.scopes.length > 0 ? 'info' : 'warn',
      key.scopes.length > 0
        ? `Trust key ${key.keyId} scopes: ${key.scopes.join(', ')}.`
        : `Trust key ${key.keyId} has no declared scopes.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.status`,
      true,
      'info',
      `Trust key ${key.keyId} lifecycle status is ${key.status}.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.valid-from`,
      !key.validFrom || parseDateValue(key.validFrom) !== null,
      !key.validFrom || parseDateValue(key.validFrom) !== null ? 'info' : 'error',
      key.validFrom
        ? `Trust key ${key.keyId} validFrom is ${key.validFrom}.`
        : `Trust key ${key.keyId} does not declare validFrom.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.expires-at`,
      !key.expiresAt || parseDateValue(key.expiresAt) !== null,
      !key.expiresAt || parseDateValue(key.expiresAt) !== null ? 'info' : 'error',
      key.expiresAt
        ? `Trust key ${key.keyId} expiresAt is ${key.expiresAt}.`
        : `Trust key ${key.keyId} does not declare expiresAt.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.window`,
      isKeyValidAt(key, evaluatedAtMs),
      isKeyValidAt(key, evaluatedAtMs) ? 'info' : 'warn',
      isKeyValidAt(key, evaluatedAtMs)
        ? `Trust key ${key.keyId} is valid at ${verifiedAt}.`
        : `Trust key ${key.keyId} is outside its declared validity window at ${verifiedAt}.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.env-var`,
      Boolean(key.envVar),
      key.envVar ? 'info' : 'warn',
      key.envVar
        ? `Trust key ${key.keyId} resolves secrets from ${key.envVar}.`
        : `Trust key ${key.keyId} does not declare envVar.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.secret`,
      Boolean(key.hasSecret),
      key.hasSecret ? 'info' : 'warn',
      key.hasSecret
        ? `Trust key ${key.keyId} secret is present in ${key.envVar}.`
        : `Trust key ${key.keyId} secret is missing from ${key.envVar ?? 'the configured env var'}.`,
    ))
    checks.push(createCheck(
      `trust-registry.key.${key.keyId}.rotation-group`,
      true,
      'info',
      key.rotationGroup
        ? `Trust key ${key.keyId} belongs to rotation group ${key.rotationGroup}.`
        : `Trust key ${key.keyId} does not declare a rotation group.`,
    ))
  }

  const policyIdentities = new Set<string>()
  for (const policy of policies) {
    const identity = `${policy.scope}:${policy.policyId}`
    const unique = !policyIdentities.has(identity)
    policyIdentities.add(identity)
    const scopedKeys = keys.filter(key => key.scopes.includes(policy.scope))
    const allowedStatuses: TrustRegistryKeyStatus[] = policy.allowedKeyStatuses.length > 0
      ? [...policy.allowedKeyStatuses]
      : ['active']
    const lifecycleScopedKeys = scopedKeys.filter(key => allowedStatuses.includes(key.status))
    const allowedKeyIds = policy.allowedKeyIds.length === 0
      ? lifecycleScopedKeys.map(key => key.keyId)
      : policy.allowedKeyIds
    const resolvableAllowedKeys = allowedKeyIds.filter(keyId =>
      lifecycleScopedKeys.some(key => key.keyId === keyId),
    )

    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.unique`,
      unique,
      unique ? 'info' : 'error',
      unique
        ? `Signer policy ${policy.policyId} is uniquely declared for ${policy.scope}.`
        : `Duplicate signer policy declaration for ${policy.policyId} in ${policy.scope}.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.enabled`,
      policy.enabled,
      policy.enabled ? 'info' : 'warn',
      policy.enabled
        ? `Signer policy ${policy.policyId} is enabled.`
        : `Signer policy ${policy.policyId} is disabled.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.signature-mode`,
      true,
      'info',
      policy.requireSignature
        ? `Signer policy ${policy.policyId} requires signatures.`
        : `Signer policy ${policy.policyId} does not require signatures.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.key-statuses`,
      allowedStatuses.length > 0,
      'info',
      `Signer policy ${policy.policyId} allows key statuses: ${describeKeyStatuses(allowedStatuses)}.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.rotation-groups`,
      true,
      'info',
      policy.allowedRotationGroups.length === 0
        ? `Signer policy ${policy.policyId} allows any rotation group.`
        : `Signer policy ${policy.policyId} allows rotation groups: ${policy.allowedRotationGroups.join(', ')}.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.allowed-keys`,
      policy.allowedKeyIds.length === 0 || resolvableAllowedKeys.length > 0,
      policy.allowedKeyIds.length === 0 || resolvableAllowedKeys.length > 0 ? 'info' : 'warn',
      policy.allowedKeyIds.length === 0
        ? `Signer policy ${policy.policyId} allows any key scoped to ${policy.scope} with statuses ${describeKeyStatuses(allowedStatuses)}.`
        : `Signer policy ${policy.policyId} allows keys: ${policy.allowedKeyIds.join(', ')}.`,
    ))
    checks.push(createCheck(
      `trust-registry.policy.${policy.policyId}.max-signature-age`,
      !policy.maxSignatureAgeMs || policy.maxSignatureAgeMs > 0,
      !policy.maxSignatureAgeMs || policy.maxSignatureAgeMs > 0 ? 'info' : 'error',
      policy.maxSignatureAgeMs
        ? `Signer policy ${policy.policyId} max signature age: ${policy.maxSignatureAgeMs}ms.`
        : `Signer policy ${policy.policyId} has no signature age ceiling.`,
    ))
  }

  return {
    verifiedAt,
    summary: summarizeVerification(checks),
    checks,
  }
}

function createEmptySnapshot(registryPath: string): TrustRegistrySnapshot {
  return {
    registryId: 'workspace-trust-registry',
    version: '1.0.0',
    sourcePath: fs.existsSync(registryPath) ? registryPath : undefined,
    loadedAt: new Date().toISOString(),
    verification: createVerification(null),
    keys: [],
    signerPolicies: buildSignerPolicies(null),
  }
}

export function loadTrustRegistryFile(registryPath: string): TrustRegistrySnapshot {
  if (!fs.existsSync(registryPath)) {
    return createEmptySnapshot(registryPath)
  }

  const raw = fs.readFileSync(registryPath, 'utf8').trim()
  if (!raw) {
    return createEmptySnapshot(registryPath)
  }

  const parsed = TrustRegistryFileSchema.parse(JSON.parse(raw))
  return {
    registryId: parsed.registryId,
    version: parsed.version,
    sourcePath: registryPath,
    loadedAt: new Date().toISOString(),
    verification: createVerification(parsed),
    keys: parsed.keys.map(toSnapshotKey),
    signerPolicies: buildSignerPolicies(parsed),
  }
}

function getDefaultSignerPolicyId(scope: TrustRegistryScope): string {
  return DEFAULT_SIGNER_POLICY_IDS[scope]
}

export class TrustRegistryStore {
  private snapshot: TrustRegistrySnapshot

  constructor(private readonly registryPath: string) {
    this.snapshot = loadTrustRegistryFile(registryPath)
  }

  load(): TrustRegistrySnapshot {
    this.snapshot = loadTrustRegistryFile(this.registryPath)
    return this.snapshot
  }

  reload(): TrustRegistrySnapshot {
    return this.load()
  }

  getSnapshot(): TrustRegistrySnapshot {
    return this.snapshot
  }

  resolveSignerPolicy(options: ResolveSignerPolicyOptions): TrustSignerPolicyLookupResult {
    const resolvedPolicyId = options.policyId ?? getDefaultSignerPolicyId(options.scope)
    const policy = this.snapshot.signerPolicies.find(candidate => candidate.policyId === resolvedPolicyId)
    if (!policy) {
      return {
        ok: false,
        failure: 'not-found',
        message: `Trust registry does not declare signer policy ${resolvedPolicyId} for ${options.scope}.`,
      }
    }

    if (policy.scope !== options.scope) {
      return {
        ok: false,
        failure: 'scope-mismatch',
        message: `Signer policy ${resolvedPolicyId} is scoped for ${policy.scope}, not ${options.scope}.`,
      }
    }

    if (!policy.enabled) {
      return {
        ok: false,
        failure: 'disabled',
        policy,
        message: `Signer policy ${resolvedPolicyId} is disabled for ${options.scope}.`,
      }
    }

    return {
      ok: true,
      policy,
      message: `Signer policy ${resolvedPolicyId} resolved for ${options.scope}.`,
    }
  }

  resolveHmacKey(options: ResolveTrustKeyOptions): TrustKeyLookupResult {
    const candidates = sortKeysForResolution(this.snapshot.keys.filter(key =>
      key.scheme === options.scheme &&
      key.keyId === options.keyId,
    ))
    if (candidates.length === 0) {
      return {
        ok: false,
        failure: 'not-found',
        message: `Trust registry does not declare keyId ${options.keyId} for ${options.scope}.`,
      }
    }

    const issuerMatched = options.issuer
      ? candidates.filter(key => key.issuer === options.issuer)
      : candidates
    if (options.issuer && issuerMatched.length === 0) {
      return {
        ok: false,
        failure: 'issuer-mismatch',
        message: `Trust registry keyId ${options.keyId} does not allow issuer ${options.issuer}.`,
      }
    }

    const scopeMatched = issuerMatched.filter(key => key.scopes.includes(options.scope))
    if (scopeMatched.length === 0) {
      return {
        ok: false,
        failure: 'scope-mismatch',
        message: `Trust registry keyId ${options.keyId} is not scoped for ${options.scope}.`,
      }
    }

    const requiredStatuses: TrustRegistryKeyStatus[] = options.requiredStatuses && options.requiredStatuses.length > 0
      ? [...options.requiredStatuses]
      : ['active']
    const statusMatched = scopeMatched.filter(key => requiredStatuses.includes(key.status))
    if (statusMatched.length === 0) {
      return {
        ok: false,
        failure: 'status-mismatch',
        message: `Trust registry keyId ${options.keyId} is scoped for ${options.scope}, but no key is in allowed statuses ${describeKeyStatuses(requiredStatuses)}.`,
      }
    }

    const evaluatedAtMs = parseDateValue(options.evaluatedAt) ?? Date.now()
    const validAtWindow = statusMatched.filter(key => isKeyValidAt(key, evaluatedAtMs))
    if (validAtWindow.length === 0) {
      const hasFutureWindow = statusMatched.some(key => {
        const validFrom = parseDateValue(key.validFrom)
        return validFrom !== null && evaluatedAtMs < validFrom
      })
      return {
        ok: false,
        failure: hasFutureWindow ? 'not-yet-valid' : 'expired',
        key: statusMatched[0],
        message: hasFutureWindow
          ? `Trust registry keyId ${options.keyId} is not yet valid for ${options.scope} at ${options.evaluatedAt ?? new Date(evaluatedAtMs).toISOString()}.`
          : `Trust registry keyId ${options.keyId} is outside its validity window for ${options.scope} at ${options.evaluatedAt ?? new Date(evaluatedAtMs).toISOString()}.`,
      }
    }

    const selectedKey = validAtWindow[0]
    if (!selectedKey) {
      return {
        ok: false,
        failure: 'expired',
        message: `Trust registry keyId ${options.keyId} could not resolve a valid key candidate for ${options.scope}.`,
      }
    }
    if (!selectedKey.envVar) {
      return {
        ok: false,
        failure: 'missing-env-var',
        key: selectedKey,
        message: `Trust registry keyId ${options.keyId} is ${selectedKey.status} but has no envVar.`,
      }
    }

    const secret = process.env[selectedKey.envVar]
    if (!secret) {
      return {
        ok: false,
        failure: 'missing-secret',
        key: selectedKey,
        message: `Trust registry keyId ${options.keyId} expects secret ${selectedKey.envVar}, but it is missing.`,
      }
    }

    return {
      ok: true,
      key: selectedKey,
      secret,
      message: `Trust registry keyId ${options.keyId} resolved for ${options.scope} with lifecycle status ${selectedKey.status}.`,
    }
  }

  evaluateHmacSignatureEnvelope(options: EvaluateHmacSignatureEnvelopeOptions): TrustSignatureEvaluationResult {
    const checks: TrustSignatureEvaluationCheck[] = []
    const policyLookup = this.resolveSignerPolicy({
      scope: options.scope,
      policyId: options.policyId,
    })
    const policy = policyLookup.policy
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.policy`,
      policyLookup.ok,
      policyLookup.ok ? 'info' : 'error',
      policyLookup.message,
    ))

    const allowedKeyStatuses: TrustRegistryKeyStatus[] = policy?.allowedKeyStatuses.length
      ? [...policy.allowedKeyStatuses]
      : ['active']
    const allowedRotationGroups = policy?.allowedRotationGroups.length
      ? [...policy.allowedRotationGroups]
      : []
    const signatureRequired = Boolean(options.requireSignature || policy?.requireSignature)

    checks.push(createSignatureCheck(
      `${options.checkPrefix}.policy-key-status`,
      true,
      'info',
      `Signer policy ${policy?.policyId ?? options.policyId ?? getDefaultSignerPolicyId(options.scope)} allows key statuses: ${describeKeyStatuses(allowedKeyStatuses)}.`,
    ))
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.policy-rotation-group`,
      true,
      'info',
      allowedRotationGroups.length === 0
        ? `Signer policy ${policy?.policyId ?? options.policyId ?? getDefaultSignerPolicyId(options.scope)} allows any rotation group.`
        : `Signer policy ${policy?.policyId ?? options.policyId ?? getDefaultSignerPolicyId(options.scope)} requires rotation groups: ${allowedRotationGroups.join(', ')}.`,
    ))

    if (!options.signature) {
      checks.push(createSignatureCheck(
        `${options.checkPrefix}.present`,
        !signatureRequired,
        signatureRequired ? 'error' : 'warn',
        signatureRequired
          ? `${options.subjectLabel} is missing signature metadata.`
          : `${options.subjectLabel} is unsigned; provenance is not cryptographically verified.`,
      ))
      return {
        ok: summarizeSignatureEvaluation(checks),
        signatureRequired,
        policy,
        checks,
      }
    }

    checks.push(createSignatureCheck(
      `${options.checkPrefix}.scheme`,
      options.signature.scheme === 'hmac-sha256',
      options.signature.scheme === 'hmac-sha256' ? 'info' : 'error',
      `${options.subjectLabel} signature scheme is ${options.signature.scheme}.`,
    ))
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.key-id`,
      Boolean(options.signature.keyId && options.signature.keyId.trim()),
      options.signature.keyId && options.signature.keyId.trim() ? 'info' : 'error',
      `${options.subjectLabel} signature key id is ${options.signature.keyId || 'missing'}.`,
    ))
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.issuer`,
      !options.signature.issuer || options.signature.issuer.trim().length > 0,
      !options.signature.issuer || options.signature.issuer.trim().length > 0 ? 'info' : 'error',
      options.signature.issuer
        ? `${options.subjectLabel} signature issuer is ${options.signature.issuer}.`
        : `${options.subjectLabel} signature does not declare an issuer.`,
    ))
    const signatureSignedAt = parseDateValue(options.signature.signedAt)
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.signed-at`,
      signatureSignedAt !== null,
      signatureSignedAt !== null ? 'info' : 'error',
      `${options.subjectLabel} signature signedAt is ${options.signature.signedAt}.`,
    ))

    checks.push(createSignatureCheck(
      `${options.checkPrefix}.policy-key-id`,
      !policy
        || policy.allowedKeyIds.length === 0
        || policy.allowedKeyIds.includes(options.signature.keyId),
      !policy
        || policy.allowedKeyIds.length === 0
        || policy.allowedKeyIds.includes(options.signature.keyId)
        ? 'info'
        : 'error',
      !policy || policy.allowedKeyIds.length === 0
        ? `Signer policy ${policy?.policyId ?? options.policyId ?? getDefaultSignerPolicyId(options.scope)} allows any scoped key.`
        : `Signer policy ${policy.policyId} requires key ids: ${policy.allowedKeyIds.join(', ')}.`,
    ))
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.policy-issuer`,
      !policy
        || policy.allowedIssuers.length === 0
        || (options.signature.issuer ? policy.allowedIssuers.includes(options.signature.issuer) : false),
      !policy
        || policy.allowedIssuers.length === 0
        || (options.signature.issuer ? policy.allowedIssuers.includes(options.signature.issuer) : false)
        ? 'info'
        : 'error',
      !policy || policy.allowedIssuers.length === 0
        ? `Signer policy ${policy?.policyId ?? options.policyId ?? getDefaultSignerPolicyId(options.scope)} allows any issuer.`
        : `Signer policy ${policy.policyId} requires issuers: ${policy.allowedIssuers.join(', ')}.`,
    ))

    if (policy?.maxSignatureAgeMs && signatureSignedAt !== null) {
      const signatureAge = Date.now() - signatureSignedAt
      checks.push(createSignatureCheck(
        `${options.checkPrefix}.max-age`,
        signatureAge <= policy.maxSignatureAgeMs,
        signatureAge <= policy.maxSignatureAgeMs ? 'info' : 'error',
        `Signer policy ${policy.policyId} signature age budget is ${policy.maxSignatureAgeMs}ms.`,
      ))
    }

    const keyLookup = this.resolveHmacKey({
      keyId: options.signature.keyId,
      issuer: options.signature.issuer,
      scope: options.scope,
      scheme: 'hmac-sha256',
      requiredStatuses: allowedKeyStatuses,
      evaluatedAt: options.signature.signedAt,
    })
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.trust-registry`,
      keyLookup.ok,
      keyLookup.ok ? 'info' : 'error',
      keyLookup.message,
    ))

    if (keyLookup.key) {
      checks.push(createSignatureCheck(
        `${options.checkPrefix}.key-lifecycle`,
        allowedKeyStatuses.includes(keyLookup.key.status),
        allowedKeyStatuses.includes(keyLookup.key.status) ? 'info' : 'error',
        `${options.subjectLabel} resolved trust key ${keyLookup.key.keyId} with lifecycle status ${keyLookup.key.status}.`,
      ))
      const rotationGroupAllowed = allowedRotationGroups.length === 0
        || (keyLookup.key.rotationGroup ? allowedRotationGroups.includes(keyLookup.key.rotationGroup) : false)
      checks.push(createSignatureCheck(
        `${options.checkPrefix}.key-rotation-group`,
        rotationGroupAllowed,
        rotationGroupAllowed ? 'info' : 'error',
        allowedRotationGroups.length === 0
          ? `${options.subjectLabel} can use any rotation group.`
          : keyLookup.key.rotationGroup
            ? `${options.subjectLabel} resolved trust key ${keyLookup.key.keyId} in rotation group ${keyLookup.key.rotationGroup}.`
            : `${options.subjectLabel} resolved trust key ${keyLookup.key.keyId} without a rotation group, but signer policy requires ${allowedRotationGroups.join(', ')}.`,
      ))
    }

    if (!keyLookup.ok || !keyLookup.secret) {
      return {
        ok: summarizeSignatureEvaluation(checks),
        signatureRequired,
        policy,
        key: keyLookup.key,
        checks,
      }
    }

    const computedSignature = crypto
      .createHmac('sha256', keyLookup.secret)
      .update(options.payload)
      .digest('hex')
    checks.push(createSignatureCheck(
      `${options.checkPrefix}.verify`,
      computedSignature === options.signature.signature.toLowerCase(),
      computedSignature === options.signature.signature.toLowerCase() ? 'info' : 'error',
      computedSignature === options.signature.signature.toLowerCase()
        ? `${options.subjectLabel} signature verified for keyId ${options.signature.keyId}.`
        : `${options.subjectLabel} signature verification failed for keyId ${options.signature.keyId}.`,
    ))

    return {
      ok: summarizeSignatureEvaluation(checks),
      signatureRequired,
      policy,
      key: keyLookup.key,
      checks,
    }
  }

  signHmacPayload(options: SignHmacPayloadOptions): TrustSigningResult {
    const checks: TrustSignatureEvaluationCheck[] = []
    const preferredPolicyId = options.policyId
      ?? this.snapshot.signerPolicies.find(candidate =>
        candidate.scope === options.scope && candidate.enabled && candidate.requireSignature,
      )?.policyId
    const policyLookup = this.resolveSignerPolicy({
      scope: options.scope,
      policyId: preferredPolicyId,
    })
    const policy = policyLookup.policy
    checks.push(createSignatureCheck(
      `sign.${options.scope}.policy`,
      policyLookup.ok,
      policyLookup.ok ? 'info' : 'error',
      policyLookup.message,
    ))

    if (!policyLookup.ok || !policy) {
      return {
        ok: false,
        signatureRequired: Boolean(policy?.requireSignature),
        policy,
        checks,
        message: policyLookup.message,
      }
    }

    const allowedStatuses = policy.allowedKeyStatuses.length > 0
      ? [...policy.allowedKeyStatuses]
      : ['active']
    const signedAt = options.signedAt ?? new Date().toISOString()
    const evaluatedAt = parseDateValue(signedAt) ?? Date.now()

    const key = sortKeysForResolution(this.snapshot.keys.filter(candidate => {
      if (candidate.scheme !== 'hmac-sha256') return false
      if (!candidate.scopes.includes(options.scope)) return false
      if (!allowedStatuses.includes(candidate.status)) return false
      if (policy.allowedKeyIds.length > 0 && !policy.allowedKeyIds.includes(candidate.keyId)) return false
      if (policy.allowedIssuers.length > 0 && (!candidate.issuer || !policy.allowedIssuers.includes(candidate.issuer))) return false
      if (policy.allowedRotationGroups.length > 0 && (!candidate.rotationGroup || !policy.allowedRotationGroups.includes(candidate.rotationGroup))) return false
      if (!isKeyValidAt(candidate, evaluatedAt)) return false
      return Boolean(candidate.envVar && process.env[candidate.envVar])
    }))[0]

    if (!key?.envVar) {
      const message = `No signing key is available for ${options.scope} under signer policy ${policy.policyId}.`
      checks.push(createSignatureCheck(
        `sign.${options.scope}.key`,
        false,
        policy.requireSignature ? 'error' : 'warn',
        message,
      ))
      return {
        ok: false,
        signatureRequired: policy.requireSignature,
        policy,
        checks,
        message,
      }
    }

    const secret = process.env[key.envVar]
    if (!secret) {
      const message = `Signing key ${key.keyId} expects secret ${key.envVar}, but it is missing.`
      checks.push(createSignatureCheck(
        `sign.${options.scope}.secret`,
        false,
        policy.requireSignature ? 'error' : 'warn',
        message,
      ))
      return {
        ok: false,
        signatureRequired: policy.requireSignature,
        policy,
        key,
        checks,
        message,
      }
    }

    const signature: HmacSignatureEnvelope = {
      scheme: 'hmac-sha256',
      keyId: key.keyId,
      issuer: key.issuer,
      signedAt,
      signature: crypto.createHmac('sha256', secret).update(options.payload).digest('hex'),
    }
    checks.push(createSignatureCheck(
      `sign.${options.scope}.key`,
      true,
      'info',
      `Using trust key ${key.keyId} under signer policy ${policy.policyId}.`,
    ))

    return {
      ok: true,
      signatureRequired: policy.requireSignature,
      policy,
      key,
      signature,
      checks,
      message: `Signed ${options.scope} payload with ${key.keyId}.`,
    }
  }
}
