import { describe, it, expect } from 'vitest'
import {
  evaluateRulesAgainstFacts,
  createFactsForPreflight,
  createFactsForRelease,
  createFactsForHumanGate,
  createFactsForApproval,
  createFactsForResume,
  createFactsForSkip,
  createFactsForTraceBundle,
  createFactsForReleaseAttestation,
  createFactsForReleaseDossier,
  createFactsForReleaseBundle,
  DaemonPolicyEngine,
  type PolicyEvaluationContext,
  type PolicyFacts,
} from '../policy-engine.js'

/**
 * PR-09: Pure evaluator and facts adapter tests.
 */
describe('PR-09: evaluateRulesAgainstFacts (pure evaluator)', () => {
  const defaultRules = new DaemonPolicyEngine().exportPack().rules

  it('evaluates preflight scope with governance-allowed facts → allow', () => {
    const facts = createFactsForPreflight({
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.3,
      evaluatedAt: '2026-01-01T00:00:00Z',
    })
    const ctx: PolicyEvaluationContext = {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z', facts, fallbackMessage: 'pass',
    }
    const verdict = evaluateRulesAgainstFacts(defaultRules, ctx)
    expect(verdict.effect).toBe('allow')
  })

  it('evaluates preflight scope with governance-blocked facts → block', () => {
    const facts = createFactsForPreflight({
      runId: 'r-1',
      governance: { allowed: false, worstStatus: 'block', findings: [{ message: 'blocked' }] } as any,
      drScore: 0.3,
      evaluatedAt: '2026-01-01T00:00:00Z',
    })
    const ctx: PolicyEvaluationContext = {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z', facts, fallbackMessage: 'pass',
    }
    const verdict = evaluateRulesAgainstFacts(defaultRules, ctx)
    expect(verdict.effect).toBe('block')
  })

  it('returns fallback when no rules match', () => {
    const verdict = evaluateRulesAgainstFacts([], {
      runId: 'r-1', ruleScope: 'nonexistent', verdictScope: 'nonexistent',
      evaluatedAt: '2026-01-01T00:00:00Z', facts: {}, fallbackMessage: 'No rules matched.',
    })
    expect(verdict.effect).toBe('allow')
    expect(verdict.rationale).toContain('No rules matched.')
  })

  it('produces stable verdictId for same inputs', () => {
    const ctx: PolicyEvaluationContext = {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForPreflight({
        runId: 'r-1', governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
        drScore: 0.5, evaluatedAt: '2026-01-01T00:00:00Z',
      }),
      fallbackMessage: 'pass',
    }
    const v1 = evaluateRulesAgainstFacts(defaultRules, ctx)
    const v2 = evaluateRulesAgainstFacts(defaultRules, ctx)
    expect(v1.verdictId).toBe(v2.verdictId)
    expect(v1.effect).toBe(v2.effect)
  })

  it('class evaluateX produces same result as pure evaluator', () => {
    const engine = new DaemonPolicyEngine()
    const input = {
      runId: 'r-1',
      governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.5,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const classResult = engine.evaluatePreflight(input)
    const pureResult = evaluateRulesAgainstFacts(engine.exportPack().rules, {
      runId: 'r-1', ruleScope: 'preflight', verdictScope: 'preflight',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForPreflight(input),
      fallbackMessage: 'Preflight checks passed under the active policy pack.',
    })
    expect(classResult.effect).toBe(pureResult.effect)
    expect(classResult.verdictId).toBe(pureResult.verdictId)
  })
})

describe('PR-09: facts adapters', () => {
  it('createFactsForPreflight produces correct facts', () => {
    const facts = createFactsForPreflight({
      runId: 'r', governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.42, evaluatedAt: '',
    })
    expect(facts.governanceAllowed).toBe(true)
    expect(facts.drScore).toBe(0.42)
  })

  it('createFactsForRelease produces correct facts', () => {
    const facts = createFactsForRelease({
      runId: 'r', decision: { effect: 'allow', rationale: ['ok'], evidenceIds: ['e1'] } as any,
      evaluatedAt: '',
    })
    expect(facts.releaseDecision).toBe('allow')
    expect(facts.releaseEvidenceIds).toEqual(['e1'])
  })

  it('createFactsForHumanGate produces correct facts', () => {
    const facts = createFactsForHumanGate({
      runId: 'r', requirement: { required: true, reason: 'needs human' } as any,
      evaluatedAt: '',
    })
    expect(facts.humanGateRequired).toBe(true)
  })

  it('createFactsForApproval produces correct facts', () => {
    const facts = createFactsForApproval({
      runId: 'r', gateId: 'g1', approvedBy: 'admin', evaluatedAt: '',
    })
    expect(facts.actorPresent).toBe(true)
    expect(facts.gateId).toBe('g1')
  })

  it('createFactsForSkip produces correct facts', () => {
    const facts = createFactsForSkip({
      runId: 'r', nodeId: 'N', strategyId: 's1', triggerCondition: 't1',
      reason: 'adaptive', evaluatedAt: '',
    })
    expect(facts.nodeId).toBe('N')
    expect(facts.strategyId).toBe('s1')
  })
})

describe('PR-09: DaemonPolicyEngine backward compat', () => {
  it('evaluatePreflight still works', () => {
    const engine = new DaemonPolicyEngine()
    const v = engine.evaluatePreflight({
      runId: 'r', governance: { allowed: true, worstStatus: 'ok', findings: [] } as any,
      drScore: 0.1, evaluatedAt: '2026-01-01T00:00:00Z',
    })
    expect(v.effect).toBe('allow')
    expect(v.scope).toBe('preflight')
  })

  it('evaluateRelease still works', () => {
    const engine = new DaemonPolicyEngine()
    const v = engine.evaluateRelease({
      runId: 'r', decision: { effect: 'allow', rationale: ['ok'], evidenceIds: [] } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    })
    expect(v.effect).toBe('allow')
  })

  it('evaluateSkip still works', () => {
    const engine = new DaemonPolicyEngine()
    const v = engine.evaluateSkip({
      runId: 'r', nodeId: 'N', strategyId: 's', triggerCondition: 't',
      reason: 'r', evaluatedAt: '2026-01-01T00:00:00Z',
    })
    expect(v.effect).toBe('allow')
    expect(v.scope).toBe('skip:N')
  })

  it('exportPack still returns valid pack', () => {
    const engine = new DaemonPolicyEngine()
    const pack = engine.exportPack()
    expect(pack.packId).toBe('antigravity-daemon-policy-pack')
    expect(pack.rules.length).toBeGreaterThan(0)
  })
})
