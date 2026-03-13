import type { ChildProcess } from 'node:child_process'
import * as vscode from 'vscode'
import {
  AntigravityDaemonClient,
  createAntigravityDaemonProcessEnv,
  spawnAntigravityDaemonProcess,
  type ApproveGateRequest,
  type BenchmarkSourceRegistrySnapshot,
  type CertificationRecordResponse,
  type BenchmarkHarnessReport,
  type InvariantReportResponse,
  type InteropHarnessReport,
  type PolicyReportResponse,
  type PolicyPack,
  type ReleaseArtifactsResponse,
  type ReleaseAttestationResponse,
  type ReleaseBundleResponse,
  type ReleaseDossierResponse,
  type RunSessionResponse,
  type RemoteWorkerListResponse,
  type TrustRegistrySnapshot,
  type VerifyReleaseArtifactsReport,
  type VerifyInvariantReport,
  type VerifyPolicyReport,
  type VerifyReleaseAttestationReport,
  type VerifyReleaseBundleReport,
  type VerifyCertificationRecordReport,
  type VerifyReleaseDossierReport,
  type RunBenchmarkRequest,
  type RunInteropRequest,
  type RunDetails,
  type StartRunResponse,
  type StreamRunResponse,
  type TraceBundleResponse,
  type TransparencyLedgerResponse,
  type VerifyTransparencyLedgerReport,
} from '@anthropic/antigravity-daemon'

type WorkflowLifecycleState = 'idle' | 'starting' | 'running' | 'completed' | 'failed'

export interface StartWorkflowRunOptions {
  goal: string
  files?: string[]
  workflowId?: 'antigravity.strict-full' | 'antigravity.adaptive'
}

export interface StartWorkflowRunResult {
  runId: string
}

interface DaemonRuntimeBundle {
  workspaceRoot: string
  client: AntigravityDaemonClient
  socketPath: string
  daemonProcess?: ChildProcess
}

export class WorkflowOrchestrator implements vscode.Disposable {
  private runtime?: DaemonRuntimeBundle
  private activeRunId?: string
  private lifecycleState: WorkflowLifecycleState = 'idle'
  private streamInterval?: NodeJS.Timeout

  constructor(private readonly extensionRoot: string) {}

  async startRun(options: StartWorkflowRunOptions): Promise<StartWorkflowRunResult> {
    const goal = options.goal.trim()
    if (!goal) {
      throw new Error('Workflow goal must not be empty')
    }

    const runtime = await this.ensureRuntime()
    const files = this.collectFiles(options.files, runtime.workspaceRoot)
    const workflowId = options.workflowId ?? 'antigravity.strict-full'
    this.lifecycleState = 'starting'

    const start = await runtime.client.startRun({
      invocation: {
        workflowId,
        workflowVersion: '1.0.0',
        goal,
        files,
        initiator: 'antigravity-extension',
        workspaceRoot: runtime.workspaceRoot,
        triggerSource: 'command',
        forceFullPath: true,
        options: {},
        metadata: {
          extension: 'antigravity-workflow',
          requestedWorkflowId: workflowId,
        },
      },
    })

    this.activeRunId = start.runId
    this.lifecycleState = 'running'
    return { runId: start.runId }
  }

  getStatus(): { state: WorkflowLifecycleState; runId?: string } {
    return { state: this.lifecycleState, runId: this.activeRunId }
  }

