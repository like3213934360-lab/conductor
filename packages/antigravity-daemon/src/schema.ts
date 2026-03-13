import { z } from 'zod'
import { WorkflowStateSchema } from '@anthropic/antigravity-shared'
import { RunBenchmarkDatasetSourceSchema } from './benchmark-dataset.js'
import { ANTIGRAVITY_AUTHORITY_HOST, ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

export const WorkflowStepPolicySchema = z.object({
  strategyId: z.string(),
  when: z.array(z.string()).default([]),
  approvalRequired: z.boolean().default(false),
})

export const WorkflowApprovalGateSchema = z.object({
  gateId: z.string(),
  approverRole: z.string().default('human-reviewer'),
  required: z.boolean().default(true),
})

export const WorkflowQualityPolicySchema = z.object({
  minTextLength: z.number().int().positive().optional(),
  minEvidenceCount: z.number().int().nonnegative().optional(),
  requireDistinctModelFamilies: z.boolean().default(false),
  requireJudgeSignal: z.boolean().default(false),
  requireOracleForHighVerifiability: z.boolean().default(false),
})

export const WorkflowModelContractSchema = z.object({
  role: z.string(),
  modelHint: z.string().optional(),
  modelPool: z.array(z.string()).default([]),
  judgeModelHints: z.array(z.string()).default([]),
  requiresDistinctFromStages: z.array(z.string()).default([]),
  forbidModelIds: z.array(z.string()).default([]),
  judgeRequired: z.boolean().default(false),
})

export const WorkflowStepDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  dependsOn: z.array(z.string()).default([]),
  capability: z.string(),
  description: z.string().optional(),
  taskClass: z.enum(['analysis', 'code', 'text', 'structured-data', 'governance']).default('text'),
  verifiabilityClass: z.enum(['low', 'medium', 'high']).default('medium'),
  outputSchemaId: z.string(),
  qualityPolicy: WorkflowQualityPolicySchema.default({}),
  evidenceRequirements: z.array(z.string()).default([]),
  budgetClass: z.enum(['S', 'M', 'L']).default('M'),
  skippable: z.boolean().default(false),
  skipPolicy: WorkflowStepPolicySchema.optional(),
  approvalGate: WorkflowApprovalGateSchema.optional(),
  modelContract: WorkflowModelContractSchema.optional(),
})

export type WorkflowStepDefinition = z.infer<typeof WorkflowStepDefinitionSchema>

export const WorkflowDefinitionSchema = z.object({
  workflowId: z.string(),
  version: z.string(),
  templateName: z.string(),
  authorityMode: z.literal('daemon-owned'),
  generatedAt: z.string(),
  description: z.string(),
  steps: z.array(WorkflowStepDefinitionSchema).min(1),
})

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>

export const WorkflowInvocationSchema = z.object({
  workflowId: z.string().default('antigravity.strict-full'),
  workflowVersion: z.string().default('1.0.0'),
  goal: z.string().min(1),
  files: z.array(z.string()).default([]),
  initiator: z.string().default('antigravity'),
  workspaceRoot: z.string(),
  hostSessionId: z.string().optional(),
  triggerSource: z.enum(['chat', 'command', 'dashboard']).default('chat'),
  forceFullPath: z.boolean().default(true),
  options: z.object({
    riskHint: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    tokenBudget: z.number().positive().optional(),
  }).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type WorkflowInvocation = z.infer<typeof WorkflowInvocationSchema>

export const ArtifactRefSchema = z.object({
  artifactId: z.string(),
  kind: z.enum(['report', 'receipt', 'trace', 'memory', 'bundle', 'other']),
  uri: z.string(),
  digest: z.string().optional(),
  description: z.string().optional(),
  createdAt: z.string(),
})

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>

export const EvidenceRefSchema = z.object({
  evidenceId: z.string(),
  kind: z.enum(['file', 'tool_receipt', 'trace_span', 'judge_report', 'other']),
  uri: z.string(),
  summary: z.string().optional(),
  createdAt: z.string(),
})

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>

export const JudgeReportSchema = z.object({
  judgeReportId: z.string(),
  judge: z.string(),
  verdict: z.enum(['agree', 'partial', 'disagree', 'needs_human']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  createdAt: z.string(),
})

export type JudgeReport = z.infer<typeof JudgeReportSchema>

export const TribunalModeSchema = z.enum(['remote', 'hybrid', 'local-fallback'])

export type TribunalMode = z.infer<typeof TribunalModeSchema>

export const TribunalSummarySchema = z.object({
  tribunalId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  mode: TribunalModeSchema,
  verdict: z.enum(['agree', 'partial', 'disagree', 'needs_human']),
  confidence: z.number().min(0).max(1),
  quorumSatisfied: z.boolean(),
  remoteJurorCount: z.number().int().nonnegative(),
  totalJurorCount: z.number().int().nonnegative(),
  rationale: z.string(),
  evidenceIds: z.array(z.string()).default([]),
  jurorReportIds: z.array(z.string()).default([]),
  createdAt: z.string(),
})

export type TribunalSummary = z.infer<typeof TribunalSummarySchema>

export const HandoffEnvelopeSchema = z.object({
  handoffId: z.string(),
  runId: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  traceId: z.string(),
  artifactIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  budgetState: z.record(z.string(), z.unknown()).default({}),
  priorJudgeSignals: z.array(JudgeReportSchema).default([]),
  createdAt: z.string(),
})

export type HandoffEnvelope = z.infer<typeof HandoffEnvelopeSchema>

export const PolicyVerdictSchema = z.object({
  verdictId: z.string(),
  runId: z.string(),
  scope: z.string(),
  effect: z.enum(['allow', 'warn', 'block']),
  rationale: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  traceId: z.string().optional(),
  evaluatedAt: z.string(),
})

export type PolicyVerdict = z.infer<typeof PolicyVerdictSchema>

const PolicyLiteralValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const PolicyConditionSchema: z.ZodType<PolicyCondition> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('all'),
    conditions: z.array(PolicyConditionSchema).min(1),
  }),
  z.object({
    kind: z.literal('any'),
    conditions: z.array(PolicyConditionSchema).min(1),
  }),
  z.object({
    kind: z.literal('not'),
    condition: PolicyConditionSchema,
  }),
  z.object({
    kind: z.literal('eq'),
    fact: z.string(),
    value: PolicyLiteralValueSchema,
  }),
  z.object({
    kind: z.literal('ne'),
    fact: z.string(),
    value: PolicyLiteralValueSchema,
  }),
  z.object({
    kind: z.literal('gt'),
    fact: z.string(),
    value: z.number(),
  }),
  z.object({
    kind: z.literal('gte'),
    fact: z.string(),
    value: z.number(),
  }),
  z.object({
    kind: z.literal('lt'),
    fact: z.string(),
    value: z.number(),
  }),
  z.object({
    kind: z.literal('lte'),
    fact: z.string(),
    value: z.number(),
  }),
  z.object({
    kind: z.literal('truthy'),
    fact: z.string(),
  }),
  z.object({
    kind: z.literal('falsy'),
    fact: z.string(),
  }),
  z.object({
    kind: z.literal('empty'),
    fact: z.string(),
  }),
  z.object({
    kind: z.literal('notEmpty'),
    fact: z.string(),
  }),
  z.object({
    kind: z.literal('includes'),
    fact: z.string(),
    value: PolicyLiteralValueSchema,
  }),
]))

