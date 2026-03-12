import * as crypto from 'node:crypto'
import { createISODateTime } from '@anthropic/antigravity-shared'

export const TRACE_BUNDLE_INTEGRITY_ALGORITHM = 'sha256' as const

export const TRACE_BUNDLE_SECTIONS = [
  'manifest',
  'policyPack',
  'trustRegistry',
  'benchmarkSourceRegistry',
  'remoteWorkers',
  'run',
  'events',
  'checkpoints',
  'timeline',
  'receipts',
  'tribunals',
  'handoffs',
  'skips',
  'verdicts',
] as const

export type TraceBundleSectionName = (typeof TRACE_BUNDLE_SECTIONS)[number]

export interface TraceBundleIntegrityPayload {
  algorithm: typeof TRACE_BUNDLE_INTEGRITY_ALGORITHM
  generatedAt: string
  entryDigests: Record<string, string>
  bundleDigest: string
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeValue(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    )
  }
  return value
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function buildTraceBundleIntegrity(
  sections: Partial<Record<TraceBundleSectionName, unknown>>,
  generatedAt?: string,
): TraceBundleIntegrityPayload {
  const resolvedGeneratedAt = generatedAt ?? createISODateTime()
  const entryDigests = Object.fromEntries(
    TRACE_BUNDLE_SECTIONS
      .filter(section => section in sections && sections[section] !== undefined)
      .map(section => [
        section,
        sha256Hex(canonicalJsonStringify(sections[section])),
      ]),
  )

  return {
    algorithm: TRACE_BUNDLE_INTEGRITY_ALGORITHM,
    generatedAt: resolvedGeneratedAt,
    entryDigests,
    bundleDigest: sha256Hex(canonicalJsonStringify({
      algorithm: TRACE_BUNDLE_INTEGRITY_ALGORITHM,
      generatedAt: resolvedGeneratedAt,
      entryDigests,
    })),
  }
}

export interface TraceBundleIntegrityVerification {
  ok: boolean
  algorithm: typeof TRACE_BUNDLE_INTEGRITY_ALGORITHM
  actualBundleDigest: string
  expectedBundleDigest?: string
  mismatchedEntries: string[]
  missingEntries: string[]
}

export function verifyTraceBundleIntegrity(
  sections: Partial<Record<TraceBundleSectionName, unknown>>,
  integrity: TraceBundleIntegrityPayload | undefined,
): TraceBundleIntegrityVerification {
  if (!integrity) {
    return {
      ok: false,
      algorithm: TRACE_BUNDLE_INTEGRITY_ALGORITHM,
      actualBundleDigest: '',
      expectedBundleDigest: undefined,
      mismatchedEntries: [],
      missingEntries: [...TRACE_BUNDLE_SECTIONS],
    }
  }

  const recomputed = buildTraceBundleIntegrity(sections, integrity.generatedAt)
  const missingEntries = Object.keys(integrity.entryDigests)
    .filter(section => !(section in recomputed.entryDigests))

  const mismatchedEntries = Object.keys({
    ...integrity.entryDigests,
    ...recomputed.entryDigests,
  }).filter(section => integrity.entryDigests[section] !== recomputed.entryDigests[section])

  return {
    ok: integrity.bundleDigest === recomputed.bundleDigest &&
      missingEntries.length === 0 &&
      mismatchedEntries.length === 0,
    algorithm: TRACE_BUNDLE_INTEGRITY_ALGORITHM,
    actualBundleDigest: recomputed.bundleDigest,
    expectedBundleDigest: integrity.bundleDigest,
    mismatchedEntries,
    missingEntries,
  }
}
