import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DagEngine, GovernanceGateway, TrustFactorService, getDefaultControlPack } from '@anthropic/antigravity-core'
import type { DaemonLifecycleStage, DaemonStageVerdict } from '@anthropic/antigravity-core'
import { WorkflowRunDriver, evaluateTransition, AntigravityModelService, type NodeExecutionResult } from '@anthropic/antigravity-model-core'
import { JsonlEventStore, MemoryManager, SqliteCheckpointStore, SqliteClient, runMigrations, UpcastingEventStore } from '@anthropic/antigravity-persistence'
import type { WorkflowEventEnvelope, WorkflowState } from '@anthropic/antigravity-shared'
import { createCheckpointId, createEventId, createISODateTime } from '@anthropic/antigravity-shared'
import { buildRunSnapshot, writeRunProjection } from './projection.js'
import { AuthorityRuntimeKernel, LifecyclePhase, type LifecycleHooks, type TerminalDecision } from './authority-runtime-kernel.js'
import { createDaemonDomainEvent, DaemonDomainEventTypes, type DaemonDomainEventType, type DaemonDomainEventLog } from './daemon-domain-events.js'
import { buildVerificationSnapshot, type VerificationSnapshot } from './verification-snapshot.js'
import { JsonlDaemonDomainEventLog } from './jsonl-domain-event-log.js'
import { DaemonLedger } from './ledger.js'
import { createDaemonUpcastingRegistry } from './daemon-upcasting-registry.js'
import { BenchmarkHarness } from './benchmark-harness.js'
import { buildEventDerivedProjection, shadowCompare, type LegacyProjectionInput, type ShadowCompareReadMode, DEFAULT_SHADOW_COMPARE_READ_MODE } from './event-derived-projection.js'
import {
  evaluateRulesAgainstFacts,
  createFactsForPreflight,
  createFactsForRelease,
  createFactsForHumanGate,
  createFactsForApproval,
  createFactsForResume,
} from './policy-engine.js'
import { BenchmarkSourceRegistryStore } from './benchmark-source-registry.js'
import { InteropHarness } from './interop-harness.js'
import {
  createExecutionReceipt,
  createSkipDecision,
  createSkipExecutionReceipt,
  createHandoffEnvelopes,
  evaluateReleaseGate,
  type ReleaseGateDecision,
} from './evidence-policy.js'
import { deriveHumanApprovalRequirement } from './hitl-policy.js'
import { DAEMON_API_CONTRACT, type DaemonApiManifest } from './manifest.js'
import { DaemonPolicyEngine } from './policy-engine.js'
import { RemoteWorkerDirectory } from './remote-worker.js'
import { TrustRegistryStore } from './trust-registry.js'
import { TribunalService } from './tribunal.js'
import {
  ApproveGateRequestSchema,
  BenchmarkHarnessReport,
  type CompletionSessionRecord,
  InteropHarnessReport,
  RunBenchmarkRequestSchema,
  RunInteropRequestSchema,
  MemorySearchRequestSchema,
  type MemorySearchResponse,
  type RemoteWorkerCallbackReceipt,
  type RemoteWorkerListResponse,
  type ReleaseArtifacts,
  type ReleaseArtifactsResponse,
  type CertificationRecordResponse,
  type InvariantReportResponse,
  type PolicyReportResponse,
  type ReleaseAttestationResponse,
  type ReleaseBundleResponse,
  type ReleaseDossierResponse,
  ResumeRunRequestSchema,
  StartRunRequestSchema,
  type ReplayRunRequest,
  type RunDetails,
  type RunSessionResponse,
  type RunSnapshot,
  type StartRunRequest,
  type StartRunResponse,
  type StagedCompletionBundle,
  type StreamRunRequest,
  type StreamRunResponse,
  type StepCompletionReceipt,
  type TraceBundleResponse,
  type TribunalSummary,
  type TribunalVerdictRecord,
  PrepareCompletionReceiptRequestSchema,
  CommitCompletionReceiptRequestSchema,
  StepHeartbeatRequestSchema,
  type VerifyReleaseArtifactsReport,
  type VerifyCertificationRecordReport,
  type VerifyInvariantReport,
  type VerifyPolicyReport,
  type VerifyReleaseAttestationReport,
  type VerifyReleaseBundleReport,
  type VerifyReleaseDossierReport,
  type VerifyTransparencyLedgerReport,
  type VerifyRunReport,
  type VerifyTraceBundleReport,
  type WorkflowDefinition,
  type WorkflowInvocation,
  type StepLease,
  PolicyVerdict,
  type BenchmarkSourceRegistrySnapshot,
} from './schema.js'
import { bootstrapDaemonRun, loadRunStateFromEvents, loadRunStateWithDiagnostics } from './run-bootstrap.js'
import { compileWorkflowDefinition, createRunRequest, resolveWorkflowDefinition } from './workflow-definition.js'
import { buildReleaseArtifactsSummary, createVerifyRunReport } from './run-verifier.js'
import {
  ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE,
  ANTIGRAVITY_DAEMON_ATTESTATIONS_DIR,
  ANTIGRAVITY_DAEMON_CERTIFICATION_RECORDS_DIR,
  ANTIGRAVITY_DAEMON_DB_NAME,
  ANTIGRAVITY_DAEMON_INVARIANT_REPORTS_DIR,
  ANTIGRAVITY_DAEMON_POLICY_PACK_FILE,
  ANTIGRAVITY_DAEMON_POLICY_REPORTS_DIR,
  ANTIGRAVITY_DAEMON_RELEASE_BUNDLES_DIR,
  ANTIGRAVITY_DAEMON_RELEASE_DOSSIERS_DIR,
  ANTIGRAVITY_DAEMON_REMOTE_WORKERS_FILE,
  ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE,
  ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE,
} from './runtime-contract.js'
import {
  buildTraceBundleIntegrity,
  TRACE_BUNDLE_SECTIONS,
  canonicalJsonStringify,
} from './trace-bundle-integrity.js'
import {
  buildReleaseAttestationPayload,
  createReleaseAttestationDocument,
  serializeReleaseAttestationSignable,
  type ReleaseAttestationDocument,
  type ReleaseAttestationVerificationReport,
} from './release-attestation.js'
import {
  verifyInvariantReportArtifact,
  verifyPolicyReportArtifact,
  verifyCertificationRecordArtifact,
  verifyReleaseBundleArtifact,
  verifyReleaseDossierArtifact,
  verifyReleaseAttestationArtifact,
  verifyTraceBundleArtifact,
  verifyArtifactChainConsistency,
} from './release-artifact-verifier.js'
import {
  buildPolicyReportPayload,
  createPolicyReportDocument,
  serializePolicyReportSignable,
  summarizePolicyReportArtifact,
  type PolicyReportDocument,
} from './policy-report.js'
import {
  buildCertificationRecordPayload,
  createCertificationRecordDocument,
  serializeCertificationRecordSignable,
  summarizeCertificationRecordArtifact,
  type CertificationRecordDocument,
} from './certification-record.js'
import {
  appendTransparencyLedgerEntry,
  readTransparencyLedgerEntries,
  summarizeTransparencyLedger,
  verifyTransparencyLedger,
} from './transparency-ledger.js'
import {
  buildReleaseBundlePayload,
  createReleaseBundleDocument,
  serializeReleaseBundleSignable,
  type ReleaseBundleDocument,
} from './release-bundle.js'
import {
  buildInvariantReportPayload,
  createInvariantReportDocument,
  serializeInvariantReportSignable,
  summarizeInvariantReportArtifact,
  type InvariantReportDocument,
} from './invariant-report.js'
import {
  buildReleaseDossierPayload,
  createReleaseDossierDocument,
  serializeReleaseDossierSignable,
  type ReleaseDossierDocument,
} from './release-dossier.js'
import { validateWorkflowStepOutput } from './workflow-output-contracts.js'
import { NoOpTelemetrySink, type RuntimeTelemetrySink } from './runtime-telemetry-sink.js'

export interface DaemonConfig {
  workspaceRoot: string
  dataDir: string
  projectionPath: string
  socketPath: string
  /** PR-14: enable strict trust mode — only verified workers can be delegated (default: false) */
  strictTrustMode?: boolean
  /** PR-19: optional telemetry sink for unified observability (default: NoOp) */
  telemetrySink?: RuntimeTelemetrySink
  /** PR-08E: shadow compare read mode (default: 'shadow') */
  shadowCompareReadMode?: ShadowCompareReadMode
}

interface ActiveRunContext {
  invocation: WorkflowInvocation
  definition: WorkflowDefinition
  driver: WorkflowRunDriver
  controller: AbortController
  startedAt: string
  drainPromise?: Promise<void>
  /** PR-04: current lifecycle phase, managed by AuthorityRuntimeKernel */
  phase: LifecyclePhase
}

interface RefreshSnapshotOptions {
  explicitStatus?: RunSnapshot['status']
  verdict?: string
  completedAt?: string
  releaseArtifacts?: ReleaseArtifacts
  policyReport?: RunSnapshot['policyReport']
  invariantReport?: RunSnapshot['invariantReport']
  releaseDossier?: RunSnapshot['releaseDossier']
  releaseBundle?: RunSnapshot['releaseBundle']
  certificationRecord?: RunSnapshot['certificationRecord']
  transparencyLedger?: RunSnapshot['transparencyLedger']
}

interface PolicySkipDetail {
  reason: string
  strategyId?: string
  triggerCondition?: string
  sourceNodeId?: string
}

interface FinalizedReleaseArtifacts {
  traceBundleReport: VerifyTraceBundleReport
  traceBundleVerdict: PolicyVerdict
  releaseAttestationReport: VerifyReleaseAttestationReport
  releaseAttestationVerdict: PolicyVerdict
}

interface FinalizedReleaseDossier {
  releaseDossierReport: VerifyReleaseDossierReport
  releaseDossierVerdict: PolicyVerdict
}

interface FinalizedInvariantReport {
  invariantReport: VerifyInvariantReport
}

interface FinalizedPolicyReport {
  policyReport: VerifyPolicyReport
}

interface FinalizedReleaseBundle {
  releaseBundleReport: VerifyReleaseBundleReport
  releaseBundleVerdict: PolicyVerdict
}

interface FinalizedCertificationRecord {
  certificationRecordReport: VerifyCertificationRecordReport
}

interface FinalizedTerminalArtifacts {
  verificationSnapshot: VerificationSnapshot
  traceArtifacts: FinalizedReleaseArtifacts
  policyReport: FinalizedPolicyReport
  invariantReport: FinalizedInvariantReport
  releaseDossier: FinalizedReleaseDossier
  releaseBundle: FinalizedReleaseBundle
  certificationRecord: FinalizedCertificationRecord
}

export class AntigravityDaemonRuntime {
  private readonly config: DaemonConfig
  private readonly sqliteClient: SqliteClient
  private readonly ledger: DaemonLedger
  private readonly eventStore: UpcastingEventStore
  private readonly checkpointStore: SqliteCheckpointStore
  private readonly memoryManager: MemoryManager
  private readonly agentRuntimeService: AntigravityModelService
  private readonly trustRegistry: TrustRegistryStore
  private readonly remoteWorkers: RemoteWorkerDirectory
  private readonly tribunalService: TribunalService
  private readonly policyEngine: DaemonPolicyEngine
  private readonly benchmarkSourceRegistry: BenchmarkSourceRegistryStore
  private readonly activeRuns = new Map<string, ActiveRunContext>()
  /** PR-12: frozen verification snapshots per run — built once at finalization time */
  private readonly verificationSnapshots = new Map<string, VerificationSnapshot>()
  /** Artifact finalization cache — guarantees at-most-once terminal artifact generation per run */
  private readonly terminalArtifactFinalizations = new Map<string, Promise<FinalizedTerminalArtifacts>>()
  /** PR-04: lifecycle coordinator — manages phase boundaries for authority runs */
  private readonly lifecycleKernel = new AuthorityRuntimeKernel()
  /** PR-07E: durable JSONL domain event log for dual-write alongside legacy ledger */
  private readonly domainEventLog: DaemonDomainEventLog
  /** PR-11: GovernanceGateway — authoritative owner of all daemon governance decisions */
  private readonly governanceGateway: GovernanceGateway
  /** PR-19: unified telemetry sink */
  private readonly telemetrySink: RuntimeTelemetrySink
  /** PR-08E: shadow compare read mode — controls projection source authority */
  private readonly shadowCompareReadMode: ShadowCompareReadMode