export type PolicyCondition =
  | { kind: 'all'; conditions: PolicyCondition[] }
  | { kind: 'any'; conditions: PolicyCondition[] }
  | { kind: 'not'; condition: PolicyCondition }
  | { kind: 'eq'; fact: string; value: string | number | boolean | null }
  | { kind: 'ne'; fact: string; value: string | number | boolean | null }
  | { kind: 'gt'; fact: string; value: number }
  | { kind: 'gte'; fact: string; value: number }
  | { kind: 'lt'; fact: string; value: number }
  | { kind: 'lte'; fact: string; value: number }
  | { kind: 'truthy'; fact: string }
  | { kind: 'falsy'; fact: string }
  | { kind: 'empty'; fact: string }
  | { kind: 'notEmpty'; fact: string }
  | { kind: 'includes'; fact: string; value: string | number | boolean | null }

export const PolicyRuleSchema = z.object({
  ruleId: z.string(),
  scope: z.string(),
  description: z.string(),
  enabled: z.boolean().default(true),
  effect: z.enum(['allow', 'warn', 'block']),
  when: PolicyConditionSchema.optional(),
  message: z.string().optional(),
  evidenceFactKey: z.string().optional(),
})

export type PolicyRule = z.infer<typeof PolicyRuleSchema>

export const PolicyPackSchema = z.object({
  packId: z.string(),
  version: z.string(),
  authorityOwner: z.literal(ANTIGRAVITY_AUTHORITY_OWNER),
  sourcePath: z.string().optional(),
  loadedAt: z.string().optional(),
  rules: z.array(PolicyRuleSchema),
})

export type PolicyPack = z.infer<typeof PolicyPackSchema>

export const ExecutionReceiptSchema = z.object({
  receiptId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  status: z.enum(['completed', 'failed', 'policy_skipped', 'cancelled', 'paused_for_human']),
  traceId: z.string(),
  model: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  outputHash: z.string().optional(),
  artifacts: z.array(ArtifactRefSchema).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  tribunal: TribunalSummarySchema.optional(),
  judgeReports: z.array(JudgeReportSchema).default([]),
  capturedAt: z.string(),
})

export type ExecutionReceipt = z.infer<typeof ExecutionReceiptSchema>

export const TribunalVerdictRecordSchema = TribunalSummarySchema.extend({
  subjectOutputHash: z.string().optional(),
  fallbackUsed: z.boolean().default(false),
  jurorReports: z.array(JudgeReportSchema).default([]),
})

export type TribunalVerdictRecord = z.infer<typeof TribunalVerdictRecordSchema>

export const SkipDecisionSchema = z.object({
  skipDecisionId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  strategyId: z.string(),
  triggerCondition: z.string(),
  approvedBy: z.string(),
  traceId: z.string(),
  evidence: z.array(EvidenceRefSchema).default([]),
  decidedAt: z.string(),
  reason: z.string(),
})

export type SkipDecision = z.infer<typeof SkipDecisionSchema>

export const DaemonNodeStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'policy_skipped',
  'cancelled',
  'paused_for_human',
])

export type DaemonNodeStatus = z.infer<typeof DaemonNodeStatusSchema>

export const RunNodeSnapshotSchema = z.object({
  nodeId: z.string(),
  name: z.string(),
  capability: z.string(),
  dependsOn: z.array(z.string()).default([]),
  status: DaemonNodeStatusSchema,
  model: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  outputSummary: z.string().optional(),
  approvalGateId: z.string().optional(),
  receiptId: z.string().optional(),
  tribunalVerdict: z.enum(['agree', 'partial', 'disagree', 'needs_human']).optional(),
  tribunalConfidence: z.number().min(0).max(1).optional(),
  tribunalMode: TribunalModeSchema.optional(),
  tribunalUpdatedAt: z.string().optional(),
  tribunalQuorumSatisfied: z.boolean().optional(),
})

export type RunNodeSnapshot = z.infer<typeof RunNodeSnapshotSchema>

export const RunStatusSchema = z.enum([
  'starting',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused_for_human',
])

export type RunStatus = z.infer<typeof RunStatusSchema>

