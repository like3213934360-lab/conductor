import { describe, expect, it } from 'vitest'
import {
  NoOpTelemetrySink,
  type RuntimeTelemetrySink,
} from '../runtime-telemetry-sink.js'

/**
 * PR-19: RuntimeTelemetrySink smoke tests.
 *
 * Verifies:
 * 1. NoOpTelemetrySink has all methods and doesn't throw
 * 2. Recording sink captures calls correctly
 * 3. Interface contract is stable
 */
describe('PR-19: RuntimeTelemetrySink', () => {
  // ─── NoOp doesn't throw ─────────────────────────────────────────────

  it('NoOpTelemetrySink implements all methods without throwing', () => {
    const sink = new NoOpTelemetrySink()
    expect(() => {
      sink.onRunStarted('run-1', { goal: 'test', nodeCount: 3 })
      sink.onRunCompleted('run-1', { status: 'completed', durationMs: 1000 })
      sink.onNodeStarted('run-1', 'A', { model: 'codex', attempt: 1 })
      sink.onNodeCompleted('run-1', 'A', { durationMs: 500, degraded: false })
      sink.onNodeFailed('run-1', 'B', { error: 'timeout' })
      sink.onRemoteCallback('run-1', { workerId: 'w-1', nodeId: 'A' })
      sink.onRecovery('run-1', { recoveredNodes: 2 })
    }).not.toThrow()
  })

  // ─── Recording sink captures calls ──────────────────────────────────

  it('recording sink captures hook calls in order', () => {
    const calls: Array<{ method: string; args: unknown[] }> = []

    const recordingSink: RuntimeTelemetrySink = {
      onRunStarted(...args) { calls.push({ method: 'onRunStarted', args }) },
      onRunCompleted(...args) { calls.push({ method: 'onRunCompleted', args }) },
      onNodeStarted(...args) { calls.push({ method: 'onNodeStarted', args }) },
      onNodeCompleted(...args) { calls.push({ method: 'onNodeCompleted', args }) },
      onNodeFailed(...args) { calls.push({ method: 'onNodeFailed', args }) },
      onRemoteCallback(...args) { calls.push({ method: 'onRemoteCallback', args }) },
      onRecovery(...args) { calls.push({ method: 'onRecovery', args }) },
    }

    recordingSink.onRunStarted('run-1', { goal: 'test', nodeCount: 5 })
    recordingSink.onNodeStarted('run-1', 'ANALYZE', { attempt: 1 })
    recordingSink.onNodeCompleted('run-1', 'ANALYZE', { durationMs: 200 })
    recordingSink.onRunCompleted('run-1', { status: 'completed' })

    expect(calls).toHaveLength(4)
    expect(calls[0]!.method).toBe('onRunStarted')
    expect(calls[0]!.args[0]).toBe('run-1')
    expect(calls[1]!.method).toBe('onNodeStarted')
    expect(calls[2]!.method).toBe('onNodeCompleted')
    expect(calls[3]!.method).toBe('onRunCompleted')
  })

  // ─── Interface contract ─────────────────────────────────────────────

  it('NoOpTelemetrySink satisfies RuntimeTelemetrySink', () => {
    const sink: RuntimeTelemetrySink = new NoOpTelemetrySink()
    expect(typeof sink.onRunStarted).toBe('function')
    expect(typeof sink.onRunCompleted).toBe('function')
    expect(typeof sink.onNodeStarted).toBe('function')
    expect(typeof sink.onNodeCompleted).toBe('function')
    expect(typeof sink.onNodeFailed).toBe('function')
    expect(typeof sink.onRemoteCallback).toBe('function')
    expect(typeof sink.onRecovery).toBe('function')
  })

  it('all 7 methods are present on NoOpTelemetrySink', () => {
    const sink = new NoOpTelemetrySink()
    const methods = ['onRunStarted', 'onRunCompleted', 'onNodeStarted',
      'onNodeCompleted', 'onNodeFailed', 'onRemoteCallback', 'onRecovery']
    for (const method of methods) {
      expect(typeof (sink as any)[method]).toBe('function')
    }
  })
})
