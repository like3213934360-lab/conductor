import type { InteropHarnessReport, RunInteropRequest, TrustRegistrySnapshot } from './schema.js'
import {
  type HarnessSuiteDefinition,
  runManifestDrivenHarness,
} from './manifest-driven-harness.js'
import { ANTIGRAVITY_AUTHORITY_HOST, ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

export interface InteropHarnessContext {
  readonly projectionPath: string
  readonly authorityOwner: string
  readonly authorityHost: string
  readonly callbackIngressBaseUrl?: string
  readonly callbackAuthScheme?: string
  hasManifestOperation(operationId: string): boolean
  getTrustRegistry?(): TrustRegistrySnapshot
  listRemoteWorkers(): {
    refreshedAt: string
    workers: Array<{
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
}

const INTEROP_SUITES: Record<string, HarnessSuiteDefinition<InteropHarnessContext>> = {
  'authority-surface': {
    suiteId: 'authority-surface',
    name: 'Authority Surface',
    description: 'Validate daemon-owned execution authority and route exposure.',
    tags: ['authority', 'contract'],
    async evaluate(ctx) {
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
        signerPolicies: [],
      }
      return {
        checks: [
        {
          id: 'authority-owner',
          ok: ctx.authorityOwner === ANTIGRAVITY_AUTHORITY_OWNER,
          message: `Authority owner is ${ctx.authorityOwner}.`,
        },
        {
          id: 'authority-host',
          ok: ctx.authorityHost === ANTIGRAVITY_AUTHORITY_HOST,
          message: `Authority host is ${ctx.authorityHost}.`,
        },
        {
          id: 'stream-operation',
          ok: ctx.hasManifestOperation('StreamRun'),
          message: 'Manifest exposes stream operations for daemon-owned run sessions.',
        },
        {
          id: 'callback-ingress-operation',
          ok: ctx.hasManifestOperation('ReceiveRemoteWorkerCallback'),
          message: 'Manifest exposes callback ingress for remote worker completion events.',
        },
        {
          id: 'callback-auth-scheme',
          ok: ctx.callbackAuthScheme === 'hmac-sha256',
          message: `Callback ingress auth scheme is ${ctx.callbackAuthScheme ?? 'unset'}.`,
        },
        {
          id: 'completion-session-operations',
          ok:
            ctx.hasManifestOperation('GetRunSession') &&
            ctx.hasManifestOperation('PrepareStepCompletionReceipt') &&
            ctx.hasManifestOperation('CommitStepCompletionReceipt'),
          message: 'Manifest exposes durable completion session operations.',
        },
        {
          id: 'trust-registry-route',
          ok: !ctx.getTrustRegistry || ctx.hasManifestOperation('ReloadTrustRegistry'),
          message: 'Manifest exposes trust registry hot reload when the trust surface is enabled.',
        },
        {
          id: 'trust-registry-surface',
          ok: trustRegistry.registryId.length > 0 && Array.isArray(trustRegistry.keys),
          message: `Trust registry ${trustRegistry.registryId}@${trustRegistry.version} is exposed through the daemon control plane.`,
        },
        {
          id: 'trust-registry-signer-policies',
          ok: Array.isArray(trustRegistry.signerPolicies) && trustRegistry.signerPolicies.length >= 2,
          message: `Trust registry exposes ${Array.isArray(trustRegistry.signerPolicies) ? trustRegistry.signerPolicies.length : 0} signer policy scope(s).`,
        },
        ],
      }
    },
  },
  'federation-surface': {
    suiteId: 'federation-surface',
    name: 'Federation Surface',
    description: 'Validate lifecycle-aware remote worker discovery metadata.',
    tags: ['federation', 'a2a'],
    async evaluate(ctx) {
      const workers = ctx.listRemoteWorkers()
      return {
        checks: [
        {
          id: 'remote-worker-refresh',
          ok: workers.refreshedAt.length > 0,
          message: `Remote worker directory refreshed at ${workers.refreshedAt}.`,
        },
        {
          id: 'remote-worker-response-mode',
          ok: workers.workers.every(worker =>
            worker.selectedResponseMode === 'inline' ||
            worker.selectedResponseMode === 'poll' ||
            worker.selectedResponseMode === 'stream' ||
            worker.selectedResponseMode === 'callback'),
          message: 'Remote worker directory exposes selected response mode metadata.',
        },
        {
          id: 'remote-worker-supported-modes',
          ok: workers.workers.every(worker => Array.isArray(worker.supportedResponseModes) && worker.supportedResponseModes.length > 0),
          message: 'Remote worker directory exposes supported response modes from agent cards.',
        },
        {
          id: 'remote-worker-protocol-source',
          ok: workers.workers.every(worker => worker.taskProtocolSource === 'agent-card'),
          message: 'Remote worker directory only exposes agent-card-derived task protocol metadata.',
        },
        {
          id: 'remote-worker-verification-summary',
          ok: workers.workers.every(worker => worker.verification?.summary === 'verified'),
          message: workers.workers.every(worker => worker.verification?.summary === 'verified')
            ? 'Remote workers passed agent-card verification without warnings.'
            : 'One or more remote workers still carry agent-card verification warnings.',
        },
        {
          id: 'remote-worker-agent-card-digest',
          ok: workers.workers.every(worker => typeof worker.agentCardSha256 === 'string' && /^[a-f0-9]{64}$/i.test(worker.agentCardSha256)),
          message: 'Remote worker directory exposes stable SHA256 digests for discovered agent cards.',
        },
        {
          id: 'remote-worker-advertisement-metadata',
          ok: workers.workers.every(worker => !worker.agentCardSchemaVersion || typeof worker.agentCardPublishedAt === 'string'),
          message: 'Remote worker directory exposes advertisement schema/publication metadata when the agent card advertises it.',
        },
        {
          id: 'remote-worker-advertisement-signature-surface',
          ok: workers.workers.every(worker =>
            !worker.agentCardAdvertisementSignatureKeyId ||
            typeof worker.agentCardAdvertisementSignedAt === 'string'),
          message: 'Remote worker directory exposes advertisement signature metadata when the agent card advertises signed surfaces.',
        },
        {
          id: 'remote-worker-discovery-issue-kinds',
          ok: (workers.discoveryIssues ?? []).every(issue => typeof issue.issueKind === 'string' && issue.issueKind.length > 0),
          message: 'Remote worker discovery issues expose structured issue kinds.',
        },
        {
          id: 'remote-worker-discovery-issue-expectations',
          ok: (workers.discoveryIssues ?? []).every(issue =>
            (!issue.expectedAgentCardSha256 || /^[a-f0-9]{64}$/i.test(issue.expectedAgentCardSha256)) &&
            (!issue.expectedAdvertisementSchemaVersion || issue.expectedAdvertisementSchemaVersion.length > 0) &&
            (!issue.advertisementTrustPolicyId || issue.advertisementTrustPolicyId.length > 0) &&
            (!issue.allowedAdvertisementKeyStatuses || Array.isArray(issue.allowedAdvertisementKeyStatuses)) &&
            (!issue.allowedAdvertisementKeyIds || Array.isArray(issue.allowedAdvertisementKeyIds)) &&
            (!issue.allowedAdvertisementIssuers || Array.isArray(issue.allowedAdvertisementIssuers))),
          message: 'Remote worker discovery issues preserve configured digest/schema/trust-policy expectations when verification blocks delegation.',
        },
        {
          id: 'callback-ingress-base-url',
          ok: workers.workers.every(worker => worker.selectedResponseMode !== 'callback') || Boolean(ctx.callbackIngressBaseUrl),
          message: ctx.callbackIngressBaseUrl
            ? `Callback ingress base URL is ${ctx.callbackIngressBaseUrl}.`
            : 'No callback lifecycle workers require a callback ingress base URL.',
        },
        {
          id: 'callback-worker-auth',
          ok: workers.workers.every(worker => worker.selectedResponseMode !== 'callback') || ctx.callbackAuthScheme === 'hmac-sha256',
          message: workers.workers.some(worker => worker.selectedResponseMode === 'callback')
            ? `Callback workers are protected with ${ctx.callbackAuthScheme ?? 'unset'} callback auth.`
            : 'No callback lifecycle workers configured.',
        },
        ],
      }
    },
  },
  'durable-runtime-surface': {
    suiteId: 'durable-runtime-surface',
    name: 'Durable Runtime Surface',
    description: 'Validate replay/recovery surfaces exposed by the daemon runtime.',
    tags: ['runtime', 'durability'],
    async evaluate(ctx) {
      return {
        checks: [
        {
          id: 'event-store-surface',
          ok: ctx.hasEventStreaming(),
          message: 'Event store exposes replayable stream reads.',
        },
        {
          id: 'checkpoint-store-surface',
          ok: ctx.hasCheckpointRecovery(),
          message: 'Checkpoint store exposes durable recovery primitives.',
        },
        {
          id: 'completion-session-surface',
          ok:
            ctx.hasManifestOperation('GetRunSession') &&
            ctx.hasManifestOperation('PrepareStepCompletionReceipt') &&
            ctx.hasManifestOperation('CommitStepCompletionReceipt'),
          message: 'Durable completion session state is exposed for recovery and host coordination.',
        },
        {
          id: 'run-projection-path',
          ok: ctx.projectionPath.length > 0,
          message: `Dashboard projection path: ${ctx.projectionPath}`,
        },
        ],
      }
    },
  },
}

export class InteropHarness {
  private readonly manifestPath: string
  private readonly ctx: InteropHarnessContext

  constructor(ctx: InteropHarnessContext, manifestPath: string) {
    this.ctx = ctx
    this.manifestPath = manifestPath
  }

  async run(request: RunInteropRequest): Promise<InteropHarnessReport> {
    return runManifestDrivenHarness({
      ctx: this.ctx,
      manifestPath: this.manifestPath,
      harnessId: 'antigravity-daemon-interop-harness',
      manifestVersion: '1.0.0',
      definitions: INTEROP_SUITES,
      suiteIds: request.suiteIds,
      caseIds: [],
    })
  }
}
