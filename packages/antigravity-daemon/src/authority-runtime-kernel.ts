/**
 * PR-04: AuthorityRuntimeKernel — lifecycle coordinator for daemon authority runs.
 *
 * Defines lifecycle phases and hooks so that runtime.ts delegates lifecycle
 * orchestration to a single coordinator instead of scattering lifecycle logic
 * inline across startRun / resumeInterruptedRun / drainRun.
 *
 * The kernel does NOT own transition/skip authority (PR-05) or domain events (PR-06).
 * It is purely a lifecycle phase sequencer.
 */

// ── Lifecycle Phase ─────────────────────────────────────────────────────────

/**
 * Lifecycle phases of a daemon authority run.
 *
 * bootstrap → draining → terminal-decision → finalizing → completed
 *
 * On error/cancel: draining → terminal-decision (with error/cancel status).
 */
export enum LifecyclePhase {
  /** Run context initialized, preflight checks passed, drain not yet started */
  Bootstrap = 'bootstrap',
  /** WorkflowRunDriver.drain() is executing (execution pump active) */
  Draining = 'draining',
  /** Drain finished — evaluating release gate, human gate, or handling error/cancel */
  TerminalDecision = 'terminal-decision',
  /** Terminal status decided — finalizing artifacts, recording memory */
  Finalizing = 'finalizing',
  /** Run fully completed, activeRuns entry cleaned up */
  Completed = 'completed',
}

// ── Terminal Decision ───────────────────────────────────────────────────────

export type TerminalStatus = 'completed' | 'paused_for_human' | 'cancelled' | 'failed'

export interface TerminalDecision {
  status: TerminalStatus
  verdict?: string
  completedAt?: string
}

// ── Lifecycle Hooks ─────────────────────────────────────────────────────────

/**
 * Hooks that the runtime provides to the kernel.
 *
 * Each hook is a phase boundary callback. The kernel calls them in sequence
 * and manages phase transitions. The runtime implements the actual logic.
 */
export interface LifecycleHooks {
  /**
   * Called after drain completes successfully.
   * Runtime should evaluate release gate / human gate and return a terminal decision.
   */
  onDrainComplete(runId: string): Promise<TerminalDecision>

  /**
   * Called when drain fails with an error (non-cancel).
   * Runtime should record the failure and return a terminal decision.
   */
  onDrainFailed(runId: string, error: Error): Promise<TerminalDecision>

  /**
   * Called when drain is aborted (cancel).
   * Runtime should record the cancellation and return a terminal decision.
   */
  onDrainCancelled(runId: string, error: Error): Promise<TerminalDecision>

  /**
   * Called after terminal decision is made. Runtime should finalize all artifacts.
   */
  onFinalize(runId: string, decision: TerminalDecision): Promise<void>

  /**
   * Called last — runtime should clean up activeRuns entry etc.
   */
  onCleanup(runId: string): void
}

// ── Kernel ───────────────────────────────────────────────────────────────────

/**
 * AuthorityRuntimeKernel — single lifecycle coordinator.
 *
 * Usage:
 *   const kernel = new AuthorityRuntimeKernel()
 *   // In startRun / resumeInterruptedRun:
 *   context.drainPromise = kernel.orchestrate(runId, drainFn, hooks)
 *
 * The kernel:
 * 1. Calls drainFn → phase = Draining
 * 2. On success: hooks.onDrainComplete → phase = TerminalDecision
 * 3. On cancel: hooks.onDrainCancelled → phase = TerminalDecision
 * 4. On error: hooks.onDrainFailed → phase = TerminalDecision
 * 5. hooks.onFinalize(decision) → phase = Finalizing
 * 6. hooks.onCleanup → phase = Completed
 */
export class AuthorityRuntimeKernel {
  /** Current phase, keyed by runId. Exposed for observability / testing. */
  private readonly phases = new Map<string, LifecyclePhase>()

  getPhase(runId: string): LifecyclePhase | undefined {
    return this.phases.get(runId)
  }

  /**
   * Orchestrate a full lifecycle for a single run.
   *
   * @param runId - The run being orchestrated.
   * @param drainFn - The execution pump function (calls driver.drain + node hooks).
   * @param hooks - Lifecycle phase boundary hooks.
   */
  async orchestrate(
    runId: string,
    drainFn: () => Promise<void>,
    hooks: LifecycleHooks,
    /** Predicate to distinguish cancellation from failure. Runtime passes () => controller.signal.aborted. */
    isCancelled: () => boolean = () => false,
  ): Promise<void> {
    let decision: TerminalDecision

    // Phase: Draining
    this.phases.set(runId, LifecyclePhase.Draining)
    try {
      await drainFn()

      // Phase: TerminalDecision (success path)
      this.phases.set(runId, LifecyclePhase.TerminalDecision)
      decision = await hooks.onDrainComplete(runId)
    } catch (error) {
      // Phase: TerminalDecision (error path)
      this.phases.set(runId, LifecyclePhase.TerminalDecision)
      const err = error instanceof Error ? error : new Error(String(error))
      if (isCancelled()) {
        decision = await hooks.onDrainCancelled(runId, err)
      } else {
        decision = await hooks.onDrainFailed(runId, err)
      }
    }

    // Phase: Finalizing
    this.phases.set(runId, LifecyclePhase.Finalizing)
    await hooks.onFinalize(runId, decision)

    // Phase: Completed
    this.phases.set(runId, LifecyclePhase.Completed)
    hooks.onCleanup(runId)
    this.phases.delete(runId)
  }
}
