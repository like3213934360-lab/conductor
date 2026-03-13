import { describe, it, expect } from 'vitest'
import {
  evaluateRulesAgainstFacts,
  createFactsForApproval,
  createFactsForResume,
  DaemonPolicyEngine,
  type PolicyEvaluationContext,
} from '../policy-engine.js'
import type { PolicyRule, PolicyVerdict } from '../schema.js'

/**
 * Governance enforcement tests (P0-1 remediation).
 *
 * These tests verify that the policy engine can produce 'block' verdicts
 * and that the verdict enforcement logic correctly identifies blocking verdicts.
 * The actual runtime enforcement is wired into runtime.ts via
 * enforceGovernanceVerdict() at preflight, approval, resume, and human-gate stages.
 */

/**
 * Simulate the enforcement check that runtime.ts performs.
 * This is a pure-function mirror of AntigravityDaemonRuntime.enforceGovernanceVerdict().
 */
function simulateEnforcement(verdict: PolicyVerdict): { blocked: true; reason: string } | null {
  if (verdict.effect === 'block') {
    const reason = `Governance verdict blocked: ${verdict.rationale.join('; ') || 'policy block'}`
    return { blocked: true, reason }
  }
  return null
}

describe('P0-1: governance verdict enforcement', () => {
  const engine = new DaemonPolicyEngine()

  it('default policy pack produces allow for approval — no enforcement block', () => {
    const input = {
      runId: 'r-enf-1',
      gateId: 'g1',
      approvedBy: 'admin',
      comment: 'approved',
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const verdict = engine.evaluateApproval(input)
    expect(verdict.effect).toBe('allow')
    const enforcement = simulateEnforcement(verdict)
    expect(enforcement).toBeNull()
  })

  it('default policy pack produces allow for resume — no enforcement block', () => {
    const input = {
      runId: 'r-enf-2',
      approvedBy: 'reviewer',
      comment: 'ok',
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const verdict = engine.evaluateResume(input)
    expect(verdict.effect).toBe('allow')
    const enforcement = simulateEnforcement(verdict)
    expect(enforcement).toBeNull()
  })

  it('approval without actor produces block — enforcement catches it', () => {
    const input = {
      runId: 'r-enf-3',
      gateId: 'g1',
      approvedBy: '',
      evaluatedAt: '2026-01-01T00:00:00Z',
    }
    const verdict = engine.evaluateApproval(input)
    expect(verdict.effect).toBe('block')
    const enforcement = simulateEnforcement(verdict)
    expect(enforcement).not.toBeNull()
    expect(enforcement!.blocked).toBe(true)
    expect(enforcement!.reason).toContain('blocked')
  })

  it('custom block rule produces block verdict — enforcement catches it', () => {
    // Create a custom policy engine with a blocking rule
    const rules: PolicyRule[] = [
      {
        ruleId: 'test-block-resume',
        scope: 'resume',
        description: 'Block all resume attempts for testing',
        enabled: true,
        effect: 'block',
        message: 'Resume blocked by test policy',
      },
    ]
    const pack = engine.exportPack()
    const context: PolicyEvaluationContext = {
      runId: 'r-enf-4',
      ruleScope: 'resume',
      verdictScope: 'resume',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForResume({
        runId: 'r-enf-4',
        approvedBy: 'reviewer',
        comment: 'ok',
        evaluatedAt: '2026-01-01T00:00:00Z',
      }),
      fallbackMessage: 'Resume checks passed.',
    }
    const verdict = evaluateRulesAgainstFacts(rules, context)
    expect(verdict.effect).toBe('block')
    const enforcement = simulateEnforcement(verdict)
    expect(enforcement).not.toBeNull()
    expect(enforcement!.blocked).toBe(true)
  })

  it('warn verdict does NOT trigger enforcement block', () => {
    const rules: PolicyRule[] = [
      {
        ruleId: 'test-warn-resume',
        scope: 'resume',
        description: 'Warn on resume for testing',
        enabled: true,
        effect: 'warn',
        message: 'Resume warned by test policy',
      },
    ]
    const context: PolicyEvaluationContext = {
      runId: 'r-enf-5',
      ruleScope: 'resume',
      verdictScope: 'resume',
      evaluatedAt: '2026-01-01T00:00:00Z',
      facts: createFactsForResume({
        runId: 'r-enf-5',
        approvedBy: 'reviewer',
        comment: 'ok',
        evaluatedAt: '2026-01-01T00:00:00Z',
      }),
      fallbackMessage: 'Resume checks passed.',
    }
    const verdict = evaluateRulesAgainstFacts(rules, context)
    expect(verdict.effect).toBe('warn')
    const enforcement = simulateEnforcement(verdict)
    expect(enforcement).toBeNull()
  })
})
