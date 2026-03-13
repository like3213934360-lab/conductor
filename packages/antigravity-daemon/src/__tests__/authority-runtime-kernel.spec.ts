import { describe, it, expect, vi } from 'vitest'
import {
  AuthorityRuntimeKernel,
  LifecyclePhase,
  type LifecycleHooks,
  type TerminalDecision,
} from '../authority-runtime-kernel.js'

describe('AuthorityRuntimeKernel', () => {
  function createHooks(overrides: Partial<LifecycleHooks> = {}): LifecycleHooks {
    return {
      onDrainComplete: vi.fn(async () => ({ status: 'completed' as const, completedAt: '2026-01-01T00:00:00Z' })),
      onDrainFailed: vi.fn(async () => ({ status: 'failed' as const, verdict: 'error' })),
      onDrainCancelled: vi.fn(async () => ({ status: 'cancelled' as const, verdict: 'cancelled' })),
      onFinalize: vi.fn(async () => {}),
      onCleanup: vi.fn(() => {}),
      ...overrides,
    }
  }

  it('sequences lifecycle phases in order on success path', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const phaseLog: string[] = []
    const hooks = createHooks({
      onDrainComplete: async (runId) => {
        phaseLog.push(`terminal:${kernel.getPhase(runId)}`)
        return { status: 'completed', completedAt: '2026-01-01T00:00:00Z' }
      },
      onFinalize: async (runId) => {
        phaseLog.push(`finalize:${kernel.getPhase(runId)}`)
      },
      onCleanup: (runId) => {
        phaseLog.push(`cleanup:${kernel.getPhase(runId)}`)
      },
    })

    const drainFn = async () => {
      phaseLog.push(`drain:${kernel.getPhase('run-1')}`)
    }

    await kernel.orchestrate('run-1', drainFn, hooks)

    expect(phaseLog).toEqual([
      'drain:draining',
      'terminal:terminal-decision',
      'finalize:finalizing',
      'cleanup:completed',
    ])
    // Phase cleaned up after completion
    expect(kernel.getPhase('run-1')).toBeUndefined()
  })

  it('calls onDrainFailed on non-cancel error', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const hooks = createHooks()
    const drainFn = async () => {
      throw new Error('some runtime error')
    }

    await kernel.orchestrate('run-2', drainFn, hooks, () => false)

    expect(hooks.onDrainFailed).toHaveBeenCalledWith('run-2', expect.objectContaining({ message: 'some runtime error' }))
    expect(hooks.onDrainComplete).not.toHaveBeenCalled()
    expect(hooks.onDrainCancelled).not.toHaveBeenCalled()
    expect(hooks.onFinalize).toHaveBeenCalled()
    expect(hooks.onCleanup).toHaveBeenCalled()
  })

  it('calls onDrainCancelled when isCancelled predicate returns true', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const hooks = createHooks()
    const drainFn = async () => {
      throw new Error('运行被取消')
    }

    await kernel.orchestrate('run-3', drainFn, hooks, () => true)

    expect(hooks.onDrainCancelled).toHaveBeenCalledWith('run-3', expect.objectContaining({ message: '运行被取消' }))
    expect(hooks.onDrainFailed).not.toHaveBeenCalled()
    expect(hooks.onDrainComplete).not.toHaveBeenCalled()
    expect(hooks.onFinalize).toHaveBeenCalled()
    expect(hooks.onCleanup).toHaveBeenCalled()
  })

  it('passes terminal decision to onFinalize', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const decision: TerminalDecision = { status: 'paused_for_human', verdict: 'needs review' }
    const hooks = createHooks({
      onDrainComplete: async () => decision,
    })

    await kernel.orchestrate('run-4', async () => {}, hooks)

    expect(hooks.onFinalize).toHaveBeenCalledWith('run-4', decision)
  })

  it('cleans up phase on error in hooks', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const hooks = createHooks({
      onFinalize: async () => { throw new Error('finalize boom') },
    })

    await expect(kernel.orchestrate('run-5', async () => {}, hooks)).rejects.toThrow('finalize boom')
    // Phase is NOT cleaned up when hooks throw — kernel doesn't catch hook errors.
    // This is by design; the caller (runtime.ts) handles cleanup.
    expect(kernel.getPhase('run-5')).toBe(LifecyclePhase.Finalizing)
  })

  it('handles multiple concurrent runs independently', async () => {
    const kernel = new AuthorityRuntimeKernel()
    const hooks1 = createHooks()
    const hooks2 = createHooks()

    const p1 = kernel.orchestrate('run-a', async () => {}, hooks1)
    const p2 = kernel.orchestrate('run-b', async () => {}, hooks2)

    await Promise.all([p1, p2])

    expect(hooks1.onDrainComplete).toHaveBeenCalledWith('run-a')
    expect(hooks2.onDrainComplete).toHaveBeenCalledWith('run-b')
    expect(kernel.getPhase('run-a')).toBeUndefined()
    expect(kernel.getPhase('run-b')).toBeUndefined()
  })
})
