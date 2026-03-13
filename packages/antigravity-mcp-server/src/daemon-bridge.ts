import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  AntigravityDaemonClient,
  createAntigravityDaemonProcessEnv,
  spawnAntigravityDaemonProcess,
  type BenchmarkHarnessReport,
  type BenchmarkSourceRegistrySnapshot,
  type CertificationRecordResponse,
  type InvariantReportResponse,
  type InteropHarnessReport,
  type MemorySearchRequest,
  type MemorySearchResponse,
  type PolicyPack,
  type PolicyReportResponse,
  type RemoteWorkerListResponse,
  type ReplayRunRequest,
  type ReleaseArtifactsResponse,
  type ReleaseAttestationResponse,
  type ReleaseBundleResponse,
  type ReleaseDossierResponse,
  type RunSessionResponse,
  type RunBenchmarkRequest,
  type RunInteropRequest,
  type RunDetails,
  type StartRunRequest,
  type StartRunResponse,
  type StreamRunResponse,
  type TraceBundleResponse,
  type TrustRegistrySnapshot,
  type TransparencyLedgerResponse,
  type VerifyReleaseArtifactsReport,
  type VerifyCertificationRecordReport,
  type VerifyInvariantReport,
  type VerifyPolicyReport,
  type VerifyReleaseAttestationReport,
  type VerifyReleaseBundleReport,
  type VerifyTransparencyLedgerReport,
  type VerifyReleaseDossierReport,
  type VerifyTraceBundleReport,
  type VerifyRunReport,
} from '@anthropic/antigravity-daemon'

interface DaemonRuntimeHandle {
  workspaceRoot: string
  client: AntigravityDaemonClient
  socketPath: string
  daemonProcess?: ChildProcess
}

function resolveWorkspaceRoot(explicitWorkspaceRoot?: string): string {
  return explicitWorkspaceRoot?.trim() ||
    process.env['ANTIGRAVITY_WORKSPACE_ROOT']?.trim() ||
    process.cwd()
}

function resolveDaemonEntry(): string {
  const envEntry = process.env['ANTIGRAVITY_DAEMON_ENTRY']
  if (envEntry && fs.existsSync(envEntry)) {
    return envEntry
  }

  const require = createRequire(__filename)
  const packageEntry = require.resolve('@anthropic/antigravity-daemon')
  const packagedMain = path.join(path.dirname(packageEntry), 'main.js')
  if (fs.existsSync(packagedMain)) {
    return packagedMain
  }

  const bundledMain = path.resolve(process.cwd(), 'dist', 'antigravity-daemon.js')
  if (fs.existsSync(bundledMain)) {
    return bundledMain
  }

  throw new Error('Unable to resolve antigravity-daemon entrypoint. Set ANTIGRAVITY_DAEMON_ENTRY explicitly.')
}

export class AntigravityDaemonBridge {
  private runtime?: DaemonRuntimeHandle

