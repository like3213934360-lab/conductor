import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BoundedModelChecker, StateInvariantVerifier } from '@anthropic/antigravity-core'
import { compileWorkflowDefinition, resolveWorkflowDefinition } from '../workflow-definition.js'

const repoRoot = path.resolve(__dirname, '../../../../')

function readSpec(fileName: string): string {
  return fs.readFileSync(path.join(repoRoot, 'spec', fileName), 'utf8')
}

describe('formal specs', () => {
  it('keeps workflow session / release gate / artifact proof specs present and frozen', () => {
    const workflowSession = readSpec('workflow-session.tla')
    const releaseGate = readSpec('release-gate.tla')
    const artifactProof = readSpec('artifact-proof.tla')

    expect(workflowSession).toContain('MODULE workflow-session')
    expect(workflowSession).toContain('LeaseRequiredForRunning ==')
    expect(workflowSession).toContain('PreparedRequiresPendingReceipt ==')
    expect(workflowSession).toContain('CommitRequiresPreparedReceipt ==')
    expect(workflowSession).toContain('NoPreparedReceiptAfterTerminal ==')

    expect(releaseGate).toContain('MODULE release-gate')
    expect(releaseGate).toContain('CompletedRequiresProofChain ==')
    expect(releaseGate).toContain('BundleRequiresDossier ==')
    expect(releaseGate).toContain('AttestationRequiresTraceBundle ==')

    expect(artifactProof).toContain('MODULE artifact-proof')
    expect(artifactProof).toContain('BundleRequiresArtifactDigests ==')
    expect(artifactProof).toContain('CertificationRequiresBundle ==')
  })

  it('executes bounded model checking against the canonical strict workflow graph', () => {
    const invocation = {
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Validate canonical Antigravity workflow topology and termination semantics.',
      files: [],
      initiator: 'formal-spec-test',
      workspaceRoot: '/tmp/antigravity',
      triggerSource: 'command' as const,
      forceFullPath: true,
      options: {},
      metadata: {},
    }
    const definition = resolveWorkflowDefinition(invocation)
    const graph = compileWorkflowDefinition(definition)
    const invariants = [...new StateInvariantVerifier().getProperties()]
    const checker = new BoundedModelChecker({
      maxStates: 500,
      maxDepth: 20,
      strategy: 'bfs',
      checkDeadlock: true,
      checkLivelock: true,
      invariants,
    })

    const result = checker.check(graph, invariants)
    expect(result.statesExplored).toBeGreaterThan(0)
    expect(result.maxDepthReached).toBeGreaterThan(0)
    expect(result.violations.every(violation =>
      ['deadlock', 'livelock', 'invariant', 'unreachable_terminal'].includes(violation.type),
    )).toBe(true)
  })
})
