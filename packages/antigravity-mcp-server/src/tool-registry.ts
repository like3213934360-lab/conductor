import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from './context.js'
import type { ModelToolContext } from './tools/model-tools.js'
import { registerAdvancedModelTools, registerCoreModelTools } from './tools/model-tools.js'
import { registerWorkflowAdvanceTool } from './tools/workflow-advance.js'
import { registerWorkflowBenchmarkTool } from './tools/workflow-benchmark.js'
import { registerWorkflowBenchmarkSourcesTool } from './tools/workflow-benchmark-sources.js'
import { registerWorkflowGetStateTool } from './tools/workflow-get-state.js'
import { registerWorkflowInteropTool } from './tools/workflow-interop.js'
import { registerWorkflowMemorySearchTool } from './tools/workflow-memory-search.js'
import { registerWorkflowPolicyPackTool } from './tools/workflow-policy-pack.js'
import { registerWorkflowPolicyReportTool } from './tools/workflow-policy-report.js'
import { registerWorkflowRemoteWorkersTool } from './tools/workflow-remote-workers.js'
import { registerWorkflowRunTool } from './tools/workflow-run.js'
import { registerWorkflowRunSessionTool } from './tools/workflow-run-session.js'
import { registerWorkflowTraceExportTool } from './tools/workflow-trace-export.js'
import { registerWorkflowTrustRegistryTool } from './tools/workflow-trust-registry.js'
import { registerWorkflowTransparencyLedgerTool } from './tools/workflow-transparency-ledger.js'
import { registerWorkflowReleaseAttestationTool } from './tools/workflow-release-attestation.js'
import { registerWorkflowReleaseArtifactsTool } from './tools/workflow-release-artifacts.js'
import { registerWorkflowInvariantReportTool } from './tools/workflow-invariant-report.js'
import { registerWorkflowReleaseBundleTool } from './tools/workflow-release-bundle.js'
import { registerWorkflowReleaseDossierTool } from './tools/workflow-release-dossier.js'
import { registerWorkflowCertificationRecordTool } from './tools/workflow-certification-record.js'
import { registerWorkflowVerifyReleaseArtifactsTool } from './tools/workflow-verify-release-artifacts.js'
import { registerWorkflowVerifyPolicyReportTool } from './tools/workflow-verify-policy-report.js'
import { registerWorkflowVerifyInvariantReportTool } from './tools/workflow-verify-invariant-report.js'
import { registerWorkflowVerifyReleaseAttestationTool } from './tools/workflow-verify-release-attestation.js'
import { registerWorkflowVerifyReleaseBundleTool } from './tools/workflow-verify-release-bundle.js'
import { registerWorkflowVerifyReleaseDossierTool } from './tools/workflow-verify-release-dossier.js'
import { registerWorkflowVerifyCertificationRecordTool } from './tools/workflow-verify-certification-record.js'
import { registerWorkflowVerifyTransparencyLedgerTool } from './tools/workflow-verify-transparency-ledger.js'
import { registerWorkflowVerifyTraceBundleTool } from './tools/workflow-verify-trace-bundle.js'
import { registerWorkflowVerifyRunTool } from './tools/workflow-verify-run.js'

export type ToolDomain = 'model' | 'workflow' | 'debug'

const ALL_DOMAINS: readonly ToolDomain[] = ['model', 'workflow', 'debug']

export interface ToolCatalogEntry {
  name: string
  domain: ToolDomain
  description: string
  keywords: string[]
}

