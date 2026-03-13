import { describe, it, expect, vi } from 'vitest'
import { evaluateTransition } from '../src/workflow-run-driver.js'
import type { TransitionDecision, NodeExecutionResult } from '../src/node-executor.js'
import type { WorkflowState } from '@anthropic/antigravity-shared'

/**
 * PR-05: Transition authority migration tests.
 *
 * These tests verify that:
 * 1. evaluateTransition() remains a correct pure rule engine
 * 2. The daemon (via onTransition hook) is the sole authority for skip/forceQueue
 * 3. Adaptive skip, strict-full, and VERIFY→HITL paths are preserved
 * 4. Executor/host output alone cannot change next-node ordering
 */
describe('PR-05: Transition authority', () => {
  // ── Adaptive skip (PARALLEL → skip DEBATE → queue VERIFY) ──────────
  it('adaptive skip: PARALLEL → skip DEBATE → queue VERIFY when consensus is strong', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0.1,
      skipAllowed: false,
      codex: { confidence: 95, summary: 'result', modelId: 'codex' },
      gemini: { confidence: 90, summary: 'result', modelId: 'gemini' },
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {
              skipPolicy: {
                strategyId: 'adaptive.debate-express.v1',
                when: ['PARALLEL.bothAvailable === true', 'PARALLEL.disagreementScore <= 0.5'],
              },
            },
            skippable: true,
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any)

    expect(transition.skipNodes).toHaveLength(1)
    expect(transition.skipNodes[0]?.nodeId).toBe('DEBATE')
    expect(transition.skipNodes[0]?.strategyId).toBe('adaptive.debate-express.v1')
    expect(transition.forceQueue).toContain('VERIFY')
  })

  // ── Strict-full: DEBATE not skipped ────────────────────────────────
  it('strict-full: DEBATE is NOT skipped when skippable is false', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0,
      codex: { confidence: 99 },
      gemini: { confidence: 99 },
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {},
            skippable: false,
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any)

    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  // ── VERIFY → HITL forceQueue path ──────────────────────────────────
  it('VERIFY → HITL: compliance violation forces HITL queue', () => {
    const transition = evaluateTransition('VERIFY', {
      complianceCheck: 'VIOLATION',
      verificationResult: 'blocked',
    }, { nodes: {} } as any)

    expect(transition.forceQueue).toContain('HITL')
    expect(transition.skipNodes).toHaveLength(0)
  })

  it('VERIFY → no HITL: passing compliance does not force HITL', () => {
    const transition = evaluateTransition('VERIFY', {
      complianceCheck: 'PASS',
      verificationResult: 'approved',
    }, { nodes: {} } as any)

    expect(transition.forceQueue).not.toContain('HITL')
  })

  // ── Anti-test: executor output cannot override daemon transition ───
  it('anti-test: arbitrary executor output fields do not affect transition', () => {
    // Even if executor injects malicious fields, evaluateTransition ignores them
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0,
      codex: { confidence: 99 },
      gemini: { confidence: 99 },
      // Attempt to inject skip decision from executor output
      _skipNodes: [{ nodeId: 'DEBATE', reason: 'injected' }],
      _forceQueue: ['VERIFY'],
      nextNode: 'SKIP_ALL',
      overrideRouting: true,
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {},
            skippable: false, // not skippable
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any)

    // No skip because skippable=false, despite executor trying to inject fields
    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  // ── High disagreement prevents skip ────────────────────────────────
  it('adaptive skip blocked when disagreement is high', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0.8, // too high
      codex: { confidence: 95 },
      gemini: { confidence: 90 },
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {
              skipPolicy: {
                strategyId: 'adaptive.debate-express.v1',
                when: ['PARALLEL.disagreementScore <= 0.5'],
              },
            },
            skippable: true,
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any)

    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  // ── Low confidence prevents skip ───────────────────────────────────
  it('adaptive skip blocked when confidence is low', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0.1,
      codex: { confidence: 70 }, // too low
      gemini: { confidence: 90 },
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {
              skipPolicy: {
                strategyId: 'adaptive.debate-express.v1',
                when: [],
              },
            },
            skippable: true,
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any)

    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  // ── evaluateTransition is a pure function ──────────────────────────
  it('evaluateTransition is deterministic and side-effect free', () => {
    const output = {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0.2,
      codex: { confidence: 92 },
      gemini: { confidence: 88 },
    }
    const state = {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{
            id: 'DEBATE',
            name: 'DEBATE',
            dependsOn: ['PARALLEL'],
            input: {
              skipPolicy: {
                strategyId: 'adaptive.debate-express.v1',
                when: ['PARALLEL.bothAvailable === true'],
              },
            },
            skippable: true,
            priority: 0,
          }],
          edges: [],
        },
      },
    } as any

    const r1 = evaluateTransition('PARALLEL', output, state)
    const r2 = evaluateTransition('PARALLEL', output, state)

    // Same inputs → same outputs
    expect(r1).toEqual(r2)
  })
})