export const TraceBundleArtifactSummarySchema = z.object({
  path: z.string(),
  integrityOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type TraceBundleArtifactSummary = z.infer<typeof TraceBundleArtifactSummarySchema>

export const ReleaseAttestationArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type ReleaseAttestationArtifactSummary = z.infer<typeof ReleaseAttestationArtifactSummarySchema>

export const ReleaseDossierArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type ReleaseDossierArtifactSummary = z.infer<typeof ReleaseDossierArtifactSummarySchema>

export const ReleaseBundleArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type ReleaseBundleArtifactSummary = z.infer<typeof ReleaseBundleArtifactSummarySchema>

export const CertificationRecordArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type CertificationRecordArtifactSummary = z.infer<typeof CertificationRecordArtifactSummarySchema>

export const TransparencyLedgerSummarySchema = z.object({
  ledgerPath: z.string(),
  entryCount: z.number().int().nonnegative(),
  latestRunId: z.string().optional(),
  headDigest: z.string().optional(),
  verified: z.boolean().optional(),
  issues: z.array(z.string()).default([]),
})

export type TransparencyLedgerSummary = z.infer<typeof TransparencyLedgerSummarySchema>

export const InvariantReportArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type InvariantReportArtifactSummary = z.infer<typeof InvariantReportArtifactSummarySchema>

export const PolicyReportArtifactSummarySchema = z.object({
  path: z.string(),
  verified: z.boolean().optional(),
  payloadDigestOk: z.boolean().optional(),
  signatureVerified: z.boolean().optional(),
  signatureRequired: z.boolean().optional(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()).default([]),
})

export type PolicyReportArtifactSummary = z.infer<typeof PolicyReportArtifactSummarySchema>

export const ReleaseArtifactsSchema = z.object({
  traceBundle: TraceBundleArtifactSummarySchema.optional(),
  releaseAttestation: ReleaseAttestationArtifactSummarySchema.optional(),
})

export type ReleaseArtifacts = z.infer<typeof ReleaseArtifactsSchema>

export const StepLeaseSchema = z.object({
  leaseId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  authorityOwner: z.literal(ANTIGRAVITY_AUTHORITY_OWNER),
  requiredEvidence: z.array(z.string()).default([]),
  allowedModelPool: z.array(z.string()).default([]),
  inputDigest: z.string().optional(),
})

export type StepLease = z.infer<typeof StepLeaseSchema>

export const StepHeartbeatSchema = z.object({
  leaseId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  heartbeatAt: z.string(),
})

export type StepHeartbeat = z.infer<typeof StepHeartbeatSchema>

export const StepCompletionReceiptSchema = z.object({
  leaseId: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed', 'policy_skipped', 'cancelled', 'paused_for_human']),
  outputHash: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  completedAt: z.string(),
})

export type StepCompletionReceipt = z.infer<typeof StepCompletionReceiptSchema>

export const PreparedCompletionReceiptSchema = StepCompletionReceiptSchema.extend({
  preparedAt: z.string(),
})

export type PreparedCompletionReceipt = z.infer<typeof PreparedCompletionReceiptSchema>

export const CommittedCompletionReceiptSchema = StepCompletionReceiptSchema.extend({
  committedAt: z.string(),
})

export type CommittedCompletionReceipt = z.infer<typeof CommittedCompletionReceiptSchema>

export const CompletionSessionPhaseSchema = z.enum(['pending', 'prepared', 'committed'])

export type CompletionSessionPhase = z.infer<typeof CompletionSessionPhaseSchema>

export const StagedNodeExecutionResultSchema = z.object({
  output: z.record(z.string(), z.unknown()),
  model: z.string().optional(),
  durationMs: z.number().nonnegative(),
  degraded: z.boolean().optional(),
})

export type StagedNodeExecutionResult = z.infer<typeof StagedNodeExecutionResultSchema>

export const StagedCompletionBundleSchema = z.object({
  bundleRef: z.string(),
  result: StagedNodeExecutionResultSchema,
  tribunal: TribunalSummarySchema.optional(),
  receipt: ExecutionReceiptSchema,
  handoffs: z.array(HandoffEnvelopeSchema).default([]),
  stagedAt: z.string(),
})

export type StagedCompletionBundle = z.infer<typeof StagedCompletionBundleSchema>

export const CompletionSessionRecordSchema = z.object({
  sessionId: z.string(),
  runId: z.string(),
  leaseId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  phase: CompletionSessionPhaseSchema,
  receipt: StepCompletionReceiptSchema,
  tribunalVerdictId: z.string().optional(),
  stagedBundleRef: z.string(),
  stagedBundle: StagedCompletionBundleSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  preparedAt: z.string().optional(),
  committedAt: z.string().optional(),
  appliedAt: z.string().optional(),
})

export type CompletionSessionRecord = z.infer<typeof CompletionSessionRecordSchema>

export const StepHeartbeatRequestSchema = z.object({
  leaseId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  heartbeatAt: z.string().optional(),
})

export type StepHeartbeatRequest = z.infer<typeof StepHeartbeatRequestSchema>

export const PrepareCompletionReceiptRequestSchema = z.object({
  leaseId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed', 'policy_skipped', 'cancelled', 'paused_for_human']),
  outputHash: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  completedAt: z.string().optional(),
})

export type PrepareCompletionReceiptRequest = z.infer<typeof PrepareCompletionReceiptRequestSchema>

export const CommitCompletionReceiptRequestSchema = z.object({
  leaseId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  status: z.enum(['completed', 'failed', 'policy_skipped', 'cancelled', 'paused_for_human']),
  outputHash: z.string().optional(),
  model: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  completedAt: z.string().optional(),
  preparedAt: z.string().optional(),
  committedAt: z.string().optional(),
})

export type CommitCompletionReceiptRequest = z.infer<typeof CommitCompletionReceiptRequestSchema>

export const RunSnapshotSchema = z.object({
  runId: z.string(),
  goal: z.string(),
  workflowId: z.string(),
  workflowVersion: z.string(),
  workflowTemplate: z.string(),
  authorityOwner: z.literal(ANTIGRAVITY_AUTHORITY_OWNER),
  authorityHost: z.literal(ANTIGRAVITY_AUTHORITY_HOST),
  workspaceRoot: z.string(),
  hostSessionId: z.string().optional(),
  status: RunStatusSchema,
  phase: z.string(),
  nodes: z.record(z.string(), RunNodeSnapshotSchema),
  runtimeState: WorkflowStateSchema.nullable(),
  activeLease: StepLeaseSchema.optional(),
  activeHeartbeat: StepHeartbeatSchema.optional(),
  pendingCompletionReceipt: StepCompletionReceiptSchema.optional(),
  preparedCompletionReceipt: PreparedCompletionReceiptSchema.optional(),
  acknowledgedCompletionReceipt: CommittedCompletionReceiptSchema.optional(),
  latestTribunalVerdict: TribunalSummarySchema.optional(),
  verdict: z.string().optional(),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  policyReport: PolicyReportArtifactSummarySchema.optional(),
  invariantReport: InvariantReportArtifactSummarySchema.optional(),
  releaseDossier: ReleaseDossierArtifactSummarySchema.optional(),
  releaseBundle: ReleaseBundleArtifactSummarySchema.optional(),
  certificationRecord: CertificationRecordArtifactSummarySchema.optional(),
  transparencyLedger: TransparencyLedgerSummarySchema.optional(),
  timelineCursor: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
})

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>

export const TimelineEntrySchema = z.object({
  sequence: z.number().int().positive(),
  runId: z.string(),
  kind: z.string(),
  nodeId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
})

export type TimelineEntry = z.infer<typeof TimelineEntrySchema>

export const RunDetailsSchema = z.object({
  invocation: WorkflowInvocationSchema,
  definition: WorkflowDefinitionSchema,
  snapshot: RunSnapshotSchema,
})

export type RunDetails = z.infer<typeof RunDetailsSchema>

export const RunSessionResponseSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  authorityOwner: z.literal(ANTIGRAVITY_AUTHORITY_OWNER),
  authorityHost: z.literal(ANTIGRAVITY_AUTHORITY_HOST),
  activeLease: StepLeaseSchema.optional(),
  activeHeartbeat: StepHeartbeatSchema.optional(),
  pendingCompletionReceipt: StepCompletionReceiptSchema.optional(),
  preparedCompletionReceipt: PreparedCompletionReceiptSchema.optional(),
  acknowledgedCompletionReceipt: CommittedCompletionReceiptSchema.optional(),
  latestTribunalVerdict: TribunalSummarySchema.optional(),
  policyReport: PolicyReportArtifactSummarySchema.optional(),
  certificationRecord: CertificationRecordArtifactSummarySchema.optional(),
  transparencyLedger: TransparencyLedgerSummarySchema.optional(),
  timelineCursor: z.number().int().nonnegative(),
  updatedAt: z.string(),
})

