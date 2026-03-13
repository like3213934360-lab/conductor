import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { createISODateTime } from '@anthropic/antigravity-shared'
import type {
  TransparencyLedgerEntry,
  TransparencyLedgerSummary,
  VerifyTransparencyLedgerReport,
} from './schema.js'
import { TransparencyLedgerEntrySchema } from './schema.js'
import { canonicalJsonStringify } from './trace-bundle-integrity.js'

export const TRANSPARENCY_LEDGER_VERSION = '1.0.0' as const

function computeEntryDigest(entry: Omit<TransparencyLedgerEntry, 'entryDigest'>): string {
  return crypto.createHash('sha256').update(canonicalJsonStringify(entry)).digest('hex')
}

export function readTransparencyLedgerEntries(ledgerPath: string): TransparencyLedgerEntry[] {
  if (!fs.existsSync(ledgerPath)) {
    return []
  }
  const raw = fs.readFileSync(ledgerPath, 'utf8').trim()
  if (!raw) {
    return []
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => TransparencyLedgerEntrySchema.parse(JSON.parse(line)))
}

export function appendTransparencyLedgerEntry(input: {
  ledgerPath: string
  runId: string
  certificationRecordPath: string
  certificationRecordDigest: string
  releaseBundlePath: string
  releaseBundleDigest: string
  recordedAt?: string
  /** PR-13: verification snapshot digest */
  snapshotDigest?: string
  /** PR-13: proof graph digest */
  proofGraphDigest?: string
}): TransparencyLedgerEntry {
  const existing = readTransparencyLedgerEntries(input.ledgerPath)
  const last = existing.at(-1)
  const baseEntry: Omit<TransparencyLedgerEntry, 'entryDigest'> = {
    version: TRANSPARENCY_LEDGER_VERSION,
    entryId: crypto.randomUUID(),
    index: existing.length,
    runId: input.runId,
    certificationRecordPath: input.certificationRecordPath,
    certificationRecordDigest: input.certificationRecordDigest,
    releaseBundlePath: input.releaseBundlePath,
    releaseBundleDigest: input.releaseBundleDigest,
    previousEntryDigest: last?.entryDigest,
    recordedAt: input.recordedAt ?? createISODateTime(),
    snapshotDigest: input.snapshotDigest,
    proofGraphDigest: input.proofGraphDigest,
  }
  const entry: TransparencyLedgerEntry = {
    ...baseEntry,
    entryDigest: computeEntryDigest(baseEntry),
  }
  fs.appendFileSync(input.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

export function verifyTransparencyLedger(ledgerPath: string): VerifyTransparencyLedgerReport {
  const entries = readTransparencyLedgerEntries(ledgerPath)
  const issues: string[] = []

  entries.forEach((entry, index) => {
    const { entryDigest, ...unsigned } = entry
    const expectedDigest = computeEntryDigest(unsigned)
    if (expectedDigest !== entryDigest) {
      issues.push(`entryDigest:${index}`)
    }
    if (index === 0) {
      if (entry.previousEntryDigest) {
        issues.push(`entryPreviousDigest:${index}`)
      }
      return
    }
    const previous = entries[index - 1]
    if (entry.previousEntryDigest !== previous?.entryDigest) {
      issues.push(`previousEntryDigest:${index}`)
    }
  })

  // PR-13: check proof graph consistency — same runId must share same proofGraphDigest
  const runProofGraphMap = new Map<string, string>()
  entries.forEach((entry, index) => {
    if (entry.proofGraphDigest) {
      const existing = runProofGraphMap.get(entry.runId)
      if (existing && existing !== entry.proofGraphDigest) {
        issues.push(`proofGraphDigest:${index}`)
      } else {
        runProofGraphMap.set(entry.runId, entry.proofGraphDigest)
      }
    }
  })

  return {
    ledgerPath,
    ok: issues.length === 0,
    entryCount: entries.length,
    headDigest: entries.at(-1)?.entryDigest,
    issues,
    verifiedAt: createISODateTime(),
  }
}

export function summarizeTransparencyLedger(input: {
  ledgerPath: string
  entries: TransparencyLedgerEntry[]
  report: VerifyTransparencyLedgerReport
}): TransparencyLedgerSummary {
  return {
    ledgerPath: input.ledgerPath,
    entryCount: input.entries.length,
    latestRunId: input.entries.at(-1)?.runId,
    headDigest: input.entries.at(-1)?.entryDigest,
    verified: input.report.ok,
    issues: input.report.issues,
  }
}
