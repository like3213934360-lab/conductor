/**
 * AGC Governance Integration Tests
 *
 * 验证 AGCService 通过完整的 4 拦截点治理生命周期:
 * - preflight (startRun)
 * - authorize (advanceNode step 2)
 * - observe (advanceNode step 4)
 * - release (completeRun)
 *
 * 以及 WorkflowRuntime 的 claimNext/submitCheckpoint 集成。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GovernanceGateway } from '../governance-gateway.js'
import { TrustFactorService } from '../trust-factor.js'
import { WorkflowRuntime } from '../workflow-runtime.js'
import { CheckpointSchemaRegistry } from '../checkpoint-schemas.js'
import { TokenBudgetEnforcer } from '../token-budget-enforcer.js'
import type { GovernanceContext, GovernanceControl, GovernanceControlResult } from '../governance-types.js'

// ── 辅助工厂 ──────────────────────────────────────────────────────────────────

function createTrustService(): TrustFactorService {
  return new TrustFactorService()
}

function createMockControl(
  id: string,
  stage: GovernanceControl['stage'],
  status: GovernanceControlResult['status'] = 'pass',
): GovernanceControl {
  return {
    id,
    name: `Mock ${id}`,
    stage,
    defaultLevel: 'block',
    priority: 0,
    evaluate: () => ({
      controlId: id,
      controlName: `Mock ${id}`,
      status,
      message: `${id} evaluated`,
    }),
  }
}

// ── GovernanceGateway 4 拦截点测试 ───────────────────────────────────────────

describe('GovernanceGateway — 4 intercept points', () => {
  let gateway: GovernanceGateway
  let trustService: TrustFactorService

  const baseCtx: GovernanceContext = {
    runId: 'test-run-001',
    graph: { nodes: [{ id: 'ANALYZE', name: 'ANALYZE', dependsOn: [], input: {}, skippable: false, priority: 0 }], edges: [] },
    state: { runId: 'test-run-001', version: 1, status: 'running', nodes: {}, completedNodeIds: [], skippedNodeIds: [] } as any,
    metadata: { goal: 'test', files: [], initiator: 'test' },
    action: { type: 'node.execute', nodeId: 'ANALYZE' },
  }

  beforeEach(() => {
    trustService = createTrustService()
    gateway = new GovernanceGateway(trustService, [
      createMockControl('input-check', 'input'),
      createMockControl('exec-check', 'execution'),
      createMockControl('route-check', 'routing'),
      createMockControl('assurance-check', 'assurance'),
      createMockControl('output-check', 'output'),
    ])
  })

  it('preflight() executes input-stage controls', async () => {
    const result = await gateway.preflight(baseCtx)
    expect(result.effect).toBe('allow')
    expect(result.rationale.some(r => r.includes('input-check'))).toBe(true)
  })

  it('authorize() executes execution + routing controls', async () => {
    const result = await gateway.authorize(baseCtx)
    expect(result.effect).toBe('allow')
    expect(result.rationale.some(r => r.includes('exec-check'))).toBe(true)
    expect(result.rationale.some(r => r.includes('route-check'))).toBe(true)
  })

  it('authorize() blocks on execution control failure', async () => {
    const blockGateway = new GovernanceGateway(trustService, [
      createMockControl('exec-blocker', 'execution', 'block'),
    ])
    const result = await blockGateway.authorize(baseCtx)
    expect(result.effect).toBe('block')
  })

  it('observe() executes assurance controls and updates trust', async () => {
    const result = await gateway.observe(baseCtx, {
      action: { type: 'node.execute', nodeId: 'ANALYZE' },
      success: true,
      durationMs: 100,
    })
    expect(result.effect).toBe('allow')
    expect(result.rationale.some(r => r.includes('assurance-check'))).toBe(true)
  })

  it('release() executes output controls with real dreadScore', async () => {
    const candidates = [{
      id: 'c1',
      provider: 'codex',
      summary: 'test answer with enough content to be valid',
      confidence: 90,
    }]
    const result = await gateway.release(baseCtx, candidates, 30)
    expect(result.effect).toBe('release')
    expect(result.score).toBeGreaterThan(0)
    expect(result.selectedCandidateId).toBe('c1')
  })
})

// ── WorkflowRuntime 集成测试 ────────────────────────────────────────────────

describe('WorkflowRuntime — Lease lifecycle', () => {
  let runtime: WorkflowRuntime
  let schemaRegistry: CheckpointSchemaRegistry
  let budgetEnforcer: TokenBudgetEnforcer

  const graph = {
    nodes: [
      { id: 'ANALYZE', name: 'ANALYZE', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 },
      { id: 'PARALLEL', name: 'PARALLEL', dependsOn: ['ANALYZE'], input: {}, skippable: false, priority: 0 },
    ],
    edges: [{ from: 'ANALYZE', to: 'PARALLEL' }],
  }

  beforeEach(() => {
    schemaRegistry = new CheckpointSchemaRegistry()
    budgetEnforcer = new TokenBudgetEnforcer({ globalLimit: 100000 })
    runtime = new WorkflowRuntime(schemaRegistry, undefined, budgetEnforcer)
    runtime.start({
      workflowId: 'test',
      version: 'v8.0',
      graph,
      nodes: {
        ANALYZE: {
          nodeId: 'ANALYZE',
          boundaryMode: 'PLANNING',
          skippable: false,
          allowedOutgoing: [{ edgeId: 'a->p', to: 'PARALLEL', when: () => true }],
        },
        PARALLEL: {
          nodeId: 'PARALLEL',
          boundaryMode: 'EXECUTION',
          skippable: false,
          allowedOutgoing: [],
        },
      },
    })
  })

  it('claimNext() returns lease for ready node', () => {
    const state = { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any
    const leases = runtime.claimNext('r1', state)
    expect(leases).toHaveLength(1)
    expect(leases[0]!.nodeId).toBe('ANALYZE')
  })

  it('submitCheckpoint() validates schema and routes to next node', () => {
    const state = { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any
    const leases = runtime.claimNext('r1', state)
    const lease = leases[0]!

    const result = runtime.submitCheckpoint({
      runId: 'r1',
      leaseId: lease.leaseId,
      nodeId: 'ANALYZE',
      checkpoint: {
        task_type: 'review',
        tools_available: ['codex'],
        evidence_files: ['test.ts'],
        risk_level: 'low',
        route_path: 'fast_track',
        token_budget: 'M',
        history_hits: [],
      },
    }, state)

    expect(result.accepted).toBe(true)
    if (result.accepted) {
      expect(result.nextNodeIds).toContain('PARALLEL')
    }
  })

  it('rejects duplicate lease submission', () => {
    const state = { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any
    const leases = runtime.claimNext('r1', state)
    const lease = leases[0]!

    const checkpoint = {
      task_type: 'review' as const,
      tools_available: ['codex'],
      evidence_files: ['test.ts'],
      risk_level: 'low' as const,
      route_path: 'fast_track' as const,
      token_budget: 'M' as const,
      history_hits: [],
    }

    // First submit succeeds
    runtime.submitCheckpoint({ runId: 'r1', leaseId: lease.leaseId, nodeId: 'ANALYZE', checkpoint }, state)

    // Second submit should fail (DUPLICATE_SUBMIT)
    const result = runtime.submitCheckpoint({ runId: 'r1', leaseId: lease.leaseId, nodeId: 'ANALYZE', checkpoint }, state)
    expect(result.accepted).toBe(false)
    if (!result.accepted) {
      expect(result.deviation.code).toBe('DUPLICATE_SUBMIT')
    }
  })
})

// ── Token 预算泄漏修复验证 ──────────────────────────────────────────────────

describe('TokenBudgetEnforcer — Leak prevention', () => {
  it('releaseReservation prevents permanent leak on expired leases', () => {
    const enforcer = new TokenBudgetEnforcer({ globalLimit: 10000, defaultReservation: 2000 })

    // Simulate preflight reservation
    const check = enforcer.preflight('ANALYZE')
    expect(check.allowed).toBe(true)

    // Before release: reserved = 2000
    let snapshot = enforcer.getSnapshot()
    expect(snapshot.globalReserved).toBe(2000)

    // Simulate lease expiry → release reservation
    enforcer.releaseReservation(2000)

    // After release: reserved = 0 (no leak)
    snapshot = enforcer.getSnapshot()
    expect(snapshot.globalReserved).toBe(0)
    expect(snapshot.globalUsed).toBe(0)
  })
})
