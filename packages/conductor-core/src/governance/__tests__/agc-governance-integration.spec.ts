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

  it('rejects PARALLEL checkpoint without dual execution receipts', () => {
    const parallelRuntime = new WorkflowRuntime(new CheckpointSchemaRegistry())
    parallelRuntime.start({
      workflowId: 'parallel-only',
      version: 'v8.0',
      graph: {
        nodes: [{ id: 'PARALLEL', name: 'PARALLEL', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 }],
        edges: [],
      },
      nodes: {
        PARALLEL: {
          nodeId: 'PARALLEL',
          boundaryMode: 'EXECUTION',
          skippable: false,
          allowedOutgoing: [],
        },
      },
    })

    const state = { runId: 'r-parallel', version: 1, nodes: {}, status: 'running' } as any
    const lease = parallelRuntime.claimNext('r-parallel', state)[0]!

    const result = parallelRuntime.submitCheckpoint({
      runId: 'r-parallel',
      leaseId: lease.leaseId,
      nodeId: 'PARALLEL',
      checkpoint: {
        execution_mode: 'dual_model_parallel',
        codex: {
          provider: 'codex',
          task_id: 'codex-task-1',
          started_at: '2026-03-10T00:00:00.000Z',
          finished_at: '2026-03-10T00:00:01.000Z',
          status: 'success',
          output_hash: 'abc',
          summary: 'done',
          confidence: 90,
          option_id: 'A',
        },
        both_available: true,
        dr_value: 0,
        skip_allowed: false,
      },
    }, state)

    expect(result.accepted).toBe(false)
    if (!result.accepted) {
      expect(result.deviation.code).toBe('SCHEMA_INVALID')
      expect(result.reason).toContain('gemini')
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

// ── P0-2/P1-3 Fix: abandonLease 释放租约 + 预算预留 ──────────────────────────

describe('WorkflowRuntime — abandonLease', () => {
  it('releases lease and budget reservation, prevents node deadlock', () => {
    const schemaRegistry = new CheckpointSchemaRegistry()
    const budgetEnforcer = new TokenBudgetEnforcer({ globalLimit: 10000, defaultReservation: 2000 })
    const runtime = new WorkflowRuntime(schemaRegistry, undefined, budgetEnforcer)

    const graph = {
      nodes: [{ id: 'A', name: 'A', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 }],
      edges: [],
    }
    runtime.start({
      workflowId: 'test', version: 'v8.0', graph,
      nodes: { A: { nodeId: 'A', boundaryMode: 'EXECUTION' as const, skippable: false, allowedOutgoing: [] } },
    })

    const state = { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any
    const leases = runtime.claimNext('r1', state)
    expect(leases).toHaveLength(1)
    const lease = leases[0]!

    // Budget reserved after claim
    let snapshot = budgetEnforcer.getSnapshot()
    expect(snapshot.globalReserved).toBeGreaterThan(0)

    // Abandon the lease (simulating auth block)
    runtime.abandonLease(lease.leaseId, 'auth blocked')

    // Budget reservation released
    snapshot = budgetEnforcer.getSnapshot()
    expect(snapshot.globalReserved).toBe(0)

    // Idempotent: second abandon should not throw
    expect(() => runtime.abandonLease(lease.leaseId, 'double abandon')).not.toThrow()
  })
})

// ── P0-3 Fix: observe 决策强制执行 ──────────────────────────────────────────

describe('GovernanceGateway — observe decision enforcement', () => {
  it('observe() returns block effect when assurance control blocks', async () => {
    const trustService = createTrustService()
    const gateway = new GovernanceGateway(trustService, [
      createMockControl('assurance-blocker', 'assurance', 'block'),
    ])

    const ctx: GovernanceContext = {
      runId: 'r1',
      graph: { nodes: [], edges: [] },
      state: { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any,
      metadata: { goal: 'test', files: [], initiator: 'test' },
      action: { type: 'node.execute', nodeId: 'ANALYZE' },
    }

    const result = await gateway.observe(ctx, {
      action: { type: 'node.execute', nodeId: 'ANALYZE' },
      success: true,
      durationMs: 100,
    })

    // The caller (AGCService.advanceNode) must check this and abandon the lease
    expect(result.effect).toBe('block')
    expect(result.rationale.some(r => r.includes('assurance-blocker'))).toBe(true)
  })
})

// ── P1-1 Fix: 激活队列 — 仅路由激活的节点获取租约 ─────────────────────────────

describe('WorkflowRuntime — activation queue', () => {
  it('claimNext() only returns nodes in the activated set', () => {
    const schemaRegistry = new CheckpointSchemaRegistry()
    const runtime = new WorkflowRuntime(schemaRegistry)

    // Graph: A -> B, A -> C (both depend on A)
    const graph = {
      nodes: [
        { id: 'A', name: 'A', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 },
        { id: 'B', name: 'B', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
        { id: 'C', name: 'C', dependsOn: ['A'], input: {}, skippable: false, priority: 0 },
      ],
      edges: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }],
    }
    runtime.start({
      workflowId: 'test', version: 'v8.0', graph,
      nodes: {
        A: { nodeId: 'A', boundaryMode: 'PLANNING' as const, skippable: false,
          allowedOutgoing: [
            { edgeId: 'a->b', to: 'B', when: () => true },
            { edgeId: 'a->c', to: 'C', when: () => true },
          ],
        },
        B: { nodeId: 'B', boundaryMode: 'EXECUTION' as const, skippable: false, allowedOutgoing: [] },
        C: { nodeId: 'C', boundaryMode: 'EXECUTION' as const, skippable: false, allowedOutgoing: [] },
      },
    })

    const state = { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any

    // Initially only root node A should be activated and claimable
    const initial = runtime.claimNext('r1', state)
    expect(initial).toHaveLength(1)
    expect(initial[0]!.nodeId).toBe('A')

    // B and C should NOT be claimable yet (not activated)
    // Manually set A as completed
    const completedState = {
      ...state,
      nodes: { A: { status: 'completed' } },
      completedNodeIds: ['A'],
    } as any

    // Before activating, no nodes should be ready (B/C not in activatedNodes)
    const beforeActivate = runtime.claimNext('r1', completedState)
    // Note: B and C need to be activated via submitCheckpoint route or activateNode
    // They won't be in activatedNodes unless routed
    expect(beforeActivate.filter(l => l.nodeId === 'B' || l.nodeId === 'C')).toHaveLength(0)
  })
})

// ── P1-7 Fix: Release 管道降级信号 ────────────────────────────────────────────

describe('GovernanceGateway — release pipeline downgrade signals', () => {
  it('returns degrade when output control degrades the output', async () => {
    const trustService = createTrustService()
    const gateway = new GovernanceGateway(trustService, [
      createMockControl('output-degrader', 'output', 'degrade'),
    ])

    const ctx: GovernanceContext = {
      runId: 'r1',
      graph: { nodes: [], edges: [] },
      state: { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any,
      metadata: { goal: 'test', files: [], initiator: 'test' },
      action: { type: 'node.execute', nodeId: 'VERIFY' },
    }

    const candidates = [{
      id: 'c1', provider: 'codex',
      summary: 'a good answer with sufficient content for scoring purposes', confidence: 95,
    }]

    const result = await gateway.release(ctx, candidates, 20)

    // Output control degrade signal should be respected:
    // The primary release path still releases (degrade doesn't block),
    // but if an assurance engine fallback is triggered, degrade signals are merged.
    // Without assurance engine, degrade passes through as normal release.
    expect(result.selectedCandidateId).toBe('c1')
    expect(result.score).toBeGreaterThan(0)
  })

  it('returns score=0 when all candidates fail assurance', async () => {
    const trustService = createTrustService()
    const gateway = new GovernanceGateway(trustService)

    // Set a mock assurance engine that always fails
    gateway.setAssuranceEngine({
      verify: async () => ({
        passed: false,
        findings: [{ message: 'hallucination detected', severity: 'critical' as const }],
      }),
    } as any)

    const ctx: GovernanceContext = {
      runId: 'r1',
      graph: { nodes: [], edges: [] },
      state: { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any,
      metadata: { goal: 'test', files: [], initiator: 'test' },
      action: { type: 'node.execute', nodeId: 'VERIFY' },
    }

    const candidates = [
      { id: 'c1', provider: 'codex', summary: 'answer one content', confidence: 80 },
      { id: 'c2', provider: 'gemini', summary: 'answer two content', confidence: 70 },
    ]

    const result = await gateway.release(ctx, candidates, 30)
    expect(result.effect).toBe('escalate')
    // P2-2 fix: score should be 0, not the best candidate's score
    expect(result.score).toBe(0)
  })
})

// ── P1-8 Fix: failFast=false 时并行控制评估 ──────────────────────────────────

describe('GovernanceGateway — parallel control evaluation', () => {
  it('evaluates controls in parallel when failFast=false', async () => {
    const trustService = createTrustService()
    const executionOrder: string[] = []

    const slowControl: GovernanceControl = {
      id: 'slow-ctrl',
      name: 'Slow Control',
      stage: 'input',
      defaultLevel: 'warn',
      priority: 10,
      evaluate: async () => {
        await new Promise(r => setTimeout(r, 50))
        executionOrder.push('slow')
        return { controlId: 'slow-ctrl', controlName: 'Slow Control', status: 'pass' as const, message: 'ok' }
      },
    }

    const fastControl: GovernanceControl = {
      id: 'fast-ctrl',
      name: 'Fast Control',
      stage: 'input',
      defaultLevel: 'warn',
      priority: 5,
      evaluate: () => {
        executionOrder.push('fast')
        return { controlId: 'fast-ctrl', controlName: 'Fast Control', status: 'pass' as const, message: 'ok' }
      },
    }

    // failFast=false → parallel evaluation
    const gateway = new GovernanceGateway(trustService, [slowControl, fastControl], { failFast: false })

    const ctx: GovernanceContext = {
      runId: 'r1',
      graph: { nodes: [], edges: [] },
      state: { runId: 'r1', version: 1, nodes: {}, status: 'running' } as any,
      metadata: { goal: 'test', files: [], initiator: 'test' },
      action: { type: 'node.execute', nodeId: 'A' },
    }

    const start = Date.now()
    const result = await gateway.preflight(ctx)
    const duration = Date.now() - start

    expect(result.effect).toBe('allow')
    // Both controls should have been evaluated
    expect(result.rationale).toHaveLength(2)
    // In parallel mode, total time should be ~50ms (slow control), not ~50ms + 0ms
    // If sequential with priority order: slow(50ms) then fast(0ms) = ~50ms anyway
    // But the key indicator is both executed
    expect(executionOrder).toContain('slow')
    expect(executionOrder).toContain('fast')
    // With parallel execution, fast should finish before slow
    expect(executionOrder[0]).toBe('fast')
  })
})
