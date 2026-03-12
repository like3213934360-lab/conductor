import { describe, expect, it } from 'vitest'
import { listToolCatalog, resolveEnabledDomains } from '../tool-registry.js'

describe('Antigravity MCP tool registry', () => {
  it('publishes the canonical daemon-backed workflow tool ids', () => {
    const names = listToolCatalog().map(tool => tool.name)
    const expectedModel = [
      'ai_ask',
      'ai_list_models',
      'ai_multi_ask',
      'ai_consensus',
    ]
    const expectedWorkflow = [
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
    ]
    const expectedDebug = [
      'workflow.memorySearch',
    ]

    expect(expectedModel.every(name => names.includes(name))).toBe(true)
    expect(expectedWorkflow.every(name => names.includes(name))).toBe(true)
    expect(expectedDebug.every(name => names.includes(name))).toBe(true)
    expect(listToolCatalog(['debug']).map(tool => tool.name).sort()).toEqual(expectedDebug.sort())
  })

  it('filters enabled domains from environment-like input', () => {
    expect(resolveEnabledDomains('workflow,debug')).toEqual(['workflow', 'debug'])
    expect(resolveEnabledDomains('unknown')).toEqual(['model', 'workflow', 'debug'])
  })
})
