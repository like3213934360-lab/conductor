import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DAEMON_API_CONTRACT } from '../manifest.js'
import {
  ANTIGRAVITY_AUTHORITY_HOST,
  ANTIGRAVITY_AUTHORITY_OWNER,
  ANTIGRAVITY_CALLBACK_AUTH_SCHEME,
  ANTIGRAVITY_CALLBACK_INGRESS_PATH,
  ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER,
  ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER,
  ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE,
  ANTIGRAVITY_DAEMON_DB_NAME,
  ANTIGRAVITY_DAEMON_ENV,
  ANTIGRAVITY_DAEMON_POLICY_PACK_FILE,
  ANTIGRAVITY_DAEMON_PROJECTION_FILE,
  ANTIGRAVITY_DAEMON_REMOTE_WORKERS_FILE,
  ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE,
} from '../runtime-contract.js'
import { TRACE_BUNDLE_SECTIONS } from '../trace-bundle-integrity.js'

const repoRoot = path.resolve(__dirname, '../../../../')

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T
}

function readText(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('Antigravity release surface', () => {
  it('keeps package identities frozen to the antigravity workspace graph', () => {
    const rootPkg = readJson<{ name: string; displayName: string; scripts: Record<string, string> }>('package.json')
    expect(rootPkg.name).toBe('antigravity-workflow')
    expect(rootPkg.displayName).toBe('Antigravity Workflow')
    expect(rootPkg.scripts.build).toContain('dist/antigravity-daemon.js')
    expect(rootPkg.scripts.build).toContain('dist/antigravity-mcp-server.js')

    const packageNames = [
      'packages/antigravity-shared/package.json',
      'packages/antigravity-core/package.json',
      'packages/antigravity-persistence/package.json',
      'packages/antigravity-model-shared/package.json',
      'packages/antigravity-model-core/package.json',
      'packages/antigravity-daemon/package.json',
      'packages/antigravity-mcp-server/package.json',
      'packages/antigravity-vscode/package.json',
      'packages/antigravity-webview/package.json',
    ].map(relativePath => readJson<{ name: string }>(relativePath).name)

    expect(packageNames).toEqual([
      '@anthropic/antigravity-shared',
      '@anthropic/antigravity-core',
      '@anthropic/antigravity-persistence',
      '@anthropic/antigravity-model-shared',
      '@anthropic/antigravity-model-core',
      '@anthropic/antigravity-daemon',
      '@anthropic/antigravity-mcp-server',
      '@anthropic/antigravity-vscode',
      '@anthropic/antigravity-webview',
    ])
  })

  it('keeps daemon authority and path defaults sourced from the canonical runtime contract', () => {
    expect(DAEMON_API_CONTRACT.authorityOwner).toBe(ANTIGRAVITY_AUTHORITY_OWNER)
    expect(DAEMON_API_CONTRACT.authorityHost).toBe(ANTIGRAVITY_AUTHORITY_HOST)
    expect(DAEMON_API_CONTRACT.callbackIngressPath).toBe(ANTIGRAVITY_CALLBACK_INGRESS_PATH)
    expect(DAEMON_API_CONTRACT.callbackAuthScheme).toBe(ANTIGRAVITY_CALLBACK_AUTH_SCHEME)
    expect(DAEMON_API_CONTRACT.callbackSignatureHeader).toBe(ANTIGRAVITY_CALLBACK_SIGNATURE_HEADER)
    expect(DAEMON_API_CONTRACT.callbackTimestampHeader).toBe(ANTIGRAVITY_CALLBACK_TIMESTAMP_HEADER)

    expect(ANTIGRAVITY_DAEMON_ENV.workspaceRoot).toBe('ANTIGRAVITY_DAEMON_WORKSPACE_ROOT')
    expect(ANTIGRAVITY_DAEMON_ENV.dataDir).toBe('ANTIGRAVITY_DAEMON_DATA_DIR')
    expect(ANTIGRAVITY_DAEMON_ENV.projectionPath).toBe('ANTIGRAVITY_DAEMON_PROJECTION_PATH')
    expect(ANTIGRAVITY_DAEMON_ENV.socketPath).toBe('ANTIGRAVITY_DAEMON_SOCKET_PATH')
    expect(ANTIGRAVITY_DAEMON_ENV.callbackHost).toBe('ANTIGRAVITY_DAEMON_CALLBACK_HOST')
    expect(ANTIGRAVITY_DAEMON_ENV.callbackPort).toBe('ANTIGRAVITY_DAEMON_CALLBACK_PORT')
    expect(ANTIGRAVITY_DAEMON_ENV.callbackBaseUrl).toBe('ANTIGRAVITY_DAEMON_CALLBACK_BASE_URL')

    expect(ANTIGRAVITY_DAEMON_DB_NAME).toBe('antigravity-daemon.db')
    expect(ANTIGRAVITY_DAEMON_PROJECTION_FILE).toBe('run-projection.json')
    expect(ANTIGRAVITY_DAEMON_POLICY_PACK_FILE).toBe('policy-pack.json')
    expect(ANTIGRAVITY_DAEMON_TRUST_REGISTRY_FILE).toBe('trust-registry.json')
    expect(ANTIGRAVITY_DAEMON_REMOTE_WORKERS_FILE).toBe('remote-workers.json')
    expect(ANTIGRAVITY_DAEMON_BENCHMARK_SOURCE_REGISTRY_FILE).toBe('benchmark-source-registry.json')
  })

  it('keeps public commands and MCP tool ids frozen to the antigravity control plane', () => {
    const rootPkg = readJson<{
      contributes?: { commands?: Array<{ command: string }> }
    }>('package.json')
    const commandIds = (rootPkg.contributes?.commands ?? []).map(command => command.command)
    expect(commandIds.every(command => command.startsWith('antigravity.'))).toBe(true)

    const toolRegistrySource = readText('packages/antigravity-mcp-server/src/tool-registry.ts')
    for (const toolName of [
      'workflow.run',
      'workflow.runSession',
      'workflow.getState',
      'workflow.advance',
      'workflow.verifyRun',
      'workflow.verifyTraceBundle',
      'workflow.releaseArtifacts',
      'workflow.policyReport',
      'workflow.invariantReport',
      'workflow.releaseAttestation',
      'workflow.releaseBundle',
      'workflow.releaseDossier',
      'workflow.certificationRecord',
      'workflow.transparencyLedger',
      'workflow.verifyReleaseArtifacts',
      'workflow.verifyPolicyReport',
      'workflow.verifyInvariantReport',
      'workflow.verifyReleaseAttestation',
      'workflow.verifyReleaseBundle',
      'workflow.verifyReleaseDossier',
      'workflow.verifyCertificationRecord',
      'workflow.verifyTransparencyLedger',
      'workflow.policyPack',
      'workflow.trustRegistry',
      'workflow.traceExport',
      'workflow.benchmark',
      'workflow.benchmarkSources',
      'workflow.interop',
      'workflow.remoteWorkers',
      'workflow.memorySearch',
      'ai_ask',
      'ai_list_models',
      'ai_multi_ask',
      'ai_consensus',
    ]) {
      expect(toolRegistrySource).toContain(`'${toolName}'`)
    }
  })

  it('keeps tribunal and durable completion proof-chain surfaces wired into the public release model', () => {
    expect(TRACE_BUNDLE_SECTIONS).toContain('tribunals')

    const schemaSource = readText('packages/antigravity-daemon/src/schema.ts')
    expect(schemaSource).toContain('TribunalSummarySchema')
    expect(schemaSource).toContain('CompletionSessionRecordSchema')
    expect(schemaSource).toContain('latestTribunalVerdict')

    const contractSource = readText('docs/ANTIGRAVITY_CONTRACT.md')
    expect(contractSource).toContain('tribunal-judge')
    expect(contractSource).toContain('PrepareStepCompletionReceipt')
    expect(contractSource).toContain('CommitStepCompletionReceipt')
  })
})