const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  { name: 'ai_ask', domain: 'model', description: 'Ask a question to a specialized AI expert.', keywords: ['ask', 'chat', 'question', '模型'] },
  { name: 'ai_codex_task', domain: 'model', description: 'Run an autonomous coding task using Codex CLI.', keywords: ['codex', 'coding', 'refactor', '代码'] },
  { name: 'ai_gemini_task', domain: 'model', description: 'Run an autonomous task using the local Gemini CLI.', keywords: ['gemini', 'reasoning', 'agent', '推理'] },
  { name: 'ai_parallel_tasks', domain: 'model', description: 'Execute multiple AI tasks concurrently in a single request.', keywords: ['parallel', 'concurrent', 'batch', '并行'] },
  { name: 'ai_list_models', domain: 'model', description: 'List configured catalog models and their assigned task types.', keywords: ['models', 'catalog', 'list'] },
  { name: 'ai_list_ecosystem', domain: 'model', description: 'Discover MCP servers and CLI ecosystem integrations.', keywords: ['ecosystem', 'extensions', 'mcp'] },
  { name: 'ai_multi_ask', domain: 'model', description: 'Ask multiple AI models the same question in parallel.', keywords: ['multi', 'parallel', 'compare'] },
  { name: 'ai_consensus', domain: 'model', description: 'Run multi-model consensus and judge selection.', keywords: ['consensus', 'vote', 'judge'] },
  { name: 'ai_start_job', domain: 'model', description: 'Start a long-running CLI task asynchronously.', keywords: ['async', 'job', 'background'] },
  { name: 'ai_poll_job', domain: 'model', description: 'Poll the status of an async CLI job.', keywords: ['poll', 'job', 'status'] },
  { name: 'workflow.run', domain: 'workflow', description: 'Start a daemon-owned Antigravity workflow run.', keywords: ['workflow', 'run', 'daemon', 'antigravity'] },
  { name: 'workflow.runSession', domain: 'workflow', description: 'Read the active daemon-issued step lease and session state for a run.', keywords: ['workflow', 'lease', 'session', 'authority'] },
  { name: 'workflow.getState', domain: 'workflow', description: 'Read the latest daemon-owned run snapshot.', keywords: ['workflow', 'snapshot', 'state', 'run'] },
  { name: 'workflow.advance', domain: 'workflow', description: 'Read incremental timeline entries for a daemon-owned run.', keywords: ['workflow', 'timeline', 'stream', 'advance'] },
  { name: 'workflow.verifyRun', domain: 'workflow', description: 'Verify receipt / skip decision / release gate integrity for a run.', keywords: ['verify', 'integrity', 'receipt', 'evidence'] },
  { name: 'workflow.verifyTraceBundle', domain: 'workflow', description: 'Verify exported trace bundle integrity for a run.', keywords: ['verify', 'trace', 'bundle', 'integrity'] },
  { name: 'workflow.releaseArtifacts', domain: 'workflow', description: 'Read the aggregated release artifact surface for a run.', keywords: ['release', 'artifacts', 'trace', 'attestation'] },
  { name: 'workflow.policyReport', domain: 'workflow', description: 'Read the exported policy report for a run.', keywords: ['policy', 'report', 'verdicts', 'governance'] },
  { name: 'workflow.invariantReport', domain: 'workflow', description: 'Read the exported invariant report for a run.', keywords: ['invariants', 'report', 'verification', 'runtime'] },
  { name: 'workflow.releaseAttestation', domain: 'workflow', description: 'Read the exported release attestation for a run.', keywords: ['release', 'attestation', 'artifact', 'provenance'] },
  { name: 'workflow.releaseBundle', domain: 'workflow', description: 'Read the exported release bundle for a run.', keywords: ['release', 'bundle', 'artifact', 'proof'] },
  { name: 'workflow.releaseDossier', domain: 'workflow', description: 'Read the exported release dossier for a run.', keywords: ['release', 'dossier', 'artifact', 'proof'] },
  { name: 'workflow.certificationRecord', domain: 'workflow', description: 'Read the exported certification record for a run.', keywords: ['certification', 'record', 'artifact', 'proof'] },
  { name: 'workflow.transparencyLedger', domain: 'workflow', description: 'Read the append-only transparency ledger and its latest head entry.', keywords: ['transparency', 'ledger', 'proof', 'audit'] },
  { name: 'workflow.verifyReleaseArtifacts', domain: 'workflow', description: 'Verify the aggregated release artifact surface for a run.', keywords: ['verify', 'release', 'artifacts', 'integrity'] },
  { name: 'workflow.verifyPolicyReport', domain: 'workflow', description: 'Verify exported policy report integrity and signature provenance for a run.', keywords: ['verify', 'policy', 'report', 'integrity'] },
  { name: 'workflow.verifyInvariantReport', domain: 'workflow', description: 'Verify exported invariant report integrity and signature provenance for a run.', keywords: ['verify', 'invariants', 'report', 'integrity'] },
  { name: 'workflow.verifyReleaseAttestation', domain: 'workflow', description: 'Verify exported release attestation integrity and signature provenance for a run.', keywords: ['verify', 'release', 'attestation', 'integrity'] },
  { name: 'workflow.verifyReleaseBundle', domain: 'workflow', description: 'Verify exported release bundle integrity and signature provenance for a run.', keywords: ['verify', 'release', 'bundle', 'integrity'] },
  { name: 'workflow.verifyReleaseDossier', domain: 'workflow', description: 'Verify exported release dossier integrity and signature provenance for a run.', keywords: ['verify', 'release', 'dossier', 'integrity'] },
  { name: 'workflow.verifyCertificationRecord', domain: 'workflow', description: 'Verify exported certification record integrity and signature provenance for a run.', keywords: ['verify', 'certification', 'record', 'integrity'] },
  { name: 'workflow.verifyTransparencyLedger', domain: 'workflow', description: 'Verify the append-only transparency ledger hash chain.', keywords: ['verify', 'transparency', 'ledger', 'integrity'] },
  { name: 'workflow.policyPack', domain: 'workflow', description: 'Read the active daemon policy-as-code pack.', keywords: ['policy', 'pack', 'rules', 'governance'] },
  { name: 'workflow.trustRegistry', domain: 'workflow', description: 'Read or reload the daemon trust registry used for signer policies, signed benchmark sources, and signed remote worker advertisements.', keywords: ['trust', 'registry', 'keys', 'policies', 'signatures', 'advertisement'] },
  { name: 'workflow.traceExport', domain: 'workflow', description: 'Export a replayable trace bundle for a run.', keywords: ['trace', 'export', 'bundle', 'replay'] },
  { name: 'workflow.benchmark', domain: 'workflow', description: 'Run the antigravity-daemon dataset-backed benchmark harness.', keywords: ['benchmark', 'harness', 'evaluation', 'suite', 'case', 'dataset'] },
  { name: 'workflow.benchmarkSources', domain: 'workflow', description: 'Read or reload the benchmark dataset source registry used by the daemon benchmark harness.', keywords: ['benchmark', 'registry', 'dataset', 'sources', 'pinning'] },
  { name: 'workflow.interop', domain: 'workflow', description: 'Run the Antigravity interoperability harness.', keywords: ['interop', 'harness', 'antigravity', 'suite'] },
  { name: 'workflow.remoteWorkers', domain: 'workflow', description: 'List remote workers discovered by antigravity-daemon together with their agent-card advertisement, task protocol surfaces, verification summaries, and classified discovery issues.', keywords: ['remote workers', 'a2a', 'workers', 'agent-card', 'protocol', 'verification', 'advertisement'] },
  { name: 'workflow.memorySearch', domain: 'debug', description: 'Search daemon-owned workflow memory and semantic facts.', keywords: ['workflow', 'memory', 'search', 'reflexion'] },
]