  async startRun(request: StartRunRequest, workspaceRoot?: string): Promise<StartRunResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.startRun(request)
  }

  async getRun(runId: string, workspaceRoot?: string): Promise<RunDetails> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getRun(runId)
  }

  async getRunSession(runId: string, workspaceRoot?: string): Promise<RunSessionResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getRunSession(runId)
  }

  async streamRun(runId: string, cursor = 0, workspaceRoot?: string): Promise<StreamRunResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.streamRun(runId, cursor)
  }

  async verifyRun(runId: string, workspaceRoot?: string): Promise<VerifyRunReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyRun(runId)
  }

  async verifyTraceBundle(runId: string, workspaceRoot?: string): Promise<VerifyTraceBundleReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyTraceBundle(runId)
  }

  async getReleaseAttestation(runId: string, workspaceRoot?: string): Promise<ReleaseAttestationResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getReleaseAttestation(runId)
  }

  async getReleaseArtifacts(runId: string, workspaceRoot?: string): Promise<ReleaseArtifactsResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getReleaseArtifacts(runId)
  }

  async getPolicyReport(runId: string, workspaceRoot?: string): Promise<PolicyReportResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getPolicyReport(runId)
  }

  async getInvariantReport(runId: string, workspaceRoot?: string): Promise<InvariantReportResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getInvariantReport(runId)
  }

  async getReleaseDossier(runId: string, workspaceRoot?: string): Promise<ReleaseDossierResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getReleaseDossier(runId)
  }

  async getReleaseBundle(runId: string, workspaceRoot?: string): Promise<ReleaseBundleResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getReleaseBundle(runId)
  }

  async getCertificationRecord(runId: string, workspaceRoot?: string): Promise<CertificationRecordResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getCertificationRecord(runId)
  }

  async getTransparencyLedger(workspaceRoot?: string): Promise<TransparencyLedgerResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getTransparencyLedger()
  }

  async verifyReleaseAttestation(runId: string, workspaceRoot?: string): Promise<VerifyReleaseAttestationReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyReleaseAttestation(runId)
  }

  async verifyReleaseArtifacts(runId: string, workspaceRoot?: string): Promise<VerifyReleaseArtifactsReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyReleaseArtifacts(runId)
  }

  async verifyPolicyReport(runId: string, workspaceRoot?: string): Promise<VerifyPolicyReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyPolicyReport(runId)
  }

  async verifyInvariantReport(runId: string, workspaceRoot?: string): Promise<VerifyInvariantReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyInvariantReport(runId)
  }

  async verifyReleaseDossier(runId: string, workspaceRoot?: string): Promise<VerifyReleaseDossierReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyReleaseDossier(runId)
  }

  async verifyReleaseBundle(runId: string, workspaceRoot?: string): Promise<VerifyReleaseBundleReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyReleaseBundle(runId)
  }

  async verifyCertificationRecord(runId: string, workspaceRoot?: string): Promise<VerifyCertificationRecordReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyCertificationRecord(runId)
  }

  async verifyTransparencyLedger(workspaceRoot?: string): Promise<VerifyTransparencyLedgerReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.verifyTransparencyLedger()
  }

  async replayRun(request: ReplayRunRequest, workspaceRoot?: string): Promise<StartRunResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.replayRun(request)
  }

  async exportTraceBundle(runId: string, workspaceRoot?: string): Promise<TraceBundleResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.exportTraceBundle(runId)
  }

  async runBenchmark(request: RunBenchmarkRequest = { suiteIds: [], caseIds: [], datasetSources: [] }, workspaceRoot?: string): Promise<BenchmarkHarnessReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.runBenchmark(request)
  }

  async runInteropHarness(request: RunInteropRequest = { suiteIds: [] }, workspaceRoot?: string): Promise<InteropHarnessReport> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.runInteropHarness(request)
  }

  async searchMemory(request: MemorySearchRequest, workspaceRoot?: string): Promise<MemorySearchResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.searchMemory(request)
  }

  async listRemoteWorkers(workspaceRoot?: string): Promise<RemoteWorkerListResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.listRemoteWorkers()
  }

  async getPolicyPack(workspaceRoot?: string): Promise<PolicyPack> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getPolicyPack()
  }

  async reloadPolicyPack(workspaceRoot?: string): Promise<PolicyPack> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.reloadPolicyPack()
  }

  async getTrustRegistry(workspaceRoot?: string): Promise<TrustRegistrySnapshot> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getTrustRegistry()
  }

  async reloadTrustRegistry(workspaceRoot?: string): Promise<TrustRegistrySnapshot> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.reloadTrustRegistry()
  }

  async getBenchmarkSourceRegistry(workspaceRoot?: string): Promise<BenchmarkSourceRegistrySnapshot> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getBenchmarkSourceRegistry()
  }

  async reloadBenchmarkSourceRegistry(workspaceRoot?: string): Promise<BenchmarkSourceRegistrySnapshot> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.reloadBenchmarkSourceRegistry()
  }

  dispose(): void {
    this.runtime?.daemonProcess?.kill()
    this.runtime = undefined
  }

  private async ensureRuntime(explicitWorkspaceRoot?: string): Promise<DaemonRuntimeHandle> {
    const workspaceRoot = resolveWorkspaceRoot(explicitWorkspaceRoot)

    if (this.runtime?.workspaceRoot === workspaceRoot && await this.runtime.client.ping()) {
      return this.runtime
    }

    this.runtime?.daemonProcess?.kill()
    const { paths } = createAntigravityDaemonProcessEnv({ workspaceRoot })
    const client = new AntigravityDaemonClient(paths.socketPath)

    if (!(await client.ping())) {
      const daemonEntry = resolveDaemonEntry()
      const spawned = await spawnAntigravityDaemonProcess({
        workspaceRoot,
        entryPath: daemonEntry,
        callbackHost: '127.0.0.1',
        callbackPort: 0,
        // B1 fix: wire strictTrustMode + federationFailPolicy from MCP env to daemon
        strictTrustMode: process.env['ANTIGRAVITY_DAEMON_STRICT_TRUST_MODE'] === 'true' || undefined,
        federationFailPolicy: (process.env['ANTIGRAVITY_DAEMON_FEDERATION_FAIL_POLICY'] as 'fallback' | 'fail-closed') || undefined,
        onStdout: text => console.error(`[AntigravityDaemonBridge] ${text}`),
        onStderr: text => console.error(`[AntigravityDaemonBridge] ${text}`),
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
}
