import type { RunStatus } from './schema.js'
import {
  ANTIGRAVITY_AUTHORITY_HOST,
  ANTIGRAVITY_AUTHORITY_OWNER,
  ANTIGRAVITY_CALLBACK_AUTH_SCHEME,
  ANTIGRAVITY_CALLBACK_INGRESS_PATH,
  ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER,
  ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER,
} from './runtime-contract.js'

export interface DaemonRouteContract {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly operationId: string
  readonly summary: string
}

export interface DaemonApiManifest {
  readonly schemaVersion: '2.10.0'
  readonly authorityMode: 'daemon-owned'
  readonly authorityOwner: typeof ANTIGRAVITY_AUTHORITY_OWNER
  readonly authorityHost: typeof ANTIGRAVITY_AUTHORITY_HOST
  readonly callbackIngressPath: typeof ANTIGRAVITY_CALLBACK_INGRESS_PATH
  readonly callbackIngressBaseUrl?: string
  readonly callbackAuthScheme: typeof ANTIGRAVITY_CALLBACK_AUTH_SCHEME
  readonly callbackSignatureHeader: typeof ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER
  readonly callbackTimestampHeader: typeof ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER
  readonly workflowIds: readonly string[]
  readonly terminalRunStatuses: readonly RunStatus[]
  readonly routes: readonly DaemonRouteContract[]
}

