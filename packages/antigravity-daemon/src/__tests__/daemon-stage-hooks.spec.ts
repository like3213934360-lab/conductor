import { describe, it, expect } from 'vitest'
import {
  evaluateRulesAgainstFacts,
  createFactsForPreflight,
  createFactsForSkip,
  DaemonPolicyEngine,
  type PolicyEvaluationContext,
} from '../policy-engine.js'
import type { DaemonLifecycleStage, DaemonStageVerdict } from '@anthropic/antigravity-core'

/**
 * PR-10: GovernanceGateway daemon lifecycle stage hook tests.
 */
describe('PR-10: DaemonLifecycleStage types', () => {
  it('DaemonLifecycleStage values are valid strings', () => {
    const stages: DaemonLifecycleStage[] = [
      'daemon:preflight',
      'daemon:skip-authorize',
      'daemon:terminal-release',
      'daemon:node-observe',
      'daemon:lease-authorize',
      'daemon:approval',
    ]
    expect(stages).toHaveLength(6)
    for (const s of stages) {
      expect(s).toMatch(/^daemon:/)
    }
  })
})

describe('PR-10: evaluateDaemonStage via pure evaluator', () => {
  const engine = new DaemonPolicyEngine()
  const rules = engine.exportPack().rules

  function buildStageVerdict(
    stage: DaemonLifecycleStage,
    context: PolicyEvaluationContext,
  ): DaemonStageVerdict {
    const verdict = evaluateRulesAgainstFacts(rules, context)
    return {
      stage,
      effect: verdict.effect,
      rationale: verdict.rationale,
      verdictId: verdict.verdictId,
      evaluatedAt: verdict.evaluatedAt,
      scope: verdict.scope,
    }
  }

  it('daemon:preflight stage produces verdict with stage metadata', () => {
    const facts = createFactsForPreflight({
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.3,
      evaluatedAt: '2026-01-01T00:00:00Z',
    })
    const sv = buildStageVerdict('daemon:preflight', {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z', facts, fallbackMessage: 'pass',
    })
    expect(sv.stage).toBe('daemon:preflight')
    expect(sv.effect).toBe('allow')
    expect(sv.verdictId).toBeTruthy()
    expect(sv.scope).toBe('preflight')
  })

  it('daemon:skip-authorize stage produces verdict with stage metadata', () => {
    const facts = createFactsForSkip({
      runId: 'r-1', nodeId: 'DEBATE', strategyId: 's1',
      triggerCondition: 't1', reason: 'adaptive', evaluatedAt: '2026-01-01T00:00:00Z',
    })
    const sv = buildStageVerdict('daemon:skip-authorize', {
      runId: 'r-1', ruleScope: 'skip', verdictScope: 'skip:DEBATE',
      evaluatedAt: '2026-01-01T00:00:00Z', facts, fallbackMessage: 'skip pass',
    })
    expect(sv.stage).toBe('daemon:skip-authorize')
    expect(sv.effect).toBe('allow')
  })

  it('stage verdict matches direct evaluateX result', () => {
    const input = {
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.5,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const directVerdict = engine.evaluatePreflight(input)
    const stageVerdict = buildStageVerdict('daemon:preflight', {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForPreflight(input),
      fallbackMessage: 'Preflight checks passed under the active policy pack.',
    })
    expect(stageVerdict.effect).toBe(directVerdict.effect)
    expect(stageVerdict.verdictId).toBe(directVerdict.verdictId)
  })

  it('blocked preflight produces block verdict with stage metadata', () => {
    const facts = createFactsForPreflight({
      runId: 'r-1',
      governance: { allowed: false, worstStatus: 'block', findings: [{ message: 'denied' }] } as any,
      drScore: 0.3,
      evaluatedAt: '2026-01-01T00:00:00Z',
    })
    const sv = buildStageVerdict('daemon:preflight', {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z', facts, fallbackMessage: 'pass',
    })
    expect(sv.stage).toBe('daemon:preflight')
    expect(sv.effect).toBe('block')
  })

  it('stage verdict does not interfere with direct evaluateX', () => {
    // Verify that calling the stage hook path does not modify engine state
    const before = engine.evaluatePreflight({
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.5, evaluatedAt: '2026-01-01T00:00:00Z',
    })
    // Call stage path
    buildStageVerdict('daemon:preflight', {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForPreflight({
        runId: 'r-1', governance: { allowed: false, worstStatus: 'block', findings: [{ message: 'x' }] } as any,
        drScore: 0.9, evaluatedAt: '2026-01-01T00:00:00Z',
      }),
      fallbackMessage: 'pass',
    })
    // Verify engine state unchanged
    const after = engine.evaluatePreflight({
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.5, evaluatedAt: '2026-01-01T00:00:00Z',
    })
    expect(after.effect).toBe(before.effect)
    expect(after.verdictId).toBe(before.verdictId)
  })
})
