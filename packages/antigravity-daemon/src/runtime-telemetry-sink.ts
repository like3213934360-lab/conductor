/**
 * PR-19: RuntimeTelemetrySink — unified observability interface for daemon mainline.
 *
 * Provides a single pluggable surface for runtime lifecycle, node execution,
 * remote delegation, and recovery telemetry. Default: NoOp (zero overhead).
 *
 * This is a *supplementary* sink — it does NOT replace appendTimeline or
 * the existing ledger. It provides a clean hook for future OTel / external
 * tracing backends.
 */

// ─── Sink Interface ──────────────────────────────────────────────────────────

export interface RuntimeTelemetrySink {
  /** Run started (after bootstrap, before first node) */
  onRunStarted(runId: string, meta: { goal: string; nodeCount: number }): void
  /** Run reached terminal state */
  onRunCompleted(runId: string, meta: { status: string; durationMs?: number }): void
  /** Node execution began */
  onNodeStarted(runId: string, nodeId: string, meta: { model?: string; attempt: number }): void
  /** Node execution succeeded */
  onNodeCompleted(runId: string, nodeId: string, meta: { durationMs?: number; degraded?: boolean }): void
  /** Node execution failed */
  onNodeFailed(runId: string, nodeId: string, meta: { error: string }): void
  /** Remote worker callback received */
  onRemoteCallback(runId: string, meta: { workerId: string; nodeId?: string }): void
  /** Run recovered from incomplete state */
  onRecovery(runId: string, meta: { recoveredNodes: number }): void
  /** PR-08E: Shadow compare detected projection drift */
  onShadowCompareDrift?(runId: string, meta: { readMode: string; mismatchCount: number }): void
  /** PR-18E: Recovery diagnostics detected replay anomalies */
  onRecoveryDiagnostics?(runId: string, meta: { eventCount: number; upcastErrorCount: number; unknownTypeCount: number; emptyStream: boolean; eventTypes: string[] }): void
}

// ─── NoOp Default ────────────────────────────────────────────────────────────

/** Default sink — all methods are no-ops. Zero overhead when telemetry is not configured. */
export class NoOpTelemetrySink implements RuntimeTelemetrySink {
  onRunStarted(): void {}
  onRunCompleted(): void {}
  onNodeStarted(): void {}
  onNodeCompleted(): void {}
  onNodeFailed(): void {}
  onRemoteCallback(): void {}
  onRecovery(): void {}
}