export const DAEMON_API_CONTRACT: DaemonApiManifest = {
  schemaVersion: '2.10.0',
  authorityMode: 'daemon-owned',
  authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
  authorityHost: ANTIGRAVITY_AUTHORITY_HOST,
  callbackIngressPath: ANTIGRAVITY_CALLBACK_INGRESS_PATH,
  callbackAuthScheme: ANTIGRAVITY_CALLBACK_AUTH_SCHEME,
  callbackSignatureHeader: ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER,
  callbackTimestampHeader: ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER,
  workflowIds: ['antigravity.strict-full', 'antigravity.adaptive'],
  terminalRunStatuses: ['completed', 'failed', 'cancelled', 'paused_for_human'],
  routes: [
    {
      method: 'GET',
      path: '/health',
      operationId: 'HealthCheck',
      summary: 'Health check for the local Antigravity daemon.',
    },
    {
      method: 'GET',
      path: '/manifest',
      operationId: 'GetManifest',
      summary: 'Return the canonical daemon API contract and authority metadata.',
    },
    {
      method: 'GET',
      path: '/policy-pack',
      operationId: 'GetPolicyPack',
      summary: 'Return the active daemon policy-as-code pack.',
    },
    {
      method: 'GET',
      path: '/trust-registry',
      operationId: 'GetTrustRegistry',
      summary: 'Return the active trust registry used for signed benchmark sources and signed remote worker advertisements.',
    },
    {
      method: 'GET',
      path: '/benchmark-source-registry',
      operationId: 'GetBenchmarkSourceRegistry',
      summary: 'Return the active benchmark dataset source registry.',
    },
    {
      method: 'GET',
      path: '/transparency-ledger',
      operationId: 'GetTransparencyLedger',
      summary: 'Return the append-only transparency ledger and its latest head entry.',
    },
    {
      method: 'GET',
      path: '/transparency-ledger',
      operationId: 'GetTransparencyLedger',
      summary: 'Return the append-only transparency ledger and its latest head entry.',
    },
    {
      method: 'GET',
      path: '/transparency-ledger',
      operationId: 'GetTransparencyLedger',
      summary: 'Return the append-only transparency ledger and its head entry.',
    },
    {
      method: 'GET',
      path: '/transparency-ledger',
      operationId: 'GetTransparencyLedger',
      summary: 'Return the workspace transparency ledger and its latest head entry.',
    },
    {
      method: 'POST',
      path: '/memory/search',
      operationId: 'SearchMemory',
      summary: 'Search daemon-owned workflow memory and semantic facts.',
    },
    {
      method: 'POST',
      path: '/policy-pack/reload',
      operationId: 'ReloadPolicyPack',
      summary: 'Reload the daemon policy-as-code pack from the local workspace file.',
    },
    {
      method: 'POST',
      path: '/trust-registry/reload',
      operationId: 'ReloadTrustRegistry',
      summary: 'Reload the daemon trust registry from the local workspace file.',
    },
    {
      method: 'POST',
      path: '/benchmark-source-registry/reload',
      operationId: 'ReloadBenchmarkSourceRegistry',
      summary: 'Reload the benchmark dataset source registry from the local workspace file.',
    },
    {
      method: 'POST',
      path: '/verify-transparency-ledger',
      operationId: 'VerifyTransparencyLedger',
      summary: 'Verify the append-only transparency ledger hash chain.',
    },
    {
      method: 'POST',
      path: '/verify-transparency-ledger',
      operationId: 'VerifyTransparencyLedger',
      summary: 'Verify the append-only transparency ledger hash chain.',
    },
    {
      method: 'POST',
      path: '/verify-transparency-ledger',
      operationId: 'VerifyTransparencyLedger',
      summary: 'Verify the append-only transparency ledger hash chain.',
    },
    {
      method: 'POST',
      path: '/verify-transparency-ledger',
      operationId: 'VerifyTransparencyLedger',
      summary: 'Verify the append-only transparency ledger hash chain.',
    },
    {
      method: 'GET',
      path: '/remote-workers',
      operationId: 'ListRemoteWorkers',
      summary: 'Return discovered remote worker adapters and their health.',
    },
    {
      method: 'POST',
      path: '/remote-workers/refresh',
      operationId: 'RefreshRemoteWorkers',
      summary: 'Refresh remote worker discovery from the local configuration file.',
    },
    {
      method: 'POST',
      path: '/remote-worker-callbacks/:callbackToken',
      operationId: 'ReceiveRemoteWorkerCallback',
      summary: 'Receive callback-based remote worker task completion events.',
    },
    {
      method: 'POST',
      path: '/runs/start',
      operationId: 'StartRun',
      summary: 'Start a daemon-owned Antigravity workflow run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId',
      operationId: 'GetRun',
      summary: 'Fetch the latest run snapshot and workflow metadata.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/session',
      operationId: 'GetRunSession',
      summary: 'Read the active daemon-issued step lease and session state for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/session/heartbeat',
      operationId: 'RecordStepHeartbeat',
      summary: 'Record a host-side heartbeat for the active daemon-issued step lease.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/session/prepare-completion',
      operationId: 'PrepareStepCompletionReceipt',
      summary: 'Prepare a host-side completion receipt that must match the pending daemon-issued receipt.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/session/commit-completion',
      operationId: 'CommitStepCompletionReceipt',
      summary: 'Commit a previously prepared host-side completion receipt.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/stream',
      operationId: 'StreamRun',
      summary: 'Read timeline entries after a cursor together with the latest snapshot.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify',
      operationId: 'VerifyRun',
      summary: 'Re-evaluate release evidence and integrity for a daemon-owned run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/approve',
      operationId: 'ApproveGate',
      summary: 'Record human approval and optionally resume a paused HITL gate.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/cancel',
      operationId: 'CancelRun',
      summary: 'Cancel an in-flight daemon-owned workflow run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/replay',
      operationId: 'ReplayRun',
      summary: 'Replay a previous run with the same invocation metadata.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/resume',
      operationId: 'ResumeRun',
      summary: 'Resume a paused run after a policy-authorized human approval.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/export-trace-bundle',
      operationId: 'ExportTraceBundle',
      summary: 'Export the replayable evidence bundle for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-trace-bundle',
      operationId: 'VerifyTraceBundle',
      summary: 'Verify the exported trace bundle integrity for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/release-attestation',
      operationId: 'GetReleaseAttestation',
      summary: 'Read the exported release attestation for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/release-artifacts',
      operationId: 'GetReleaseArtifacts',
      summary: 'Read the aggregated release artifact surface for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/policy-report',
      operationId: 'GetPolicyReport',
      summary: 'Read the exported policy report for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/invariant-report',
      operationId: 'GetInvariantReport',
      summary: 'Read the exported invariant report for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/release-dossier',
      operationId: 'GetReleaseDossier',
      summary: 'Read the exported release dossier for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/release-bundle',
      operationId: 'GetReleaseBundle',
      summary: 'Read the exported release bundle for a run.',
    },
    {
      method: 'GET',
      path: '/runs/:runId/certification-record',
      operationId: 'GetCertificationRecord',
      summary: 'Read the exported certification record for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-release-attestation',
      operationId: 'VerifyReleaseAttestation',
      summary: 'Verify the exported release attestation for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-release-artifacts',
      operationId: 'VerifyReleaseArtifacts',
      summary: 'Verify the aggregated release artifact surface for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-policy-report',
      operationId: 'VerifyPolicyReport',
      summary: 'Verify the exported policy report for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-invariant-report',
      operationId: 'VerifyInvariantReport',
      summary: 'Verify the exported invariant report for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-release-dossier',
      operationId: 'VerifyReleaseDossier',
      summary: 'Verify the exported release dossier for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-release-bundle',
      operationId: 'VerifyReleaseBundle',
      summary: 'Verify the exported release bundle for a run.',
    },
    {
      method: 'POST',
      path: '/runs/:runId/verify-certification-record',
      operationId: 'VerifyCertificationRecord',
      summary: 'Verify the exported certification record for a run.',
    },
    {
      method: 'POST',
      path: '/benchmark',
      operationId: 'RunBenchmark',
      summary: 'Run the dataset-backed benchmark harness for the daemon runtime.',
    },
    {
      method: 'POST',
      path: '/interop-harness',
      operationId: 'RunInteropHarness',
      summary: 'Run the manifest-driven interoperability harness for Antigravity integration.',
    },
  ],
}