  constructor(config: DaemonConfig) {
    this.config = config
    fs.mkdirSync(this.config.dataDir, { recursive: true })
    fs.mkdirSync(path.dirname(this.config.projectionPath), { recursive: true })
    this.sqliteClient = new SqliteClient({
      dataDir: this.config.dataDir,
      dbName: ANTIGRAVITY_DAEMON_DB_NAME,
    })
    runMigrations(this.sqliteClient.getDatabase())
    this.ledger = new DaemonLedger(this.sqliteClient.getDatabase())
    this.governanceGateway = new GovernanceGateway(
      new TrustFactorService(),
      getDefaultControlPack(),
    )
    this.domainEventLog = new JsonlDaemonDomainEventLog(this.config.dataDir)
    this.shadowCompareReadMode = this.config.shadowCompareReadMode ?? DEFAULT_SHADOW_COMPARE_READ_MODE
    this.eventStore = new UpcastingEventStore(
      new JsonlEventStore({ dataDir: this.config.dataDir }),
      createDaemonUpcastingRegistry(),
    )
    this.checkpointStore = new SqliteCheckpointStore(this.sqliteClient.getDatabase())
    this.memoryManager = new MemoryManager({ db: this.sqliteClient.getDatabase() })
    this.agentRuntimeService = new AntigravityModelService()
    this.trustRegistry = new TrustRegistryStore(path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE))
    this.remoteWorkers = new RemoteWorkerDirectory(
      path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_REMOTE_WORKERS_FILE),
      this.trustRegistry,
      undefined, // transport — use default
      this.config.strictTrustMode ?? false,
    )
    this.tribunalService = new TribunalService(this.remoteWorkers, this.agentRuntimeService)
    this.policyEngine = new DaemonPolicyEngine({
      policyPackPath: path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_POLICY_PACK_FILE),
    })
    this.benchmarkSourceRegistry = new BenchmarkSourceRegistryStore(
      path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE),
      this.trustRegistry,
    )
    this.telemetrySink = config.telemetrySink ?? new NoOpTelemetrySink()
  }

  async initialize(): Promise<void> {
    this.trustRegistry.load()
    this.policyEngine.reload()
    this.benchmarkSourceRegistry.load()
    await this.remoteWorkers.refresh()
    await this.recoverInterruptedRuns()
  }

  getManifest(): DaemonApiManifest {
    return {
      ...DAEMON_API_CONTRACT,
      callbackIngressBaseUrl: this.remoteWorkers.getCallbackIngressBaseUrl(),
    }
  }

  setCallbackIngressBaseUrl(baseUrl: string): void {
    this.remoteWorkers.setCallbackIngressBaseUrl(baseUrl)
  }

  getPolicyPack() {
    return this.policyEngine.exportPack()
  }

  getTrustRegistry() {
    return this.trustRegistry.getSnapshot()
  }

  refreshPolicyPack() {
    return this.policyEngine.reload()
  }

  async refreshTrustRegistry() {
    const snapshot = this.trustRegistry.reload()
    this.benchmarkSourceRegistry.reload()
    await this.remoteWorkers.refresh()
    return snapshot
  }

  getBenchmarkSourceRegistry(): BenchmarkSourceRegistrySnapshot {
    return this.benchmarkSourceRegistry.getSnapshot()
  }

  searchMemory(request: unknown): MemorySearchResponse {
    const parsed = MemorySearchRequestSchema.parse(request)
    const recall = this.memoryManager.recall(parsed.query, parsed.files)
    const topK = parsed.topK
    const reflexionPrompts = recall.reflexionPrompts.slice(0, topK)
    const relevantFacts = recall.relevantFacts.slice(0, topK)
    return {
      reflexionPrompts,
      relevantFacts,
      promptCount: reflexionPrompts.length,
      factCount: relevantFacts.length,
      budgetStatus: recall.budgetStatus,
    }
  }

  refreshBenchmarkSourceRegistry(): BenchmarkSourceRegistrySnapshot {
    return this.benchmarkSourceRegistry.reload()
  }

  listRemoteWorkers(): RemoteWorkerListResponse {
    return this.remoteWorkers.list()
  }

  async refreshRemoteWorkers(): Promise<RemoteWorkerListResponse> {
    await this.remoteWorkers.refresh()
    return this.remoteWorkers.list()
  }

  receiveRemoteWorkerCallback(
    callbackToken: string,
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): RemoteWorkerCallbackReceipt {
    const receipt = this.remoteWorkers.receiveCallback(callbackToken, payload, rawBody, headers)
    this.ledger.appendTimeline(receipt.runId, 'remote.callback.received', undefined, {
      callbackToken: receipt.callbackToken,
      taskId: receipt.taskId,
      workerId: receipt.workerId,
      status: receipt.status,
      verifiedSignature: receipt.verifiedSignature,
    }, receipt.receivedAt)
    this.telemetrySink.onRemoteCallback(receipt.runId, { workerId: receipt.workerId, nodeId: undefined })
    return receipt
  }

  async startRun(request: StartRunRequest): Promise<StartRunResponse> {
    const parsed = StartRunRequestSchema.parse(request)
    const invocation = parsed.invocation
    const definition = resolveWorkflowDefinition(invocation)
    const graph = compileWorkflowDefinition(definition)
    const driver = new WorkflowRunDriver({
      eventStore: this.eventStore,
      checkpointStore: this.checkpointStore,
      dagEngine: new DagEngine(),
      agentRuntime: this.agentRuntimeService,
      executorRegistry: this.remoteWorkers.createExecutorRegistry(definition),
      issueStepLease: ({ runId, nodeId, state, attempt }) => this.issueStepLease(runId, definition, state, nodeId, attempt),
      validateNodeResult: ({ nodeId, state, result }) => {
        const step = definition.steps.find(candidate => candidate.id === nodeId)
        if (!step) {
          throw new Error(`Missing workflow step definition for ${nodeId}`)
        }
        return {
          ...result,
          output: validateWorkflowStepOutput(step, result.output, state),
        }
      },
    })
    const startedAt = createISODateTime()
    const controller = new AbortController()
    const context: ActiveRunContext = {
      invocation,
      definition,
      driver,
      controller,
      startedAt,
      phase: LifecyclePhase.Bootstrap,
    }

    const start = await bootstrapDaemonRun(createRunRequest(invocation, graph), {
      eventStore: this.eventStore,
      checkpointStore: this.checkpointStore,
    })
    this.activeRuns.set(start.runId, context)
    this.ledger.upsertWorkflowDefinition(definition)

    // PR-11: governance gateway cutover — preflight via gateway
    const preflightVerdict = this.evaluateGovernanceStage(
      'daemon:preflight', start.runId, 'preflight', 'preflight', startedAt,
      createFactsForPreflight({
        runId: start.runId,
        governance: start.governance,
        drScore: start.drScore.score,
        evaluatedAt: startedAt,
      }),
      'Preflight checks passed under the active policy pack.',
    )
    this.recordPolicyVerdict(start.runId, 'policy.preflight', preflightVerdict)

    this.ledger.appendTimeline(start.runId, 'run.started', undefined, {
      goal: invocation.goal,
      workflow: definition.templateName,
      hostSessionId: invocation.hostSessionId,
    }, startedAt)
    this.telemetrySink.onRunStarted(start.runId, { goal: invocation.goal, nodeCount: definition.steps.length })
    if (start.route.skippedNodes.length > 0) {
      this.syncPolicySkippedNodes(
        start.runId,
        definition,
        start.state,
        new Map(start.route.skippedNodes.map(item => [item.nodeId, {
          reason: item.reason,
          strategyId: definition.steps.find(step => step.id === item.nodeId)?.skipPolicy?.strategyId ?? 'route.skip',
          triggerCondition: `route.lane=${start.route.lane}; confidence=${start.route.confidence}`,
          sourceNodeId: 'ROUTE_DECIDED',
        }])),
      )
    }

    const snapshot = await this.refreshSnapshot(start.runId, context, {
      explicitStatus: 'running',
    })

    context.drainPromise = this.drainRun(start.runId, context)
    void context.drainPromise.catch(() => {
      // Snapshot already carries terminal error state.
    })

    return {
      runId: start.runId,
      invocation,
      definition,
      snapshot,
    }
  }

  async getRun(runId: string): Promise<RunDetails | null> {
    const cached = this.ledger.getRun(runId)
    if (!cached) {
      return null
    }
    return {
      ...cached,
      snapshot: await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
        explicitStatus: cached.snapshot.status,
        verdict: cached.snapshot.verdict,
        releaseArtifacts: cached.snapshot.releaseArtifacts,
      }),
    }
  }

  async getRunSession(runId: string): Promise<RunSessionResponse> {
    const run = await this.getRequiredRun(runId)
    return {
      runId: run.snapshot.runId,
      status: run.snapshot.status,
      authorityOwner: run.snapshot.authorityOwner,
      authorityHost: run.snapshot.authorityHost,
      activeLease: run.snapshot.activeLease,
      activeHeartbeat: run.snapshot.activeHeartbeat,
      pendingCompletionReceipt: run.snapshot.pendingCompletionReceipt,
      preparedCompletionReceipt: run.snapshot.preparedCompletionReceipt,
      acknowledgedCompletionReceipt: run.snapshot.acknowledgedCompletionReceipt,
      latestTribunalVerdict: run.snapshot.latestTribunalVerdict,
      certificationRecord: run.snapshot.certificationRecord,
      transparencyLedger: run.snapshot.transparencyLedger,
      timelineCursor: run.snapshot.timelineCursor,
      updatedAt: run.snapshot.updatedAt,
    }
  }

  async recordStepHeartbeat(runId: string, request: unknown): Promise<RunSessionResponse> {
    const parsed = StepHeartbeatRequestSchema.parse(request)
    const run = await this.getRequiredRun(runId)
    const activeLease = run.snapshot.activeLease
    if (!activeLease) {
      throw new Error(`Run ${runId} does not have an active lease`)
    }
    if (
      activeLease.leaseId !== parsed.leaseId ||
      activeLease.nodeId !== parsed.nodeId ||
      activeLease.attempt !== parsed.attempt
    ) {
      throw new Error(`Heartbeat does not match the active lease for run ${runId}`)
    }
    if (Date.parse(activeLease.expiresAt) <= Date.now()) {
      throw new Error(`Lease ${activeLease.leaseId} for run ${runId} has expired`)
    }

    const heartbeatAt = parsed.heartbeatAt ?? createISODateTime()
    const currentVersion = await this.eventStore.getCurrentVersion(runId)
    const event: WorkflowEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'NODE_HEARTBEAT',
      payload: {
        nodeId: parsed.nodeId,
        leaseId: parsed.leaseId,
        attempt: parsed.attempt,
        heartbeatAt,
      },
      timestamp: heartbeatAt,
      version: currentVersion + 1,
    }
    await this.eventStore.append({
      runId,
      events: [event],
      expectedVersion: currentVersion,
    })
    return this.getRunSession(runId)
  }

  async prepareStepCompletionReceipt(runId: string, request: unknown): Promise<RunSessionResponse> {
    const parsed = PrepareCompletionReceiptRequestSchema.parse(request)
    const session = this.ledger.getCompletionSession(runId, parsed.leaseId, parsed.nodeId, parsed.attempt)
    if (!session) {
      throw new Error(`Run ${runId} does not have a staged completion session`)
    }
    if (
      session.receipt.status !== parsed.status ||
      (session.receipt.outputHash ?? '') !== (parsed.outputHash ?? '') ||
      (session.receipt.model ?? '') !== (parsed.model ?? '') ||
      (session.receipt.durationMs ?? 0) !== (parsed.durationMs ?? 0)
    ) {
      throw new Error(`Completion receipt payload mismatch for run ${runId}`)
    }
    if (parsed.completedAt && session.receipt.completedAt !== parsed.completedAt) {
      throw new Error(`Completion receipt completion timestamp mismatch for run ${runId}`)
    }
    if (session.phase === 'committed' || session.phase === 'prepared') {
      await this.refreshSnapshot(runId, this.activeRuns.get(runId))
      return this.getRunSession(runId)
    }

    const preparedAt = createISODateTime()
    const preparedSession = this.advanceCompletionSession(session, 'prepared', preparedAt)
    this.ledger.appendTimeline(runId, 'session.completion-receipt.prepared', parsed.nodeId, {
      sessionId: preparedSession.sessionId,
      leaseId: parsed.leaseId,
      attempt: parsed.attempt,
      status: parsed.status,
      preparedAt,
      completionReceipt: {
        ...preparedSession.receipt,
        preparedAt,
      },
    }, preparedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId))
    return this.getRunSession(runId)
  }

  async commitStepCompletionReceipt(runId: string, request: unknown): Promise<RunSessionResponse> {
    const parsed = CommitCompletionReceiptRequestSchema.parse(request)
    const session = this.ledger.getCompletionSession(runId, parsed.leaseId, parsed.nodeId, parsed.attempt)
    if (!session) {
      throw new Error(`Run ${runId} does not have a staged completion session`)
    }
    if (session.phase === 'pending') {
      throw new Error(`Run ${runId} completion session must be prepared before commit`)
    }
    if (
      session.receipt.status !== parsed.status ||
      (session.receipt.outputHash ?? '') !== (parsed.outputHash ?? '') ||
      (session.receipt.model ?? '') !== (parsed.model ?? '') ||
      (session.receipt.durationMs ?? 0) !== (parsed.durationMs ?? 0)
    ) {
      throw new Error(`Commit receipt payload mismatch for run ${runId}`)
    }
    if (parsed.completedAt && session.receipt.completedAt !== parsed.completedAt) {
      throw new Error(`Commit receipt completion timestamp mismatch for run ${runId}`)
    }
    if (parsed.preparedAt && session.preparedAt && session.preparedAt !== parsed.preparedAt) {
      throw new Error(`Commit receipt prepared timestamp mismatch for run ${runId}`)
    }
    if (session.phase === 'committed') {
      await this.refreshSnapshot(runId, this.activeRuns.get(runId))
      return this.getRunSession(runId)
    }

    const acknowledgedAt = createISODateTime()
    const committedAt = parsed.committedAt ?? acknowledgedAt
    const committedSession = this.advanceCompletionSession(session, 'committed', committedAt)
    this.ledger.appendTimeline(runId, 'session.completion-receipt.accepted', parsed.nodeId, {
      sessionId: committedSession.sessionId,
      leaseId: parsed.leaseId,
      attempt: parsed.attempt,
      status: parsed.status,
      acknowledgedAt,
      completionReceipt: {
        ...committedSession.receipt,
        committedAt,
      },
    }, acknowledgedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId))
    return this.getRunSession(runId)
  }

  async streamRun(request: StreamRunRequest): Promise<StreamRunResponse> {
    const run = await this.getRun(request.runId)
    if (!run) {
      throw new Error(`Run not found: ${request.runId}`)
    }
    const entries = this.ledger.listTimeline(request.runId, request.cursor)
    return {
      snapshot: run.snapshot,
      entries,
      nextCursor: entries.length > 0 ? entries[entries.length - 1]!.sequence : request.cursor,
    }
  }

  async approveGate(request: unknown): Promise<RunDetails> {
    const parsed = ApproveGateRequestSchema.parse(request)
    const run = await this.getRequiredRun(parsed.runId)
    const now = createISODateTime()
    // PR-11: gateway cutover for approval
    const approvalInput = {
      runId: parsed.runId,
      gateId: parsed.gateId,
      approvedBy: parsed.approvedBy,
      comment: parsed.comment,
      evaluatedAt: now,
    }
    // PR-11: governance gateway cutover — approval via gateway
    const verdict = this.evaluateGovernanceStage(
      'daemon:approval', parsed.runId, 'approval', `approval:${parsed.gateId}`, now,
      createFactsForApproval(approvalInput), `Approval gate ${parsed.gateId} passed under the active policy pack.`,
    )
    this.recordPolicyVerdict(parsed.runId, 'policy.approval', verdict, parsed.gateId)
    this.ledger.appendTimeline(parsed.runId, 'gate.approved', parsed.gateId, {
      approvedBy: parsed.approvedBy,
      comment: parsed.comment,
    }, now)
    if (run.snapshot.status === 'paused_for_human') {
      return this.resumeRun({
        runId: parsed.runId,
        approvedBy: parsed.approvedBy,
        comment: parsed.comment,
      })
    }
    const snapshot = await this.refreshSnapshot(parsed.runId, this.activeRuns.get(parsed.runId), {
      verdict: run.snapshot.verdict,
    })
    return {
      ...run,
      snapshot,
    }
  }

  async cancelRun(runId: string): Promise<RunDetails> {
    const run = await this.getRequiredRun(runId)
    const active = this.activeRuns.get(runId)
    if (active) {
      this.ledger.appendTimeline(runId, 'run.cancel.requested', undefined, {
        reason: 'User requested cancellation from Antigravity command',
      }, createISODateTime())
      active.controller.abort()
    }
    const snapshot = await this.refreshSnapshot(runId, active, {
      explicitStatus: active ? 'running' : run.snapshot.status,
    })
    return {
      ...run,
      snapshot,
    }
  }

  async replayRun(request: ReplayRunRequest): Promise<StartRunResponse> {
    const previous = await this.getRequiredRun(request.runId)
    return this.startRun({
      invocation: {
        ...previous.invocation,
        hostSessionId: request.hostSessionId ?? previous.invocation.hostSessionId,
        metadata: {
          ...previous.invocation.metadata,
          replayOf: request.runId,
        },
      },
    })
  }

  async resumeRun(request: unknown): Promise<RunDetails> {
    const parsed = ResumeRunRequestSchema.parse(request)
    const existing = await this.getRequiredRun(parsed.runId)
    if (existing.snapshot.status !== 'paused_for_human') {
      return existing
    }

    const now = createISODateTime()
    // PR-11: gateway cutover for resume
    const resumeInput = {
      runId: parsed.runId,
      approvedBy: parsed.approvedBy,
      comment: parsed.comment,
      evaluatedAt: now,
    }
    // PR-11: governance gateway cutover — resume via gateway
    const resumeVerdict = this.evaluateGovernanceStage(
      'daemon:approval', parsed.runId, 'resume', 'resume', now,
      createFactsForResume(resumeInput), 'Resume checks passed under the active policy pack.',
    )
    this.recordPolicyVerdict(parsed.runId, 'policy.resume', resumeVerdict)
    await this.ensureRunCompletedEvent(parsed.runId, 'completed')
    this.ledger.appendTimeline(parsed.runId, 'run.resumed', undefined, {
      approvedBy: parsed.approvedBy ?? 'unknown',
      comment: parsed.comment,
    }, now)
    const snapshot = await this.refreshSnapshot(parsed.runId, this.activeRuns.get(parsed.runId), {
      explicitStatus: 'completed',
      completedAt: now,
    })
    this.recordRunMemory(existing.invocation, existing.definition, snapshot)
    return {
      ...existing,
      snapshot,
    }
  }

  async exportTraceBundle(runId: string): Promise<TraceBundleResponse> {
    const run = await this.getRequiredRun(runId)
    const events = await this.eventStore.load({ runId })
    const checkpoints = await this.checkpointStore.list(runId)
    const timeline = this.ledger.listTimeline(runId)
    const receipts = this.ledger.listExecutionReceipts(runId)
    const tribunals = this.ledger.listTribunalVerdicts(runId)
    const handoffs = this.ledger.listHandoffEnvelopes(runId)
    const skips = this.ledger.listSkipDecisions(runId)
    const verdicts = this.ledger.listPolicyVerdicts(runId)
    const bundleDir = path.join(this.config.dataDir, 'exports')
    fs.mkdirSync(bundleDir, { recursive: true })
    const bundlePath = path.join(bundleDir, `${runId}.trace.json`)
    const bundleSections = {
      manifest: this.getManifest(),
      policyPack: this.policyEngine.exportPack(),
      trustRegistry: this.getTrustRegistry(),
      benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
      remoteWorkers: this.listRemoteWorkers(),
      run,
      events,
      checkpoints,
      timeline,
      receipts,
      tribunals,
      handoffs,
      skips,
      verdicts,
    } satisfies Record<(typeof TRACE_BUNDLE_SECTIONS)[number], unknown>
    const integrity = buildTraceBundleIntegrity(bundleSections)
    const signatureResult = this.trustRegistry.signHmacPayload({
      scope: 'trace-bundle',
      payload: canonicalJsonStringify(integrity),
      signedAt: integrity.generatedAt,
    })
    fs.writeFileSync(bundlePath, JSON.stringify({
      ...bundleSections,
      integrity,
      signaturePolicyId: signatureResult.policy?.policyId,
      signature: signatureResult.signature,
    }, null, 2), 'utf8')

    const snapshot = await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      releaseArtifacts: {
        traceBundle: {
          path: bundlePath,
          issues: [],
        },
      },
    })
    this.ledger.appendTimeline(runId, 'trace.bundle.exported', undefined, {
      bundlePath,
    }, createISODateTime())

    return {
      runId,
      bundlePath,
      timelineEntries: timeline.length,
      executionReceipts: receipts.length,
      handoffEnvelopes: handoffs.length,
      skipDecisions: skips.length,
      integrity,
      signaturePolicyId: signatureResult.policy?.policyId,
      signature: signatureResult.signature,
    }
  }

  async verifyRun(runId: string): Promise<VerifyRunReport> {
    const run = await this.getRequiredRun(runId)
    const state = run.snapshot.runtimeState ?? await this.loadState(runId)
    const receipts = this.ledger.listExecutionReceipts(runId)
    const handoffs = this.ledger.listHandoffEnvelopes(runId)
    const skipDecisions = this.ledger.listSkipDecisions(runId)
    const receiptsByNode = new Map(receipts.map(receipt => [receipt.nodeId, receipt] as const))
    const skipDecisionsByNode = new Set(skipDecisions.map(item => item.nodeId))
    const policySkippedNodes = Object.values(run.snapshot.nodes)
      .filter(node => node.status === 'policy_skipped')
      .map(node => node.nodeId)
    const releaseDecision = evaluateReleaseGate({
      definition: run.definition,
      receipts,
      state,
    })
    const missingReceiptNodes = run.definition.steps
      .filter(step => !receiptsByNode.has(step.id))
      .map(step => step.id)
    const missingTribunalNodes = run.definition.steps
      .filter(step => step.modelContract?.judgeRequired)
      .filter(step => !receiptsByNode.get(step.id)?.tribunal)
      .map(step => step.id)
    const tribunalFailures = run.definition.steps
      .filter(step => step.modelContract?.judgeRequired)
      .flatMap(step => {
        const tribunal = receiptsByNode.get(step.id)?.tribunal
        if (!tribunal) {
          return []
        }
        const failures: string[] = []
        if (!tribunal.quorumSatisfied) {
          failures.push(`${step.id}: tribunal quorum not satisfied`)
        }
        if (tribunal.mode !== 'remote') {
          failures.push(`${step.id}: tribunal mode ${tribunal.mode}`)
        }
        if (tribunal.confidence < 0.6) {
          failures.push(`${step.id}: tribunal confidence ${tribunal.confidence.toFixed(2)}`)
        }
        if (tribunal.verdict === 'disagree' || tribunal.verdict === 'needs_human') {
          failures.push(`${step.id}: tribunal verdict ${tribunal.verdict}`)
        }
        return failures
      })
    const missingSkipDecisionNodes = policySkippedNodes.filter(nodeId => !skipDecisionsByNode.has(nodeId))
    const missingSkipReceiptNodes = policySkippedNodes.filter(
      nodeId => receiptsByNode.get(nodeId)?.status !== 'policy_skipped',
    )
    const timeline = this.ledger.listTimeline(runId)
    let traceBundleReport: VerifyTraceBundleReport | undefined
    let traceBundleIssues: string[] = []
    let releaseAttestationReport: FinalizedReleaseArtifacts['releaseAttestationReport'] | undefined
    let releaseAttestationIssues: string[] = []
    if (run.snapshot.releaseArtifacts.traceBundle?.path) {
      try {
        traceBundleReport = await this.evaluateTraceBundleReport(runId, run.snapshot.releaseArtifacts.traceBundle.path, false)
      } catch (error) {
        traceBundleIssues = [error instanceof Error ? error.message : String(error)]
      }
    }
    if (run.snapshot.releaseArtifacts.releaseAttestation?.path && traceBundleReport) {
      try {
        releaseAttestationReport = this.evaluateReleaseAttestationDocument(
          runId,
          run.snapshot.releaseArtifacts.releaseAttestation.path,
          traceBundleReport,
          false,
        )
      } catch (error) {
        releaseAttestationIssues = [error instanceof Error ? error.message : String(error)]
      }
    }
    const releaseArtifacts = buildReleaseArtifactsSummary({
      existing: run.snapshot.releaseArtifacts,
      traceBundleReport,
      traceBundleIssues,
      releaseAttestationReport,
      releaseAttestationIssues,
    })

    return createVerifyRunReport({
      run,
      releaseDecision,
      receiptCount: receipts.length,
      handoffCount: handoffs.length,
      skipDecisionCount: skipDecisions.length,
      missingReceiptNodes,
      missingTribunalNodes,
      tribunalFailures,
      missingSkipDecisionNodes,
      missingSkipReceiptNodes,
      releaseArtifacts,
      timeline,
      verifiedAt: createISODateTime(),
    })
  }

  async verifyTraceBundle(runId: string): Promise<VerifyTraceBundleReport> {
    const run = await this.getRequiredRun(runId)
    const bundlePath = run.snapshot.releaseArtifacts.traceBundle?.path
    if (!bundlePath) {
      throw new Error(`Run ${runId} does not have an exported trace bundle`)
    }
    return this.evaluateTraceBundleReport(runId, bundlePath, true)
  }

  async getReleaseAttestation(runId: string): Promise<ReleaseAttestationResponse> {
    const run = await this.getRequiredRun(runId)
    const attestationPath = run.snapshot.releaseArtifacts.releaseAttestation?.path
    if (!attestationPath) {
      throw new Error(`Run ${runId} does not have an exported release attestation`)
    }
    if (!fs.existsSync(attestationPath)) {
      throw new Error(`Release attestation not found: ${attestationPath}`)
    }
    const document = JSON.parse(fs.readFileSync(attestationPath, 'utf8')) as ReleaseAttestationDocument
    return {
      runId,
      attestationPath,
      document,
    }
  }

  async verifyReleaseAttestation(runId: string): Promise<VerifyReleaseAttestationReport> {
    const run = await this.getRequiredRun(runId)
    const attestationPath = run.snapshot.releaseArtifacts.releaseAttestation?.path
    if (!attestationPath) {
      throw new Error(`Run ${runId} does not have an exported release attestation`)
    }
    const traceBundlePath = run.snapshot.releaseArtifacts.traceBundle?.path
    if (!traceBundlePath) {
      throw new Error(`Run ${runId} does not have an exported trace bundle required for attestation verification`)
    }
    const traceBundleReport = await this.evaluateTraceBundleReport(runId, traceBundlePath, false)
    const report = this.evaluateReleaseAttestationDocument(runId, attestationPath, traceBundleReport, true)
    return {
      runId,
      attestationPath,
      ok: report.ok,
      payloadDigestOk: report.payloadDigestOk,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
      signatureKeyId: report.signatureKeyId,
      signatureIssuer: report.signatureIssuer,
      issues: report.issues,
      verifiedAt: createISODateTime(),
    }
  }

  async getReleaseArtifacts(runId: string): Promise<ReleaseArtifactsResponse> {
    const run = await this.getRequiredRun(runId)
    return {
      runId,
      releaseArtifacts: run.snapshot.releaseArtifacts,
    }
  }

  async getInvariantReport(runId: string): Promise<InvariantReportResponse> {
    const run = await this.getRequiredRun(runId)
    const reportPath = run.snapshot.invariantReport?.path
    if (!reportPath) {
      throw new Error(`Run ${runId} does not have an exported invariant report`)
    }
    if (!fs.existsSync(reportPath)) {
      throw new Error(`Invariant report not found: ${reportPath}`)
    }
    const document = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as InvariantReportDocument
    return {
      runId,
      reportPath,
      document,
    }
  }

  async getPolicyReport(runId: string): Promise<PolicyReportResponse> {
    const run = await this.getRequiredRun(runId)
    const reportPath = run.snapshot.policyReport?.path
    if (!reportPath) {
      throw new Error(`Run ${runId} does not have an exported policy report`)
    }
    if (!fs.existsSync(reportPath)) {
      throw new Error(`Policy report not found: ${reportPath}`)
    }
    const document = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as PolicyReportDocument
    return {
      runId,
      reportPath,
      document,
    }
  }

  async getReleaseDossier(runId: string): Promise<ReleaseDossierResponse> {
    const run = await this.getRequiredRun(runId)
    const dossierPath = run.snapshot.releaseDossier?.path
    if (!dossierPath) {
      throw new Error(`Run ${runId} does not have an exported release dossier`)
    }
    if (!fs.existsSync(dossierPath)) {
      throw new Error(`Release dossier not found: ${dossierPath}`)
    }
    const document = JSON.parse(fs.readFileSync(dossierPath, 'utf8')) as ReleaseDossierDocument
    return {
      runId,
      dossierPath,
      document,
    }
  }

  async getReleaseBundle(runId: string): Promise<ReleaseBundleResponse> {
    const run = await this.getRequiredRun(runId)
    const bundlePath = run.snapshot.releaseBundle?.path
    if (!bundlePath) {
      throw new Error(`Run ${runId} does not have an exported release bundle`)
    }
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Release bundle not found: ${bundlePath}`)
    }
    const document = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as ReleaseBundleDocument
    return {
      runId,
      bundlePath,
      document,
    }
  }

  async getCertificationRecord(runId: string): Promise<CertificationRecordResponse> {
    const run = await this.getRequiredRun(runId)
    const recordPath = run.snapshot.certificationRecord?.path
    if (!recordPath) {
      throw new Error(`Run ${runId} does not have an exported certification record`)
    }
    if (!fs.existsSync(recordPath)) {
      throw new Error(`Certification record not found: ${recordPath}`)
    }
    const document = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as CertificationRecordDocument
    return {
      runId,
      recordPath,
      document,
    }
  }

  async verifyReleaseArtifacts(runId: string): Promise<VerifyReleaseArtifactsReport> {
    const run = await this.getRequiredRun(runId)
    const releaseArtifacts = run.snapshot.releaseArtifacts
    const issues: string[] = []

    let traceBundleSummary = releaseArtifacts.traceBundle
    if (releaseArtifacts.traceBundle?.path) {
      const report = await this.evaluateTraceBundleReport(runId, releaseArtifacts.traceBundle.path, false)
      traceBundleSummary = {
        path: releaseArtifacts.traceBundle.path,
        integrityOk: report.mismatchedEntries.length === 0 && report.missingEntries.length === 0,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: [...report.mismatchedEntries, ...report.missingEntries, ...report.failedSignatureChecks],
      }
      issues.push(...traceBundleSummary.issues)
    }

    let releaseAttestationSummary = releaseArtifacts.releaseAttestation
    if (releaseArtifacts.releaseAttestation?.path && releaseArtifacts.traceBundle?.path) {
      const traceBundleReport = await this.evaluateTraceBundleReport(runId, releaseArtifacts.traceBundle.path, false)
      const report = this.evaluateReleaseAttestationDocument(
        runId,
        releaseArtifacts.releaseAttestation.path,
        traceBundleReport,
        false,
      )
      releaseAttestationSummary = {
        path: releaseArtifacts.releaseAttestation.path,
        verified: report.ok,
        payloadDigestOk: report.payloadDigestOk,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: report.issues,
      }
      issues.push(...report.issues)
    } else if (releaseArtifacts.releaseAttestation?.path && !releaseArtifacts.traceBundle?.path) {
      releaseAttestationSummary = {
        ...releaseArtifacts.releaseAttestation,
        issues: [...(releaseArtifacts.releaseAttestation.issues ?? []), 'trace bundle required for attestation verification'],
      }
      issues.push(...releaseAttestationSummary.issues)
    }

    return {
      runId,
      ok: issues.length === 0,
      releaseArtifacts: {
        ...(traceBundleSummary ? { traceBundle: traceBundleSummary } : {}),
        ...(releaseAttestationSummary ? { releaseAttestation: releaseAttestationSummary } : {}),
      },
      issues,
      verifiedAt: createISODateTime(),
    }
  }

  async verifyInvariantReport(runId: string): Promise<VerifyInvariantReport> {
    const run = await this.getRequiredRun(runId)
    const reportPath = run.snapshot.invariantReport?.path
    if (!reportPath) {
      throw new Error(`Run ${runId} does not have an exported invariant report`)
    }
    const verifyRunReport = await this.verifyRun(runId)
    const { report } = verifyInvariantReportArtifact(
      run,
      reportPath,
      verifyRunReport.releaseArtifacts,
      verifyRunReport.invariantFailures,
      this.trustRegistry,
    )
    this.ledger.appendTimeline(runId, 'invariant.report.verified', undefined, {
      reportPath,
      ok: report.ok,
      issues: report.issues,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
    }, report.verifiedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      invariantReport: summarizeInvariantReportArtifact({
        path: reportPath,
        report,
      }),
    })
    return report
  }

  async verifyPolicyReport(runId: string): Promise<VerifyPolicyReport> {
    const run = await this.getRequiredRun(runId)
    const reportPath = run.snapshot.policyReport?.path
    if (!reportPath) {
      throw new Error(`Run ${runId} does not have an exported policy report`)
    }
    const verdicts = this.ledger.listPolicyVerdicts(runId)
    const { report } = verifyPolicyReportArtifact(run, reportPath, verdicts, this.trustRegistry)
    this.ledger.appendTimeline(runId, 'policy.report.verified', undefined, {
      reportPath,
      ok: report.ok,
      issues: report.issues,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
    }, report.verifiedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      policyReport: summarizePolicyReportArtifact({
        path: reportPath,
        report,
      }),
    })
    return report
  }

  async verifyReleaseDossier(runId: string): Promise<VerifyReleaseDossierReport> {
    const run = await this.getRequiredRun(runId)
    const dossierPath = run.snapshot.releaseDossier?.path
    if (!dossierPath) {
      throw new Error(`Run ${runId} does not have an exported release dossier`)
    }

    const verifyRunReport = await this.verifyRun(runId)
    const { report } = verifyReleaseDossierArtifact(run, dossierPath, verifyRunReport, this.trustRegistry)
    this.ledger.appendTimeline(runId, 'release.dossier.verified', undefined, {
      dossierPath,
      ok: report.ok,
      issues: report.issues,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
    }, report.verifiedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      releaseDossier: {
        path: dossierPath,
        verified: report.ok,
        payloadDigestOk: report.payloadDigestOk,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: report.issues,
      },
    })
    return report
  }

  async verifyReleaseBundle(runId: string): Promise<VerifyReleaseBundleReport> {
    const run = await this.getRequiredRun(runId)
    const bundlePath = run.snapshot.releaseBundle?.path
    if (!bundlePath) {
      throw new Error(`Run ${runId} does not have an exported release bundle`)
    }
    const verifyRunReport = await this.verifyRun(runId)
    const { report } = verifyReleaseBundleArtifact(
      run,
      bundlePath,
      verifyRunReport,
      run.snapshot.policyReport,
      run.snapshot.invariantReport,
      run.snapshot.certificationRecord ?? this.getPlannedCertificationRecordSummary(runId),
      this.trustRegistry,
    )
    this.ledger.appendTimeline(runId, 'release.bundle.verified', undefined, {
      bundlePath,
      ok: report.ok,
      issues: report.issues,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
    }, report.verifiedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      releaseBundle: {
        path: bundlePath,
        verified: report.ok,
        payloadDigestOk: report.payloadDigestOk,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: report.issues,
      },
    })
    return report
  }

  async verifyCertificationRecord(runId: string): Promise<VerifyCertificationRecordReport> {
    const run = await this.getRequiredRun(runId)
    const recordPath = run.snapshot.certificationRecord?.path
    if (!recordPath) {
      throw new Error(`Run ${runId} does not have an exported certification record`)
    }
    const bundle = await this.getReleaseBundle(runId)
    const blockedScopes = this.ledger.listPolicyVerdicts(runId)
      .filter(verdict => verdict.effect === 'block')
      .map(verdict => verdict.scope)
    const expectedPayload = buildCertificationRecordPayload({
      run,
      releaseBundle: {
        path: bundle.bundlePath,
        payloadDigest: bundle.document.payloadDigest,
        signaturePolicyId: bundle.document.signaturePolicyId,
        signatureKeyId: bundle.document.signature?.keyId,
        signatureIssuer: bundle.document.signature?.issuer,
      },
      trustRegistry: this.getTrustRegistry(),
      benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
      blockedScopes,
      remoteWorkers: this.listRemoteWorkers().workers.map(worker => ({
        workerId: worker.id,
        agentCardSha256: worker.agentCardSha256,
        verificationSummary: worker.verification?.summary,
      })),
    })
    const { report } = verifyCertificationRecordArtifact(run, recordPath, expectedPayload, this.trustRegistry)
    this.ledger.appendTimeline(runId, 'certification.record.verified', undefined, {
      recordPath,
      ok: report.ok,
      issues: report.issues,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
    }, report.verifiedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      certificationRecord: summarizeCertificationRecordArtifact({
        path: recordPath,
        report,
      }),
    })
    return report
  }

  async getTransparencyLedger() {
    const ledgerPath = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE)
    const entries = readTransparencyLedgerEntries(ledgerPath)
    return {
      ledgerPath,
      entryCount: entries.length,
      headEntry: entries.at(-1),
      entries,
    }
  }

  async verifyTransparencyLedger(): Promise<VerifyTransparencyLedgerReport> {
    const ledgerPath = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE)
    return verifyTransparencyLedger(ledgerPath)
  }

  async runBenchmark(request: unknown = {}): Promise<BenchmarkHarnessReport> {
    const parsed = RunBenchmarkRequestSchema.parse(request)
    const harness = new BenchmarkHarness({
      workspaceRoot: this.config.workspaceRoot,
      dataDir: this.config.dataDir,
      projectionPath: this.config.projectionPath,
      socketPath: this.config.socketPath,
      getManifestRouteCount: () => this.getManifest().routes.length,
      getCallbackAuthScheme: () => this.getManifest().callbackAuthScheme,
      hasManifestOperation: (operationId) => this.getManifest().routes.some(route => route.operationId === operationId),
      getPolicyPack: () => this.getPolicyPack(),
      getTrustRegistry: () => this.getTrustRegistry(),
      listRemoteWorkers: () => this.listRemoteWorkers(),
      hasEventStreaming: () => typeof this.eventStore.getCurrentVersion === 'function',
      hasCheckpointRecovery: () => typeof this.checkpointStore.loadLatest === 'function',
      verifyReleaseAttestationArtifact: (attestationPath, traceBundlePath) => {
        const runId = path.basename(traceBundlePath, '.trace.json')
        const traceBundleReport = verifyTraceBundleArtifact(runId, traceBundlePath, this.trustRegistry).report
        return verifyReleaseAttestationArtifact(runId, attestationPath, traceBundleReport, this.trustRegistry).report
      },
    }, path.join(this.config.dataDir, 'benchmark-manifest.json'))
    return harness.run(parsed)
  }

  async runInteropHarness(request: unknown = {}): Promise<InteropHarnessReport> {
    const parsed = RunInteropRequestSchema.parse(request)
    const harness = new InteropHarness({
      projectionPath: this.config.projectionPath,
      authorityOwner: this.getManifest().authorityOwner,
      authorityHost: this.getManifest().authorityHost,
      callbackIngressBaseUrl: this.getManifest().callbackIngressBaseUrl,
      callbackAuthScheme: this.getManifest().callbackAuthScheme,
      hasManifestOperation: (operationId) => this.getManifest().routes.some(route => route.operationId === operationId),
      getTrustRegistry: () => this.getTrustRegistry(),
      listRemoteWorkers: () => this.listRemoteWorkers(),
      hasEventStreaming: () => typeof this.eventStore.getCurrentVersion === 'function',
      hasCheckpointRecovery: () => typeof this.checkpointStore.loadLatest === 'function',
    }, path.join(this.config.dataDir, 'interop-manifest.json'))
    return harness.run(parsed)
  }

  private async finalizeTraceBundle(runId: string): Promise<FinalizedReleaseArtifacts> {
    let traceBundleReport: VerifyTraceBundleReport
    try {
      const exported = await this.exportTraceBundle(runId)
      traceBundleReport = await this.evaluateTraceBundleReport(runId, exported.bundlePath, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const verifiedAt = createISODateTime()
      this.ledger.appendTimeline(runId, 'trace.bundle.failed', undefined, {
        error: message,
      }, verifiedAt)
      traceBundleReport = {
        runId,
        bundlePath: '',
        ok: false,
        algorithm: 'sha256',
        actualBundleDigest: '',
        expectedBundleDigest: undefined,
        mismatchedEntries: [],
        missingEntries: ['trace-bundle'],
        signatureVerified: false,
        signatureRequired: false,
        signaturePolicyId: undefined,
        signatureKeyId: undefined,
        signatureIssuer: undefined,
        failedSignatureChecks: [message],
        verifiedAt,
      }
    }
    const traceBundleVerdict = this.policyEngine.evaluateTraceBundle({
      runId,
      report: traceBundleReport,
      evaluatedAt: traceBundleReport.verifiedAt,
    })
    this.recordPolicyVerdict(runId, 'policy.trace-bundle', traceBundleVerdict)

    const attestationDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_ATTESTATIONS_DIR)
    fs.mkdirSync(attestationDir, { recursive: true })
    const attestationPath = path.join(attestationDir, `${runId}.release-attestation.json`)

    let releaseAttestationReport: FinalizedReleaseArtifacts['releaseAttestationReport']
    try {
      const run = await this.getRequiredRun(runId)
      const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
      const generatedAt = createISODateTime()
      const documentBase = createReleaseAttestationDocument(
        buildReleaseAttestationPayload({
          run,
          traceBundleReport,
          policyVerdicts: this.ledger.listPolicyVerdicts(runId),
          trustRegistry: this.getTrustRegistry(),
          benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
          verificationSnapshot,
        }),
        generatedAt,
      )
      const signing = this.trustRegistry.signHmacPayload({
        scope: 'release-attestation',
        payload: serializeReleaseAttestationSignable(documentBase),
        signedAt: generatedAt,
      })
      const document: ReleaseAttestationDocument = {
        ...documentBase,
        signaturePolicyId: signing.policy?.policyId,
        signature: signing.signature,
      }
      fs.writeFileSync(attestationPath, JSON.stringify(document, null, 2), 'utf8')

      releaseAttestationReport = verifyReleaseAttestationArtifact(
        runId,
        attestationPath,
        traceBundleReport,
        this.trustRegistry,
      ).report
      this.ledger.appendTimeline(runId, 'release.attestation.exported', undefined, {
        attestationPath,
        signaturePolicyId: releaseAttestationReport.signaturePolicyId,
      }, generatedAt)
      this.ledger.appendTimeline(runId, 'release.attestation.verified', undefined, {
        attestationPath,
        ok: releaseAttestationReport.ok,
        issues: releaseAttestationReport.issues,
      }, generatedAt)
      await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
        releaseArtifacts: {
          releaseAttestation: {
            path: attestationPath,
            issues: [],
          },
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const verifiedAt = createISODateTime()
      releaseAttestationReport = {
        runId,
        ok: false,
        payloadDigestOk: false,
        signatureVerified: false,
        signatureRequired: false,
        signaturePolicyId: undefined,
        signatureKeyId: undefined,
        signatureIssuer: undefined,
        attestationPath,
        issues: [message],
        verifiedAt,
      }
      this.ledger.appendTimeline(runId, 'release.attestation.failed', undefined, {
        attestationPath,
        error: message,
      }, verifiedAt)
    }

    const releaseAttestationVerdict = this.policyEngine.evaluateReleaseAttestation({
      runId,
      attestationPath,
      ok: releaseAttestationReport.ok,
      signatureVerified: releaseAttestationReport.signatureVerified,
      signatureRequired: releaseAttestationReport.signatureRequired,
      issues: releaseAttestationReport.issues,
      evaluatedAt: createISODateTime(),
    })
    this.recordPolicyVerdict(runId, 'policy.release-attestation', releaseAttestationVerdict)

    return {
      traceBundleReport,
      traceBundleVerdict,
      releaseAttestationReport,
      releaseAttestationVerdict,
    }
  }

  private evaluateReleaseAttestationDocument(
    runId: string,
    attestationPath: string,
    traceBundleReport: VerifyTraceBundleReport,
    recordTimeline: boolean,
  ): FinalizedReleaseArtifacts['releaseAttestationReport'] {
    const { report } = verifyReleaseAttestationArtifact(runId, attestationPath, traceBundleReport, this.trustRegistry)

    if (recordTimeline) {
      this.ledger.appendTimeline(runId, 'release.attestation.verified', undefined, {
        attestationPath,
        ok: report.ok,
        issues: report.issues,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
      }, report.verifiedAt)
    }

    return {
      ...report,
    }
  }

  private async finalizeReleaseDossier(runId: string): Promise<FinalizedReleaseDossier> {
    const run = await this.getRequiredRun(runId)
    const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
    const verifyRunReport = await this.verifyRun(runId)
    const policyVerdicts = this.ledger.listPolicyVerdicts(runId)
    const generatedAt = createISODateTime()
    const dossierDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_RELEASE_DOSSIERS_DIR)
    fs.mkdirSync(dossierDir, { recursive: true })
    const dossierPath = path.join(dossierDir, `${runId}.release-dossier.json`)
    const payload = buildReleaseDossierPayload({
      run,
      verifyRunReport,
      policyVerdicts,
      trustRegistry: this.getTrustRegistry(),
      benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
      verificationSnapshot,
    })
    const document = createReleaseDossierDocument(payload, generatedAt)
    const signing = this.trustRegistry.signHmacPayload({
      scope: 'release-dossier',
      payload: serializeReleaseDossierSignable(document),
    })

    if (signing.signature) {
      document.signaturePolicyId = signing.policy?.policyId
      document.signature = signing.signature
    }

    fs.writeFileSync(dossierPath, JSON.stringify(document, null, 2), 'utf8')

    const { report } = verifyReleaseDossierArtifact(run, dossierPath, verifyRunReport, this.trustRegistry)
    this.ledger.appendTimeline(runId, 'release.dossier.generated', undefined, {
      dossierPath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
    }, generatedAt)

    const verdict = this.policyEngine.evaluateReleaseDossier({
      runId,
      dossierPath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      issues: report.issues,
      evaluatedAt: report.verifiedAt,
    })
    this.recordPolicyVerdict(runId, 'policy.release-dossier', verdict)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      releaseDossier: {
        path: dossierPath,
        verified: report.ok,
        payloadDigestOk: report.payloadDigestOk,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: report.issues,
      },
    })

    return {
      releaseDossierReport: report,
      releaseDossierVerdict: verdict,
    }
  }

  private async finalizeInvariantReport(runId: string): Promise<FinalizedInvariantReport> {
    const run = await this.getRequiredRun(runId)
    const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
    const verifyRunReport = await this.verifyRun(runId)
    const generatedAt = createISODateTime()
    const reportDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_INVARIANT_REPORTS_DIR)
    fs.mkdirSync(reportDir, { recursive: true })
    const reportPath = path.join(reportDir, `${runId}.invariant-report.json`)
    const payload = buildInvariantReportPayload({
      run,
      releaseArtifacts: verifyRunReport.releaseArtifacts,
      invariantFailures: verifyRunReport.invariantFailures,
      verificationSnapshot,
    })
    const document = createInvariantReportDocument(payload, generatedAt)
    const signing = this.trustRegistry.signHmacPayload({
      scope: 'invariant-report',
      payload: serializeInvariantReportSignable(document),
    })

    if (signing.signature) {
      document.signaturePolicyId = signing.policy?.policyId
      document.signature = signing.signature
    }

    fs.writeFileSync(reportPath, JSON.stringify(document, null, 2), 'utf8')

    const { report } = verifyInvariantReportArtifact(
      run,
      reportPath,
      verifyRunReport.releaseArtifacts,
      verifyRunReport.invariantFailures,
      this.trustRegistry,
    )
    this.ledger.appendTimeline(runId, 'invariant.report.generated', undefined, {
      reportPath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
    }, generatedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      invariantReport: summarizeInvariantReportArtifact({
        path: reportPath,
        report,
      }),
    })

    return {
      invariantReport: report,
    }
  }

  private async finalizePolicyReport(runId: string): Promise<FinalizedPolicyReport> {
    const run = await this.getRequiredRun(runId)
    const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
    const verdicts = this.ledger.listPolicyVerdicts(runId)
    const generatedAt = createISODateTime()
    const reportDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_POLICY_REPORTS_DIR)
    fs.mkdirSync(reportDir, { recursive: true })
    const reportPath = path.join(reportDir, `${runId}.policy-report.json`)
    const payload = buildPolicyReportPayload({
      run,
      verdicts,
      verificationSnapshot,
    })
    const document = createPolicyReportDocument(payload, generatedAt)
    const signing = this.trustRegistry.signHmacPayload({
      scope: 'policy-report',
      payload: serializePolicyReportSignable(document),
    })

    if (signing.signature) {
      document.signaturePolicyId = signing.policy?.policyId
      document.signature = signing.signature
    }

    fs.writeFileSync(reportPath, JSON.stringify(document, null, 2), 'utf8')

    const { report } = verifyPolicyReportArtifact(run, reportPath, verdicts, this.trustRegistry)
    this.ledger.appendTimeline(runId, 'policy.report.generated', undefined, {
      reportPath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
    }, generatedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      policyReport: summarizePolicyReportArtifact({
        path: reportPath,
        report,
      }),
    })

    return {
      policyReport: report,
    }
  }

  private async finalizeReleaseBundle(runId: string): Promise<FinalizedReleaseBundle> {
    const existing = await this.getRequiredRun(runId)
    if (!existing.snapshot.policyReport?.path) {
      await this.finalizePolicyReport(runId)
    }
    const run = await this.getRequiredRun(runId)
    const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
    const verifyRunReport = await this.verifyRun(runId)
    const generatedAt = createISODateTime()
    const bundleDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_RELEASE_BUNDLES_DIR)
    fs.mkdirSync(bundleDir, { recursive: true })
    const bundlePath = path.join(bundleDir, `${runId}.release-bundle.json`)
    const payload = buildReleaseBundlePayload({
      run,
      verifyRunReport,
      policyReport: run.snapshot.policyReport,
      invariantReport: run.snapshot.invariantReport,
      releaseDossier: run.snapshot.releaseDossier,
      certificationRecord: run.snapshot.certificationRecord ?? this.getPlannedCertificationRecordSummary(runId),
      trustRegistry: this.getTrustRegistry(),
      benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
      verificationSnapshot,
    })
    const document = createReleaseBundleDocument(payload, generatedAt)
    const signing = this.trustRegistry.signHmacPayload({
      scope: 'release-bundle',
      payload: serializeReleaseBundleSignable(document),
    })

    if (signing.signature) {
      document.signaturePolicyId = signing.policy?.policyId
      document.signature = signing.signature
    }

    fs.writeFileSync(bundlePath, JSON.stringify(document, null, 2), 'utf8')

    const { report } = verifyReleaseBundleArtifact(
      run,
      bundlePath,
      verifyRunReport,
      run.snapshot.policyReport,
      run.snapshot.invariantReport,
      run.snapshot.certificationRecord ?? this.getPlannedCertificationRecordSummary(runId),
      this.trustRegistry,
    )
    this.ledger.appendTimeline(runId, 'release.bundle.generated', undefined, {
      bundlePath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
    }, generatedAt)

    const verdict = this.policyEngine.evaluateReleaseBundle({
      runId,
      bundlePath,
      ok: report.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      issues: report.issues,
      evaluatedAt: report.verifiedAt,
    })
    this.recordPolicyVerdict(runId, 'policy.release-bundle', verdict)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      releaseBundle: {
        path: bundlePath,
        verified: report.ok,
        payloadDigestOk: report.payloadDigestOk,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
        signaturePolicyId: report.signaturePolicyId,
        signatureKeyId: report.signatureKeyId,
        signatureIssuer: report.signatureIssuer,
        issues: report.issues,
      },
    })

    return {
      releaseBundleReport: report,
      releaseBundleVerdict: verdict,
    }
  }

  private async finalizeCertificationRecord(runId: string): Promise<FinalizedCertificationRecord> {
    const run = await this.getRequiredRun(runId)
    if (!run.snapshot.releaseBundle?.path) {
      await this.finalizeReleaseBundle(runId)
    }
    const latestRun = await this.getRequiredRun(runId)
    const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
    const bundle = await this.getReleaseBundle(runId)
    const generatedAt = createISODateTime()
    const recordDir = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_CERTIFICATION_RECORDS_DIR)
    fs.mkdirSync(recordDir, { recursive: true })
    const recordPath = path.join(recordDir, `${runId}.certification-record.json`)
    const blockedScopes = this.ledger.listPolicyVerdicts(runId)
      .filter(verdict => verdict.effect === 'block')
      .map(verdict => verdict.scope)
    const payload = buildCertificationRecordPayload({
      run: latestRun,
      releaseBundle: {
        path: bundle.bundlePath,
        payloadDigest: bundle.document.payloadDigest,
        signaturePolicyId: bundle.document.signaturePolicyId,
        signatureKeyId: bundle.document.signature?.keyId,
        signatureIssuer: bundle.document.signature?.issuer,
      },
      trustRegistry: this.getTrustRegistry(),
      benchmarkSourceRegistry: this.getBenchmarkSourceRegistry(),
      blockedScopes,
      remoteWorkers: this.listRemoteWorkers().workers.map(worker => ({
        workerId: worker.id,
        agentCardSha256: worker.agentCardSha256,
        verificationSummary: worker.verification?.summary,
      })),
      verificationSnapshot,
    })
    const document = createCertificationRecordDocument(payload, generatedAt)
    const { snapshotDigest: certSnapshotDigest, artifactInputs } = this.collectProofGraphArtifactInputs(runId, latestRun, document)
    const { crossArtifactReport, proofGraphDigest } = verifyArtifactChainConsistency({
      artifacts: artifactInputs,
      snapshotDigest: certSnapshotDigest,
    })

    if (!proofGraphDigest) {
      throw new Error(`Cannot append certification proof graph for run ${runId}: proofGraphDigest is empty`)
    }

    document.proofGraphDigest = proofGraphDigest

    const signing = this.trustRegistry.signHmacPayload({
      scope: 'certification-record',
      payload: serializeCertificationRecordSignable(document),
    })

    if (signing.signature) {
      document.signaturePolicyId = signing.policy?.policyId
      document.signature = signing.signature
    }

    fs.writeFileSync(recordPath, JSON.stringify(document, null, 2), 'utf8')

    const { report } = verifyCertificationRecordArtifact(latestRun, recordPath, payload, this.trustRegistry)

    // PR-13: log cross-artifact issues to timeline
    if (!crossArtifactReport.ok) {
      this.ledger.appendTimeline(runId, 'certification.cross_artifact.failed', undefined, {
        issues: crossArtifactReport.issues,
        proofGraphDigest,
      }, generatedAt)
    }

    const transparencyLedgerPath = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE)
    appendTransparencyLedgerEntry({
      ledgerPath: transparencyLedgerPath,
      runId,
      certificationRecordPath: recordPath,
      certificationRecordDigest: document.payloadDigest,
      releaseBundlePath: bundle.bundlePath,
      releaseBundleDigest: bundle.document.payloadDigest,
      recordedAt: generatedAt,
      snapshotDigest: certSnapshotDigest,
      proofGraphDigest,
    })
    const ledgerEntries = readTransparencyLedgerEntries(transparencyLedgerPath)
    const ledgerReport = verifyTransparencyLedger(transparencyLedgerPath)
    this.ledger.appendTimeline(runId, 'certification.record.generated', undefined, {
      recordPath,
      ok: report.ok && crossArtifactReport.ok,
      signatureVerified: report.signatureVerified,
      signatureRequired: report.signatureRequired,
      signaturePolicyId: report.signaturePolicyId,
      transparencyLedgerPath,
      transparencyEntryCount: ledgerEntries.length,
      transparencyHeadDigest: ledgerReport.headDigest,
    }, generatedAt)
    await this.refreshSnapshot(runId, this.activeRuns.get(runId), {
      certificationRecord: summarizeCertificationRecordArtifact({
        path: recordPath,
        report,
      }),
      transparencyLedger: summarizeTransparencyLedger({
        ledgerPath: transparencyLedgerPath,
        entries: ledgerEntries,
        report: ledgerReport,
      }),
    })

    return {
      certificationRecordReport: report,
    }
  }

  close(): void {
    this.sqliteClient.close()
  }

  private async evaluateTraceBundleReport(
    runId: string,
    bundlePath: string,
    recordTimeline: boolean,
  ): Promise<VerifyTraceBundleReport> {
    const { report } = verifyTraceBundleArtifact(runId, bundlePath, this.trustRegistry)

    if (recordTimeline) {
      this.ledger.appendTimeline(runId, 'trace.bundle.verified', undefined, {
        bundlePath,
        ok: report.ok,
        actualBundleDigest: report.actualBundleDigest,
        expectedBundleDigest: report.expectedBundleDigest,
        mismatchedEntries: report.mismatchedEntries,
        missingEntries: report.missingEntries,
        signatureVerified: report.signatureVerified,
        signatureRequired: report.signatureRequired,
      }, report.verifiedAt)
    }

    return report
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const interrupted = this.ledger.listRunsByStatuses(['starting', 'running'])
    for (const run of interrupted) {
      if (this.activeRuns.has(run.snapshot.runId)) {
        continue
      }
      await this.resumeInterruptedRun(run)
    }
  }

  private async resumeInterruptedRun(run: RunDetails): Promise<void> {
    const controller = new AbortController()
    const context: ActiveRunContext = {
      invocation: run.invocation,
      definition: run.definition,
      driver: new WorkflowRunDriver({
        eventStore: this.eventStore,
        checkpointStore: this.checkpointStore,
        dagEngine: new DagEngine(),
        agentRuntime: this.agentRuntimeService,
        executorRegistry: this.remoteWorkers.createExecutorRegistry(run.definition),
        issueStepLease: ({ runId, nodeId, state, attempt }) => this.issueStepLease(runId, run.definition, state, nodeId, attempt),
        validateNodeResult: ({ nodeId, state, result }) => {
          const step = run.definition.steps.find(candidate => candidate.id === nodeId)
          if (!step) {
            throw new Error(`Missing workflow step definition for ${nodeId}`)
          }
          return {
            ...result,
            output: validateWorkflowStepOutput(step, result.output, state),
          }
        },
      }),
      controller,
      startedAt: run.snapshot.startedAt ?? run.snapshot.createdAt,
      phase: LifecyclePhase.Bootstrap,
    }
    this.activeRuns.set(run.snapshot.runId, context)
    this.ledger.appendTimeline(run.snapshot.runId, 'run.recovered', undefined, {
      previousStatus: run.snapshot.status,
      authorityOwner: this.getManifest().authorityOwner,
    }, createISODateTime())
    this.telemetrySink.onRecovery(run.snapshot.runId, { recoveredNodes: Object.keys(run.snapshot.nodes ?? {}).length })
    await this.reconcileCompletionSessions(run.snapshot.runId)
    await this.recoverStaleActiveLease(run.snapshot.runId)
    await this.refreshSnapshot(run.snapshot.runId, context, {
      explicitStatus: 'running',
      verdict: run.snapshot.verdict,
      releaseArtifacts: run.snapshot.releaseArtifacts,
    })
    context.drainPromise = this.drainRun(run.snapshot.runId, context)
    void context.drainPromise.catch(() => {
      // Snapshot already carries terminal error state.
    })
  }

  private async drainRun(runId: string, context: ActiveRunContext): Promise<void> {
    // PR-04: delegate lifecycle to AuthorityRuntimeKernel.
    // The kernel manages phase transitions; runtime provides hook implementations.
    const drainFn = () => this.executeDrain(runId, context)
    const hooks: LifecycleHooks = {
      onDrainComplete: async (_runId) => this.evaluateTerminalDecision(_runId, context),
      onDrainCancelled: async (_runId, error) => {
        const message = error.message
        await this.ensureRunCompletedEvent(_runId, 'cancelled')
        this.ledger.appendTimeline(_runId, 'run.cancelled', undefined, {
          reason: message,
        }, createISODateTime())
        this.telemetrySink.onRunCompleted(_runId, { status: 'cancelled' })
        const snapshot = await this.refreshSnapshot(_runId, context, {
          explicitStatus: 'cancelled',
          verdict: message,
          completedAt: createISODateTime(),
        })
        this.recordRunMemory(context.invocation, context.definition, snapshot)
        return { status: 'cancelled' as const, verdict: message, completedAt: createISODateTime() }
      },
      onDrainFailed: async (_runId, error) => {
        const message = error.message
        await this.ensureRunCompletedEvent(_runId, 'failed')
        this.ledger.appendTimeline(_runId, 'run.failed', undefined, {
          error: message,
        }, createISODateTime())
        this.telemetrySink.onRunCompleted(_runId, { status: 'failed' })
        const snapshot = await this.refreshSnapshot(_runId, context, {
          explicitStatus: 'failed',
          verdict: message,
          completedAt: createISODateTime(),
        })
        this.recordRunMemory(context.invocation, context.definition, snapshot)
        return { status: 'failed' as const, verdict: message, completedAt: createISODateTime() }
      },
      onFinalize: async (_runId, _decision) => {
        await this.ensureTerminalArtifactsFinalized(_runId)
      },
      onCleanup: (_runId) => {
        this.activeRuns.delete(_runId)
        this.verificationSnapshots.delete(_runId)
        this.terminalArtifactFinalizations.delete(_runId)
      },
    }

    await this.lifecycleKernel.orchestrate(
      runId,
      drainFn,
      hooks,
      () => context.controller.signal.aborted,
    )
  }

  /**
   * PR-04: Execute the drain pump — calls driver.drain() with node-level hooks.
   * Separated from lifecycle coordination to keep concerns distinct.
   */
  private async executeDrain(runId: string, context: ActiveRunContext): Promise<void> {
    await context.driver.drain(runId, {
      signal: context.controller.signal,
      maxTicks: 40,
      onNodeStarted: async (nodeId) => {
        this.ledger.appendTimeline(runId, 'node.started', nodeId, {}, createISODateTime())
        this.telemetrySink.onNodeStarted(runId, nodeId, { attempt: 1 })
        await this.refreshSnapshot(runId, context, { explicitStatus: 'running' })
      },
      onNodeComplete: async (nodeId, result, lease) => {
        const capturedAt = createISODateTime()
        this.ledger.appendTimeline(runId, 'tribunal.started', nodeId, {
          leaseId: lease.leaseId,
          attempt: lease.attempt,
        }, capturedAt)
        const tribunalVerdict = await this.tribunalService.evaluate({
          runId,
          nodeId,
          output: result.output,
          state: await this.loadState(runId),
          invocation: context.invocation,
          definition: context.definition,
          capturedAt,
        })
        if (tribunalVerdict) {
          this.recordTribunalVerdict(runId, tribunalVerdict)
          // PR-07: dual-write policy_verdict.recorded
          await this.emitDomainEvent(runId, DaemonDomainEventTypes.POLICY_VERDICT_RECORDED, {
            nodeId,
            verdictType: 'tribunal' as const,
            verdict: tribunalVerdict.verdict ?? 'recorded',
            details: { mode: tribunalVerdict.mode, confidence: tribunalVerdict.confidence },
          }, nodeId)
        }
        const tribunalSummary = this.buildTribunalSummary(tribunalVerdict)
        const receipt = createExecutionReceipt({
          runId,
          nodeId,
          result,
          invocation: context.invocation,
          definition: context.definition,
          capturedAt,
          traceId: crypto.randomUUID(),
          tribunal: tribunalSummary,
          judgeReports: tribunalVerdict ? [] : [],
        })
        // PR-07: dual-write receipt.recorded
        await this.emitDomainEvent(runId, DaemonDomainEventTypes.RECEIPT_RECORDED, {
          receiptId: receipt.receiptId,
          nodeId,
          model: receipt.model ?? 'unknown',
          status: receipt.status,
          outputHash: receipt.outputHash,
          durationMs: receipt.durationMs ?? 0,
        }, nodeId)
        const handoffs = createHandoffEnvelopes({
          runId,
          nodeId,
          definition: context.definition,
          receipt,
          capturedAt: receipt.capturedAt,
        })
        // PR-07: dual-write handoff.recorded for each handoff
        for (const handoff of handoffs) {
          await this.emitDomainEvent(runId, DaemonDomainEventTypes.HANDOFF_RECORDED, {
            handoffId: handoff.handoffId ?? crypto.randomUUID(),
            nodeId,
            sourceNodeId: handoff.sourceNodeId ?? nodeId,
            targetNodeId: handoff.targetNodeId ?? 'unknown',
          }, nodeId)
        }
        const pendingCompletionReceipt: StepCompletionReceipt = {
          leaseId: lease.leaseId,
          runId,
          nodeId,
          attempt: lease.attempt,
          status: receipt.status,
          outputHash: receipt.outputHash,
          model: receipt.model,
          durationMs: receipt.durationMs,
          completedAt: receipt.capturedAt,
        }
        this.stageCompletionSession(
          runId,
          lease,
          pendingCompletionReceipt,
          result,
          tribunalSummary,
          handoffs,
          receipt,
          capturedAt,
        )
        // PR-07: dual-write completion_session.started
        await this.emitDomainEvent(runId, DaemonDomainEventTypes.COMPLETION_SESSION_STARTED, {
          leaseId: lease.leaseId,
          nodeId,
          attempt: lease.attempt,
        }, nodeId)
        await this.refreshSnapshot(runId, context, { explicitStatus: 'running' })
        const preparedSession = await this.prepareStepCompletionReceipt(runId, {
          leaseId: lease.leaseId,
          nodeId,
          attempt: lease.attempt,
          status: receipt.status,
          outputHash: receipt.outputHash,
          model: receipt.model,
          durationMs: receipt.durationMs,
          completedAt: receipt.capturedAt,
        })
        await this.commitStepCompletionReceipt(runId, {
          leaseId: lease.leaseId,
          nodeId,
          attempt: lease.attempt,
          status: receipt.status,
          outputHash: receipt.outputHash,
          model: receipt.model,
          durationMs: receipt.durationMs,
          completedAt: receipt.capturedAt,
          preparedAt: preparedSession.preparedCompletionReceipt?.preparedAt,
        })
        // PR-07: dual-write completion_session.committed
        await this.emitDomainEvent(runId, DaemonDomainEventTypes.COMPLETION_SESSION_COMMITTED, {
          leaseId: lease.leaseId,
          nodeId,
          attempt: lease.attempt,
          status: receipt.status,
          outputHash: receipt.outputHash,
          model: receipt.model,
          durationMs: receipt.durationMs,
        }, nodeId)
        const committedSession = this.ledger.getCompletionSession(runId, lease.leaseId, nodeId, lease.attempt)
        if (!committedSession) {
          throw new Error(`Missing committed completion session for ${runId}/${nodeId}`)
        }
        this.applyCommittedCompletionArtifacts(runId, committedSession)
        this.ledger.appendTimeline(runId, 'node.completed', nodeId, {
          receiptId: receipt.receiptId,
          model: receipt.model,
          durationMs: receipt.durationMs,
        }, createISODateTime())
        this.telemetrySink.onNodeCompleted(runId, nodeId, { durationMs: receipt.durationMs, degraded: tribunalVerdict?.mode !== 'remote' })
        await this.refreshSnapshot(runId, context, { explicitStatus: 'running' })
      },
      onNodeFailed: async (nodeId, error) => {
        this.ledger.appendTimeline(runId, 'node.failed', nodeId, {
          error: error.message,
        }, createISODateTime())
        this.telemetrySink.onNodeFailed(runId, nodeId, { error: error.message })
        await this.refreshSnapshot(runId, context, {
          explicitStatus: 'running',
          verdict: error.message,
        })
      },
      onNodeSkipped: async (nodeId, detail) => {
        const state = await this.loadState(runId)
        this.syncPolicySkippedNodes(runId, context.definition, state, new Map([[nodeId, {
          reason: detail.reason,
          strategyId: detail.strategyId,
          triggerCondition: detail.triggerCondition,
          sourceNodeId: detail.sourceNodeId,
        }]]))
        await this.refreshSnapshot(runId, context, { explicitStatus: 'running' })
      },
      // PR-05: Daemon-authoritative transition hook — driver delegates skip/forceQueue
      // decisions to daemon instead of evaluating them internally.
      onTransition: async (nodeId, result, state) => {
        return this.evaluateNodeTransition(nodeId, result, state, runId)
      },
    })
  }

  /**
   * PR-05: Daemon-authoritative transition evaluation.
   * The daemon is the sole owner of skip/forceQueue/route-override decisions.
   * Uses evaluateTransition() as a pure rule engine, but the authority (decision
   * to accept/reject) lives here, not in the driver.
   */
  private evaluateNodeTransition(
    nodeId: string,
    result: NodeExecutionResult,
    state: WorkflowState,
    runId: string,
  ): { skipNodes: Array<{ nodeId: string; reason: string; strategyId?: string; triggerCondition?: string }>; forceQueue: string[] } {
    const transition = evaluateTransition(nodeId, result.output, state)

    // Record authority provenance in timeline
    for (const skip of transition.skipNodes) {
      this.ledger.appendTimeline(runId, 'authority.skip', skip.nodeId, {
        sourceNodeId: nodeId,
        reason: skip.reason,
        strategyId: skip.strategyId,
        authorityOwner: 'daemon',
      }, createISODateTime())
      // PR-07: dual-write skip.authorized
      void this.emitDomainEvent(runId, DaemonDomainEventTypes.SKIP_AUTHORIZED, {
        nodeId: skip.nodeId,
        sourceNodeId: nodeId,
        reason: skip.reason,
        strategyId: skip.strategyId,
        triggerCondition: skip.triggerCondition,
        authorityOwner: 'daemon',
      }, skip.nodeId)
    }
    for (const fqNodeId of transition.forceQueue) {
      this.ledger.appendTimeline(runId, 'authority.forceQueue', fqNodeId, {
        sourceNodeId: nodeId,
        authorityOwner: 'daemon',
      }, createISODateTime())
    }

    return transition
  }

  /**
   * PR-07: Emit a daemon domain event — fail-open dual-write helper.
   *
   * Legacy ledger writes are authoritative. If the domain event append fails,
   * the error is recorded in the timeline as `dual_write.failed` and the run
   * continues. This preserves backward compatibility and allows rollback by
   * simply not consuming the event log.
   */
  private async emitDomainEvent(
    runId: string,
    eventType: DaemonDomainEventType,
    payload: Record<string, unknown>,
    nodeId?: string,
  ): Promise<void> {
    try {
      const sequence = await this.domainEventLog.getLatestSequence(runId)
      const event = createDaemonDomainEvent(runId, eventType, sequence + 1, payload, nodeId)
      await this.domainEventLog.append({
        runId,
        events: [event],
        expectedSequence: sequence,
      })
    } catch (error) {
      // Fail-open: log audit trail but do not crash the run
      this.ledger.appendTimeline(runId, 'dual_write.failed', nodeId ?? 'system', {
        eventType,
        error: error instanceof Error ? error.message : String(error),
      }, createISODateTime())
    }
  }

  /**
   * PR-10/11: Evaluate a daemon lifecycle governance stage via GovernanceGateway.
   *
   * Replaces the old diagnostics-only hook path and the helper-only cutover path.
   * GovernanceGateway is the authoritative policy decision point for daemon
   * lifecycle governance; runtime consumes the returned verdict directly.
   */
  private evaluateGovernanceStage(
    stage: DaemonLifecycleStage,
    runId: string,
    ruleScope: string,
    verdictScope: string,
    evaluatedAt: string,
    facts: Record<string, unknown>,
    fallbackMessage: string,
  ): PolicyVerdict {
    const pack = this.policyEngine.exportPack()
    const stageVerdict = this.governanceGateway.evaluateDaemonLifecycleStage({
      stage,
      runId,
      ruleScope,
      verdictScope,
      evaluatedAt,
      facts,
      fallbackMessage,
      rules: pack.rules,
      evaluator: evaluateRulesAgainstFacts,
    })
    // Log stage-tagged verdict to timeline for audit
    this.ledger.appendTimeline(runId, 'governance.stage_verdict', 'system', {
      stage: stageVerdict.stage,
      effect: stageVerdict.effect,
      verdictId: stageVerdict.verdictId,
      scope: stageVerdict.scope,
      rationale: stageVerdict.rationale,
    }, evaluatedAt)
    return {
      verdictId: stageVerdict.verdictId,
      runId,
      scope: stageVerdict.scope,
      effect: stageVerdict.effect as PolicyVerdict['effect'],
      rationale: stageVerdict.rationale,
      evidenceIds: [],
      evaluatedAt: stageVerdict.evaluatedAt,
    }
  }

  /**
   * PR-04: Evaluate terminal decision after drain completes successfully.
   * Handles release gate, human gate, and artifact verification.
   */
  private async evaluateTerminalDecision(runId: string, context: ActiveRunContext): Promise<TerminalDecision> {
    const state = await this.loadState(runId)
    const releaseDecision = this.evaluateReleaseGate(runId, context.definition, state)
    // PR-11: gateway cutover for release
    const releaseEvaluatedAt = createISODateTime()
    const releaseInput = { runId, decision: releaseDecision, evaluatedAt: releaseEvaluatedAt }
    // PR-11: governance gateway cutover — release via gateway
    const releaseVerdict = this.evaluateGovernanceStage(
      'daemon:terminal-release', runId, 'release', 'release', releaseEvaluatedAt,
      createFactsForRelease(releaseInput), 'Release checks passed under the active policy pack.',
    )
    this.recordPolicyVerdict(runId, 'policy.release', releaseVerdict)
    if (releaseVerdict.effect === 'block') {
      await this.ensureRunCompletedEvent(runId, 'paused')
      this.ledger.appendTimeline(runId, 'run.blocked_for_human', undefined, {
        reason: releaseDecision.rationale.join('; '),
      }, createISODateTime())
      await this.refreshSnapshot(runId, context, {
        explicitStatus: 'paused_for_human',
        verdict: releaseDecision.rationale.join('; '),
      })
      return { status: 'paused_for_human', verdict: releaseDecision.rationale.join('; ') }
    }

    const humanGate = deriveHumanApprovalRequirement(state)
    // PR-11: governance gateway cutover — human-gate via gateway
    const humanGateEvaluatedAt = createISODateTime()
    const humanGateInput = { runId, requirement: humanGate, evaluatedAt: humanGateEvaluatedAt }
    const humanGateVerdict = this.evaluateGovernanceStage(
      'daemon:terminal-release', runId, 'human-gate', 'human-gate', humanGateEvaluatedAt,
      createFactsForHumanGate(humanGateInput), 'Human gate checks passed under the active policy pack.',
    )
    this.recordPolicyVerdict(runId, 'policy.human-gate', humanGateVerdict, 'HITL')
    if (humanGate.required) {
      await this.ensureRunCompletedEvent(runId, 'paused')
      this.ledger.appendTimeline(runId, 'run.paused_for_human', 'HITL', {
        reason: humanGate.reason,
      }, createISODateTime())
      await this.refreshSnapshot(runId, context, {
        explicitStatus: 'paused_for_human',
        verdict: humanGate.reason,
      })
      return { status: 'paused_for_human', verdict: humanGate.reason }
    }

    // Happy path: run completed
    this.ledger.appendTimeline(runId, 'run.completed', undefined, {}, createISODateTime())
    this.telemetrySink.onRunCompleted(runId, { status: 'completed' })
    await this.refreshSnapshot(runId, context, {
      explicitStatus: 'completed',
      completedAt: createISODateTime(),
    })
    const finalizedArtifacts = await this.ensureTerminalArtifactsFinalized(runId)
    if (
      finalizedArtifacts.traceArtifacts.traceBundleVerdict.effect === 'block' ||
      finalizedArtifacts.traceArtifacts.releaseAttestationVerdict.effect === 'block' ||
      !finalizedArtifacts.invariantReport.invariantReport.ok ||
      finalizedArtifacts.releaseDossier.releaseDossierVerdict.effect === 'block' ||
      finalizedArtifacts.releaseBundle.releaseBundleVerdict.effect === 'block' ||
      !finalizedArtifacts.certificationRecord.certificationRecordReport.ok
    ) {
      const rationale = [
        ...finalizedArtifacts.traceArtifacts.traceBundleVerdict.rationale,
        ...finalizedArtifacts.traceArtifacts.releaseAttestationVerdict.rationale,
        ...(!finalizedArtifacts.invariantReport.invariantReport.ok ? finalizedArtifacts.invariantReport.invariantReport.issues : []),
        ...finalizedArtifacts.releaseDossier.releaseDossierVerdict.rationale,
        ...finalizedArtifacts.releaseBundle.releaseBundleVerdict.rationale,
        ...(!finalizedArtifacts.certificationRecord.certificationRecordReport.ok ? finalizedArtifacts.certificationRecord.certificationRecordReport.issues : []),
      ].filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)
      await this.ensureRunCompletedEvent(runId, 'paused')
      this.ledger.appendTimeline(runId, 'run.blocked_for_human', undefined, {
        reason: rationale.join('; '),
      }, createISODateTime())
      await this.refreshSnapshot(runId, context, {
        explicitStatus: 'paused_for_human',
        verdict: rationale.join('; '),
      })
      return { status: 'paused_for_human', verdict: rationale.join('; ') }
    }
    const finalizedRun = await this.getRequiredRun(runId)
    this.recordRunMemory(context.invocation, context.definition, finalizedRun.snapshot)
    return { status: 'completed', completedAt: createISODateTime() }
  }

  private async ensureTerminalArtifactsFinalized(runId: string): Promise<FinalizedTerminalArtifacts> {
    const existing = this.terminalArtifactFinalizations.get(runId)
    if (existing) {
      return existing
    }

    const finalizationPromise = (async () => {
      const verificationSnapshot = await this.ensureVerificationSnapshot(runId)
      const traceArtifacts = await this.finalizeTraceBundle(runId)
      const policyReport = await this.finalizePolicyReport(runId)
      const invariantReport = await this.finalizeInvariantReport(runId)
      const releaseDossier = await this.finalizeReleaseDossier(runId)
      const releaseBundle = await this.finalizeReleaseBundle(runId)
      const certificationRecord = await this.finalizeCertificationRecord(runId)
      return {
        verificationSnapshot,
        traceArtifacts,
        policyReport,
        invariantReport,
        releaseDossier,
        releaseBundle,
        certificationRecord,
      }
    })()

    this.terminalArtifactFinalizations.set(runId, finalizationPromise)
    try {
      return await finalizationPromise
    } catch (error) {
      this.terminalArtifactFinalizations.delete(runId)
      throw error
    }
  }

  private async ensureVerificationSnapshot(runId: string): Promise<VerificationSnapshot> {
    const existing = this.verificationSnapshots.get(runId)
    if (existing) {
      return existing
    }

    const verifyReport = await this.verifyRun(runId)
    const run = await this.getRequiredRun(runId)
    const verdicts = this.ledger.listPolicyVerdicts(runId)
    const verificationSnapshot = buildVerificationSnapshot({
      run,
      verifyReport,
      verdicts,
      generatedAt: createISODateTime(),
    })
    this.verificationSnapshots.set(runId, verificationSnapshot)
    this.ledger.appendTimeline(runId, 'verification.snapshot.built', undefined, {
      snapshotDigest: verificationSnapshot.snapshotDigest,
      verificationOk: verificationSnapshot.verification.ok,
    }, verificationSnapshot.generatedAt)
    return verificationSnapshot
  }

  private readArtifactDocument<T>(artifactPath: string, label: string): T {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Missing ${label} artifact at ${artifactPath}`)
    }
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as T
  }

  private collectProofGraphArtifactInputs(
    runId: string,
    run: RunDetails,
    certificationDocument: CertificationRecordDocument,
  ): {
    snapshotDigest: string
    artifactInputs: Array<{ kind: string; runId: string; snapshotDigest: string; payloadDigest: string }>
  } {
    const policyReportPath = run.snapshot.policyReport?.path
    const invariantReportPath = run.snapshot.invariantReport?.path
    const releaseAttestationPath = run.snapshot.releaseArtifacts.releaseAttestation?.path
    const releaseDossierPath = run.snapshot.releaseDossier?.path
    const releaseBundlePath = run.snapshot.releaseBundle?.path

    if (!policyReportPath || !invariantReportPath || !releaseAttestationPath || !releaseDossierPath || !releaseBundlePath) {
      throw new Error(`Cannot compute proof graph for run ${runId}: missing terminal artifact path(s)`)
    }

    const policyDocument = this.readArtifactDocument<PolicyReportDocument>(policyReportPath, 'policy report')
    const invariantDocument = this.readArtifactDocument<InvariantReportDocument>(invariantReportPath, 'invariant report')
    const attestationDocument = this.readArtifactDocument<ReleaseAttestationDocument>(releaseAttestationPath, 'release attestation')
    const dossierDocument = this.readArtifactDocument<ReleaseDossierDocument>(releaseDossierPath, 'release dossier')
    const bundleDocument = this.readArtifactDocument<ReleaseBundleDocument>(releaseBundlePath, 'release bundle')

    const artifactInputs = [
      { kind: 'policy-report', runId, snapshotDigest: policyDocument.payload.snapshotDigest, payloadDigest: policyDocument.payloadDigest },
      { kind: 'invariant-report', runId, snapshotDigest: invariantDocument.payload.snapshotDigest, payloadDigest: invariantDocument.payloadDigest },
      { kind: 'release-attestation', runId, snapshotDigest: attestationDocument.payload.snapshotDigest, payloadDigest: attestationDocument.payloadDigest },
      { kind: 'release-dossier', runId, snapshotDigest: dossierDocument.payload.snapshotDigest, payloadDigest: dossierDocument.payloadDigest },
      { kind: 'release-bundle', runId, snapshotDigest: bundleDocument.payload.snapshotDigest, payloadDigest: bundleDocument.payloadDigest },
      { kind: 'certification-record', runId, snapshotDigest: certificationDocument.payload.snapshotDigest, payloadDigest: certificationDocument.payloadDigest },
    ]

    const missingSnapshotKinds = artifactInputs
      .filter(input => !input.snapshotDigest)
      .map(input => input.kind)
    if (missingSnapshotKinds.length > 0) {
      throw new Error(`Cannot compute proof graph for run ${runId}: missing snapshotDigest in ${missingSnapshotKinds.join(', ')}`)
    }

    const snapshotDigests = new Set(artifactInputs.map(input => input.snapshotDigest))
    if (snapshotDigests.size !== 1) {
      throw new Error(`Cannot compute proof graph for run ${runId}: inconsistent snapshotDigest across terminal artifacts`)
    }

    return {
      snapshotDigest: artifactInputs[0]!.snapshotDigest!,
      artifactInputs: artifactInputs.map(input => ({
        kind: input.kind,
        runId: input.runId,
        snapshotDigest: input.snapshotDigest!,
        payloadDigest: input.payloadDigest,
      })),
    }
  }

  private recordRunMemory(
    invocation: WorkflowInvocation,
    definition: WorkflowDefinition,
    snapshot: RunSnapshot,
  ): void {
    if (snapshot.status !== 'completed' && snapshot.status !== 'failed' && snapshot.status !== 'cancelled') {
      return
    }

    const outcome = snapshot.status === 'completed'
      ? 'completed'
      : snapshot.status === 'cancelled'
        ? 'cancelled'
        : 'failed'

    this.memoryManager.recordRun(
      {
        runId: snapshot.runId,
        goal: invocation.goal,
        repoRoot: invocation.workspaceRoot,
        files: invocation.files,
        riskLevel: invocation.options.riskHint,
        worstStatus: snapshot.status,
        nodeCount: definition.steps.length,
        createdAt: snapshot.createdAt,
        completedAt: snapshot.completedAt,
        summary: snapshot.verdict,
      },
      invocation.options.riskHint ?? 'unknown',
      {
        runId: snapshot.runId,
        goal: invocation.goal,
        outcome,
        riskLevel: invocation.options.riskHint,
        keyInsights: snapshot.verdict ? [snapshot.verdict] : [],
        failureReasons: outcome === 'completed' ? [] : (snapshot.verdict ? [snapshot.verdict] : []),
        nodeCount: definition.steps.length,
        files: invocation.files,
        createdAt: snapshot.createdAt,
      },
    )
  }

  private issueStepLease(
    runId: string,
    definition: WorkflowDefinition,
    state: WorkflowState | null,
    nodeId: string,
    attempt: number,
  ): StepLease {
    const step = definition.steps.find(candidate => candidate.id === nodeId)
    if (!step) {
      throw new Error(`Missing workflow step definition for ${nodeId}`)
    }
    const issuedAt = createISODateTime()
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    const upstreamOutputs = step.dependsOn.reduce<Record<string, unknown>>((acc, upstreamNodeId) => {
      acc[upstreamNodeId] = state?.nodes[upstreamNodeId]?.output ?? null
      return acc
    }, {})
    const inputDigest = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        goal: state?.capturedContext?.metadata?.goal,
        nodeId,
        upstreamOutputs,
      }))
      .digest('hex')

    return {
      leaseId: crypto.randomUUID(),
      runId,
      nodeId,
      attempt,
      issuedAt,
      expiresAt,
      authorityOwner: this.getManifest().authorityOwner,
      requiredEvidence: step.evidenceRequirements,
      allowedModelPool: step.modelContract?.modelPool ?? [],
      inputDigest,
    }
  }

  private createCompletionSessionId(
    runId: string,
    leaseId: string,
    nodeId: string,
    attempt: number,
  ): string {
    return `${runId}:${leaseId}:${nodeId}:${attempt}`
  }

  private buildTribunalSummary(verdict: TribunalVerdictRecord | undefined): TribunalSummary | undefined {
    if (!verdict) {
      return undefined
    }
    return {
      tribunalId: verdict.tribunalId,
      runId: verdict.runId,
      nodeId: verdict.nodeId,
      mode: verdict.mode,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      quorumSatisfied: verdict.quorumSatisfied,
      remoteJurorCount: verdict.remoteJurorCount,
      totalJurorCount: verdict.totalJurorCount,
      rationale: verdict.rationale,
      evidenceIds: verdict.evidenceIds,
      jurorReportIds: verdict.jurorReportIds,
      createdAt: verdict.createdAt,
    }
  }

  private createStagedCompletionBundle(
    sessionId: string,
    result: NodeExecutionResult,
    receipt: NonNullable<StagedCompletionBundle['receipt']>,
    handoffs: StagedCompletionBundle['handoffs'],
    tribunal: TribunalSummary | undefined,
    stagedAt: string,
  ): StagedCompletionBundle {
    return {
      bundleRef: `completion://${sessionId}`,
      result: {
        output: result.output,
        model: result.model,
        durationMs: result.durationMs,
        degraded: result.degraded,
      },
      tribunal,
      receipt,
      handoffs,
      stagedAt,
    }
  }

  private stageCompletionSession(
    runId: string,
    lease: { leaseId: string; nodeId: string; attempt: number },
    receipt: StepCompletionReceipt,
    result: NodeExecutionResult,
    tribunal: TribunalSummary | undefined,
    handoffs: StagedCompletionBundle['handoffs'],
    executionReceipt: StagedCompletionBundle['receipt'],
    stagedAt: string,
  ): CompletionSessionRecord {
    const existing = this.ledger.getCompletionSession(runId, lease.leaseId, lease.nodeId, lease.attempt)
    const sessionId = this.createCompletionSessionId(runId, lease.leaseId, lease.nodeId, lease.attempt)
    const session: CompletionSessionRecord = {
      sessionId,
      runId,
      leaseId: lease.leaseId,
      nodeId: lease.nodeId,
      attempt: lease.attempt,
      phase: 'pending',
      receipt,
      tribunalVerdictId: tribunal?.tribunalId,
      stagedBundleRef: `completion://${sessionId}`,
      stagedBundle: this.createStagedCompletionBundle(
        sessionId,
        result,
        executionReceipt,
        handoffs,
        tribunal,
        stagedAt,
      ),
      createdAt: existing?.createdAt ?? stagedAt,
      updatedAt: stagedAt,
      appliedAt: existing?.appliedAt,
    }
    this.ledger.upsertCompletionSession(session)
    this.ledger.appendTimeline(runId, 'session.completion-receipt.pending', lease.nodeId, {
      sessionId,
      leaseId: lease.leaseId,
      attempt: lease.attempt,
      completionReceipt: receipt,
      stagedBundleRef: session.stagedBundleRef,
    }, stagedAt)
    return session
  }

  private advanceCompletionSession(
    session: CompletionSessionRecord,
    phase: CompletionSessionRecord['phase'],
    updatedAt: string,
  ): CompletionSessionRecord {
    const next: CompletionSessionRecord = {
      ...session,
      phase,
      updatedAt,
      preparedAt: phase === 'prepared' || phase === 'committed'
        ? (session.preparedAt ?? updatedAt)
        : session.preparedAt,
      committedAt: phase === 'committed'
        ? (session.committedAt ?? updatedAt)
        : session.committedAt,
    }
    this.ledger.upsertCompletionSession(next)
    return next
  }

  private recordTribunalVerdict(
    runId: string,
    verdict: TribunalVerdictRecord,
  ): void {
    this.ledger.recordTribunalVerdict(verdict)
    this.ledger.appendTimeline(runId, verdict.mode === 'remote' ? 'tribunal.completed' : 'tribunal.degraded', verdict.nodeId, {
      tribunalId: verdict.tribunalId,
      mode: verdict.mode,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      quorumSatisfied: verdict.quorumSatisfied,
      jurorReportIds: verdict.jurorReportIds,
    }, verdict.createdAt)
  }

  private applyCommittedCompletionArtifacts(
    runId: string,
    session: CompletionSessionRecord,
  ): CompletionSessionRecord {
    const existingReceipts = new Map(
      this.ledger.listExecutionReceipts(runId).map(receipt => [receipt.receiptId, receipt] as const),
    )
    if (!existingReceipts.has(session.stagedBundle.receipt.receiptId)) {
      this.ledger.recordExecutionReceipt(session.stagedBundle.receipt)
    }

    const existingHandoffs = new Set(
      this.ledger.listHandoffEnvelopes(runId).map(envelope => envelope.handoffId),
    )
    for (const handoff of session.stagedBundle.handoffs) {
      if (existingHandoffs.has(handoff.handoffId)) {
        continue
      }
      this.ledger.recordHandoffEnvelope(handoff)
      this.ledger.appendTimeline(runId, 'handoff.created', handoff.targetNodeId, {
        handoffId: handoff.handoffId,
        sourceNodeId: handoff.sourceNodeId,
      }, handoff.createdAt)
    }

    const appliedAt = session.appliedAt ?? createISODateTime()
    const nextSession: CompletionSessionRecord = {
      ...session,
      appliedAt,
      updatedAt: appliedAt,
    }
    this.ledger.upsertCompletionSession(nextSession)
    return nextSession
  }

  private async replayCommittedCompletion(
    runId: string,
    session: CompletionSessionRecord,
  ): Promise<void> {
    const state = await this.loadState(runId)
    const nodeState = state.nodes[session.nodeId]
    if (nodeState?.status === 'completed' && nodeState.leaseId === session.leaseId) {
      return
    }

    const currentVersion = await this.eventStore.getCurrentVersion(runId)
    const checkpointId = createCheckpointId()
    const events: WorkflowEventEnvelope[] = [
      {
        eventId: createEventId(),
        runId,
        type: 'NODE_COMPLETED',
        payload: {
          nodeId: session.nodeId,
          leaseId: session.leaseId,
          output: session.stagedBundle.result.output,
          model: session.stagedBundle.result.model,
          durationMs: session.stagedBundle.result.durationMs,
          degraded: session.stagedBundle.result.degraded ?? false,
        },
        timestamp: session.receipt.completedAt,
        version: currentVersion + 1,
      },
      {
        eventId: createEventId(),
        runId,
        type: 'CHECKPOINT_SAVED',
        payload: {
          checkpointId,
          version: currentVersion + 2,
        },
        timestamp: createISODateTime(),
        version: currentVersion + 2,
      },
    ]

    await this.eventStore.append({
      runId,
      events,
      expectedVersion: currentVersion,
    })

    try {
      const postState = await loadRunStateFromEvents(this.eventStore, runId)
      await this.checkpointStore.save({
        checkpoint: {
          checkpointId,
          runId,
          version: postState.version,
          state: postState,
          createdAt: createISODateTime(),
        },
      })
    } catch {
      // Event replay is sufficient to recover if checkpoint persistence misses this window.
    }

    this.ledger.appendTimeline(runId, 'session.completion-receipt.recovered', session.nodeId, {
      sessionId: session.sessionId,
      leaseId: session.leaseId,
      attempt: session.attempt,
      completionReceipt: session.receipt,
    }, createISODateTime())
  }

  private async reconcileCompletionSessions(
    runId: string,
  ): Promise<void> {
    const sessions = this.ledger.listCompletionSessions(runId)
    for (const session of sessions) {
      let current = session
      if (current.phase === 'pending') {
        current = this.advanceCompletionSession(current, 'prepared', createISODateTime())
      }
      if (current.phase === 'prepared') {
        current = this.advanceCompletionSession(current, 'committed', createISODateTime())
      }
      if (current.phase === 'committed' && !current.appliedAt) {
        current = this.applyCommittedCompletionArtifacts(runId, current)
      }
      if (current.phase === 'committed') {
        await this.replayCommittedCompletion(runId, current)
      }
    }
  }

  private async recoverStaleActiveLease(runId: string): Promise<void> {
    const run = this.ledger.getRun(runId)
    const activeLease = run?.snapshot.activeLease
    if (!activeLease) {
      return
    }
    const session = this.ledger.getCompletionSession(
      runId,
      activeLease.leaseId,
      activeLease.nodeId,
      activeLease.attempt,
    )
    if (session || Date.parse(activeLease.expiresAt) > Date.now()) {
      return
    }

    const currentVersion = await this.eventStore.getCurrentVersion(runId)
    await this.eventStore.append({
      runId,
      expectedVersion: currentVersion,
      events: [{
        eventId: createEventId(),
        runId,
        type: 'NODE_QUEUED',
        payload: {
          nodeId: activeLease.nodeId,
          reason: 'Recovered stale active lease without staged completion bundle',
        },
        timestamp: createISODateTime(),
        version: currentVersion + 1,
      }],
    })
    this.ledger.appendTimeline(runId, 'session.lease.recovered', activeLease.nodeId, {
      leaseId: activeLease.leaseId,
      attempt: activeLease.attempt,
      reason: 'Recovered stale active lease without staged completion bundle',
    }, createISODateTime())
  }

  private async ensureRunCompletedEvent(
    runId: string,
    finalStatus: 'completed' | 'failed' | 'cancelled' | 'paused',
  ): Promise<void> {
    const state = await this.loadState(runId)
    const normalizedStatus =
      finalStatus === 'paused'
        ? 'paused'
        : finalStatus
    if (state?.status === normalizedStatus) {
      return
    }
    const currentVersion = await this.eventStore.getCurrentVersion(runId)
    const event: WorkflowEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'RUN_COMPLETED',
      payload: {
        finalStatus,
      },
      timestamp: createISODateTime(),
      version: currentVersion + 1,
    }
    await this.eventStore.append({
      runId,
      events: [event],
      expectedVersion: currentVersion,
    })
  }

  private async getRequiredRun(runId: string): Promise<RunDetails> {
    const run = await this.getRun(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    return run
  }

  private evaluateReleaseGate(
    runId: string,
    definition: WorkflowDefinition,
    state: WorkflowState | null,
  ): ReleaseGateDecision {
    const receipts = this.ledger.listExecutionReceipts(runId)
    return evaluateReleaseGate({
      definition,
      receipts,
      state,
    })
  }

  private recordPolicyVerdict(
    runId: string,
    timelineKind: string,
    verdict: PolicyVerdict,
    nodeId?: string,
  ): void {
    this.ledger.recordPolicyVerdict(verdict)
    const pack = this.policyEngine.exportPack()
    this.ledger.appendTimeline(runId, timelineKind, nodeId, {
      verdictId: verdict.verdictId,
      scope: verdict.scope,
      effect: verdict.effect,
      rationale: verdict.rationale,
      evidenceIds: verdict.evidenceIds,
      policyPackId: pack.packId,
      policyPackVersion: pack.version,
    }, verdict.evaluatedAt)
    // PR-07E: dual-write verdict to durable domain event log
    void this.emitDomainEvent(runId, DaemonDomainEventTypes.POLICY_VERDICT_RECORDED, {
      nodeId: nodeId ?? undefined,
      verdictType: timelineKind,
      verdict: verdict.effect,
      details: {
        verdictId: verdict.verdictId,
        scope: verdict.scope,
        rationale: verdict.rationale,
        policyPackId: pack.packId,
        policyPackVersion: pack.version,
      },
    }, nodeId)
  }

  private syncPolicySkippedNodes(
    runId: string,
    definition: WorkflowDefinition,
    state: WorkflowState | null,
    detailsByNode: ReadonlyMap<string, PolicySkipDetail> = new Map(),
  ): void {
    if (!state) {
      return
    }

    const skippedNodeIds = Object.entries(state.nodes)
      .filter(([, node]) => node?.status === 'skipped')
      .map(([nodeId]) => nodeId)
    if (skippedNodeIds.length === 0) {
      return
    }

    const decisionsByNode = new Map(
      this.ledger.listSkipDecisions(runId).map(decision => [decision.nodeId, decision] as const),
    )
    const receiptsByNode = new Map(
      this.ledger.listExecutionReceipts(runId).map(receipt => [receipt.nodeId, receipt] as const),
    )
    const existingHandoffIds = new Set(
      this.ledger.listHandoffEnvelopes(runId).map(envelope => envelope.handoffId),
    )

    for (const nodeId of skippedNodeIds) {
      const step = definition.steps.find(item => item.id === nodeId)
      if (!step) {
        continue
      }

      const detail = detailsByNode.get(nodeId)
      let decision = decisionsByNode.get(nodeId)
      if (!decision) {
        const decidedAt = createISODateTime()
        decision = createSkipDecision({
          runId,
          nodeId,
          strategyId: detail?.strategyId ?? step.skipPolicy?.strategyId ?? 'unexpected.skip',
          triggerCondition: detail?.triggerCondition ??
            (step.skipPolicy?.when.length
              ? step.skipPolicy.when.join(' && ')
              : 'Recovered policy skip from daemon state replay.'),
          approvedBy: 'antigravity-daemon.policy-engine',
          traceId: crypto.randomUUID(),
          decidedAt,
          reason: detail?.reason ?? `Policy-authorized skip recorded for ${nodeId}.`,
        })
        this.ledger.recordSkipDecision(decision)
        const skipVerdict = this.policyEngine.evaluateSkip({
          runId,
          nodeId,
          strategyId: decision.strategyId,
          triggerCondition: decision.triggerCondition,
          reason: decision.reason,
          evidenceIds: decision.evidence.map(item => item.evidenceId),
          evaluatedAt: decidedAt,
        })
        this.recordPolicyVerdict(runId, 'policy.skip.authorized', skipVerdict, nodeId)
        this.ledger.appendTimeline(runId, 'node.policy_skipped', nodeId, {
          skipDecisionId: decision.skipDecisionId,
          strategyId: decision.strategyId,
          reason: decision.reason,
          sourceNodeId: detail?.sourceNodeId,
        }, decidedAt)
        decisionsByNode.set(nodeId, decision)
      }

      let receipt = receiptsByNode.get(nodeId)
      if (!receipt) {
        receipt = createSkipExecutionReceipt({
          runId,
          nodeId,
          decision,
          capturedAt: decision.decidedAt,
        })
        this.ledger.recordExecutionReceipt(receipt)
        this.ledger.appendTimeline(runId, 'node.skipped.receipt', nodeId, {
          receiptId: receipt.receiptId,
          strategyId: decision.strategyId,
        }, receipt.capturedAt)
        receiptsByNode.set(nodeId, receipt)
      }

      const handoffs = createHandoffEnvelopes({
        runId,
        nodeId,
        definition,
        receipt,
        capturedAt: receipt.capturedAt,
      })
      for (const handoff of handoffs) {
        if (existingHandoffIds.has(handoff.handoffId)) {
          continue
        }
        this.ledger.recordHandoffEnvelope(handoff)
        this.ledger.appendTimeline(runId, 'handoff.created', handoff.targetNodeId, {
          handoffId: handoff.handoffId,
          sourceNodeId: handoff.sourceNodeId,
        }, handoff.createdAt)
        existingHandoffIds.add(handoff.handoffId)
      }
    }
  }

  private async refreshSnapshot(
    runId: string,
    context: ActiveRunContext | undefined,
    options: RefreshSnapshotOptions = {},
  ): Promise<RunSnapshot> {
    const existing = this.ledger.getRun(runId)
    const invocation = context?.invocation ?? existing?.invocation
    const definition = context?.definition ?? existing?.definition
    if (!invocation || !definition) {
      throw new Error(`Missing run metadata for ${runId}`)
    }
    const state = await this.loadState(runId)
    this.syncPolicySkippedNodes(runId, definition, state)
    const nextArtifactPaths = {
      traceBundle: options.releaseArtifacts?.traceBundle?.path ?? existing?.snapshot.releaseArtifacts.traceBundle?.path,
      releaseAttestation: options.releaseArtifacts?.releaseAttestation?.path ?? existing?.snapshot.releaseArtifacts.releaseAttestation?.path,
    }
    const nextInvariantReportPath = options.invariantReport?.path ?? existing?.snapshot.invariantReport?.path
    const nextPolicyReportPath = options.policyReport?.path ?? existing?.snapshot.policyReport?.path
    const nextReleaseDossierPath = options.releaseDossier?.path ?? existing?.snapshot.releaseDossier?.path
    const nextReleaseBundlePath = options.releaseBundle?.path ?? existing?.snapshot.releaseBundle?.path
    const nextCertificationRecordPath = options.certificationRecord?.path ?? existing?.snapshot.certificationRecord?.path
    const transparencyLedgerPath = path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_TRANSPARENCY_LEDGER_FILE)
    let traceBundleSummary = options.releaseArtifacts?.traceBundle ?? existing?.snapshot.releaseArtifacts.traceBundle
    if (nextArtifactPaths.traceBundle) {
      try {
        const report = await this.evaluateTraceBundleReport(runId, nextArtifactPaths.traceBundle, false)
        traceBundleSummary = {
          path: nextArtifactPaths.traceBundle,
          integrityOk: report.mismatchedEntries.length === 0 && report.missingEntries.length === 0,
          signatureVerified: report.signatureVerified,
          signatureRequired: report.signatureRequired,
          signaturePolicyId: report.signaturePolicyId,
          signatureKeyId: report.signatureKeyId,
          signatureIssuer: report.signatureIssuer,
          issues: [...report.mismatchedEntries, ...report.missingEntries, ...report.failedSignatureChecks],
        }
      } catch (error) {
        traceBundleSummary = {
          path: nextArtifactPaths.traceBundle,
          issues: [error instanceof Error ? error.message : String(error)],
        }
      }
    }
    let releaseAttestationSummary = options.releaseArtifacts?.releaseAttestation ?? existing?.snapshot.releaseArtifacts.releaseAttestation
    if (nextArtifactPaths.releaseAttestation) {
      try {
        const baseTraceReport = nextArtifactPaths.traceBundle
          ? await this.evaluateTraceBundleReport(runId, nextArtifactPaths.traceBundle, false)
          : undefined
        if (baseTraceReport) {
          const report = this.evaluateReleaseAttestationDocument(
            runId,
            nextArtifactPaths.releaseAttestation,
            baseTraceReport,
            false,
          )
          releaseAttestationSummary = {
            path: nextArtifactPaths.releaseAttestation,
            verified: report.ok,
            payloadDigestOk: report.payloadDigestOk,
            signatureVerified: report.signatureVerified,
            signatureRequired: report.signatureRequired,
            signaturePolicyId: report.signaturePolicyId,
            signatureKeyId: report.signatureKeyId,
            signatureIssuer: report.signatureIssuer,
            issues: report.issues,
          }
        } else {
          releaseAttestationSummary = {
            path: nextArtifactPaths.releaseAttestation,
            issues: ['trace bundle report unavailable'],
          }
        }
      } catch (error) {
        releaseAttestationSummary = {
          path: nextArtifactPaths.releaseAttestation,
          issues: [error instanceof Error ? error.message : String(error)],
        }
      }
    }
    const policyReportSummary = options.policyReport ?? existing?.snapshot.policyReport ?? (
      nextPolicyReportPath
        ? {
            path: nextPolicyReportPath,
            issues: [],
          }
        : undefined
    )
    const invariantReportSummary = options.invariantReport ?? existing?.snapshot.invariantReport ?? (
      nextInvariantReportPath
        ? {
            path: nextInvariantReportPath,
            issues: [],
          }
        : undefined
    )
    const releaseDossierSummary = options.releaseDossier ?? existing?.snapshot.releaseDossier ?? (
      nextReleaseDossierPath
        ? {
            path: nextReleaseDossierPath,
            issues: [],
          }
        : undefined
    )
    const releaseBundleSummary = options.releaseBundle ?? existing?.snapshot.releaseBundle ?? (
      nextReleaseBundlePath
        ? {
            path: nextReleaseBundlePath,
            issues: [],
          }
        : undefined
    )
    const certificationRecordSummary = options.certificationRecord ?? existing?.snapshot.certificationRecord ?? (
      nextCertificationRecordPath
        ? {
            path: nextCertificationRecordPath,
            issues: [],
          }
        : undefined
    )
    const transparencyLedgerSummary = options.transparencyLedger ?? existing?.snapshot.transparencyLedger ?? (
      fs.existsSync(transparencyLedgerPath)
        ? summarizeTransparencyLedger({
            ledgerPath: transparencyLedgerPath,
            entries: readTransparencyLedgerEntries(transparencyLedgerPath),
            report: verifyTransparencyLedger(transparencyLedgerPath),
          })
        : undefined
    )
    const now = createISODateTime()
    const completionSessions = this.ledger.listCompletionSessions(runId)
    const latestTribunalVerdict = this.ledger.getLatestTribunalVerdict(runId)
    const snapshot = buildRunSnapshot({
      runId,
      invocation,
      definition,
      state,
      createdAt: existing?.snapshot.createdAt ?? context?.startedAt ?? now,
      updatedAt: now,
      startedAt: existing?.snapshot.startedAt ?? context?.startedAt ?? now,
      completedAt: options.completedAt ?? existing?.snapshot.completedAt,
      explicitStatus: options.explicitStatus,
      verdict: options.verdict ?? existing?.snapshot.verdict,
      timelineCursor: this.ledger.getLatestTimelineCursor(runId),
      releaseArtifacts: {
        ...(traceBundleSummary ? { traceBundle: traceBundleSummary } : {}),
        ...(releaseAttestationSummary ? { releaseAttestation: releaseAttestationSummary } : {}),
      },
      policyReport: policyReportSummary,
      invariantReport: invariantReportSummary,
      releaseDossier: releaseDossierSummary,
      releaseBundle: releaseBundleSummary,
      certificationRecord: certificationRecordSummary,
      transparencyLedger: transparencyLedgerSummary,
      skipDecisions: this.ledger.listSkipDecisions(runId),
      receipts: this.ledger.listExecutionReceipts(runId),
      completionSessions,
      latestTribunalVerdict: latestTribunalVerdict
        ? {
            tribunalId: latestTribunalVerdict.tribunalId,
            runId: latestTribunalVerdict.runId,
            nodeId: latestTribunalVerdict.nodeId,
            mode: latestTribunalVerdict.mode,
            verdict: latestTribunalVerdict.verdict,
            confidence: latestTribunalVerdict.confidence,
            quorumSatisfied: latestTribunalVerdict.quorumSatisfied,
            remoteJurorCount: latestTribunalVerdict.remoteJurorCount,
            totalJurorCount: latestTribunalVerdict.totalJurorCount,
            rationale: latestTribunalVerdict.rationale,
            evidenceIds: latestTribunalVerdict.evidenceIds,
            jurorReportIds: latestTribunalVerdict.jurorReportIds,
            createdAt: latestTribunalVerdict.createdAt,
          }
        : undefined,
    })

    // PR-08E: shadow compare — read mode gated
    // legacy: skip shadow compare entirely
    // shadow: dual-read, ledger authoritative, event-derived compared (default)
    // primary: event-derived authoritative, ledger compared (parity gate)
    if (this.shadowCompareReadMode !== 'legacy') {
      try {
        const domainEvents = await this.domainEventLog.load(runId)
        if (domainEvents.length > 0) {
          const eventProjection = buildEventDerivedProjection(domainEvents)
          const legacyInput: LegacyProjectionInput = {
            receipts: (this.ledger.listExecutionReceipts(runId) ?? []).map(r => ({
              receiptId: r.receiptId,
              nodeId: r.nodeId,
              model: r.model,
              status: r.status as string,
              outputHash: r.outputHash ?? '',
              durationMs: r.durationMs,
            })),
            completionSessions: completionSessions.map(s => ({
              leaseId: s.leaseId,
              nodeId: s.nodeId,
              attempt: s.attempt,
              phase: s.phase,
              status: s.receipt?.status,
              outputHash: s.receipt?.outputHash,
            })),
            handoffs: [], // handoffs not separately tracked in legacy ledger
            skips: (this.ledger.listSkipDecisions(runId) ?? []).map(s => ({
              nodeId: s.nodeId,
              reason: s.reason,
              strategyId: s.strategyId,
            })),
            verdicts: latestTribunalVerdict
              ? [{ nodeId: latestTribunalVerdict.nodeId, verdict: latestTribunalVerdict.verdict }]
              : [],
          }
          const compareResult = shadowCompare(legacyInput, eventProjection)
          if (!compareResult.match) {
            this.ledger.appendTimeline(runId, 'shadow_compare.drift', 'system', {
              readMode: this.shadowCompareReadMode,
              mismatchCount: compareResult.mismatches.length,
              mismatches: compareResult.mismatches.slice(0, 10), // cap for readability
              legacyCounts: compareResult.legacyCounts,
              eventDerivedCounts: compareResult.eventDerivedCounts,
            }, createISODateTime())
            this.telemetrySink.onShadowCompareDrift?.(runId, {
              readMode: this.shadowCompareReadMode,
              mismatchCount: compareResult.mismatches.length,
            })
          } else {
            // PR-08E: parity gate — log successful parity for primary readiness
            this.ledger.appendTimeline(runId, 'shadow_compare.parity', 'system', {
              readMode: this.shadowCompareReadMode,
              legacyCounts: compareResult.legacyCounts,
              eventDerivedCounts: compareResult.eventDerivedCounts,
            }, createISODateTime())
          }
        }
      } catch (compareError) {
        // Shadow compare is fire-and-forget; never crash refreshSnapshot
        this.ledger.appendTimeline(runId, 'shadow_compare.error', 'system', {
          readMode: this.shadowCompareReadMode,
          error: compareError instanceof Error ? compareError.message : String(compareError),
        }, createISODateTime())
      }
    }

    this.ledger.upsertRun(invocation, definition, snapshot)
    writeRunProjection(this.config.projectionPath, snapshot)
    return snapshot
  }

  /**
   * PR-18E: Load run state with diagnostics — pushes replay health to timeline/telemetry.
   * Returns the same WorkflowState as before; diagnostics are side-effect only.
   */
  private async loadState(runId: string): Promise<WorkflowState> {
    const { state, diagnostics } = await loadRunStateWithDiagnostics(this.eventStore, runId)
    // Push diagnostics to timeline (fire-and-forget, never crash)
    try {
      if (diagnostics.upcastErrorCount > 0 || diagnostics.unknownTypeCount > 0 || diagnostics.emptyStream) {
        this.ledger.appendTimeline(runId, 'recovery.diagnostics', 'system', {
          eventCount: diagnostics.eventCount,
          upcastErrorCount: diagnostics.upcastErrorCount,
          unknownTypeCount: diagnostics.unknownTypeCount,
          emptyStream: diagnostics.emptyStream,
          eventTypes: diagnostics.eventTypes,
        }, createISODateTime())
        this.telemetrySink.onRecoveryDiagnostics?.(runId, diagnostics)
      }
    } catch {
      // diagnostics push is never allowed to crash the main path
    }
    return state
  }

  private getPlannedCertificationRecordSummary(runId: string): NonNullable<RunSnapshot['certificationRecord']> {
    return {
      path: path.join(this.config.dataDir, ANTIGRAVITY_DAEMON_CERTIFICATION_RECORDS_DIR, `${runId}.certification-record.json`),
      issues: [],
    }
  }
}
