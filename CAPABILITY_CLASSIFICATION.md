# Capability Classification

> Authoritative reference for which capabilities are **stable** (in daemon mainline) versus **experimental** (code exists but not on default authority path).

## Stable

These capabilities are on the daemon authority runtime default path and form real correctness / governance / replay / release constraints.

| Capability | Entry Point | Constraint |
|-----------|------------|-----------|
| DAG Engine (CyclicDagEngine) | `runtime.ts` → `@anthropic/antigravity-core` | Node execution orchestration |
| Governance Gateway (GaaS) | `runtime.ts` → `GovernanceGateway` | 4 lifecycle interception points |
| Event Sourcing (JsonlEventStore) | `runtime.ts` → `@anthropic/antigravity-persistence` | Immutable event log, replay |
| Policy Engine | `runtime.ts` → `DaemonPolicyEngine` | Rule evaluation, preflight/release gates |
| Authority Runtime Kernel | `runtime.ts` → `AuthorityRuntimeKernel` | Lifecycle phase enforcement |
| Remote Worker Directory | `runtime.ts` → `RemoteWorkerDirectory` | A2A-style federation + strict trust mode |
| Trust Registry | `runtime.ts` → `TrustRegistryStore` | Signer policy, key lifecycle |
| HITL / Human Approval Gate | `runtime.ts` → `deriveHumanApprovalRequirement` | Approval gating |
| Release Artifacts + Verifiers | `runtime.ts` → artifact builders + verifiers | Attestation chain |
| Transparency Ledger + Proof Graph | `runtime.ts` → `DaemonLedger` | Tamper-evident ledger |
| Checkpoint + Snapshot | `runtime.ts` → `SqliteCheckpointStore` | Recovery, fold memoization |
| UpcastingEventStore (PR-18) | `runtime.ts` → `UpcastingEventStore` wrapping `JsonlEventStore` | Schema evolution on read path |

## Experimental

These capabilities have working code and tests but are **not** on the daemon default authority path and do **not** form correctness constraints.

| Capability | Code Location | Why Experimental |
|-----------|--------------|-----------------|
| Benchmark Harness | `daemon/benchmark-harness.ts` | Internal evaluation harness — not a correctness constraint, not an external benchmark platform |
| Benchmark Source Registry | `daemon/benchmark-source-registry.ts` | Evidence-backed dataset registry — in snapshot but not a release gate |
| Interop Harness | `daemon/interop-harness.ts` | Experimental diagnostic harness — not a correctness constraint |
| Memory Manager | `persistence/MemoryManager` | SQLite keyword recall, record-only — not in analyze/route/verify decision path |
| OTel / DagEngineTracer | `core/observability/dag-tracer.ts` | Structural tracer, no `@opentelemetry` SDK, not imported by daemon |
| Formal Verifier (StateInvariantVerifier) | `core/dag/formal-verifier.ts` | Conformance asset — in core library, not in daemon runtime path |
| Formal Verifier (BoundedModelChecker) | `core/dag/model-checker.ts` | Conformance asset — in core library, not in daemon runtime path |

## Frozen

Retained as code assets but not on any active mainline path. Not recommended for new integrations.

| Capability | Code Location | Why Frozen |
|-----------|--------------|-----------|
| VectorMemory | `persistence/memory/vector-memory.ts` | Code exists, not exported from barrel, not imported by daemon runtime |
| VectorMemoryLayer | `persistence/memory/vector-memory.ts` | Internal to VectorMemory, no embedding provider wired |
