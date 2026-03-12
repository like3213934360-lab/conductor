import * as http from 'node:http'
import {
  type ApproveGateRequest,
  type BenchmarkHarnessReport,
  type BenchmarkSourceRegistrySnapshot,
  type CertificationRecordResponse,
  type InteropHarnessReport,
  type MemorySearchRequest,
  type MemorySearchResponse,
  type InvariantReportResponse,
  type RemoteWorkerListResponse,
  type RunBenchmarkRequest,
  type RunInteropRequest,
  type ReplayRunRequest,
  type ReleaseArtifactsResponse,
  type PolicyReportResponse,
  type ReleaseAttestationResponse,
  type ReleaseBundleResponse,
  type ReleaseDossierResponse,
  type ResumeRunRequest,
  type RunDetails,
  type RunSessionResponse,
  type PrepareCompletionReceiptRequest,
  type CommitCompletionReceiptRequest,
  type StepHeartbeatRequest,
  type PolicyPack,
  type StartRunRequest,
  type StartRunResponse,
  type StreamRunResponse,
  type TraceBundleResponse,
  type TrustRegistrySnapshot,
  type TransparencyLedgerResponse,
  type VerifyReleaseArtifactsReport,
  type VerifyPolicyReport,
  type VerifyInvariantReport,
  type VerifyReleaseAttestationReport,
  type VerifyReleaseBundleReport,
  type VerifyCertificationRecordReport,
  type VerifyTransparencyLedgerReport,
  type VerifyReleaseDossierReport,
  type VerifyTraceBundleReport,
  type VerifyRunReport,
} from './schema.js'
import type { DaemonApiManifest } from './manifest.js'
import {
  resolveAntigravityDaemonDataDir,
  resolveAntigravityDaemonProjectionPath,
  resolveAntigravityDaemonSocketPath,
} from './runtime-contract.js'

export interface DaemonPaths {
  dataDir: string
  projectionPath: string
  socketPath: string
}

export function resolveAntigravityDaemonPaths(workspaceRoot: string): DaemonPaths {
  return {
    dataDir: resolveAntigravityDaemonDataDir(workspaceRoot),
    projectionPath: resolveAntigravityDaemonProjectionPath(workspaceRoot),
    socketPath: resolveAntigravityDaemonSocketPath(workspaceRoot),
  }
}

interface RequestOptions {
  method: 'GET' | 'POST'
  requestPath: string
  body?: unknown
}

export interface DaemonClientTransport {
  request<T>(options: RequestOptions): Promise<T>
}

export class AntigravityDaemonClient {
  private readonly socketPath?: string
  private readonly transport?: DaemonClientTransport

  constructor(socketPathOrTransport: string | DaemonClientTransport) {
    if (typeof socketPathOrTransport === 'string') {
      this.socketPath = socketPathOrTransport
      return
    }
    this.transport = socketPathOrTransport
  }

  async ping(): Promise<boolean> {
    try {
      const response = await this.request<{ ok: boolean }>({
        method: 'GET',
        requestPath: '/health',
      })
      return response.ok === true
    } catch {
      return false
    }
  }

  async getManifest(): Promise<DaemonApiManifest> {
    return this.request({
      method: 'GET',
      requestPath: '/manifest',
    })
  }

  async getPolicyPack(): Promise<PolicyPack> {
    return this.request({
      method: 'GET',
      requestPath: '/policy-pack',
    })
  }

  async getTrustRegistry(): Promise<TrustRegistrySnapshot> {
    return this.request({
      method: 'GET',
      requestPath: '/trust-registry',
    })
  }

  async getBenchmarkSourceRegistry(): Promise<BenchmarkSourceRegistrySnapshot> {
    return this.request({
      method: 'GET',
      requestPath: '/benchmark-source-registry',
    })
  }

  async getTransparencyLedger(): Promise<TransparencyLedgerResponse> {
    return this.request({
      method: 'GET',
      requestPath: '/transparency-ledger',
    })
  }

  async searchMemory(request: MemorySearchRequest): Promise<MemorySearchResponse> {
    return this.request({
      method: 'POST',
      requestPath: '/memory/search',
      body: request,
    })
  }

  async reloadPolicyPack(): Promise<PolicyPack> {
    return this.request({
      method: 'POST',
      requestPath: '/policy-pack/reload',
      body: {},
    })
  }

  async reloadTrustRegistry(): Promise<TrustRegistrySnapshot> {
    return this.request({
      method: 'POST',
      requestPath: '/trust-registry/reload',
      body: {},
    })
  }

  async reloadBenchmarkSourceRegistry(): Promise<BenchmarkSourceRegistrySnapshot> {
    return this.request({
      method: 'POST',
      requestPath: '/benchmark-source-registry/reload',
      body: {},
    })
  }

  async listRemoteWorkers(): Promise<RemoteWorkerListResponse> {
    return this.request({
      method: 'GET',
      requestPath: '/remote-workers',
    })
  }

  async refreshRemoteWorkers(): Promise<RemoteWorkerListResponse> {
    return this.request({
      method: 'POST',
      requestPath: '/remote-workers/refresh',
      body: {},
    })
  }

  async startRun(request: StartRunRequest): Promise<StartRunResponse> {
    return this.request({
      method: 'POST',
      requestPath: '/runs/start',
      body: request,
    })
  }