  async getRun(runId = this.activeRunId): Promise<RunDetails> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const run = await runtime.client.getRun(runId)
    this.syncLifecycle(run)
    return run
  }

  async getRunSession(runId = this.activeRunId): Promise<RunSessionResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getRunSession(runId)
  }

  async cancelRun(runId = this.activeRunId): Promise<RunDetails> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const run = await runtime.client.cancelRun(runId)
    this.syncLifecycle(run)
    return run
  }

  async replayRun(runId = this.activeRunId): Promise<StartRunResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const run = await runtime.client.replayRun({ runId })
    this.activeRunId = run.runId
    this.lifecycleState = 'running'
    return run
  }

  async resumeRun(runId = this.activeRunId, comment?: string): Promise<RunDetails> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const run = await runtime.client.resumeRun({
      runId,
      approvedBy: 'antigravity-user',
      comment,
    })
    this.syncLifecycle(run)
    return run
  }

  async approveGate(
    request: Omit<ApproveGateRequest, 'runId'> & { runId?: string },
  ): Promise<RunDetails> {
    const runId = request.runId ?? this.activeRunId
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const run = await runtime.client.approveGate({
      ...request,
      runId,
    })
    this.syncLifecycle(run)
    return run
  }

  async exportTraceBundle(runId = this.activeRunId): Promise<TraceBundleResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.exportTraceBundle(runId)
  }

  async getReleaseAttestation(runId = this.activeRunId): Promise<ReleaseAttestationResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getReleaseAttestation(runId)
  }

  async getReleaseArtifacts(runId = this.activeRunId): Promise<ReleaseArtifactsResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getReleaseArtifacts(runId)
  }

  async getPolicyReport(runId = this.activeRunId): Promise<PolicyReportResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getPolicyReport(runId)
  }

  async getInvariantReport(runId = this.activeRunId): Promise<InvariantReportResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getInvariantReport(runId)
  }

  async getReleaseDossier(runId = this.activeRunId): Promise<ReleaseDossierResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getReleaseDossier(runId)
  }

  async getReleaseBundle(runId = this.activeRunId): Promise<ReleaseBundleResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getReleaseBundle(runId)
  }

  async getCertificationRecord(runId = this.activeRunId): Promise<CertificationRecordResponse> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.getCertificationRecord(runId)
  }

  async getTransparencyLedger(): Promise<TransparencyLedgerResponse> {
    const runtime = await this.ensureRuntime()
    return runtime.client.getTransparencyLedger()
  }

  async verifyReleaseAttestation(runId = this.activeRunId): Promise<VerifyReleaseAttestationReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyReleaseAttestation(runId)
  }

  async verifyReleaseArtifacts(runId = this.activeRunId): Promise<VerifyReleaseArtifactsReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyReleaseArtifacts(runId)
  }

  async verifyPolicyReport(runId = this.activeRunId): Promise<VerifyPolicyReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyPolicyReport(runId)
  }

  async verifyInvariantReport(runId = this.activeRunId): Promise<VerifyInvariantReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyInvariantReport(runId)
  }

  async verifyReleaseDossier(runId = this.activeRunId): Promise<VerifyReleaseDossierReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyReleaseDossier(runId)
  }

  async verifyReleaseBundle(runId = this.activeRunId): Promise<VerifyReleaseBundleReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyReleaseBundle(runId)
  }

  async verifyCertificationRecord(runId = this.activeRunId): Promise<VerifyCertificationRecordReport> {
    if (!runId) {
      throw new Error('No workflow run has been started yet')
    }
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyCertificationRecord(runId)
  }

  async verifyTransparencyLedger(): Promise<VerifyTransparencyLedgerReport> {
    const runtime = await this.ensureRuntime()
    return runtime.client.verifyTransparencyLedger()
  }

  async runBenchmark(request: RunBenchmarkRequest = { suiteIds: [], caseIds: [], datasetSources: [] }): Promise<BenchmarkHarnessReport> {
    const runtime = await this.ensureRuntime()
    return runtime.client.runBenchmark(request)
  }

  async runInteropHarness(request: RunInteropRequest = { suiteIds: [] }): Promise<InteropHarnessReport> {
    const runtime = await this.ensureRuntime()
    return runtime.client.runInteropHarness(request)
  }

  async listRemoteWorkers(): Promise<RemoteWorkerListResponse> {
    const runtime = await this.ensureRuntime()
    return runtime.client.listRemoteWorkers()
  }

  async refreshRemoteWorkers(): Promise<RemoteWorkerListResponse> {
    const runtime = await this.ensureRuntime()
    return runtime.client.refreshRemoteWorkers()
  }

  async reloadPolicyPack(): Promise<PolicyPack> {
    const runtime = await this.ensureRuntime()
    return runtime.client.reloadPolicyPack()
  }

  async getTrustRegistry(): Promise<TrustRegistrySnapshot> {
    const runtime = await this.ensureRuntime()
    return runtime.client.getTrustRegistry()
  }

  async reloadTrustRegistry(): Promise<TrustRegistrySnapshot> {
    const runtime = await this.ensureRuntime()
    return runtime.client.reloadTrustRegistry()
  }

  async getBenchmarkSourceRegistry(): Promise<BenchmarkSourceRegistrySnapshot> {
    const runtime = await this.ensureRuntime()
    return runtime.client.getBenchmarkSourceRegistry()
  }

  async reloadBenchmarkSourceRegistry(): Promise<BenchmarkSourceRegistrySnapshot> {
    const runtime = await this.ensureRuntime()
    return runtime.client.reloadBenchmarkSourceRegistry()
  }

  async streamRun(
    runId: string,
    onUpdate: (event: StreamRunResponse) => void,
    intervalMs = 1500,
  ): Promise<vscode.Disposable> {
    const runtime = await this.ensureRuntime()
    let cursor = 0
    let disposed = false

    const dispose = () => {
      if (disposed) {
        return
      }
      disposed = true
      clearInterval(timer)
      if (this.streamInterval === timer) {
        this.streamInterval = undefined
      }
    }

    const poll = async () => {
      if (disposed) {
        return
      }
      const response = await runtime.client.streamRun(runId, cursor)
      cursor = response.nextCursor
      this.syncLifecycle({ snapshot: response.snapshot } as RunDetails)
      onUpdate(response)
      if (response.snapshot.status === 'completed' ||
        response.snapshot.status === 'failed' ||
        response.snapshot.status === 'cancelled' ||
        response.snapshot.status === 'paused_for_human') {
        dispose()
      }
    }

    const timer = setInterval(() => {
      void poll()
    }, intervalMs)
    this.streamInterval = timer
    void poll()
    return new vscode.Disposable(dispose)
  }

  dispose(): void {
    if (this.streamInterval) {
      clearInterval(this.streamInterval)
      this.streamInterval = undefined
    }
    this.runtime?.daemonProcess?.kill()
    this.runtime = undefined
  }

  private async ensureRuntime(): Promise<DaemonRuntimeBundle> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      throw new Error('Open a workspace before starting a workflow run')
    }

    if (this.runtime?.workspaceRoot === workspaceRoot && await this.runtime.client.ping()) {
      return this.runtime
    }

    this.runtime?.daemonProcess?.kill()
    const { paths } = createAntigravityDaemonProcessEnv({ workspaceRoot })
    const client = new AntigravityDaemonClient(paths.socketPath)

    if (!(await client.ping())) {
      const daemonEntry = vscode.Uri.joinPath(
        vscode.Uri.file(this.extensionRoot),
        'dist',
        'antigravity-daemon.js',
      ).fsPath
      const spawned = await spawnAntigravityDaemonProcess({
        workspaceRoot,
        entryPath: daemonEntry,
        callbackHost: '127.0.0.1',
        callbackPort: 0,
        // B1 fix: wire strictTrustMode + federationFailPolicy from VSCode settings to daemon env
        strictTrustMode: vscode.workspace.getConfiguration('antigravity').get<boolean>('strictTrustMode'),
        federationFailPolicy: vscode.workspace.getConfiguration('antigravity').get<'fallback' | 'fail-closed'>('federationFailPolicy'),
        onStdout: (text: string) => console.log(`[AntigravityDaemon] ${text}`),
        onStderr: (text: string) => console.error(`[AntigravityDaemon] ${text}`),
      })
      const daemonProcess = spawned.daemonProcess
      daemonProcess.on('exit', () => {
        if (this.runtime?.daemonProcess === daemonProcess) {
          this.runtime = undefined
        }
      })
      this.runtime = {
        workspaceRoot,
        client: spawned.client,
        daemonProcess,
        socketPath: paths.socketPath,
      }
      return this.runtime
    }

    this.runtime = {
      workspaceRoot,
      client,
      socketPath: paths.socketPath,
    }
    return this.runtime
  }

  private collectFiles(explicitFiles: string[] | undefined, workspaceRoot: string): string[] {
    if (explicitFiles && explicitFiles.length > 0) {
      return explicitFiles
    }

    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath
    if (activeFile && activeFile.startsWith(workspaceRoot)) {
      return [activeFile]
    }

    return []
  }

  private syncLifecycle(run: Pick<RunDetails, 'snapshot'>): void {
    this.activeRunId = run.snapshot.runId
    switch (run.snapshot.status) {
      case 'completed':
        this.lifecycleState = 'completed'
        break
      case 'failed':
      case 'cancelled':
        this.lifecycleState = 'failed'
        break
      case 'running':
      case 'starting':
      case 'paused_for_human':
      default:
        this.lifecycleState = 'running'
        break
    }
  }
}
