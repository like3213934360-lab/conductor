import { describe, expect, it } from 'vitest'
import { evaluateTransition } from '../src/workflow-run-driver.js'
import { DebateExecutor, ParallelExecutor } from '../src/node-executor.js'

describe('ParallelExecutor', () => {
  it('emits dual-model receipts and disables skipping', async () => {
    const executor = new ParallelExecutor()
    const result = await executor.execute({
      runId: 'run-1',
      graph: { nodes: [], edges: [] },
      state: { capturedContext: { metadata: { goal: 'audit this repo' } } } as any,
      nodeId: 'PARALLEL',
      attempt: 0,
      lease: {
        leaseId: 'lease-1',
        runId: 'run-1',
        nodeId: 'PARALLEL',
        attempt: 0,
        issuedAt: '2026-03-12T00:00:00.000Z',
        expiresAt: '2026-03-12T00:05:00.000Z',
        authorityOwner: 'antigravity-daemon',
        requiredEvidence: ['analysis-receipt', 'parallel-receipts'],
        allowedModelPool: ['codex', 'gemini'],
      },
      signal: AbortSignal.none,
      agentRuntime: {
        codexTask: async () => JSON.stringify({ summary: 'codex answer', confidence: 91, optionId: 'A' }),
        geminiTask: async () => JSON.stringify({ summary: 'gemini answer', confidence: 88, optionId: 'B' }),
      } as any,
      getUpstreamOutput: () => ({ taskType: 'review' }),
    })

    expect(result.output.executionMode).toBe('dual_model_parallel')
    expect(result.output.skipAllowed).toBe(false)
    expect(result.output.bothAvailable).toBe(true)

    const codex = result.output.codex as Record<string, unknown>
    const gemini = result.output.gemini as Record<string, unknown>
    expect(codex.modelId).toBe('codex')
    expect(gemini.modelId).toBe('gemini')
    expect(codex.status).toBe('success')
    expect(gemini.status).toBe('success')
    expect(codex.taskId).not.toBe(gemini.taskId)
    expect(typeof codex.outputHash).toBe('string')
    expect(typeof gemini.outputHash).toBe('string')
  })

  it('applies compensation when first parallel attempt is overly similar', async () => {
    let invocation = 0
    const executor = new ParallelExecutor()
    const result = await executor.execute({
      runId: 'run-2',
      graph: { nodes: [], edges: [] },
      state: { capturedContext: { metadata: { goal: 'audit this repo' } } } as any,
      nodeId: 'PARALLEL',
      attempt: 0,
      lease: {
        leaseId: 'lease-2',
        runId: 'run-2',
        nodeId: 'PARALLEL',
        attempt: 0,
        issuedAt: '2026-03-12T00:00:00.000Z',
        expiresAt: '2026-03-12T00:05:00.000Z',
        authorityOwner: 'antigravity-daemon',
        requiredEvidence: ['analysis-receipt', 'parallel-receipts'],
        allowedModelPool: ['codex', 'gemini'],
      },
      signal: AbortSignal.none,
      agentRuntime: {
        codexTask: async () => {
          invocation++
          return JSON.stringify({ summary: invocation <= 2 ? 'same summary' : 'codex alternate answer', confidence: 91, optionId: invocation <= 2 ? 'A' : 'B' })
        },
        geminiTask: async () => JSON.stringify({ summary: invocation <= 2 ? 'same summary' : 'gemini alternate answer', confidence: 88, optionId: invocation <= 2 ? 'A' : 'C' }),
      } as any,
      getUpstreamOutput: () => ({ taskType: 'review' }),
    })

    expect(result.output.compensationApplied).toBe(true)
    expect((result.output.compensationAttempts as Array<unknown>).length).toBeGreaterThan(0)
    expect(result.output.summarySimilarity).toBeLessThan(0.9)
  })
})

describe('DebateExecutor', () => {
  it('runs adaptive rounds until stability is achieved', async () => {
    let round = 0
    const executor = new DebateExecutor()
    const result = await executor.execute({
      runId: 'run-debate-1',
      graph: { nodes: [], edges: [] },
      state: { capturedContext: { metadata: { goal: 'compare implementations' } } } as any,
      nodeId: 'DEBATE',
      attempt: 0,
      lease: {
        leaseId: 'lease-debate-1',
        runId: 'run-debate-1',
        nodeId: 'DEBATE',
        attempt: 0,
        issuedAt: '2026-03-12T00:00:00.000Z',
        expiresAt: '2026-03-12T00:05:00.000Z',
        authorityOwner: 'antigravity-daemon',
        requiredEvidence: ['parallel-receipts', 'judge-signal'],
        allowedModelPool: ['judge'],
      },
      signal: AbortSignal.none,
      agentRuntime: {
        consensus: async () => {
          round += 1
          return round === 1
            ? { judgeText: 'First round summary with some instability.', judgeModel: 'judge-1', candidates: [{ label: 'CODEX', text: 'A' }], totalMs: 10 }
            : { judgeText: 'First round summary with some instability.', judgeModel: 'judge-1', candidates: [{ label: 'CODEX', text: 'A' }], totalMs: 10 }
        },
      } as any,
      getUpstreamOutput: (id: string) => id === 'PARALLEL'
        ? {
            codex: { summary: 'Codex plan', optionId: 'CODEX' },
            gemini: { summary: 'Gemini plan', optionId: 'GEMINI' },
          }
        : undefined,
    })

    expect(result.output.debateRounds).toBeGreaterThanOrEqual(2)
    expect(result.output.stabilityAchieved).toBe(true)
    expect(result.output.compensationRequested).toBe(false)
  })
})

describe('evaluateTransition', () => {
  it('does not skip DEBATE for strict-full runs even when outputs align', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0,
      skipAllowed: false,
      codex: { confidence: 99 },
      gemini: { confidence: 99 },
    }, {
      nodes: {},
      capturedContext: {
        graph: {
          nodes: [{ id: 'DEBATE', name: 'DEBATE', dependsOn: ['PARALLEL'], input: {}, skippable: false, priority: 0 }],
          edges: [],
        },
      },
    } as any)

    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  it('policy-skips DEBATE for adaptive runs when parallel consensus is strong', () => {
    const transition = evaluateTransition('PARALLEL', {
      executionMode: 'dual_model_parallel',
      bothAvailable: true,
      disagreementScore: 0,
      skipAllowed: false,
      codex: { confidence: 96 },
      gemini: { confidence: 94 },
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

  it('keeps VERIFY mandatory after DEBATE', () => {
    const transition = evaluateTransition('DEBATE', {
      debateRounds: 2,
      convergenceScore: 0.9,
    }, { nodes: {} } as any)

    expect(transition.skipNodes).toHaveLength(0)
  })
})
