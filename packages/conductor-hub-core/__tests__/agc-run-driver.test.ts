import { describe, expect, it } from 'vitest'
import { evaluateTransition } from '../src/agc-run-driver.js'
import { ParallelExecutor } from '../src/node-executor.js'

describe('ParallelExecutor', () => {
  it('emits dual-model receipts and disables skipping', async () => {
    const executor = new ParallelExecutor()
    const result = await executor.execute({
      runId: 'run-1',
      graph: { nodes: [], edges: [] },
      state: { capturedContext: { metadata: { goal: 'audit this repo' } } } as any,
      nodeId: 'PARALLEL',
      attempt: 0,
      signal: AbortSignal.none,
      hub: {
        codexTask: async () => JSON.stringify({ summary: 'codex answer', confidence: 91, option_id: 'A' }),
        geminiTask: async () => JSON.stringify({ summary: 'gemini answer', confidence: 88, option_id: 'B' }),
      } as any,
      getUpstreamOutput: () => ({ task_type: 'review' }),
    })

    expect(result.output.execution_mode).toBe('dual_model_parallel')
    expect(result.output.skip_allowed).toBe(false)
    expect(result.output.both_available).toBe(true)

    const codex = result.output.codex as Record<string, unknown>
    const gemini = result.output.gemini as Record<string, unknown>
    expect(codex.provider).toBe('codex')
    expect(gemini.provider).toBe('gemini')
    expect(codex.status).toBe('success')
    expect(gemini.status).toBe('success')
    expect(codex.task_id).not.toBe(gemini.task_id)
    expect(typeof codex.output_hash).toBe('string')
    expect(typeof gemini.output_hash).toBe('string')
  })
})

describe('evaluateTransition', () => {
  it('does not fast-track after PARALLEL even when outputs align', () => {
    const transition = evaluateTransition('PARALLEL', {
      execution_mode: 'dual_model_parallel',
      both_available: true,
      dr_value: 0,
      skip_allowed: false,
      codex: { confidence: 99 },
      gemini: { confidence: 99 },
    }, { nodes: {} } as any)

    expect(transition.skipNodes).toHaveLength(0)
    expect(transition.forceQueue).toHaveLength(0)
  })

  it('keeps VERIFY mandatory after DEBATE', () => {
    const transition = evaluateTransition('DEBATE', {
      debate_rounds: 2,
      convergence_score: 0.9,
    }, { nodes: {} } as any)

    expect(transition.skipNodes).toHaveLength(0)
  })
})
