import { describe, it, expect } from 'vitest'
import {
  evaluateRulesAgainstFacts,
  createFactsForRelease,
  createFactsForHumanGate,
  createFactsForApproval,
  createFactsForResume,
  DaemonPolicyEngine,
  type PolicyEvaluationContext,
} from '../policy-engine.js'
import type { DaemonLifecycleStage, DaemonStageVerdict } from '@anthropic/antigravity-core'

/**
 * PR-11: Gateway cutover tests.
 *
 * Verify that gateway-based evaluation produces equivalent results
 * to direct evaluateX calls, and that the cutover is correct.
 */
function evaluateViaGateway(
  engine: DaemonPolicyEngine,
  stage: DaemonLifecycleStage,
  runId: string,
  ruleScope: string,
  verdictScope: string,
  evaluatedAt: string,
  facts: Record<string, unknown>,
  fallbackMessage: string,
) {
  const rules = engine.exportPack().rules
  const context: PolicyEvaluationContext = {
    runId, ruleScope, verdictScope, evaluatedAt, facts, fallbackMessage,
  }
  const verdict = evaluateRulesAgainstFacts(rules, context)
  const stageVerdict: DaemonStageVerdict = {
    stage,
    effect: verdict.effect,
    rationale: verdict.rationale,
    verdictId: verdict.verdictId,
    evaluatedAt: verdict.evaluatedAt,
    scope: verdict.scope,
  }
  return { verdict, stageVerdict }
}

describe('PR-11: gateway cutover equivalence — release', () => {
  const engine = new DaemonPolicyEngine()

  it('release allow via gateway = direct evaluateRelease', () => {
    const input = {
      runId: 'r-1',
      decision: { effect: 'allow', rationale: ['ok'], evidenceIds: ['e1'] } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const direct = engine.evaluateRelease(input)
    const { verdict: gateway } = evaluateViaGateway(
      engine, 'daemon:terminal-release', 'r-1', 'release', 'release',
      '2026-01-01T00:00:00Z', createFactsForRelease(input),
      'Release checks passed under the active policy pack.',
    )
    expect(gateway.effect).toBe(direct.effect)
    expect(gateway.verdictId).toBe(direct.verdictId)
  })

  it('release block via gateway produces block', () => {
    const input = {
      runId: 'r-1',
      decision: { effect: 'block', rationale: ['insufficient evidence'], evidenceIds: [] } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const { verdict, stageVerdict } = evaluateViaGateway(
      engine, 'daemon:terminal-release', 'r-1', 'release', 'release',
      '2026-01-01T00:00:00Z', createFactsForRelease(input),
      'Release checks passed under the active policy pack.',
    )
    expect(verdict.effect).toBe('block')
    expect(stageVerdict.stage).toBe('daemon:terminal-release')
  })
})

describe('PR-11: gateway cutover equivalence — human-gate', () => {
  const engine = new DaemonPolicyEngine()

  it('human-gate required via gateway = direct evaluateHumanGate', () => {
    const input = {
      runId: 'r-1',
      requirement: { required: true, reason: 'needs human' } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const direct = engine.evaluateHumanGate(input)
    const { verdict: gateway } = evaluateViaGateway(
      engine, 'daemon:terminal-release', 'r-1', 'human-gate', 'human-gate',
      '2026-01-01T00:00:00Z', createFactsForHumanGate(input),
      'Human gate checks passed under the active policy pack.',
    )
    expect(gateway.effect).toBe(direct.effect)
    expect(gateway.verdictId).toBe(direct.verdictId)
  })

  it('human-gate cleared via gateway = allow', () => {
    const input = {
      runId: 'r-1',
      requirement: { required: false, reason: undefined } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const { verdict } = evaluateViaGateway(
      engine, 'daemon:terminal-release', 'r-1', 'human-gate', 'human-gate',
      '2026-01-01T00:00:00Z', createFactsForHumanGate(input),
      'Human gate checks passed under the active policy pack.',
    )
    expect(verdict.effect).toBe('allow')
  })
})

describe('PR-11: gateway cutover equivalence — approval', () => {
  const engine = new DaemonPolicyEngine()

  it('approval with actor via gateway = direct evaluateApproval', () => {
    const input = {
      runId: 'r-1', gateId: 'g1', approvedBy: 'admin',
      comment: 'approved', evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const direct = engine.evaluateApproval(input)
    const { verdict: gateway, stageVerdict } = evaluateViaGateway(
      engine, 'daemon:approval', 'r-1', 'approval', 'approval:g1',
      '2026-01-01T00:00:00Z', createFactsForApproval(input),
      'Approval gate g1 passed under the active policy pack.',
    )
    expect(gateway.effect).toBe(direct.effect)
    expect(gateway.verdictId).toBe(direct.verdictId)
    expect(stageVerdict.stage).toBe('daemon:approval')
  })

  it('approval without actor via gateway blocks', () => {
    const input = {
      runId: 'r-1', gateId: 'g1', approvedBy: '',
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const { verdict } = evaluateViaGateway(
      engine, 'daemon:approval', 'r-1', 'approval', 'approval:g1',
      '2026-01-01T00:00:00Z', createFactsForApproval(input),
      'Approval gate g1 passed under the active policy pack.',
    )
    expect(verdict.effect).toBe('block')
  })
})

describe('PR-11: gateway cutover equivalence — resume', () => {
  const engine = new DaemonPolicyEngine()

  it('resume via gateway = direct evaluateResume', () => {
    const input = {
      runId: 'r-1', approvedBy: 'reviewer',
      comment: 'ok', evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const direct = engine.evaluateResume(input)
    const { verdict: gateway } = evaluateViaGateway(
      engine, 'daemon:approval', 'r-1', 'resume', 'resume',
      '2026-01-01T00:00:00Z', createFactsForResume(input),
      'Resume checks passed under the active policy pack.',
    )
    expect(gateway.effect).toBe(direct.effect)
    expect(gateway.verdictId).toBe(direct.verdictId)
  })
})

describe('PR-11: stage verdict metadata', () => {
  const engine = new DaemonPolicyEngine()

  it('stage verdict carries correct stage and scope', () => {
    const input = {
      runId: 'r-1',
      decision: { effect: 'allow', rationale: ['ok'], evidenceIds: [] } as any,
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const { stageVerdict } = evaluateViaGateway(
      engine, 'daemon:terminal-release', 'r-1', 'release', 'release',
      '2026-01-01T00:00:00Z', createFactsForRelease(input),
      'Release checks passed under the active policy pack.',
    )
    expect(stageVerdict.stage).toBe('daemon:terminal-release')
    expect(stageVerdict.scope).toBe('release')
    expect(stageVerdict.verdictId).toBeTruthy()
    expect(stageVerdict.evaluatedAt).toBe('2026-01-01T00:00:00Z')
  })
})
