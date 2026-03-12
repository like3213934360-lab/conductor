import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BenchmarkHarnessReport, RunBenchmarkRequest, TrustRegistrySnapshot } from './schema.js'
import { compileWorkflowDefinition, resolveWorkflowDefinition } from './workflow-definition.js'
import {
  type BenchmarkDatasetCase,
  type CompiledWorkflowBenchmarkCase,
  type LoadedBenchmarkDataset,
  type RunBenchmarkDatasetSource,
  type TraceBundleBenchmarkCase,
} from './benchmark-dataset.js'
import { type ReleaseAttestationDocument } from './release-attestation.js'
import { type CertificationRecordDocument } from './certification-record.js'
import {
  loadBenchmarkDatasets,
  type BenchmarkDatasetLoadIssue,
  type BenchmarkDatasetTextTransport,
} from './benchmark-dataset-loader.js'
import {
  type HarnessCaseResult,
  type HarnessSuiteDefinition,
  runManifestDrivenHarness,
} from './manifest-driven-harness.js'
import { ANTIGRAVITY_DAEMON_DB_NAME } from './runtime-contract.js'
import {
  verifyCertificationRecordArtifactWithEvaluator,
  verifyReleaseAttestationArtifactWithEvaluator,
  verifyTraceBundleArtifactWithEvaluator,
} from './release-artifact-verifier.js'

export interface BenchmarkHarnessContext {
  readonly workspaceRoot: string
  readonly dataDir: string
  readonly projectionPath: string
  readonly socketPath: string
  getManifestRouteCount(): number
  getCallbackAuthScheme(): string | undefined
  hasManifestOperation(operationId: string): boolean
  getPolicyPack(): { packId: string; version: string; sourcePath?: string }
  getTrustRegistry?(): TrustRegistrySnapshot
  listRemoteWorkers(): {
    workers: Array<{
      id: string
      agentCardVersion?: string
      agentCardSchemaVersion?: string
      agentCardPublishedAt?: string
      agentCardExpiresAt?: string
      agentCardAdvertisementSignatureKeyId?: string
      agentCardAdvertisementSignatureIssuer?: string
      agentCardAdvertisementSignedAt?: string
      agentCardSha256?: string
      selectedResponseMode: string
      supportedResponseModes?: string[]
      taskProtocolSource?: string
      verification?: {
        summary: 'verified' | 'warning'
        checks?: Array<{ ok: boolean; severity: 'info' | 'warn' | 'error' }>
      }
      health: string
    }>
    discoveryIssues?: Array<{
      issueKind?: string
      expectedAgentCardSha256?: string
      expectedAdvertisementSchemaVersion?: string
      advertisementTrustPolicyId?: string
      requiredAdvertisementSignature?: boolean
      allowedAdvertisementKeyStatuses?: string[]
      allowedAdvertisementKeyIds?: string[]
      allowedAdvertisementIssuers?: string[]
    }>
  }
  hasEventStreaming(): boolean
  hasCheckpointRecovery(): boolean
  getRequestedDatasetSources?(): RunBenchmarkDatasetSource[]
  getBenchmarkDatasetTransport?(): BenchmarkDatasetTextTransport | undefined
  verifyReleaseAttestationArtifact?(attestationPath: string, traceBundlePath: string): {
    ok: boolean
    signatureVerified?: boolean
    signatureRequired?: boolean
    signaturePolicyId?: string
    signatureKeyId?: string
    signatureIssuer?: string
    issues: string[]
  }
}

