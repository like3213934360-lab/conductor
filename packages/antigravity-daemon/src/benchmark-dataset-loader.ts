import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { z } from 'zod'
import { loadBenchmarkSourceRegistryFile } from './benchmark-source-registry.js'
import { TrustRegistryStore } from './trust-registry.js'
import {
  ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE,
  ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE,
} from './runtime-contract.js'
import type { BenchmarkSourceRegistrySnapshot } from './schema.js'
import {
  BenchmarkDatasetFileSchema,
  BenchmarkDatasetSourceConfigSchema,
  BenchmarkDatasetSourceRefSchema,
  DEFAULT_BENCHMARK_DATASET,
  RunBenchmarkDatasetSourceSchema,
  type BenchmarkDatasetCase,
  type BenchmarkDatasetSourceConfig,
  type BenchmarkDatasetSourceKind,
  type BenchmarkDatasetSourceRef,
  type BenchmarkDatasetSourceRegistryEntry,
  type LoadedBenchmarkDataset,
  type RunBenchmarkDatasetSource,
} from './benchmark-dataset.js'

const BenchmarkHarnessDatasetConfigSchema = z.object({
  datasetSources: z.array(RunBenchmarkDatasetSourceSchema).default([]),
})

const RunBenchmarkDatasetSourceListSchema = z.array(RunBenchmarkDatasetSourceSchema).default([])

interface RuntimeDatasetSource extends BenchmarkDatasetSourceConfig {
  sourceId: string
  sourceKind: Extract<BenchmarkDatasetSourceKind, 'manifest-source' | 'request-source'>
}

export interface BenchmarkDatasetLoadIssue {
  sourceId: string
  sourceKind: Extract<BenchmarkDatasetSourceKind, 'manifest-source' | 'request-source'>
  location: string
  required: boolean
  error: string
  registryRef?: string
  registryPath?: string
  expectedDatasetId?: string
  expectedVersion?: string
  expectedSha256?: string
}

export interface LoadedBenchmarkDatasetBundle {
  datasets: LoadedBenchmarkDataset[]
  issues: BenchmarkDatasetLoadIssue[]
}

interface LoadBenchmarkDatasetsOptions {
  workspaceRoot: string
  dataDir: string
  manifestPath: string
  requestDatasetSources?: RunBenchmarkDatasetSource[]
  requestText?: BenchmarkDatasetTextTransport
}

interface DatasetSourceRegistryResolution {
  sources: RuntimeDatasetSource[]
  issues: BenchmarkDatasetLoadIssue[]
}

interface DatasetSourceRegistryContext {
  snapshot: BenchmarkSourceRegistrySnapshot
  registryPath: string
  sourceMap: Map<string, BenchmarkDatasetSourceRegistryEntry>
}

interface ConditionalRequestHeaders {
  etag?: string
  lastModified?: string
}

interface HttpTextResponse {
  statusCode: number
  headers: http.IncomingHttpHeaders
  rawText: string
}

export interface BenchmarkDatasetTextRequest {
  url: string
  bearerToken?: string
  conditionalHeaders?: ConditionalRequestHeaders
}

export type BenchmarkDatasetTextTransport = (
  request: BenchmarkDatasetTextRequest,
) => Promise<HttpTextResponse>

interface RemoteDatasetCacheRecord {
  schemaVersion: '1'
  sourceLocation: string
  fetchedAt: string
  expiresAt: string
  etag?: string
  lastModified?: string
  integritySha256: string
  rawText: string
  datasetId: string
  version: string
}

function hashText(rawText: string): string {
  return crypto.createHash('sha256').update(rawText).digest('hex')
}

function asSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function requestText(
  request: BenchmarkDatasetTextRequest,
): Promise<HttpTextResponse> {
  return new Promise<HttpTextResponse>((resolve, reject) => {
    const target = new URL(request.url)
    const transport = target.protocol === 'https:' ? https : http
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(request.bearerToken ? { authorization: `Bearer ${request.bearerToken}` } : {}),
        ...(request.conditionalHeaders?.etag ? { 'if-none-match': request.conditionalHeaders.etag } : {}),
        ...(request.conditionalHeaders?.lastModified ? { 'if-modified-since': request.conditionalHeaders.lastModified } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const rawText = Buffer.concat(chunks).toString('utf8')
        const statusCode = res.statusCode ?? 500
        if (statusCode >= 400) {
          reject(new Error(rawText || `Dataset request failed (${statusCode})`))
          return
        }
        resolve({
          statusCode,
          headers: res.headers,
          rawText,
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function isRemoteLocation(location: string): boolean {
  return /^https?:\/\//.test(location)
}

function normalizeLocalPath(workspaceRoot: string, location: string): string {
  const resolved = location.startsWith('file://')
    ? fileURLToPath(location)
    : path.isAbsolute(location)
      ? location
      : path.join(workspaceRoot, location)
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, 'benchmark-dataset.json')
  }
  return resolved
}

function normalizeSourceId(prefix: string, value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned ? `${prefix}:${cleaned}` : `${prefix}:${Math.random().toString(36).slice(2, 8)}`
}

function isRegistrySourceString(value: string): boolean {
  return value.startsWith('registry:')
}

function cloneCaseWithNormalizedId(
  testCase: BenchmarkDatasetCase,
  nextCaseId: string,
  dataset: Pick<LoadedBenchmarkDataset, 'datasetId' | 'sourceId' | 'sourceKind' | 'sourceLocation'>,
): BenchmarkDatasetCase {
  if (nextCaseId === testCase.caseId) {
    return {
      ...testCase,
      metadata: {
        ...testCase.metadata,
        sourceCaseId: testCase.caseId,
      },
    }
  }

  return {
    ...testCase,
    caseId: nextCaseId,
    metadata: {
      ...testCase.metadata,
      sourceCaseId: testCase.caseId,
      sourceDatasetId: dataset.datasetId,
      sourceDatasetSourceId: dataset.sourceId,
      sourceDatasetSourceKind: dataset.sourceKind,
      sourceDatasetLocation: dataset.sourceLocation,
    },
  }
}

function uniquifyCaseId(caseId: string, namespace: string, seen: Set<string>): string {
  if (!seen.has(caseId)) {
    seen.add(caseId)
    return caseId
  }
  let candidate = `${namespace}:${caseId}`
  let suffix = 2
  while (seen.has(candidate)) {
    candidate = `${namespace}:${caseId}:${suffix}`
    suffix += 1
  }
  seen.add(candidate)
  return candidate
}

function applyCaseIdNormalization(dataset: LoadedBenchmarkDataset, seen: Set<string>): LoadedBenchmarkDataset {
  const namespace = dataset.sourceId || dataset.datasetId
  return {
    ...dataset,
    cases: dataset.cases.map(testCase =>
      cloneCaseWithNormalizedId(
        testCase,
        uniquifyCaseId(testCase.caseId, namespace, seen),
        dataset,
      )),
  }
}

function applyRegistrySourceOverrides(
  registrySource: BenchmarkDatasetSourceRegistryEntry,
  ref: BenchmarkDatasetSourceRef,
): BenchmarkDatasetSourceConfig {
  if (registrySource.locked) {
    return {
      ...registrySource,
      enabled: ref.enabled ?? registrySource.enabled,
      required: ref.required ?? registrySource.required,
    }
  }
  return {
    ...registrySource,
    enabled: ref.enabled ?? registrySource.enabled,
    required: ref.required ?? registrySource.required,
    authEnvVar: ref.authEnvVar ?? registrySource.authEnvVar,
    expectedDatasetId: ref.expectedDatasetId ?? registrySource.expectedDatasetId,
    expectedVersion: ref.expectedVersion ?? registrySource.expectedVersion,
    expectedSha256: ref.expectedSha256 ?? registrySource.expectedSha256,
    cacheTtlMs: ref.cacheTtlMs ?? registrySource.cacheTtlMs,
    allowStaleOnError: ref.allowStaleOnError ?? registrySource.allowStaleOnError,
  }
}

function isLockedRegistrySourceVerified(
  registryContext: DatasetSourceRegistryContext,
): boolean {
  return registryContext.snapshot.verification.summary === 'verified'
}

function getLockedRegistryOverrideKeys(
  ref: BenchmarkDatasetSourceRef,
): string[] {
  const forbiddenKeys = [
    'authEnvVar',
    'expectedDatasetId',
    'expectedVersion',
    'expectedSha256',
    'cacheTtlMs',
    'allowStaleOnError',
  ] as const
  return forbiddenKeys.filter(key => ref[key] !== undefined)
}

function createRegistryIssue(
  sourceId: string,
  sourceKind: Extract<BenchmarkDatasetSourceKind, 'manifest-source' | 'request-source'>,
  location: string,
  required: boolean,
  error: string,
  registryContext: DatasetSourceRegistryContext,
  registryRef?: string,
  expected?: Partial<Pick<BenchmarkDatasetLoadIssue, 'expectedDatasetId' | 'expectedVersion' | 'expectedSha256'>>,
): BenchmarkDatasetLoadIssue {
  return {
    sourceId,
    sourceKind,
    location,
    required,
    registryRef,
    registryPath: registryContext.registryPath,
    error,
    expectedDatasetId: expected?.expectedDatasetId,
    expectedVersion: expected?.expectedVersion,
    expectedSha256: expected?.expectedSha256,
  }
}

function resolveDatasetSourceInputs(
  inputs: RunBenchmarkDatasetSource[],
  sourceKind: Extract<BenchmarkDatasetSourceKind, 'manifest-source' | 'request-source'>,
  registryContext: DatasetSourceRegistryContext,
): DatasetSourceRegistryResolution {
  const parsedInputs = RunBenchmarkDatasetSourceListSchema.parse(inputs)
  const sources: RuntimeDatasetSource[] = []
  const issues: BenchmarkDatasetLoadIssue[] = []

  for (const [index, source] of parsedInputs.entries()) {
    if (typeof source === 'string') {
      if (isRegistrySourceString(source)) {
        const registryRef = source.slice('registry:'.length).trim()
        const registrySource = registryContext.sourceMap.get(registryRef)
        if (!registrySource) {
          issues.push(createRegistryIssue(
            normalizeSourceId(sourceKind, `${index + 1}-${registryRef}`),
            sourceKind,
            `registry:${registryRef}`,
            true,
            `Dataset source registry entry not found: ${registryRef}`,
            registryContext,
            registryRef,
          ))
          continue
        }
        if (registrySource.enabled === false) {
          continue
        }
        if (registrySource.locked && !isLockedRegistrySourceVerified(registryContext)) {
          issues.push(createRegistryIssue(
            registrySource.sourceId,
            sourceKind,
            `registry:${registryRef}`,
            registrySource.required,
            `Locked dataset source registry entry ${registryRef} requires a verified benchmark source registry.`,
            registryContext,
            registryRef,
            {
              expectedDatasetId: registrySource.expectedDatasetId,
              expectedVersion: registrySource.expectedVersion,
              expectedSha256: registrySource.expectedSha256,
            },
          ))
          continue
        }
        sources.push({
          ...registrySource,
          sourceId: registrySource.sourceId,
          sourceKind,
        })
        continue
      }

      sources.push({
        sourceId: normalizeSourceId(sourceKind, `${index + 1}-${source}`),
        location: source,
        enabled: true,
        required: true,
        cacheTtlMs: 300_000,
        allowStaleOnError: true,
        sourceKind,
      })
      continue
    }

    if ('registryRef' in source) {
      const registrySource = registryContext.sourceMap.get(source.registryRef)
      if (!registrySource) {
        issues.push(createRegistryIssue(
          normalizeSourceId(sourceKind, `${index + 1}-${source.registryRef}`),
          sourceKind,
          `registry:${source.registryRef}`,
          source.required ?? true,
          `Dataset source registry entry not found: ${source.registryRef}`,
          registryContext,
          source.registryRef,
          {
            expectedDatasetId: source.expectedDatasetId,
            expectedVersion: source.expectedVersion,
            expectedSha256: source.expectedSha256,
          },
        ))
        continue
      }
      const parsedRef = BenchmarkDatasetSourceRefSchema.parse(source)
      if (parsedRef.enabled === false) {
        continue
      }
      if (registrySource.locked && !isLockedRegistrySourceVerified(registryContext)) {
        issues.push(createRegistryIssue(
          registrySource.sourceId,
          sourceKind,
          `registry:${source.registryRef}`,
          parsedRef.required ?? registrySource.required,
          `Locked dataset source registry entry ${source.registryRef} requires a verified benchmark source registry.`,
          registryContext,
          source.registryRef,
          {
            expectedDatasetId: registrySource.expectedDatasetId,
            expectedVersion: registrySource.expectedVersion,
            expectedSha256: registrySource.expectedSha256,
          },
        ))
        continue
      }
      const forbiddenOverrideKeys = registrySource.locked
        ? getLockedRegistryOverrideKeys(parsedRef)
        : []
      if (forbiddenOverrideKeys.length > 0) {
        issues.push(createRegistryIssue(
          registrySource.sourceId,
          sourceKind,
          `registry:${source.registryRef}`,
          parsedRef.required ?? registrySource.required,
          `Locked dataset source registry entry ${source.registryRef} does not allow overrides for ${forbiddenOverrideKeys.join(', ')}.`,
          registryContext,
          source.registryRef,
          {
            expectedDatasetId: registrySource.expectedDatasetId,
            expectedVersion: registrySource.expectedVersion,
            expectedSha256: registrySource.expectedSha256,
          },
        ))
        continue
      }
      const resolvedSource = applyRegistrySourceOverrides(registrySource, parsedRef)
      if (resolvedSource.enabled === false) {
        continue
      }
      sources.push({
        ...resolvedSource,
        sourceId: registrySource.sourceId,
        sourceKind,
      })
      continue
    }

    const parsedSource = BenchmarkDatasetSourceConfigSchema.parse(source)
    if (parsedSource.enabled === false) {
      continue
    }
    sources.push({
      ...parsedSource,
      sourceId: parsedSource.sourceId ?? normalizeSourceId(sourceKind, `${index + 1}-${parsedSource.location}`),
      sourceKind,
    })
  }

  return { sources, issues }
}

function loadManifestDatasetSources(
  manifestPath: string,
  registryContext: DatasetSourceRegistryContext,
): DatasetSourceRegistryResolution {
  if (!fs.existsSync(manifestPath)) {
    return { sources: [], issues: [] }
  }
  const raw = fs.readFileSync(manifestPath, 'utf8').trim()
  if (!raw) {
    return { sources: [], issues: [] }
  }
  const parsed = BenchmarkHarnessDatasetConfigSchema.parse(JSON.parse(raw))
  return resolveDatasetSourceInputs(parsed.datasetSources, 'manifest-source', registryContext)
}

function resolveRequestDatasetSources(
  sources: RunBenchmarkDatasetSource[],
  registryContext: DatasetSourceRegistryContext,
): DatasetSourceRegistryResolution {
  return resolveDatasetSourceInputs(sources, 'request-source', registryContext)
}

function dedupeDatasetSources(workspaceRoot: string, sources: RuntimeDatasetSource[]): RuntimeDatasetSource[] {
  const unique = new Map<string, RuntimeDatasetSource>()
  for (const source of sources) {
    const key = isRemoteLocation(source.location)
      ? source.location
      : normalizeLocalPath(workspaceRoot, source.location)
    unique.set(key, source)
  }
  return [...unique.values()]
}

function resolveRemoteDatasetCachePath(dataDir: string, sourceLocation: string): string {
  const cacheKey = crypto.createHash('sha256').update(sourceLocation).digest('hex')
  return path.join(dataDir, 'cache', 'benchmark-datasets', `${cacheKey}.json`)
}

function readRemoteDatasetCache(cachePath: string): RemoteDatasetCacheRecord | null {
  if (!fs.existsSync(cachePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(cachePath, 'utf8').trim()
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as RemoteDatasetCacheRecord
    if (parsed.schemaVersion !== '1' || typeof parsed.rawText !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeRemoteDatasetCache(cachePath: string, record: RemoteDatasetCacheRecord): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  fs.writeFileSync(cachePath, JSON.stringify(record, null, 2), 'utf8')
}

function resolveBearerToken(source: RuntimeDatasetSource): string | undefined {
  if (!source.authEnvVar) {
    return undefined
  }
  const token = process.env[source.authEnvVar]?.trim()
  if (!token) {
    throw new Error(`Missing auth token in env var ${source.authEnvVar}`)
  }
  return token
}

function validateLoadedDataset(
  source: RuntimeDatasetSource,
  datasetId: string,
  version: string,
  integritySha256: string,
): void {
  if (source.expectedDatasetId && datasetId !== source.expectedDatasetId) {
    throw new Error(`Dataset id mismatch: expected ${source.expectedDatasetId}, received ${datasetId}`)
  }
  if (source.expectedVersion && version !== source.expectedVersion) {
    throw new Error(`Dataset version mismatch: expected ${source.expectedVersion}, received ${version}`)
  }
  if (source.expectedSha256 && integritySha256.toLowerCase() !== source.expectedSha256.toLowerCase()) {
    throw new Error(`Dataset sha256 mismatch: expected ${source.expectedSha256}, received ${integritySha256}`)
  }
}

function materializeDataset(
  rawText: string,
  source: RuntimeDatasetSource,
  sourceLocation: string,
  seenCaseIds: Set<string>,
  metadata: {
    sourcePath?: string
    cacheStatus: LoadedBenchmarkDataset['cacheStatus']
    integritySha256?: string
  },
): LoadedBenchmarkDataset {
  const parsed = BenchmarkDatasetFileSchema.parse(JSON.parse(rawText))
  const integritySha256 = metadata.integritySha256 ?? hashText(rawText)
  validateLoadedDataset(source, parsed.datasetId, parsed.version, integritySha256)
  return applyCaseIdNormalization({
    datasetId: parsed.datasetId,
    version: parsed.version,
    sourceId: source.sourceId,
    sourceKind: source.sourceKind,
    sourceLocation,
    sourcePath: metadata.sourcePath,
    cacheStatus: metadata.cacheStatus,
    integritySha256,
    cases: parsed.cases.filter(testCase => testCase.enabled !== false),
  }, seenCaseIds)
}

async function loadRemoteDatasetSource(
  dataDir: string,
  source: RuntimeDatasetSource,
  seenCaseIds: Set<string>,
  requestTextTransport: BenchmarkDatasetTextTransport,
): Promise<LoadedBenchmarkDataset> {
  const bearerToken = resolveBearerToken(source)
  const cachePath = resolveRemoteDatasetCachePath(dataDir, source.location)
  const cached = readRemoteDatasetCache(cachePath)
  const now = Date.now()
  const hasFreshCache = cached && Date.parse(cached.expiresAt) > now

  if (hasFreshCache) {
    return materializeDataset(cached.rawText, source, source.location, seenCaseIds, {
      cacheStatus: 'hit',
      integritySha256: cached.integritySha256,
    })
  }

  try {
    const response = await requestTextTransport({
      url: source.location,
      bearerToken,
      conditionalHeaders: cached ? {
        etag: cached.etag,
        lastModified: cached.lastModified,
      } : undefined,
    })

    if (response.statusCode === 304) {
      if (!cached) {
        throw new Error(`Dataset source ${source.sourceId} returned 304 without a local cache entry`)
      }
      const refreshedCache: RemoteDatasetCacheRecord = {
        ...cached,
        fetchedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + source.cacheTtlMs).toISOString(),
      }
      writeRemoteDatasetCache(cachePath, refreshedCache)
      return materializeDataset(refreshedCache.rawText, source, source.location, seenCaseIds, {
        cacheStatus: 'revalidated',
        integritySha256: refreshedCache.integritySha256,
      })
    }

    const integritySha256 = hashText(response.rawText)
    const parsed = BenchmarkDatasetFileSchema.parse(JSON.parse(response.rawText))
    validateLoadedDataset(source, parsed.datasetId, parsed.version, integritySha256)
    const nextCache: RemoteDatasetCacheRecord = {
      schemaVersion: '1',
      sourceLocation: source.location,
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + source.cacheTtlMs).toISOString(),
      etag: asSingleHeaderValue(response.headers['etag']),
      lastModified: asSingleHeaderValue(response.headers['last-modified']),
      integritySha256,
      rawText: response.rawText,
      datasetId: parsed.datasetId,
      version: parsed.version,
    }
    writeRemoteDatasetCache(cachePath, nextCache)
    return applyCaseIdNormalization({
      datasetId: parsed.datasetId,
      version: parsed.version,
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      sourceLocation: source.location,
      cacheStatus: 'miss',
      integritySha256,
      cases: parsed.cases.filter(testCase => testCase.enabled !== false),
    }, seenCaseIds)
  } catch (error) {
    if (cached && source.allowStaleOnError) {
      return materializeDataset(cached.rawText, source, source.location, seenCaseIds, {
        cacheStatus: 'stale-fallback',
        integritySha256: cached.integritySha256,
      })
    }
    throw error
  }
}

async function loadRuntimeDatasetSource(
  workspaceRoot: string,
  dataDir: string,
  source: RuntimeDatasetSource,
  seenCaseIds: Set<string>,
  requestTextTransport: BenchmarkDatasetTextTransport,
): Promise<LoadedBenchmarkDataset> {
  if (isRemoteLocation(source.location)) {
    return loadRemoteDatasetSource(dataDir, source, seenCaseIds, requestTextTransport)
  }

  const sourcePath = normalizeLocalPath(workspaceRoot, source.location)
  const rawText = fs.readFileSync(sourcePath, 'utf8')
  return materializeDataset(rawText, source, sourcePath, seenCaseIds, {
    sourcePath,
    cacheStatus: 'not-applicable',
  })
}

export async function loadBenchmarkDatasets(
  options: LoadBenchmarkDatasetsOptions,
): Promise<LoadedBenchmarkDatasetBundle> {
  const seenCaseIds = new Set<string>()
  const datasets: LoadedBenchmarkDataset[] = []
  const issues: BenchmarkDatasetLoadIssue[] = []
  const workspaceDatasetPath = path.join(options.dataDir, 'benchmark-dataset.json')
  const registryPath = path.join(options.dataDir, ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE)
  const trustRegistry = new TrustRegistryStore(path.join(options.dataDir, ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE))
  trustRegistry.load()
  const registrySnapshot = loadBenchmarkSourceRegistryFile(registryPath, trustRegistry)
  const registryContext: DatasetSourceRegistryContext = {
    snapshot: registrySnapshot,
    registryPath,
    sourceMap: new Map(
      registrySnapshot.sources.map(source => [source.sourceId, source]),
    ),
  }

  if (fs.existsSync(workspaceDatasetPath)) {
    const rawText = fs.readFileSync(workspaceDatasetPath, 'utf8').trim()
    if (rawText) {
      const parsed = BenchmarkDatasetFileSchema.parse(JSON.parse(rawText))
      datasets.push(applyCaseIdNormalization({
        datasetId: parsed.datasetId,
        version: parsed.version,
        sourceId: 'workspace-dataset',
        sourceKind: 'workspace-file',
        sourceLocation: workspaceDatasetPath,
        sourcePath: workspaceDatasetPath,
        cacheStatus: 'not-applicable',
        integritySha256: hashText(rawText),
        cases: parsed.cases.filter(testCase => testCase.enabled !== false),
      }, seenCaseIds))
    }
  }

  const manifestResolution = loadManifestDatasetSources(options.manifestPath, registryContext)
  const requestResolution = resolveRequestDatasetSources(options.requestDatasetSources ?? [], registryContext)
  issues.push(...manifestResolution.issues, ...requestResolution.issues)

  const configuredSources = dedupeDatasetSources(
    options.workspaceRoot,
    [
      ...manifestResolution.sources,
      ...requestResolution.sources,
    ],
  )
  const requestTextTransport = options.requestText ?? requestText

  for (const source of configuredSources) {
    try {
      datasets.push(await loadRuntimeDatasetSource(
        options.workspaceRoot,
        options.dataDir,
        source,
        seenCaseIds,
        requestTextTransport,
      ))
    } catch (error) {
      issues.push({
        sourceId: source.sourceId,
        sourceKind: source.sourceKind,
        location: source.location,
        required: source.required,
        error: error instanceof Error ? error.message : String(error),
        expectedDatasetId: source.expectedDatasetId,
        expectedVersion: source.expectedVersion,
        expectedSha256: source.expectedSha256,
      })
    }
  }

  if (datasets.length === 0 && configuredSources.length === 0 && !fs.existsSync(workspaceDatasetPath)) {
    const builtinRawText = JSON.stringify({
      datasetId: DEFAULT_BENCHMARK_DATASET.datasetId,
      version: DEFAULT_BENCHMARK_DATASET.version,
      cases: DEFAULT_BENCHMARK_DATASET.cases,
    })
    datasets.push(applyCaseIdNormalization({
      ...DEFAULT_BENCHMARK_DATASET,
      sourceId: 'builtin-default',
      sourceKind: 'builtin-default',
      sourceLocation: 'builtin://antigravity-benchmark-dataset',
      cacheStatus: 'not-applicable',
      integritySha256: hashText(builtinRawText),
    }, seenCaseIds))
  }

  return { datasets, issues }
}