  async getRun(runId: string): Promise<RunDetails> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}`,
    })
  }

  async getRunSession(runId: string): Promise<RunSessionResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/session`,
    })
  }

  async recordStepHeartbeat(runId: string, request: StepHeartbeatRequest): Promise<RunSessionResponse> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/session/heartbeat`,
      body: request,
    })
  }

  async prepareStepCompletionReceipt(runId: string, request: PrepareCompletionReceiptRequest): Promise<RunSessionResponse> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/session/prepare-completion`,
      body: request,
    })
  }

  async commitStepCompletionReceipt(runId: string, request: CommitCompletionReceiptRequest): Promise<RunSessionResponse> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/session/commit-completion`,
      body: request,
    })
  }

  async streamRun(runId: string, cursor = 0): Promise<StreamRunResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/stream?cursor=${cursor}`,
    })
  }

  async approveGate(request: ApproveGateRequest): Promise<RunDetails> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(request.runId)}/approve`,
      body: request,
    })
  }

  async cancelRun(runId: string): Promise<RunDetails> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/cancel`,
      body: {},
    })
  }

  async replayRun(request: ReplayRunRequest): Promise<StartRunResponse> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(request.runId)}/replay`,
      body: request,
    })
  }

  async resumeRun(request: ResumeRunRequest): Promise<RunDetails> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(request.runId)}/resume`,
      body: request,
    })
  }

  async exportTraceBundle(runId: string): Promise<TraceBundleResponse> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/export-trace-bundle`,
      body: {},
    })
  }

  async verifyRun(runId: string): Promise<VerifyRunReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify`,
      body: {},
    })
  }

  async verifyTraceBundle(runId: string): Promise<VerifyTraceBundleReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-trace-bundle`,
      body: {},
    })
  }

  async getReleaseAttestation(runId: string): Promise<ReleaseAttestationResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/release-attestation`,
    })
  }

  async verifyReleaseAttestation(runId: string): Promise<VerifyReleaseAttestationReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-release-attestation`,
      body: {},
    })
  }

  async getReleaseArtifacts(runId: string): Promise<ReleaseArtifactsResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/release-artifacts`,
    })
  }

  async getPolicyReport(runId: string): Promise<PolicyReportResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/policy-report`,
    })
  }

  async getInvariantReport(runId: string): Promise<InvariantReportResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/invariant-report`,
    })
  }

  async getReleaseDossier(runId: string): Promise<ReleaseDossierResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/release-dossier`,
    })
  }

  async getReleaseBundle(runId: string): Promise<ReleaseBundleResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/release-bundle`,
    })
  }

  async getCertificationRecord(runId: string): Promise<CertificationRecordResponse> {
    return this.request({
      method: 'GET',
      requestPath: `/runs/${encodeURIComponent(runId)}/certification-record`,
    })
  }

  async verifyReleaseArtifacts(runId: string): Promise<VerifyReleaseArtifactsReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-release-artifacts`,
      body: {},
    })
  }

  async verifyPolicyReport(runId: string): Promise<VerifyPolicyReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-policy-report`,
      body: {},
    })
  }

  async verifyInvariantReport(runId: string): Promise<VerifyInvariantReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-invariant-report`,
      body: {},
    })
  }

  async verifyReleaseDossier(runId: string): Promise<VerifyReleaseDossierReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-release-dossier`,
      body: {},
    })
  }

  async verifyReleaseBundle(runId: string): Promise<VerifyReleaseBundleReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-release-bundle`,
      body: {},
    })
  }

  async verifyCertificationRecord(runId: string): Promise<VerifyCertificationRecordReport> {
    return this.request({
      method: 'POST',
      requestPath: `/runs/${encodeURIComponent(runId)}/verify-certification-record`,
      body: {},
    })
  }

  async verifyTransparencyLedger(): Promise<VerifyTransparencyLedgerReport> {
    return this.request({
      method: 'POST',
      requestPath: '/verify-transparency-ledger',
      body: {},
    })
  }

  async runBenchmark(request: RunBenchmarkRequest = { suiteIds: [], caseIds: [], datasetSources: [] }): Promise<BenchmarkHarnessReport> {
    return this.request({
      method: 'POST',
      requestPath: '/benchmark',
      body: request,
    })
  }

  async runInteropHarness(request: RunInteropRequest = { suiteIds: [] }): Promise<InteropHarnessReport> {
    return this.request({
      method: 'POST',
      requestPath: '/interop-harness',
      body: request,
    })
  }

  async waitForReady(timeoutMs = 10_000): Promise<void> {
    const started = Date.now()
    for (;;) {
      if (await this.ping()) {
        return
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for antigravity-daemon on ${this.socketPath ?? 'custom transport'}`)
      }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    if (this.transport) {
      return this.transport.request<T>(options)
    }

    return new Promise<T>((resolve, reject) => {
      const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
      const req = http.request({
        socketPath: this.socketPath,
        method: options.method,
        path: options.requestPath,
        headers: payload ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : undefined,
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const data = raw ? JSON.parse(raw) as Record<string, unknown> : {}
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(typeof data.error === 'string' ? data.error : `Daemon request failed (${res.statusCode})`))
            return
          }
          resolve(data as T)
        })
      })

      req.on('error', reject)
      if (payload) {
        req.write(payload)
      }
      req.end()
    })
  }
}
