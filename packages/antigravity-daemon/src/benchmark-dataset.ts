import { z } from 'zod'
import { ANTIGRAVITY_AUTHORITY_HOST, ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

export const BenchmarkDatasetSourceConfigSchema = z.object({
  sourceId: z.string().optional(),
  location: z.string().min(1),
  enabled: z.boolean().default(true),
  required: z.boolean().default(true),
  authEnvVar: z.string().optional(),
  expectedDatasetId: z.string().optional(),
  expectedVersion: z.string().optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  cacheTtlMs: z.number().int().nonnegative().default(300_000),
  allowStaleOnError: z.boolean().default(true),
})

export type BenchmarkDatasetSourceConfig = z.infer<typeof BenchmarkDatasetSourceConfigSchema>
export type BenchmarkDatasetSourceConfigInput = z.input<typeof BenchmarkDatasetSourceConfigSchema>

export const BenchmarkDatasetSourceRegistryEntrySchema = BenchmarkDatasetSourceConfigSchema.extend({
  sourceId: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  locked: z.boolean().default(false),
})

export type BenchmarkDatasetSourceRegistryEntry = z.infer<typeof BenchmarkDatasetSourceRegistryEntrySchema>

export const BenchmarkDatasetSourceRegistrySignatureSchema = z.object({
  scheme: z.literal('hmac-sha256'),
  keyId: z.string().min(1),
  issuer: z.string().min(1).optional(),
  signedAt: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
})

export type BenchmarkDatasetSourceRegistrySignature = z.infer<typeof BenchmarkDatasetSourceRegistrySignatureSchema>

export const BenchmarkDatasetSourceRegistryFileSchema = z.object({
  registryId: z.string().default('workspace-benchmark-source-registry'),
  version: z.string().default('1.0.0'),
  trustPolicyId: z.string().default('default:benchmark-source-registry'),
  sources: z.array(BenchmarkDatasetSourceRegistryEntrySchema).default([]),
  signature: BenchmarkDatasetSourceRegistrySignatureSchema.optional(),
})

export type BenchmarkDatasetSourceRegistryFile = z.infer<typeof BenchmarkDatasetSourceRegistryFileSchema>
export type BenchmarkDatasetSourceRegistryFileInput = z.input<typeof BenchmarkDatasetSourceRegistryFileSchema>

export const BenchmarkDatasetSourceRefSchema = z.object({
  registryRef: z.string().min(1),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  authEnvVar: z.string().optional(),
  expectedDatasetId: z.string().optional(),
  expectedVersion: z.string().optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  cacheTtlMs: z.number().int().nonnegative().optional(),
  allowStaleOnError: z.boolean().optional(),
})

export type BenchmarkDatasetSourceRef = z.infer<typeof BenchmarkDatasetSourceRefSchema>

export const RunBenchmarkDatasetSourceSchema = z.union([
  z.string().min(1),
  BenchmarkDatasetSourceConfigSchema,
  BenchmarkDatasetSourceRefSchema,
])

export type RunBenchmarkDatasetSource = z.input<typeof RunBenchmarkDatasetSourceSchema>

export const CompiledWorkflowBenchmarkCaseSchema = z.object({
  caseKind: z.literal('compiledWorkflow').default('compiledWorkflow'),
  caseId: z.string(),
  name: z.string(),
  workflowId: z.enum(['antigravity.strict-full', 'antigravity.adaptive']),
  workflowVersion: z.string().default('1.0.0'),
  goal: z.string().min(1),
  expectedTemplate: z.string().optional(),
  expectedAuthorityMode: z.literal('daemon-owned').default('daemon-owned'),
  expectedNodeCount: z.number().int().positive().default(7),
  expectedEdgeCount: z.number().int().nonnegative().default(6),
  requiredNodeIds: z.array(z.string()).default([]),
  requiredApprovalGateIds: z.array(z.string()).default([]),
  expectDebateSkippable: z.boolean().optional(),
  expectedDebateStrategyId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

export const TraceBundleBenchmarkCaseSchema = z.object({
  caseKind: z.literal('traceBundle'),
  caseId: z.string(),
  name: z.string(),
  sourcePath: z.string().min(1),
  expectedRunStatus: z.enum(['starting', 'running', 'completed', 'failed', 'cancelled', 'paused_for_human']).optional(),
  expectedWorkflowTemplate: z.string().optional(),
  expectedAuthorityOwner: z.literal(ANTIGRAVITY_AUTHORITY_OWNER).default(ANTIGRAVITY_AUTHORITY_OWNER),
  expectedAuthorityHost: z.literal(ANTIGRAVITY_AUTHORITY_HOST).default(ANTIGRAVITY_AUTHORITY_HOST),
  minExecutionReceipts: z.number().int().nonnegative().default(1),
  minTimelineEntries: z.number().int().nonnegative().default(1),
  minPolicyVerdicts: z.number().int().nonnegative().default(1),
  requiredTimelineKinds: z.array(z.string()).default([]),
  requiredPolicyScopes: z.array(z.string()).default([]),
  requiredNodeStatuses: z.record(z.string(), z.string()).default({}),
  requiredRemoteWorkerResponseModes: z.array(z.enum(['inline', 'poll', 'stream', 'callback'])).default([]),
  requireTraceBundleIntegrity: z.boolean().default(false),
  requireSignedTraceBundle: z.boolean().default(false),
  requiredTraceBundleSignatureKeyIds: z.array(z.string()).default([]),
  requiredTraceBundleSignatureIssuers: z.array(z.string()).default([]),
  requiredTraceBundleSignaturePolicyId: z.string().optional(),
  releaseAttestationPath: z.string().optional(),
  requireReleaseAttestation: z.boolean().default(false),
  requireSignedReleaseAttestation: z.boolean().default(false),
  requiredReleaseAttestationSignatureKeyIds: z.array(z.string()).default([]),
  requiredReleaseAttestationSignatureIssuers: z.array(z.string()).default([]),
  requiredReleaseAttestationSignaturePolicyId: z.string().optional(),
  certificationRecordPath: z.string().optional(),
  requireCertificationRecord: z.boolean().default(false),
  requireSignedCertificationRecord: z.boolean().default(false),
  requiredCertificationRecordSignatureKeyIds: z.array(z.string()).default([]),
  requiredCertificationRecordSignatureIssuers: z.array(z.string()).default([]),
  requiredCertificationRecordSignaturePolicyId: z.string().optional(),
  requireAgentCardDigests: z.boolean().default(false),
  requiredAgentCardSchemaVersions: z.array(z.string()).default([]),
  requireSignedAgentCardAdvertisements: z.boolean().default(false),
  requiredAgentCardAdvertisementKeyIds: z.array(z.string()).default([]),
  requiredAgentCardAdvertisementIssuers: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

export const BenchmarkDatasetCaseSchema = z.discriminatedUnion('caseKind', [
  CompiledWorkflowBenchmarkCaseSchema,
  TraceBundleBenchmarkCaseSchema,
])

export type BenchmarkDatasetCase = z.infer<typeof BenchmarkDatasetCaseSchema>
export type CompiledWorkflowBenchmarkCase = z.infer<typeof CompiledWorkflowBenchmarkCaseSchema>
export type TraceBundleBenchmarkCase = z.infer<typeof TraceBundleBenchmarkCaseSchema>

export const BenchmarkDatasetFileSchema = z.object({
  datasetId: z.string().default('antigravity-benchmark-dataset'),
  version: z.string().default('1.0.0'),
  cases: z.array(BenchmarkDatasetCaseSchema).default([]),
})

export type BenchmarkDatasetFile = z.infer<typeof BenchmarkDatasetFileSchema>

export type BenchmarkDatasetSourceKind =
  | 'builtin-default'
  | 'workspace-file'
  | 'manifest-source'
  | 'request-source'

export interface LoadedBenchmarkDataset {
  datasetId: string
  version: string
  sourceId: string
  sourceKind: BenchmarkDatasetSourceKind
  sourceLocation: string
  sourcePath?: string
  cacheStatus?: 'not-applicable' | 'miss' | 'hit' | 'revalidated' | 'stale-fallback'
  integritySha256?: string
  cases: BenchmarkDatasetCase[]
}

export const DEFAULT_BENCHMARK_DATASET: Omit<LoadedBenchmarkDataset, 'sourceId' | 'sourceKind' | 'sourceLocation' | 'sourcePath'> = {
  datasetId: 'antigravity-benchmark-dataset',
  version: '1.0.0',
  cases: [
    {
      caseKind: 'compiledWorkflow',
      caseId: 'strict-full-canonical-graph',
      name: 'Strict Full Canonical Graph',
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Compile the canonical strict Antigravity workflow.',
      expectedTemplate: 'antigravity.strict-full.v1',
      expectedAuthorityMode: 'daemon-owned',
      expectedNodeCount: 7,
      expectedEdgeCount: 6,
      requiredNodeIds: ['ANALYZE', 'PARALLEL', 'DEBATE', 'VERIFY', 'SYNTHESIZE', 'PERSIST', 'HITL'],
      requiredApprovalGateIds: ['antigravity-final-gate'],
      expectDebateSkippable: false,
      tags: ['strict', 'workflow'],
      metadata: {},
      enabled: true,
    },
    {
      caseKind: 'compiledWorkflow',
      caseId: 'adaptive-debate-policy-skip',
      name: 'Adaptive Debate Policy Skip',
      workflowId: 'antigravity.adaptive',
      workflowVersion: '1.0.0',
      goal: 'Compile the adaptive Antigravity workflow with policy-authorized debate skipping.',
      expectedTemplate: 'antigravity.adaptive.v1',
      expectedAuthorityMode: 'daemon-owned',
      expectedNodeCount: 7,
      expectedEdgeCount: 6,
      requiredNodeIds: ['ANALYZE', 'PARALLEL', 'DEBATE', 'VERIFY', 'SYNTHESIZE', 'PERSIST', 'HITL'],
      requiredApprovalGateIds: ['antigravity-final-gate'],
      expectDebateSkippable: true,
      expectedDebateStrategyId: 'adaptive.debate-express.v1',
      tags: ['adaptive', 'policy'],
      metadata: {},
      enabled: true,
    },
    {
      caseKind: 'compiledWorkflow',
      caseId: 'adaptive-human-gate-terminal',
      name: 'Adaptive Human Gate Terminal',
      workflowId: 'antigravity.adaptive',
      workflowVersion: '1.0.0',
      goal: 'Validate that adaptive workflows retain the final human gate.',
      expectedTemplate: 'antigravity.adaptive.v1',
      expectedAuthorityMode: 'daemon-owned',
      expectedNodeCount: 7,
      expectedEdgeCount: 6,
      requiredNodeIds: ['PERSIST', 'HITL'],
      requiredApprovalGateIds: ['antigravity-final-gate'],
      expectDebateSkippable: true,
      expectedDebateStrategyId: 'adaptive.debate-express.v1',
      tags: ['adaptive', 'human-gate'],
      metadata: {},
      enabled: true,
    },
  ],
}
