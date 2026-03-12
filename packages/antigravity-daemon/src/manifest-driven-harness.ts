import * as fs from 'node:fs'
import { z } from 'zod'
import { createISODateTime } from '@anthropic/antigravity-shared'
import type { SelfTestCheck } from './schema.js'

export interface HarnessSuiteDescriptor {
  suiteId: string
  name: string
  description: string
  tags: string[]
}

export interface HarnessSuiteResult extends HarnessSuiteDescriptor {
  ok: boolean
  totalCases: number
  passedCases: number
  totalChecks: number
  passedChecks: number
  avgDurationMs: number
  cases: HarnessCaseResult[]
  checks: SelfTestCheck[]
}

export interface ManifestDrivenHarnessReport {
  harnessId: string
  manifestVersion: string
  sourcePath?: string
  suiteIds: string[]
  caseIds: string[]
  ok: boolean
  ranAt: string
  totalCases: number
  passedCases: number
  totalChecks: number
  passedChecks: number
  suites: HarnessSuiteResult[]
}

export interface HarnessCaseDescriptor {
  caseId: string
  name: string
  tags: string[]
  metadata: Record<string, unknown>
}

export interface HarnessCaseResult extends HarnessCaseDescriptor {
  ok: boolean
  totalChecks: number
  passedChecks: number
  durationMs: number
  checks: SelfTestCheck[]
}

export interface HarnessSuiteEvaluation {
  checks?: SelfTestCheck[]
  cases?: HarnessCaseResult[]
}

export interface HarnessSuiteDefinition<Context> extends HarnessSuiteDescriptor {
  evaluate(ctx: Context): Promise<HarnessSuiteEvaluation>
}

interface LoadedHarnessManifest {
  harnessId: string
  manifestVersion: string
  sourcePath?: string
  suites: HarnessSuiteDescriptor[]
}

const HarnessManifestFileSchema = z.object({
  harnessId: z.string().optional(),
  manifestVersion: z.string().optional(),
  suites: z.array(z.object({
    suiteId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    enabled: z.boolean().default(true),
  })).default([]),
})

type HarnessManifestFile = z.infer<typeof HarnessManifestFileSchema>

function createDefaultManifest<Context>(
  harnessId: string,
  manifestVersion: string,
  definitions: Record<string, HarnessSuiteDefinition<Context>>,
): LoadedHarnessManifest {
  return {
    harnessId,
    manifestVersion,
    suites: Object.values(definitions).map(({ suiteId, name, description, tags }) => ({
      suiteId,
      name,
      description,
      tags,
    })),
  }
}

function loadHarnessManifest<Context>(
  manifestPath: string,
  harnessId: string,
  manifestVersion: string,
  definitions: Record<string, HarnessSuiteDefinition<Context>>,
): LoadedHarnessManifest {
  const base = createDefaultManifest(harnessId, manifestVersion, definitions)
  if (!fs.existsSync(manifestPath)) {
    return base
  }
  const raw = fs.readFileSync(manifestPath, 'utf8').trim()
  if (!raw) {
    return {
      ...base,
      sourcePath: manifestPath,
    }
  }

  const parsed = HarnessManifestFileSchema.parse(JSON.parse(raw)) as HarnessManifestFile
  const overrides = new Map(parsed.suites.map(suite => [suite.suiteId, suite]))
  const suites = base.suites
    .map((suite) => {
      const override = overrides.get(suite.suiteId)
      if (override?.enabled === false) {
        return null
      }
      return {
        suiteId: suite.suiteId,
        name: override?.name ?? suite.name,
        description: override?.description ?? suite.description,
        tags: override?.tags ?? suite.tags,
      }
    })
    .filter((suite): suite is HarnessSuiteDescriptor => suite !== null)

  return {
    harnessId: parsed.harnessId ?? base.harnessId,
    manifestVersion: parsed.manifestVersion ?? base.manifestVersion,
    sourcePath: manifestPath,
    suites,
  }
}

export async function runManifestDrivenHarness<Context>(options: {
  ctx: Context
  manifestPath: string
  harnessId: string
  manifestVersion: string
  definitions: Record<string, HarnessSuiteDefinition<Context>>
  suiteIds: string[]
  caseIds?: string[]
}): Promise<ManifestDrivenHarnessReport> {
  const manifest = loadHarnessManifest(
    options.manifestPath,
    options.harnessId,
    options.manifestVersion,
    options.definitions,
  )
  const requestedSuites = options.suiteIds.length > 0
    ? new Set(options.suiteIds)
    : undefined
  const requestedCases = options.caseIds && options.caseIds.length > 0
    ? new Set(options.caseIds)
    : undefined
  const selected = manifest.suites.filter(suite => !requestedSuites || requestedSuites.has(suite.suiteId))

  const suites = await Promise.all(selected.map(async (descriptor) => {
    const evaluator = options.definitions[descriptor.suiteId]
    if (!evaluator) {
      return {
        ...descriptor,
        ok: false,
        totalCases: 0,
        passedCases: 0,
        totalChecks: 1,
        passedChecks: 0,
        avgDurationMs: 0,
        cases: [],
        checks: [{
          id: 'suite-missing',
          ok: false,
          message: `No harness suite implementation is registered for ${descriptor.suiteId}.`,
        }],
      } satisfies HarnessSuiteResult
    }
    const evaluation = await evaluator.evaluate(options.ctx)
    const checks = [...(evaluation.checks ?? [])]
    const rawCases = evaluation.cases ?? []
    const cases = requestedCases
      ? rawCases.filter(testCase => requestedCases.has(testCase.caseId))
      : rawCases
    if (rawCases.length > 0 && requestedCases && cases.length === 0) {
      checks.push({
        id: 'case-filter-empty',
        ok: false,
        message: `No requested caseIds matched suite ${descriptor.suiteId}.`,
      })
    }
    const passedChecks = checks.filter(check => check.ok).length +
      cases.reduce((sum, testCase) => sum + testCase.passedChecks, 0)
    const totalChecks = checks.length + cases.reduce((sum, testCase) => sum + testCase.totalChecks, 0)
    const totalCases = cases.length
    const passedCases = cases.filter(testCase => testCase.ok).length
    const avgDurationMs = totalCases > 0
      ? Math.round(cases.reduce((sum, testCase) => sum + testCase.durationMs, 0) / totalCases)
      : 0
    return {
      ...descriptor,
      ok: checks.every(check => check.ok) && cases.every(testCase => testCase.ok),
      totalCases,
      passedCases,
      totalChecks,
      passedChecks,
      avgDurationMs,
      cases,
      checks,
    } satisfies HarnessSuiteResult
  }))

  const caseIds = suites.flatMap(suite => suite.cases.map(testCase => testCase.caseId))
  const totalCases = suites.reduce((sum, suite) => sum + suite.totalCases, 0)
  const passedCases = suites.reduce((sum, suite) => sum + suite.passedCases, 0)
  const totalChecks = suites.reduce((sum, suite) => sum + suite.totalChecks, 0)
  const passedChecks = suites.reduce((sum, suite) => sum + suite.passedChecks, 0)

  return {
    harnessId: manifest.harnessId,
    manifestVersion: manifest.manifestVersion,
    sourcePath: manifest.sourcePath,
    suiteIds: suites.map(suite => suite.suiteId),
    caseIds,
    ok: suites.every(suite => suite.ok),
    ranAt: createISODateTime(),
    totalCases,
    passedCases,
    totalChecks,
    passedChecks,
    suites,
  }
}