export type RunSessionResponse = z.infer<typeof RunSessionResponseSchema>

export const PolicyReportPayloadSchema = z.object({
  run: z.object({
    runId: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    workflowTemplate: z.string(),
    status: z.string(),
    verdict: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  verdicts: z.array(z.object({
    verdictId: z.string(),
    scope: z.string(),
    effect: z.string(),
    evidenceIds: z.array(z.string()),
    rationale: z.array(z.string()),
    evaluatedAt: z.string(),
  })),
  summary: z.object({
    verdictCount: z.number().int().nonnegative(),
    blockCount: z.number().int().nonnegative(),
    warnCount: z.number().int().nonnegative(),
    allowCount: z.number().int().nonnegative(),
    blockedScopes: z.array(z.string()),
  }),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type PolicyReportPayload = z.infer<typeof PolicyReportPayloadSchema>

export const PolicyReportDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: PolicyReportPayloadSchema,
  payloadDigest: z.string(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type PolicyReportDocument = z.infer<typeof PolicyReportDocumentSchema>

export const PolicyReportResponseSchema = z.object({
  runId: z.string(),
  reportPath: z.string(),
  document: PolicyReportDocumentSchema,
})

export type PolicyReportResponse = z.infer<typeof PolicyReportResponseSchema>

export const StartRunRequestSchema = z.object({
  invocation: WorkflowInvocationSchema,
})

export type StartRunRequest = z.infer<typeof StartRunRequestSchema>

export const StartRunResponseSchema = RunDetailsSchema.extend({
  runId: z.string(),
})

export type StartRunResponse = z.infer<typeof StartRunResponseSchema>

export const StreamRunRequestSchema = z.object({
  runId: z.string(),
  cursor: z.number().int().nonnegative().default(0),
})

export type StreamRunRequest = z.infer<typeof StreamRunRequestSchema>

export const StreamRunResponseSchema = z.object({
  snapshot: RunSnapshotSchema,
  entries: z.array(TimelineEntrySchema),
  nextCursor: z.number().int().nonnegative(),
})

export type StreamRunResponse = z.infer<typeof StreamRunResponseSchema>

export const ApproveGateRequestSchema = z.object({
  runId: z.string(),
  gateId: z.string(),
  approvedBy: z.string(),
  comment: z.string().optional(),
})

export type ApproveGateRequest = z.infer<typeof ApproveGateRequestSchema>

export const ReplayRunRequestSchema = z.object({
  runId: z.string(),
  hostSessionId: z.string().optional(),
})

export type ReplayRunRequest = z.infer<typeof ReplayRunRequestSchema>

export const ResumeRunRequestSchema = z.object({
  runId: z.string(),
  approvedBy: z.string().optional(),
  comment: z.string().optional(),
})

export type ResumeRunRequest = z.infer<typeof ResumeRunRequestSchema>

export const TraceBundleResponseSchema = z.object({
  runId: z.string(),
  bundlePath: z.string(),
  timelineEntries: z.number().int().nonnegative(),
  executionReceipts: z.number().int().nonnegative(),
  handoffEnvelopes: z.number().int().nonnegative(),
  skipDecisions: z.number().int().nonnegative(),
  integrity: z.object({
    algorithm: z.literal('sha256'),
    generatedAt: z.string(),
    entryDigests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/i)),
    bundleDigest: z.string().regex(/^[a-f0-9]{64}$/i),
  }),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type TraceBundleResponse = z.infer<typeof TraceBundleResponseSchema>

export const ReleaseAttestationPayloadSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  workflowVersion: z.string(),
  workflowTemplate: z.string(),
  status: z.string(),
  verdict: z.string().optional(),
  completedAt: z.string().optional(),
  traceBundle: z.object({
    bundlePath: z.string(),
    actualBundleDigest: z.string(),
    expectedBundleDigest: z.string().optional(),
    signatureVerified: z.boolean(),
    signatureRequired: z.boolean(),
    signaturePolicyId: z.string().optional(),
    signatureKeyId: z.string().optional(),
    signatureIssuer: z.string().optional(),
    verifiedAt: z.string(),
  }),
  policyVerdicts: z.array(z.object({
    verdictId: z.string(),
    scope: z.string(),
    effect: z.string(),
    evidenceIds: z.array(z.string()),
    rationale: z.array(z.string()),
    evaluatedAt: z.string(),
  })),
  trustRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
  }),
  benchmarkSourceRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
    trustPolicyId: z.string(),
    digestSha256: z.string().optional(),
  }),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type ReleaseAttestationPayload = z.infer<typeof ReleaseAttestationPayloadSchema>

export const ReleaseAttestationDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: ReleaseAttestationPayloadSchema,
  payloadDigest: z.string(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type ReleaseAttestationDocument = z.infer<typeof ReleaseAttestationDocumentSchema>

export const ReleaseAttestationResponseSchema = z.object({
  runId: z.string(),
  attestationPath: z.string(),
  document: ReleaseAttestationDocumentSchema,
})

export type ReleaseAttestationResponse = z.infer<typeof ReleaseAttestationResponseSchema>

export const ReleaseArtifactsResponseSchema = z.object({
  runId: z.string(),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
})

export type ReleaseArtifactsResponse = z.infer<typeof ReleaseArtifactsResponseSchema>

export const InvariantReportPayloadSchema = z.object({
  run: z.object({
    runId: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    workflowTemplate: z.string(),
    status: z.string(),
    verdict: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  invariantFailures: z.array(z.string()),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type InvariantReportPayload = z.infer<typeof InvariantReportPayloadSchema>

export const InvariantReportDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: InvariantReportPayloadSchema,
  payloadDigest: z.string(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type InvariantReportDocument = z.infer<typeof InvariantReportDocumentSchema>

export const InvariantReportResponseSchema = z.object({
  runId: z.string(),
  reportPath: z.string(),
  document: InvariantReportDocumentSchema,
})

export type InvariantReportResponse = z.infer<typeof InvariantReportResponseSchema>

export const ReleaseDossierPayloadSchema = z.object({
  run: z.object({
    runId: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    workflowTemplate: z.string(),
    status: z.string(),
    verdict: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  verification: z.object({
    ok: z.boolean(),
    status: RunStatusSchema,
    releaseGateEffect: z.enum(['allow', 'block']),
    rationale: z.array(z.string()),
    receiptCount: z.number().int().nonnegative(),
    handoffCount: z.number().int().nonnegative(),
    skipDecisionCount: z.number().int().nonnegative(),
    missingReceiptNodes: z.array(z.string()),
    missingSkipDecisionNodes: z.array(z.string()),
    missingSkipReceiptNodes: z.array(z.string()),
    invariantFailures: z.array(z.string()),
  }),
  policyVerdicts: z.array(z.object({
    verdictId: z.string(),
    scope: z.string(),
    effect: z.string(),
    evidenceIds: z.array(z.string()),
    rationale: z.array(z.string()),
    evaluatedAt: z.string(),
  })),
  trustRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
  }),
  benchmarkSourceRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
    trustPolicyId: z.string(),
    digestSha256: z.string().optional(),
  }),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type ReleaseDossierPayload = z.infer<typeof ReleaseDossierPayloadSchema>

export const ReleaseDossierDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: ReleaseDossierPayloadSchema,
  payloadDigest: z.string(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type ReleaseDossierDocument = z.infer<typeof ReleaseDossierDocumentSchema>

export const ReleaseDossierResponseSchema = z.object({
  runId: z.string(),
  dossierPath: z.string(),
  document: ReleaseDossierDocumentSchema,
})

export type ReleaseDossierResponse = z.infer<typeof ReleaseDossierResponseSchema>

export const ReleaseBundlePayloadSchema = z.object({
  run: z.object({
    runId: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    workflowTemplate: z.string(),
    status: z.string(),
    verdict: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  policyReport: PolicyReportArtifactSummarySchema.optional(),
  invariantReport: InvariantReportArtifactSummarySchema.optional(),
  releaseDossier: ReleaseDossierArtifactSummarySchema.optional(),
  certificationRecord: CertificationRecordArtifactSummarySchema.optional(),
  verification: z.object({
    ok: z.boolean(),
    status: RunStatusSchema,
    releaseGateEffect: z.enum(['allow', 'block']),
    rationale: z.array(z.string()),
    receiptCount: z.number().int().nonnegative(),
    handoffCount: z.number().int().nonnegative(),
    skipDecisionCount: z.number().int().nonnegative(),
    missingReceiptNodes: z.array(z.string()),
    missingSkipDecisionNodes: z.array(z.string()),
    missingSkipReceiptNodes: z.array(z.string()),
    invariantFailures: z.array(z.string()),
  }),
  trustRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
  }),
  benchmarkSourceRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
    trustPolicyId: z.string(),
    digestSha256: z.string().optional(),
  }),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type ReleaseBundlePayload = z.infer<typeof ReleaseBundlePayloadSchema>

export const CertificationRecordPayloadSchema = z.object({
  run: z.object({
    runId: z.string(),
    workflowId: z.string(),
    workflowVersion: z.string(),
    workflowTemplate: z.string(),
    status: z.string(),
    verdict: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  releaseBundle: z.object({
    path: z.string(),
    payloadDigest: z.string(),
    signaturePolicyId: z.string().optional(),
    signatureKeyId: z.string().optional(),
    signatureIssuer: z.string().optional(),
  }),
  releaseDossier: ReleaseDossierArtifactSummarySchema.optional(),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  policyReport: PolicyReportArtifactSummarySchema.optional(),
  invariantReport: InvariantReportArtifactSummarySchema.optional(),
  trustRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
  }),
  benchmarkSourceRegistry: z.object({
    registryId: z.string(),
    version: z.string(),
    trustPolicyId: z.string(),
    digestSha256: z.string().optional(),
  }),
  remoteWorkers: z.array(z.object({
    workerId: z.string(),
    agentCardSha256: z.string().optional(),
    verificationSummary: z.enum(['verified', 'warning']).optional(),
  })).default([]),
  governance: z.object({
    finalVerdict: z.string(),
    releaseGateEffect: z.enum(['allow', 'block']),
    blockedScopes: z.array(z.string()).default([]),
  }),
  /** PR-12: digest of the verification snapshot this payload was built from */
  snapshotDigest: z.string().optional(),
})

export type CertificationRecordPayload = z.infer<typeof CertificationRecordPayloadSchema>

export const CertificationRecordDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: CertificationRecordPayloadSchema,
  payloadDigest: z.string(),
  proofGraphDigest: z.string().optional(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type CertificationRecordDocument = z.infer<typeof CertificationRecordDocumentSchema>

export const CertificationRecordResponseSchema = z.object({
  runId: z.string(),
  recordPath: z.string(),
  document: CertificationRecordDocumentSchema,
})

export type CertificationRecordResponse = z.infer<typeof CertificationRecordResponseSchema>

export const TransparencyLedgerEntrySchema = z.object({
  version: z.string(),
  entryId: z.string(),
  index: z.number().int().nonnegative(),
  runId: z.string(),
  certificationRecordPath: z.string(),
  certificationRecordDigest: z.string(),
  releaseBundlePath: z.string(),
  releaseBundleDigest: z.string(),
  previousEntryDigest: z.string().optional(),
  entryDigest: z.string(),
  recordedAt: z.string(),
  /** PR-13: verification snapshot digest for proof graph binding */
  snapshotDigest: z.string().optional(),
  /** PR-13: proof graph digest binding certification + bundle + snapshot */
  proofGraphDigest: z.string().optional(),
})

export type TransparencyLedgerEntry = z.infer<typeof TransparencyLedgerEntrySchema>

export const TransparencyLedgerResponseSchema = z.object({
  ledgerPath: z.string(),
  entryCount: z.number().int().nonnegative(),
  headEntry: TransparencyLedgerEntrySchema.optional(),
  entries: z.array(TransparencyLedgerEntrySchema),
})

export type TransparencyLedgerResponse = z.infer<typeof TransparencyLedgerResponseSchema>

export const ReleaseBundleDocumentSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  payload: ReleaseBundlePayloadSchema,
  payloadDigest: z.string(),
  signaturePolicyId: z.string().optional(),
  signature: z.object({
    scheme: z.literal('hmac-sha256'),
    keyId: z.string(),
    issuer: z.string().optional(),
    signedAt: z.string(),
    signature: z.string().regex(/^[a-f0-9]{64}$/i),
  }).optional(),
})

export type ReleaseBundleDocument = z.infer<typeof ReleaseBundleDocumentSchema>

export const ReleaseBundleResponseSchema = z.object({
  runId: z.string(),
  bundlePath: z.string(),
  document: ReleaseBundleDocumentSchema,
})

export type ReleaseBundleResponse = z.infer<typeof ReleaseBundleResponseSchema>

export const VerifyReleaseAttestationReportSchema = z.object({
  runId: z.string(),
  attestationPath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyReleaseAttestationReport = z.infer<typeof VerifyReleaseAttestationReportSchema>

export const VerifyReleaseArtifactsReportSchema = z.object({
  runId: z.string(),
  ok: z.boolean(),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyReleaseArtifactsReport = z.infer<typeof VerifyReleaseArtifactsReportSchema>

export const VerifyInvariantReportSchema = z.object({
  runId: z.string(),
  reportPath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyInvariantReport = z.infer<typeof VerifyInvariantReportSchema>

export const VerifyPolicyReportSchema = z.object({
  runId: z.string(),
  reportPath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyPolicyReport = z.infer<typeof VerifyPolicyReportSchema>

export const VerifyReleaseDossierReportSchema = z.object({
  runId: z.string(),
  dossierPath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyReleaseDossierReport = z.infer<typeof VerifyReleaseDossierReportSchema>

export const VerifyReleaseBundleReportSchema = z.object({
  runId: z.string(),
  bundlePath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyReleaseBundleReport = z.infer<typeof VerifyReleaseBundleReportSchema>

export const VerifyCertificationRecordReportSchema = z.object({
  runId: z.string(),
  recordPath: z.string(),
  ok: z.boolean(),
  payloadDigestOk: z.boolean(),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyCertificationRecordReport = z.infer<typeof VerifyCertificationRecordReportSchema>

export const VerifyTransparencyLedgerReportSchema = z.object({
  ledgerPath: z.string(),
  ok: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  headDigest: z.string().optional(),
  issues: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyTransparencyLedgerReport = z.infer<typeof VerifyTransparencyLedgerReportSchema>

export const VerifyTraceBundleReportSchema = z.object({
  runId: z.string(),
  bundlePath: z.string(),
  ok: z.boolean(),
  algorithm: z.literal('sha256'),
  actualBundleDigest: z.string(),
  expectedBundleDigest: z.string().optional(),
  mismatchedEntries: z.array(z.string()),
  missingEntries: z.array(z.string()),
  signatureVerified: z.boolean(),
  signatureRequired: z.boolean(),
  signaturePolicyId: z.string().optional(),
  signatureKeyId: z.string().optional(),
  signatureIssuer: z.string().optional(),
  failedSignatureChecks: z.array(z.string()),
  verifiedAt: z.string(),
})

export type VerifyTraceBundleReport = z.infer<typeof VerifyTraceBundleReportSchema>

export const VerifyRunReportSchema = z.object({
  runId: z.string(),
  ok: z.boolean(),
  status: RunStatusSchema,
  releaseGateEffect: z.enum(['allow', 'block']),
  rationale: z.array(z.string()),
  receiptCount: z.number().int().nonnegative(),
  handoffCount: z.number().int().nonnegative(),
  skipDecisionCount: z.number().int().nonnegative(),
  missingReceiptNodes: z.array(z.string()),
  missingTribunalNodes: z.array(z.string()).default([]),
  tribunalFailures: z.array(z.string()).default([]),
  missingSkipDecisionNodes: z.array(z.string()),
  missingSkipReceiptNodes: z.array(z.string()),
  invariantFailures: z.array(z.string()),
  releaseArtifacts: ReleaseArtifactsSchema.default({}),
  verifiedAt: z.string(),
})

export type VerifyRunReport = z.infer<typeof VerifyRunReportSchema>

export const MemorySearchRequestSchema = z.object({
  query: z.string().min(1),
  files: z.array(z.string()).default([]),
  topK: z.number().int().positive().default(5),
})

export type MemorySearchRequest = z.input<typeof MemorySearchRequestSchema>

export const MemorySearchResponseSchema = z.object({
  reflexionPrompts: z.array(z.unknown()).default([]),
  relevantFacts: z.array(z.unknown()).default([]),
  promptCount: z.number().int().nonnegative(),
  factCount: z.number().int().nonnegative(),
  budgetStatus: z.object({
    maxSemanticFacts: z.number().int().nonnegative(),
    currentSemanticFacts: z.number().int().nonnegative(),
    utilizationPercent: z.number().int().nonnegative(),
    overBudget: z.boolean(),
  }),
})

export type MemorySearchResponse = z.infer<typeof MemorySearchResponseSchema>

export const BenchmarkSourceRegistryEntrySchema = z.object({
  sourceId: z.string(),
  location: z.string(),
  enabled: z.boolean(),
  required: z.boolean(),
  authEnvVar: z.string().optional(),
  expectedDatasetId: z.string().optional(),
  expectedVersion: z.string().optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  cacheTtlMs: z.number().int().nonnegative(),
  allowStaleOnError: z.boolean(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  locked: z.boolean(),
})

export type BenchmarkSourceRegistryEntry = z.infer<typeof BenchmarkSourceRegistryEntrySchema>

export const BenchmarkSourceRegistrySignatureSchema = z.object({
  scheme: z.literal('hmac-sha256'),
  keyId: z.string(),
  issuer: z.string().optional(),
  signedAt: z.string(),
})

export type BenchmarkSourceRegistrySignature = z.infer<typeof BenchmarkSourceRegistrySignatureSchema>

export const BenchmarkSourceRegistryVerificationCheckSchema = z.object({
  checkId: z.string(),
  ok: z.boolean(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
})

export type BenchmarkSourceRegistryVerificationCheck = z.infer<typeof BenchmarkSourceRegistryVerificationCheckSchema>

export const BenchmarkSourceRegistryVerificationSchema = z.object({
  verifiedAt: z.string(),
  summary: z.enum(['verified', 'warning']),
  checks: z.array(BenchmarkSourceRegistryVerificationCheckSchema).default([]),
})

export type BenchmarkSourceRegistryVerification = z.infer<typeof BenchmarkSourceRegistryVerificationSchema>

export const TrustRegistryScopeSchema = z.enum([
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

export type TrustRegistryScope = z.infer<typeof TrustRegistryScopeSchema>

export const TrustRegistryKeyStatusSchema = z.enum([
  'active',
  'staged',
  'retired',
])

export type TrustRegistryKeyStatus = z.infer<typeof TrustRegistryKeyStatusSchema>

export const TrustRegistryKeySnapshotSchema = z.object({
  keyId: z.string(),
  scheme: z.literal('hmac-sha256'),
  issuer: z.string().optional(),
  envVar: z.string().optional(),
  description: z.string().optional(),
  scopes: z.array(TrustRegistryScopeSchema).default([]),
  status: TrustRegistryKeyStatusSchema,
  validFrom: z.string().optional(),
  expiresAt: z.string().optional(),
  rotationGroup: z.string().optional(),
  hasSecret: z.boolean(),
})

export type TrustRegistryKeySnapshot = z.infer<typeof TrustRegistryKeySnapshotSchema>

export const TrustRegistrySignerPolicySnapshotSchema = z.object({
  policyId: z.string(),
  scope: TrustRegistryScopeSchema,
  description: z.string().optional(),
  enabled: z.boolean(),
  requireSignature: z.boolean(),
  allowedKeyStatuses: z.array(TrustRegistryKeyStatusSchema).default([]),
  allowedRotationGroups: z.array(z.string()).default([]),
  allowedKeyIds: z.array(z.string()).default([]),
  allowedIssuers: z.array(z.string()).default([]),
  maxSignatureAgeMs: z.number().int().positive().optional(),
})

export type TrustRegistrySignerPolicySnapshot = z.infer<typeof TrustRegistrySignerPolicySnapshotSchema>

export const TrustRegistryVerificationCheckSchema = z.object({
  checkId: z.string(),
  ok: z.boolean(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
})

export type TrustRegistryVerificationCheck = z.infer<typeof TrustRegistryVerificationCheckSchema>

export const TrustRegistryVerificationSchema = z.object({
  verifiedAt: z.string(),
  summary: z.enum(['verified', 'warning']),
  checks: z.array(TrustRegistryVerificationCheckSchema).default([]),
})

export type TrustRegistryVerification = z.infer<typeof TrustRegistryVerificationSchema>

export const TrustRegistrySnapshotSchema = z.object({
  registryId: z.string(),
  version: z.string(),
  sourcePath: z.string().optional(),
  loadedAt: z.string(),
  verification: TrustRegistryVerificationSchema,
  keys: z.array(TrustRegistryKeySnapshotSchema).default([]),
  signerPolicies: z.array(TrustRegistrySignerPolicySnapshotSchema).default([]),
})

export type TrustRegistrySnapshot = z.infer<typeof TrustRegistrySnapshotSchema>

export const BenchmarkSourceRegistrySnapshotSchema = z.object({
  registryId: z.string(),
  version: z.string(),
  sourcePath: z.string().optional(),
  loadedAt: z.string(),
  trustPolicyId: z.string(),
  digestSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  signature: BenchmarkSourceRegistrySignatureSchema.optional(),
  verification: BenchmarkSourceRegistryVerificationSchema,
  sources: z.array(BenchmarkSourceRegistryEntrySchema).default([]),
})

export type BenchmarkSourceRegistrySnapshot = z.infer<typeof BenchmarkSourceRegistrySnapshotSchema>

export const RemoteWorkerVerificationCheckSchema = z.object({
  checkId: z.string(),
  ok: z.boolean(),
  severity: z.enum(['info', 'warn', 'error']),
  message: z.string(),
})

export type RemoteWorkerVerificationCheck = z.infer<typeof RemoteWorkerVerificationCheckSchema>

export const RemoteWorkerVerificationSchema = z.object({
  verifiedAt: z.string(),
  summary: z.enum(['verified', 'warning']),
  checks: z.array(RemoteWorkerVerificationCheckSchema).default([]),
})

export type RemoteWorkerVerification = z.infer<typeof RemoteWorkerVerificationSchema>

export const RemoteWorkerSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentCardVersion: z.string(),
  agentCardSchemaVersion: z.string().optional(),
  agentCardPublishedAt: z.string().optional(),
  agentCardExpiresAt: z.string().optional(),
  agentCardAdvertisementSignatureKeyId: z.string().optional(),
  agentCardAdvertisementSignatureIssuer: z.string().optional(),
  agentCardAdvertisementSignedAt: z.string().optional(),
  advertisementTrustPolicyId: z.string(),
  agentCardSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  agentCardEtag: z.string().optional(),
  agentCardLastModified: z.string().optional(),
  endpoint: z.string(),
  taskEndpoint: z.string(),
  selectedResponseMode: z.enum(['inline', 'poll', 'stream', 'callback']),
  supportedResponseModes: z.array(z.enum(['inline', 'poll', 'stream', 'callback'])).default([]),
  taskProtocolSource: z.literal('agent-card'),
  statusEndpointTemplate: z.string().optional(),
  streamEndpointTemplate: z.string().optional(),
  callbackUrlTemplate: z.string().optional(),
  callbackAuthScheme: z.literal('hmac-sha256').optional(),
  callbackSignatureHeader: z.string().optional(),
  callbackTimestampHeader: z.string().optional(),
  callbackSignatureEncoding: z.literal('hex').optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  maxPollAttempts: z.number().int().positive().optional(),
  callbackTimeoutMs: z.number().int().positive().optional(),
  /** PR-03: Maximum allowed clock skew for callback timestamp freshness */
  maxCallbackSkewMs: z.number().int().positive().optional(),
  capabilities: z.array(z.string()),
  health: z.enum(['healthy', 'degraded', 'unreachable', 'unknown']),
  trustScore: z.number(),
  source: z.string(),
  preferredNodeIds: z.array(z.string()).default([]),
  verification: RemoteWorkerVerificationSchema,
  lastError: z.string().optional(),
  /** PR-14: whether this worker is eligible for delegation under the current trust mode */
  delegable: z.boolean().default(true),
  /** PR-14: reason delegation is blocked (present when delegable is false) */
  delegationBlockReason: z.enum([
    'worker_not_healthy',
    'trust_score_below_min',
    'verification_not_verified',
  ]).optional(),
})

export type RemoteWorkerSnapshot = z.infer<typeof RemoteWorkerSnapshotSchema>

export const RemoteWorkerDiscoveryIssueSchema = z.object({
  id: z.string(),
  issueKind: z.enum(['discovery', 'agent-card', 'protocol', 'auth', 'routing']),
  endpoint: z.string(),
  agentCardUrl: z.string(),
  expectedAgentCardSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  expectedAdvertisementSchemaVersion: z.string().optional(),
  advertisementTrustPolicyId: z.string().optional(),
  requiredAdvertisementSignature: z.boolean().optional(),
  allowedAdvertisementKeyStatuses: z.array(TrustRegistryKeyStatusSchema).default([]),
  allowedAdvertisementRotationGroups: z.array(z.string()).default([]),
  allowedAdvertisementKeyIds: z.array(z.string()).default([]),
  allowedAdvertisementIssuers: z.array(z.string()).default([]),
  error: z.string(),
  capabilities: z.array(z.string()).default([]),
  preferredNodeIds: z.array(z.string()).default([]),
  minTrustScore: z.number(),
  detectedAt: z.string(),
})

export type RemoteWorkerDiscoveryIssue = z.infer<typeof RemoteWorkerDiscoveryIssueSchema>

export const RemoteWorkerListResponseSchema = z.object({
  refreshedAt: z.string(),
  workers: z.array(RemoteWorkerSnapshotSchema),
  discoveryIssues: z.array(RemoteWorkerDiscoveryIssueSchema).default([]),
  /** PR-14: current trust mode for delegation decisions */
  trustMode: z.enum(['strict', 'relaxed']).optional(),
})

export type RemoteWorkerListResponse = z.infer<typeof RemoteWorkerListResponseSchema>

export const RemoteWorkerCallbackReceiptSchema = z.object({
  callbackToken: z.string(),
  runId: z.string(),
  taskId: z.string(),
  workerId: z.string(),
  status: z.enum(['completed', 'failed']),
  verifiedSignature: z.boolean(),
  receivedAt: z.string(),
})

export type RemoteWorkerCallbackReceipt = z.infer<typeof RemoteWorkerCallbackReceiptSchema>

export const SelfTestCheckSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  message: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
})

export type SelfTestCheck = z.infer<typeof SelfTestCheckSchema>

export const RunBenchmarkRequestSchema = z.object({
  suiteIds: z.array(z.string()).default([]),
  caseIds: z.array(z.string()).default([]),
  datasetSources: z.array(RunBenchmarkDatasetSourceSchema).default([]),
})

export type RunBenchmarkRequest = z.input<typeof RunBenchmarkRequestSchema>

export const BenchmarkSuiteDescriptorSchema = z.object({
  suiteId: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()).default([]),
})

export type BenchmarkSuiteDescriptor = z.infer<typeof BenchmarkSuiteDescriptorSchema>

export const BenchmarkCaseResultSchema = z.object({
  caseId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  checks: z.array(SelfTestCheckSchema),
})

export type BenchmarkCaseResult = z.infer<typeof BenchmarkCaseResultSchema>

export const BenchmarkSuiteResultSchema = BenchmarkSuiteDescriptorSchema.extend({
  ok: z.boolean(),
  totalCases: z.number().int().nonnegative().default(0),
  passedCases: z.number().int().nonnegative().default(0),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  avgDurationMs: z.number().int().nonnegative().default(0),
  cases: z.array(BenchmarkCaseResultSchema).default([]),
  checks: z.array(SelfTestCheckSchema),
})

export type BenchmarkSuiteResult = z.infer<typeof BenchmarkSuiteResultSchema>

export const BenchmarkHarnessReportSchema = z.object({
  harnessId: z.string(),
  manifestVersion: z.string(),
  sourcePath: z.string().optional(),
  suiteIds: z.array(z.string()),
  caseIds: z.array(z.string()).default([]),
  ok: z.boolean(),
  ranAt: z.string(),
  totalCases: z.number().int().nonnegative().default(0),
  passedCases: z.number().int().nonnegative().default(0),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  suites: z.array(BenchmarkSuiteResultSchema),
})

export type BenchmarkHarnessReport = z.infer<typeof BenchmarkHarnessReportSchema>

export const RunInteropRequestSchema = z.object({
  suiteIds: z.array(z.string()).default([]),
})

export type RunInteropRequest = z.infer<typeof RunInteropRequestSchema>

export const InteropHarnessReportSchema = z.object({
  harnessId: z.string(),
  manifestVersion: z.string(),
  sourcePath: z.string().optional(),
  suiteIds: z.array(z.string()),
  ok: z.boolean(),
  ranAt: z.string(),
  totalCases: z.number().int().nonnegative().default(0),
  passedCases: z.number().int().nonnegative().default(0),
  totalChecks: z.number().int().nonnegative(),
  passedChecks: z.number().int().nonnegative(),
  suites: z.array(BenchmarkSuiteResultSchema),
})

export type InteropHarnessReport = z.infer<typeof InteropHarnessReportSchema>

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'paused_for_human'
}