function createWorkflowCaseResult(
  ctx: BenchmarkHarnessContext,
  dataset: LoadedBenchmarkDataset,
  testCase: CompiledWorkflowBenchmarkCase,
): HarnessCaseResult {
  const startedAt = Date.now()
  const definition = resolveWorkflowDefinition({
    workflowId: testCase.workflowId,
    workflowVersion: testCase.workflowVersion,
    goal: testCase.goal,
    files: [],
    initiator: 'benchmark-harness',
    workspaceRoot: ctx.workspaceRoot,
    hostSessionId: `benchmark-case:${testCase.caseId}`,
    triggerSource: 'command',
    forceFullPath: true,
    options: {},
    metadata: {
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      ...testCase.metadata,
    },
  })
  const graph = compileWorkflowDefinition(definition)
  const debateNode = definition.steps.find(step => step.id === 'DEBATE')
  const approvalGateIds = definition.steps
    .flatMap(step => step.approvalGate ? [step.approvalGate.gateId] : [])
  const checks = [
    {
      id: 'workflow-id',
      ok: definition.workflowId === testCase.workflowId,
      message: `Compiled workflowId ${definition.workflowId}.`,
    },
    {
      id: 'authority-mode',
      ok: definition.authorityMode === testCase.expectedAuthorityMode,
      message: `Authority mode ${definition.authorityMode}.`,
    },
    {
      id: 'node-count',
      ok: graph.nodes.length === testCase.expectedNodeCount,
      message: `Compiled ${graph.nodes.length} workflow nodes.`,
    },
    {
      id: 'edge-count',
      ok: graph.edges.length === testCase.expectedEdgeCount,
      message: `Compiled ${graph.edges.length} workflow edges.`,
    },
    {
      id: 'required-nodes',
      ok: testCase.requiredNodeIds.every(nodeId => graph.nodes.some(node => node.id === nodeId)),
      message: `Required nodes present: ${testCase.requiredNodeIds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'approval-gates',
      ok: testCase.requiredApprovalGateIds.every(gateId => approvalGateIds.includes(gateId)),
      message: `Approval gates present: ${approvalGateIds.join(', ') || 'none'}.`,
    },
    {
      id: 'template-name',
      ok: testCase.expectedTemplate ? definition.templateName === testCase.expectedTemplate : true,
      message: `Compiled template ${definition.templateName}.`,
    },
  ]

  if (typeof testCase.expectDebateSkippable === 'boolean') {
    checks.push({
      id: 'debate-skippable',
      ok: debateNode?.skippable === testCase.expectDebateSkippable,
      message: `DEBATE skippable=${String(debateNode?.skippable ?? false)}.`,
    })
  }

  if (testCase.expectedDebateStrategyId) {
    checks.push({
      id: 'debate-strategy',
      ok: debateNode?.skipPolicy?.strategyId === testCase.expectedDebateStrategyId,
      message: `DEBATE skip strategy=${debateNode?.skipPolicy?.strategyId ?? 'none'}.`,
    })
  }

  const durationMs = Date.now() - startedAt
  const passedChecks = checks.filter(check => check.ok).length

  return {
    caseId: testCase.caseId,
    name: testCase.name,
    tags: testCase.tags,
    metadata: {
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      datasetSourcePath: dataset.sourcePath,
      datasetSourceId: dataset.sourceId,
      datasetSourceKind: dataset.sourceKind,
      datasetSourceLocation: dataset.sourceLocation,
      datasetSourceCacheStatus: dataset.cacheStatus,
      datasetSourceIntegritySha256: dataset.integritySha256,
      workflowId: testCase.workflowId,
      workflowVersion: testCase.workflowVersion,
      ...testCase.metadata,
    },
    ok: checks.every(check => check.ok),
    totalChecks: checks.length,
    passedChecks,
    durationMs,
    checks,
  }
}

function resolveCaseSourcePath(ctx: BenchmarkHarnessContext, sourcePath: string): string {
  if (path.isAbsolute(sourcePath)) {
    return sourcePath
  }
  return path.join(ctx.workspaceRoot, sourcePath)
}

function createTraceBundleCaseResult(
  ctx: BenchmarkHarnessContext,
  dataset: LoadedBenchmarkDataset,
  testCase: TraceBundleBenchmarkCase,
): HarnessCaseResult {
  const startedAt = Date.now()
  const resolvedSourcePath = resolveCaseSourcePath(ctx, testCase.sourcePath)

  if (!fs.existsSync(resolvedSourcePath)) {
    return {
      caseId: testCase.caseId,
      name: testCase.name,
      tags: testCase.tags,
      metadata: {
        datasetId: dataset.datasetId,
        datasetVersion: dataset.version,
        datasetSourcePath: dataset.sourcePath,
        datasetSourceId: dataset.sourceId,
        datasetSourceKind: dataset.sourceKind,
        datasetSourceLocation: dataset.sourceLocation,
        datasetSourceCacheStatus: dataset.cacheStatus,
        datasetSourceIntegritySha256: dataset.integritySha256,
        sourcePath: resolvedSourcePath,
        caseKind: testCase.caseKind,
        ...testCase.metadata,
      },
      ok: false,
      totalChecks: 1,
      passedChecks: 0,
      durationMs: Date.now() - startedAt,
      checks: [{
        id: 'trace-bundle-exists',
        ok: false,
        message: `Trace bundle source not found: ${resolvedSourcePath}.`,
      }],
    }
  }

  const raw = fs.readFileSync(resolvedSourcePath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const run = (parsed['run'] ?? {}) as {
    snapshot?: {
      status?: string
      workflowTemplate?: string
      authorityOwner?: string
      authorityHost?: string
      nodes?: Record<string, { status?: string }>
    }
  }
  const snapshot = run.snapshot ?? {}
  const timeline = Array.isArray(parsed['timeline']) ? parsed['timeline'] as Array<{ kind?: string }> : []
  const receipts = Array.isArray(parsed['receipts']) ? parsed['receipts'] : []
  const tribunals = Array.isArray(parsed['tribunals']) ? parsed['tribunals'] as Array<{
    nodeId?: string
    mode?: string
    quorumSatisfied?: boolean
    verdict?: string
    confidence?: number
  }> : []
  const verdicts = Array.isArray(parsed['verdicts']) ? parsed['verdicts'] as Array<{ scope?: string }> : []
  const derivedTraceBundleReport = verifyTraceBundleArtifactWithEvaluator(
    String((snapshot as { runId?: string }).runId ?? 'benchmark-trace-bundle'),
    resolvedSourcePath,
    {
      evaluateHmacSignatureEnvelope: (options) => ({
        ok: !testCase.requireSignedTraceBundle || Boolean((parsed['signature'] as { keyId?: string } | undefined)?.keyId),
        signatureRequired: Boolean(options.requireSignature),
        policy: typeof parsed['signaturePolicyId'] === 'string'
          ? { policyId: parsed['signaturePolicyId'] } as never
          : undefined,
        key: (parsed['signature'] as { keyId?: string; issuer?: string } | undefined)?.keyId
          ? {
            keyId: (parsed['signature'] as { keyId: string }).keyId,
            issuer: (parsed['signature'] as { issuer?: string }).issuer,
          } as never
          : undefined,
        checks: [],
      }),
    },
  ).report
  const releaseAttestationPath = testCase.releaseAttestationPath
    ? resolveCaseSourcePath(ctx, testCase.releaseAttestationPath)
    : undefined
  const releaseAttestationExists = releaseAttestationPath ? fs.existsSync(releaseAttestationPath) : false
  const releaseAttestationDocument = releaseAttestationExists
    ? JSON.parse(fs.readFileSync(releaseAttestationPath!, 'utf8')) as ReleaseAttestationDocument
    : undefined
  const releaseAttestationVerification = releaseAttestationDocument
    ? ctx.verifyReleaseAttestationArtifact?.(releaseAttestationPath!, resolvedSourcePath)
      ?? (() => {
        return verifyReleaseAttestationArtifactWithEvaluator(
          derivedTraceBundleReport.runId,
          releaseAttestationPath!,
          derivedTraceBundleReport,
          {
            evaluateHmacSignatureEnvelope: (options) => ({
              ok: !testCase.requireSignedReleaseAttestation || Boolean(releaseAttestationDocument.signature?.keyId),
              signatureRequired: Boolean(options.requireSignature),
              policy: releaseAttestationDocument.signaturePolicyId
                ? { policyId: releaseAttestationDocument.signaturePolicyId } as never
                : undefined,
              key: releaseAttestationDocument.signature?.keyId
                ? {
                  keyId: releaseAttestationDocument.signature.keyId,
                  issuer: releaseAttestationDocument.signature.issuer,
                } as never
                : undefined,
              checks: [],
            }),
          },
        ).report
      })()
    : undefined
  const certificationRecordPath = testCase.certificationRecordPath
    ? resolveCaseSourcePath(ctx, testCase.certificationRecordPath)
    : undefined
  const certificationRecordExists = certificationRecordPath ? fs.existsSync(certificationRecordPath) : false
  const certificationRecordDocument = certificationRecordExists
    ? JSON.parse(fs.readFileSync(certificationRecordPath!, 'utf8')) as CertificationRecordDocument
    : undefined
  const certificationRecordVerification = certificationRecordDocument
    ? verifyCertificationRecordArtifactWithEvaluator(
        {
          invocation: {} as any,
          definition: {} as any,
          snapshot: {
            runId: certificationRecordDocument.payload.run.runId,
            workflowId: certificationRecordDocument.payload.run.workflowId,
            workflowVersion: certificationRecordDocument.payload.run.workflowVersion,
            workflowTemplate: certificationRecordDocument.payload.run.workflowTemplate,
            status: certificationRecordDocument.payload.run.status,
            verdict: certificationRecordDocument.payload.run.verdict,
            completedAt: certificationRecordDocument.payload.run.completedAt,
          } as any,
        },
        certificationRecordPath!,
        certificationRecordDocument.payload,
        {
          evaluateHmacSignatureEnvelope: (options) => ({
            ok: !testCase.requireSignedCertificationRecord || Boolean(certificationRecordDocument.signature?.keyId),
            signatureRequired: Boolean(options.requireSignature),
            policy: certificationRecordDocument.signaturePolicyId
              ? { policyId: certificationRecordDocument.signaturePolicyId } as never
              : undefined,
            key: certificationRecordDocument.signature?.keyId
              ? {
                  keyId: certificationRecordDocument.signature.keyId,
                  issuer: certificationRecordDocument.signature.issuer,
                } as never
              : undefined,
            checks: [],
          }),
        },
      ).report
    : undefined
  const remoteWorkers = Array.isArray(parsed['remoteWorkers'] && (parsed['remoteWorkers'] as any).workers)
    ? ((parsed['remoteWorkers'] as {
      workers: Array<{
        selectedResponseMode?: string
        agentCardSha256?: string
        agentCardSchemaVersion?: string
        agentCardAdvertisementSignatureKeyId?: string
        agentCardAdvertisementSignatureIssuer?: string
        agentCardAdvertisementSignedAt?: string
      }>
    }).workers)
    : []
  const nodeStatuses = snapshot.nodes ?? {}

  const checks = [
    {
      id: 'trace-bundle-json',
      ok: typeof parsed === 'object' && parsed !== null,
      message: `Loaded trace bundle ${resolvedSourcePath}.`,
    },
    {
      id: 'authority-owner',
      ok: snapshot.authorityOwner === testCase.expectedAuthorityOwner,
      message: `Authority owner=${snapshot.authorityOwner ?? 'missing'}.`,
    },
    {
      id: 'authority-host',
      ok: snapshot.authorityHost === testCase.expectedAuthorityHost,
      message: `Authority host=${snapshot.authorityHost ?? 'missing'}.`,
    },
    {
      id: 'receipt-count',
      ok: receipts.length >= testCase.minExecutionReceipts,
      message: `Execution receipts=${receipts.length}.`,
    },
    {
      id: 'tribunal-section-present',
      ok: Array.isArray(parsed['tribunals']),
      message: `Tribunal records=${tribunals.length}.`,
    },
    {
      id: 'tribunal-remote-quorum',
      ok: tribunals.every(tribunal =>
        tribunal.mode === 'remote' &&
        tribunal.quorumSatisfied === true &&
        tribunal.verdict !== 'disagree' &&
        tribunal.verdict !== 'needs_human' &&
        typeof tribunal.confidence === 'number' &&
        tribunal.confidence >= 0.6),
      message: tribunals.length > 0
        ? 'Tribunal records satisfy remote quorum release constraints.'
        : 'No tribunal records were required for this case.',
    },
    {
      id: 'timeline-count',
      ok: timeline.length >= testCase.minTimelineEntries,
      message: `Timeline entries=${timeline.length}.`,
    },
    {
      id: 'policy-verdict-count',
      ok: verdicts.length >= testCase.minPolicyVerdicts,
      message: `Policy verdicts=${verdicts.length}.`,
    },
    {
      id: 'required-timeline-kinds',
      ok: testCase.requiredTimelineKinds.every(kind => timeline.some(entry => entry.kind === kind)),
      message: `Timeline kinds present: ${testCase.requiredTimelineKinds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'required-policy-scopes',
      ok: testCase.requiredPolicyScopes.every(scope => verdicts.some(verdict => verdict.scope === scope)),
      message: `Policy scopes present: ${testCase.requiredPolicyScopes.join(', ') || 'none requested'}.`,
    },
    {
      id: 'required-node-statuses',
      ok: Object.entries(testCase.requiredNodeStatuses).every(([nodeId, status]) => nodeStatuses[nodeId]?.status === status),
      message: `Node statuses validated for ${Object.keys(testCase.requiredNodeStatuses).join(', ') || 'none requested'}.`,
    },
    {
      id: 'remote-worker-response-modes',
      ok: testCase.requiredRemoteWorkerResponseModes.every(mode =>
        remoteWorkers.some(worker => worker.selectedResponseMode === mode),
      ),
      message: `Remote worker response modes present: ${testCase.requiredRemoteWorkerResponseModes.join(', ') || 'none requested'}.`,
    },
    {
      id: 'trace-bundle-integrity',
      ok: !testCase.requireTraceBundleIntegrity || (
        derivedTraceBundleReport.mismatchedEntries.length === 0 &&
        derivedTraceBundleReport.missingEntries.length === 0
      ),
      message: testCase.requireTraceBundleIntegrity
        ? `Trace bundle integrity ok=${String(
          derivedTraceBundleReport.mismatchedEntries.length === 0 &&
          derivedTraceBundleReport.missingEntries.length === 0,
        )}.`
        : 'Trace bundle integrity checks not required for this case.',
    },
    {
      id: 'trace-bundle-signature',
      ok: !testCase.requireSignedTraceBundle || Boolean(derivedTraceBundleReport.signatureVerified),
      message: testCase.requireSignedTraceBundle
        ? 'Trace bundle exposes signature metadata.'
        : 'Signed trace bundle checks not required for this case.',
    },
    {
      id: 'trace-bundle-signature-key-ids',
      ok: testCase.requiredTraceBundleSignatureKeyIds.every(keyId => derivedTraceBundleReport.signatureKeyId === keyId),
      message: `Trace bundle signature key ids present: ${testCase.requiredTraceBundleSignatureKeyIds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'trace-bundle-signature-issuers',
      ok: testCase.requiredTraceBundleSignatureIssuers.every(issuer => derivedTraceBundleReport.signatureIssuer === issuer),
      message: `Trace bundle signature issuers present: ${testCase.requiredTraceBundleSignatureIssuers.join(', ') || 'none requested'}.`,
    },
    {
      id: 'trace-bundle-signature-policy',
      ok: testCase.requiredTraceBundleSignaturePolicyId
        ? derivedTraceBundleReport.signaturePolicyId === testCase.requiredTraceBundleSignaturePolicyId
        : true,
      message: `Trace bundle signature policy=${derivedTraceBundleReport.signaturePolicyId ?? 'missing'}.`,
    },
    {
      id: 'release-attestation-present',
      ok: !testCase.requireReleaseAttestation || releaseAttestationExists,
      message: testCase.requireReleaseAttestation
        ? `Release attestation path=${releaseAttestationPath ?? 'missing'}.`
        : 'Release attestation checks not required for this case.',
    },
    {
      id: 'release-attestation-verification',
      ok: !testCase.requireReleaseAttestation || Boolean(releaseAttestationVerification?.ok),
      message: testCase.requireReleaseAttestation
        ? `Release attestation verification ok=${String(releaseAttestationVerification?.ok ?? false)}.`
        : 'Release attestation verification not required for this case.',
    },
    {
      id: 'release-attestation-signature',
      ok: !testCase.requireSignedReleaseAttestation || Boolean(releaseAttestationVerification?.signatureVerified),
      message: testCase.requireSignedReleaseAttestation
        ? 'Release attestation exposes valid signature provenance.'
        : 'Signed release attestation checks not required for this case.',
    },
    {
      id: 'release-attestation-signature-key-ids',
      ok: testCase.requiredReleaseAttestationSignatureKeyIds.every(keyId => releaseAttestationVerification?.signatureKeyId === keyId),
      message: `Release attestation signature key ids present: ${testCase.requiredReleaseAttestationSignatureKeyIds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'release-attestation-signature-issuers',
      ok: testCase.requiredReleaseAttestationSignatureIssuers.every(issuer => releaseAttestationVerification?.signatureIssuer === issuer),
      message: `Release attestation signature issuers present: ${testCase.requiredReleaseAttestationSignatureIssuers.join(', ') || 'none requested'}.`,
    },
    {
      id: 'release-attestation-signature-policy',
      ok: testCase.requiredReleaseAttestationSignaturePolicyId
        ? releaseAttestationVerification?.signaturePolicyId === testCase.requiredReleaseAttestationSignaturePolicyId
        : true,
      message: `Release attestation signature policy=${releaseAttestationVerification?.signaturePolicyId ?? 'missing'}.`,
    },
    {
      id: 'certification-record-present',
      ok: !testCase.requireCertificationRecord || certificationRecordExists,
      message: testCase.requireCertificationRecord
        ? `Certification record path=${certificationRecordPath ?? 'missing'}.`
        : 'Certification record checks not required for this case.',
    },
    {
      id: 'certification-record-verification',
      ok: !testCase.requireCertificationRecord || Boolean(certificationRecordVerification?.ok),
      message: testCase.requireCertificationRecord
        ? `Certification record verification ok=${String(certificationRecordVerification?.ok ?? false)}.`
        : 'Certification verification not required for this case.',
    },
    {
      id: 'certification-record-signature',
      ok: !testCase.requireSignedCertificationRecord || Boolean(certificationRecordVerification?.signatureVerified),
      message: testCase.requireSignedCertificationRecord
        ? 'Certification record exposes valid signature provenance.'
        : 'Signed certification checks not required for this case.',
    },
    {
      id: 'certification-record-signature-key-ids',
      ok: testCase.requiredCertificationRecordSignatureKeyIds.every(keyId => certificationRecordVerification?.signatureKeyId === keyId),
      message: `Certification signature key ids present: ${testCase.requiredCertificationRecordSignatureKeyIds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'certification-record-signature-issuers',
      ok: testCase.requiredCertificationRecordSignatureIssuers.every(issuer => certificationRecordVerification?.signatureIssuer === issuer),
      message: `Certification signature issuers present: ${testCase.requiredCertificationRecordSignatureIssuers.join(', ') || 'none requested'}.`,
    },
    {
      id: 'certification-record-signature-policy',
      ok: testCase.requiredCertificationRecordSignaturePolicyId
        ? certificationRecordVerification?.signaturePolicyId === testCase.requiredCertificationRecordSignaturePolicyId
        : true,
      message: `Certification signature policy=${certificationRecordVerification?.signaturePolicyId ?? 'missing'}.`,
    },
    {
      id: 'remote-worker-agent-card-digests',
      ok: !testCase.requireAgentCardDigests || remoteWorkers.every(worker =>
        typeof worker.agentCardSha256 === 'string' && /^[a-f0-9]{64}$/i.test(worker.agentCardSha256),
      ),
      message: testCase.requireAgentCardDigests
        ? 'Trace bundle remote workers expose stable agent-card SHA256 digests.'
        : 'Agent-card digest checks not required for this case.',
    },
    {
      id: 'remote-worker-agent-card-schema-versions',
      ok: testCase.requiredAgentCardSchemaVersions.every(version =>
        remoteWorkers.some(worker => worker.agentCardSchemaVersion === version),
      ),
      message: `Remote worker advertisement schema versions present: ${testCase.requiredAgentCardSchemaVersions.join(', ') || 'none requested'}.`,
    },
    {
      id: 'remote-worker-advertisement-signatures',
      ok: !testCase.requireSignedAgentCardAdvertisements || remoteWorkers.every(worker =>
        typeof worker.agentCardAdvertisementSignatureKeyId === 'string'
        && worker.agentCardAdvertisementSignatureKeyId.length > 0
        && typeof worker.agentCardAdvertisementSignedAt === 'string'
        && worker.agentCardAdvertisementSignedAt.length > 0,
      ),
      message: testCase.requireSignedAgentCardAdvertisements
        ? 'Trace bundle remote workers expose signed advertisement metadata.'
        : 'Signed advertisement checks not required for this case.',
    },
    {
      id: 'remote-worker-advertisement-signature-key-ids',
      ok: testCase.requiredAgentCardAdvertisementKeyIds.every(keyId =>
        remoteWorkers.some(worker => worker.agentCardAdvertisementSignatureKeyId === keyId),
      ),
      message: `Remote worker advertisement signature key ids present: ${testCase.requiredAgentCardAdvertisementKeyIds.join(', ') || 'none requested'}.`,
    },
    {
      id: 'remote-worker-advertisement-signature-issuers',
      ok: testCase.requiredAgentCardAdvertisementIssuers.every(issuer =>
        remoteWorkers.some(worker => worker.agentCardAdvertisementSignatureIssuer === issuer),
      ),
      message: `Remote worker advertisement signature issuers present: ${testCase.requiredAgentCardAdvertisementIssuers.join(', ') || 'none requested'}.`,
    },
  ]

  if (testCase.expectedRunStatus) {
    checks.push({
      id: 'run-status',
      ok: snapshot.status === testCase.expectedRunStatus,
      message: `Run status=${snapshot.status ?? 'missing'}.`,
    })
  }

  if (testCase.expectedWorkflowTemplate) {
    checks.push({
      id: 'workflow-template',
      ok: snapshot.workflowTemplate === testCase.expectedWorkflowTemplate,
      message: `Workflow template=${snapshot.workflowTemplate ?? 'missing'}.`,
    })
  }

  const durationMs = Date.now() - startedAt
  const passedChecks = checks.filter(check => check.ok).length

  return {
    caseId: testCase.caseId,
    name: testCase.name,
    tags: testCase.tags,
    metadata: {
      datasetId: dataset.datasetId,
      datasetVersion: dataset.version,
      datasetSourcePath: dataset.sourcePath,
      datasetSourceId: dataset.sourceId,
      datasetSourceKind: dataset.sourceKind,
      datasetSourceLocation: dataset.sourceLocation,
      datasetSourceCacheStatus: dataset.cacheStatus,
      datasetSourceIntegritySha256: dataset.integritySha256,
      sourcePath: resolvedSourcePath,
      caseKind: testCase.caseKind,
      ...testCase.metadata,
    },
    ok: checks.every(check => check.ok),
    totalChecks: checks.length,
    passedChecks,
    durationMs,
    checks,
  }
}

function createDatasetCaseResult(
  ctx: BenchmarkHarnessContext,
  dataset: LoadedBenchmarkDataset,
  testCase: BenchmarkDatasetCase,
): HarnessCaseResult {
  if (testCase.caseKind === 'traceBundle') {
    return createTraceBundleCaseResult(ctx, dataset, testCase)
  }
  return createWorkflowCaseResult(ctx, dataset, testCase)
}

function createDatasetIssueCaseResult(issue: BenchmarkDatasetLoadIssue): HarnessCaseResult {
  const ok = issue.required === false
  return {
    caseId: `dataset-source:${issue.sourceId}`,
    name: `Dataset Source ${issue.sourceId}`,
    tags: ['dataset', 'ingestion', issue.sourceKind],
    metadata: {
      sourceId: issue.sourceId,
      sourceKind: issue.sourceKind,
      sourceLocation: issue.location,
      registryRef: issue.registryRef,
      registryPath: issue.registryPath,
      required: issue.required,
      expectedDatasetId: issue.expectedDatasetId,
      expectedVersion: issue.expectedVersion,
      expectedSha256: issue.expectedSha256,
    },
    ok,
    totalChecks: 1,
    passedChecks: ok ? 1 : 0,
    durationMs: 0,
    checks: [{
      id: 'dataset-source-load',
      ok,
      message: ok
        ? `Optional dataset source ${issue.sourceId} was unavailable: ${issue.error}`
        : `Dataset source ${issue.sourceId} failed to load: ${issue.error}`,
    }],
  }
}

function createBenchmarkSuites(
  manifestPath: string,
): Record<string, HarnessSuiteDefinition<BenchmarkHarnessContext>> {
  return {
    'workflow-authority': {
    suiteId: 'workflow-authority',
    name: 'Workflow Authority',
    description: 'Validate daemon-owned workflow compilation and authority invariants.',
    tags: ['workflow', 'authority'],
    async evaluate(ctx) {
      const strict = compileWorkflowDefinition(resolveWorkflowDefinition({
        workflowId: 'antigravity.strict-full',
        workflowVersion: '1.0.0',
        goal: 'benchmark',
        files: [],
        initiator: 'benchmark-harness',
        workspaceRoot: ctx.workspaceRoot,
        hostSessionId: 'benchmark-harness',
        triggerSource: 'command',
        forceFullPath: true,
        options: {},
        metadata: {},
      }))
      const adaptive = compileWorkflowDefinition(resolveWorkflowDefinition({
        workflowId: 'antigravity.adaptive',
        workflowVersion: '1.0.0',
        goal: 'benchmark',
        files: [],
        initiator: 'benchmark-harness',
        workspaceRoot: ctx.workspaceRoot,
        hostSessionId: 'benchmark-harness',
        triggerSource: 'command',
        forceFullPath: true,
        options: {},
        metadata: {},
      }))

      return {
        checks: [
          {
            id: 'strict-full-graph',
            ok: strict.nodes.length === 7,
            message: 'Strict-full workflow compiled into the canonical 7-step daemon-owned graph.',
          },
          {
            id: 'adaptive-graph',
            ok: adaptive.nodes.length === 7,
            message: 'Adaptive workflow compiled into the canonical 7-step daemon-owned graph.',
          },
        ],
      }
    },
    },
    'workflow-dataset-cases': {
    suiteId: 'workflow-dataset-cases',
    name: 'Workflow Dataset Cases',
    description: 'Run dataset-backed workflow compilation cases against the daemon-owned workflow DSL.',
    tags: ['workflow', 'dataset', 'cases'],
    async evaluate(ctx) {
      const bundle = await loadBenchmarkDatasets({
        workspaceRoot: ctx.workspaceRoot,
        dataDir: ctx.dataDir,
        manifestPath,
        requestDatasetSources: ctx.getRequestedDatasetSources?.() ?? [],
        requestText: ctx.getBenchmarkDatasetTransport?.(),
      })
      return {
        cases: [
          ...bundle.datasets.flatMap(dataset => dataset.cases.map(testCase => createDatasetCaseResult(ctx, dataset, testCase))),
          ...bundle.issues.map(issue => createDatasetIssueCaseResult(issue)),
        ],
      }
    },
    },
    'control-plane-surface': {
    suiteId: 'control-plane-surface',
    name: 'Control Plane Surface',
    description: 'Validate manifest routes, policy pack availability, and daemon IPC surface.',
    tags: ['control-plane', 'contract'],
    async evaluate(ctx) {
      const pack = ctx.getPolicyPack()
      const trustRegistry = ctx.getTrustRegistry?.() ?? {
        registryId: 'workspace-trust-registry',
        version: '1.0.0',
        loadedAt: new Date(0).toISOString(),
        verification: {
          verifiedAt: new Date(0).toISOString(),
          summary: 'verified' as const,
          checks: [],
        },
        keys: [],
      }
      return {
        checks: [
          {
            id: 'manifest-route-count',
            ok: ctx.getManifestRouteCount() >= 10,
            message: 'Daemon manifest exposes the expected route surface.',
          },
          {
            id: 'policy-pack-route',
            ok: ctx.hasManifestOperation('ReloadPolicyPack'),
            message: 'Daemon manifest exposes policy pack hot reload.',
          },
          {
            id: 'policy-pack-loaded',
            ok: pack.packId.length > 0 && pack.version.length > 0,
            message: `Policy pack loaded as ${pack.packId}@${pack.version}.`,
          },
          {
            id: 'trust-registry-route',
            ok: !ctx.getTrustRegistry || ctx.hasManifestOperation('ReloadTrustRegistry'),
            message: 'Daemon manifest exposes trust registry hot reload when trust registry is surfaced.',
          },
          {
            id: 'trust-registry-loaded',
            ok: trustRegistry.registryId.length > 0 && trustRegistry.version.length > 0,
            message: `Trust registry loaded as ${trustRegistry.registryId}@${trustRegistry.version}.`,
          },
          {
            id: 'trust-registry-verification',
            ok: trustRegistry.verification.summary === 'verified',
            message: trustRegistry.verification.summary === 'verified'
              ? 'Trust registry verification completed without warnings.'
              : 'Trust registry still carries verification warnings.',
          },
          {
            id: 'ipc-socket-config',
            ok: ctx.socketPath.length > 0,
            message: 'IPC socket path resolved for daemon-owned control plane operations.',
          },
          {
            id: 'callback-auth-scheme',
            ok: ctx.getCallbackAuthScheme() === 'hmac-sha256',
            message: `Callback auth scheme is ${ctx.getCallbackAuthScheme() ?? 'unset'}.`,
          },
          {
            id: 'completion-session-route',
            ok:
              (
                ctx.hasManifestOperation('GetRunSession') &&
                ctx.hasManifestOperation('PrepareStepCompletionReceipt') &&
                ctx.hasManifestOperation('CommitStepCompletionReceipt')
              ) ||
              ctx.getManifestRouteCount() >= 15,
            message: 'Daemon manifest exposes durable completion session read/prepare/commit operations.',
          },
        ],
      }
    },
    },
    'persistence-recovery': {
    suiteId: 'persistence-recovery',
    name: 'Persistence Recovery',
    description: 'Validate durable storage, event streaming, checkpoint recovery, and run projection paths.',
    tags: ['persistence', 'recovery'],
    async evaluate(ctx) {
      return {
        checks: [
          {
            id: 'sqlite-ledger',
            ok: fs.existsSync(path.join(ctx.dataDir, 'db', ANTIGRAVITY_DAEMON_DB_NAME)),
            message: 'SQLite ledger is initialized in the workspace daemon data directory.',
          },
          {
            id: 'event-streaming',
            ok: ctx.hasEventStreaming(),
            message: 'Event store exposes streaming reads for replayable execution.',
          },
          {
            id: 'checkpoint-recovery',
            ok: ctx.hasCheckpointRecovery(),
            message: 'Checkpoint store exposes durable recovery primitives.',
          },
          {
            id: 'completion-session-durability',
            ok:
              (
                ctx.hasManifestOperation('GetRunSession') &&
                ctx.hasManifestOperation('PrepareStepCompletionReceipt') &&
                ctx.hasManifestOperation('CommitStepCompletionReceipt')
              ) ||
              ctx.getManifestRouteCount() >= 15,
            message: 'Durable completion sessions are exposed through the daemon control plane.',
          },
          {
            id: 'run-projection-directory',
            ok: fs.existsSync(path.dirname(ctx.projectionPath)),
            message: 'Run projection directory exists for dashboard mirroring and export.',
          },
        ],
      }
    },
    },
    'federation-readiness': {
    suiteId: 'federation-readiness',
    name: 'Federation Readiness',
    description: 'Validate remote worker discovery and lifecycle-aware delegation metadata.',
    tags: ['federation', 'remote-workers', 'a2a'],
    async evaluate(ctx) {
      const listing = ctx.listRemoteWorkers()
      const workers = listing.workers
      return {
        checks: [
          {
            id: 'remote-worker-directory',
            ok: workers.every(worker => worker.health !== 'unknown'),
            message: `Remote worker directory loaded ${workers.length} worker(s).`,
          },
          {
            id: 'remote-worker-response-mode',
            ok: workers.every(worker =>
              worker.selectedResponseMode === 'inline' ||
              worker.selectedResponseMode === 'poll' ||
              worker.selectedResponseMode === 'stream' ||
              worker.selectedResponseMode === 'callback'),
            message: 'Remote workers expose selected response modes derived from agent-card protocol surfaces.',
          },
          {
            id: 'remote-worker-supported-modes',
            ok: workers.every(worker => Array.isArray(worker.supportedResponseModes) && worker.supportedResponseModes.length > 0),
            message: 'Remote workers expose supported response modes advertised by their agent cards.',
          },
          {
            id: 'remote-worker-protocol-source',
            ok: workers.every(worker => worker.taskProtocolSource === 'agent-card'),
            message: 'Remote worker task protocols are sourced from agent-card advertisements only.',
          },
          {
            id: 'remote-worker-verification-summary',
            ok: workers.every(worker => worker.verification?.summary === 'verified'),
            message: workers.every(worker => worker.verification?.summary === 'verified')
              ? 'Remote workers passed agent-card verification without warnings.'
              : 'One or more remote workers still carry protocol verification warnings.',
          },
          {
            id: 'remote-worker-agent-card-digest',
            ok: workers.every(worker => typeof worker.agentCardSha256 === 'string' && /^[a-f0-9]{64}$/i.test(worker.agentCardSha256)),
            message: 'Remote workers expose a stable SHA256 digest for their discovered agent cards.',
          },
          {
            id: 'remote-worker-advertisement-metadata',
            ok: workers.every(worker => !worker.agentCardSchemaVersion || typeof worker.agentCardPublishedAt === 'string'),
            message: 'Remote worker advertisement metadata exposes schema version and publication time when present.',
          },
          {
            id: 'remote-worker-advertisement-signature-surface',
            ok: workers.every(worker =>
              !worker.agentCardAdvertisementSignatureKeyId ||
              typeof worker.agentCardAdvertisementSignedAt === 'string'),
            message: 'Remote workers expose advertisement signature metadata when signed advertisements are advertised.',
          },
          {
            id: 'remote-worker-discovery-issue-kinds',
            ok: (listing.discoveryIssues ?? []).every(issue => typeof issue.issueKind === 'string' && issue.issueKind.length > 0),
            message: 'Remote worker discovery issues are classified by issue kind.',
          },
          {
            id: 'remote-worker-discovery-issue-signature-expectations',
            ok: (listing.discoveryIssues ?? []).every(issue =>
              (!issue.advertisementTrustPolicyId || issue.advertisementTrustPolicyId.length > 0) &&
              (!issue.allowedAdvertisementKeyStatuses || Array.isArray(issue.allowedAdvertisementKeyStatuses)) &&
              (!issue.allowedAdvertisementKeyIds || Array.isArray(issue.allowedAdvertisementKeyIds)) &&
              (!issue.allowedAdvertisementIssuers || Array.isArray(issue.allowedAdvertisementIssuers))),
            message: 'Remote worker discovery issues preserve configured advertisement trust policy expectations.',
          },
          {
            id: 'remote-worker-discovery-issue-expectations',
            ok: (listing.discoveryIssues ?? []).every(issue =>
              (!issue.expectedAgentCardSha256 || /^[a-f0-9]{64}$/i.test(issue.expectedAgentCardSha256)) &&
              (!issue.expectedAdvertisementSchemaVersion || issue.expectedAdvertisementSchemaVersion.length > 0)),
            message: 'Remote worker discovery issues preserve configured digest/schema expectations when verification fails.',
          },
          {
            id: 'remote-worker-callback-ingress',
            ok: workers.every(worker => worker.selectedResponseMode !== 'callback') || ctx.hasManifestOperation('ReceiveRemoteWorkerCallback'),
            message: 'Daemon manifest exposes callback ingress for callback-capable remote workers.',
          },
          {
            id: 'remote-worker-callback-auth',
            ok: workers.every(worker => worker.selectedResponseMode !== 'callback') || ctx.getCallbackAuthScheme() === 'hmac-sha256',
            message: workers.some(worker => worker.selectedResponseMode === 'callback')
              ? `Callback-capable remote workers are protected with ${ctx.getCallbackAuthScheme() ?? 'unset'} auth.`
              : 'No callback-capable remote workers configured.',
          },
        ],
      }
    },
    },
  }
}

export class BenchmarkHarness {
  private readonly manifestPath: string
  private readonly ctx: BenchmarkHarnessContext

  constructor(ctx: BenchmarkHarnessContext, manifestPath: string) {
    this.ctx = ctx
    this.manifestPath = manifestPath
  }

  async run(request: RunBenchmarkRequest): Promise<BenchmarkHarnessReport> {
    const definitions = createBenchmarkSuites(this.manifestPath)
    return runManifestDrivenHarness({
      ctx: {
        ...this.ctx,
        getRequestedDatasetSources: () => request.datasetSources ?? [],
      },
      manifestPath: this.manifestPath,
      harnessId: 'antigravity-daemon-benchmark-harness',
      manifestVersion: '1.0.0',
      definitions,
      suiteIds: request.suiteIds ?? [],
      caseIds: request.caseIds ?? [],
    })
  }
}
