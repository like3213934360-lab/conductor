import { describe, expect, it } from 'vitest'
import { evaluateRunInvariants } from '../run-invariants.js'

describe('run invariants', () => {
  it('requires completed runs to carry terminal timeline and release artifacts', () => {
    const failures = evaluateRunInvariants({
      snapshot: {
        runId: 'run-1',
        goal: 'test',
        workflowId: 'antigravity.strict-full',
        workflowVersion: '1.0.0',
        workflowTemplate: 'antigravity.strict-full.v1',
        authorityOwner: 'antigravity-daemon',
        authorityHost: 'antigravity',
        workspaceRoot: '/tmp/project',
        status: 'completed',
        phase: 'COMPLETED',
        nodes: {},
        runtimeState: null,
        timelineCursor: 0,
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
        releaseArtifacts: {},
      },
      timeline: [],
    })

    expect(failures).toContain('terminal.completedAt')
    expect(failures).toContain('completed.timeline')
    expect(failures).toContain('completed.traceBundle')
    expect(failures).toContain('completed.releaseAttestation')
  })

  it('accepts paused runs when a human-gate timeline entry exists', () => {
    const failures = evaluateRunInvariants({
      snapshot: {
        runId: 'run-2',
        goal: 'test',
        workflowId: 'antigravity.strict-full',
        workflowVersion: '1.0.0',
        workflowTemplate: 'antigravity.strict-full.v1',
        authorityOwner: 'antigravity-daemon',
        authorityHost: 'antigravity',
        workspaceRoot: '/tmp/project',
        status: 'paused_for_human',
        phase: 'PAUSED_FOR_HUMAN',
        nodes: {},
        runtimeState: null,
        timelineCursor: 2,
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
        releaseArtifacts: {},
      },
      timeline: [
        {
          sequence: 1,
          runId: 'run-2',
          kind: 'run.paused_for_human',
          payload: {},
          createdAt: '2026-03-12T00:00:01.000Z',
        },
      ],
    })

    expect(failures).toEqual([])
  })
})