export function isToolDomain(value: string): value is ToolDomain {
  return (ALL_DOMAINS as readonly string[]).includes(value)
}

export function resolveEnabledDomains(raw = process.env['ANTIGRAVITY_TOOL_DOMAINS']): ToolDomain[] {
  if (!raw) {
    return [...ALL_DOMAINS]
  }

  const domains = raw.split(',')
    .map(item => item.trim())
    .filter(isToolDomain)

  return domains.length > 0 ? domains : [...ALL_DOMAINS]
}

export function listToolCatalog(domains: readonly ToolDomain[] = ALL_DOMAINS): ToolCatalogEntry[] {
  const enabled = new Set(domains)
  return TOOL_CATALOG.filter(tool => enabled.has(tool.domain))
}

export function registerToolCatalog(
  server: McpServer,
  ctx: ServerContext,
  modelCtx: ModelToolContext,
  domains: readonly ToolDomain[] = ALL_DOMAINS,
): void {
  const enabled = new Set(domains)

  if (enabled.has('model')) {
    registerCoreModelTools(server, modelCtx)
    registerAdvancedModelTools(server, modelCtx)
  }

  if (enabled.has('workflow')) {
    registerWorkflowRunTool(server, ctx)
    registerWorkflowRunSessionTool(server, ctx)
    registerWorkflowGetStateTool(server, ctx)
    registerWorkflowAdvanceTool(server, ctx)
    registerWorkflowVerifyRunTool(server, ctx)
    registerWorkflowVerifyTraceBundleTool(server, ctx)
    registerWorkflowReleaseArtifactsTool(server, ctx)
    registerWorkflowPolicyReportTool(server, ctx)
    registerWorkflowInvariantReportTool(server, ctx)
    registerWorkflowReleaseAttestationTool(server, ctx)
    registerWorkflowReleaseBundleTool(server, ctx)
    registerWorkflowReleaseDossierTool(server, ctx)
    registerWorkflowCertificationRecordTool(server, ctx)
    registerWorkflowTransparencyLedgerTool(server, ctx)
    registerWorkflowVerifyReleaseArtifactsTool(server, ctx)
    registerWorkflowVerifyPolicyReportTool(server, ctx)
    registerWorkflowVerifyInvariantReportTool(server, ctx)
    registerWorkflowVerifyReleaseAttestationTool(server, ctx)
    registerWorkflowVerifyReleaseBundleTool(server, ctx)
    registerWorkflowVerifyReleaseDossierTool(server, ctx)
    registerWorkflowVerifyCertificationRecordTool(server, ctx)
    registerWorkflowVerifyTransparencyLedgerTool(server, ctx)
    registerWorkflowPolicyPackTool(server, ctx)
    registerWorkflowTrustRegistryTool(server, ctx)
    registerWorkflowTraceExportTool(server, ctx)
    registerWorkflowBenchmarkTool(server, ctx)
    registerWorkflowBenchmarkSourcesTool(server, ctx)
    registerWorkflowInteropTool(server, ctx)
    registerWorkflowRemoteWorkersTool(server, ctx)
  }

  if (enabled.has('debug')) {
    registerWorkflowMemorySearchTool(server, ctx)
  }
}

export function registerSearchTool(
  server: McpServer,
  domains: readonly ToolDomain[] = ALL_DOMAINS,
): void {
  server.tool(
    'search_tools',
    'Search the registered Antigravity MCP tool catalog by name, domain, or keyword.',
    {
      query: z.string().min(1).describe('Search query'),
      domain: z.enum(['model', 'workflow', 'debug']).optional().describe('Optional domain filter'),
      limit: z.number().int().positive().max(20).optional().describe('Maximum number of results'),
    },
    async (args) => {
      const normalizedQuery = args.query.trim().toLowerCase()
      const enabledDomains = args.domain ? [args.domain] : domains
      const matches = listToolCatalog(enabledDomains)
        .filter(tool =>
          tool.name.toLowerCase().includes(normalizedQuery) ||
          tool.description.toLowerCase().includes(normalizedQuery) ||
          tool.keywords.some(keyword => keyword.toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, args.limit ?? 8)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query: args.query,
            domains: enabledDomains,
            totalMatches: matches.length,
            matches,
          }, null, 2),
        }],
      }
    },
  )
}
