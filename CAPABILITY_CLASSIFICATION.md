# Capability Classification

> Authoritative capability boundary for the current repository state.  
> Classification is based on the **default daemon authority runtime path**, not on whether a class, helper, builder, or test exists.

> Current baseline: acceptance audit dated 2026-03-13 (post-remediation).  
> Current overall result: **已通过 — P0 主链未闭环问题已全部修复**.  
> Stable means "on the default mainline and affecting real runtime behavior".  
> Anything not meeting that bar is explicitly marked as `experimental`, `diagnostics-only`, `scaffolding`, or `not-mainline`.

## Stable / Default Mainline

These capabilities are on the daemon default path and form real runtime constraints today.

| Capability | Entry Point | Status | Notes |
|-----------|------------|--------|-------|
| DagEngine-based daemon runtime | `runtime.ts` → `DagEngine` | ✅ 通过 | Default runtime uses `DagEngine`. `CyclicDagEngine` is not the default engine. |
| AuthorityRuntimeKernel lifecycle orchestration | `runtime.ts` → `AuthorityRuntimeKernel` | ✅ 通过 | `drain -> terminal -> finalize` coordinated through kernel. |
| Daemon-owned transition / skip / forceQueue authority | `runtime.ts` → `onTransition` | ✅ 通过 | Default runtime path delegates to daemon authority. |
| JsonlEventStore + UpcastingEventStore read path | `runtime.ts` → `UpcastingEventStore(JsonlEventStore)` | ✅ 通过 | Upcasting is on the default read path. |
| Multi-chain event upcasting | `daemon-upcasting-registry.ts` | ✅ 通过 | 3 chains registered and consumed by default read path. |
| Callback auth + freshness + replay protection | `remote-worker.ts` | ✅ 通过 | Active at ingress. |
| Trust Registry + strict delegation filter | `trust-registry.ts`, `remote-worker.ts` | ✅ 通过 | `strictTrustMode` changes delegable worker set. |
| RuntimeTelemetrySink hook surface | `runtime.ts` → `RuntimeTelemetrySink` | ✅ 通过 | Key hooks wired + `onShadowCompareDrift` / `onRecoveryDiagnostics` optional methods. |
| Daemon / MCP standalone build and smoke lanes | `package.json`, `smoke.mjs` | ✅ 通过 | Pass. |
| Release artifact export / verify chain | 6 artifact types | ✅ 通过 | All builders receive `VerificationSnapshot`, `snapshotDigest` is non-empty. |
| **GovernanceGateway default governance mainline** | `runtime.ts` → `GovernanceGateway.evaluateDaemonLifecycleStage()` | ✅ 通过 | **唯一权威入口**，5 个决策点全部经由 gateway。 |
| **Durable domain event dual-write** | `runtime.ts` → `JsonlDaemonDomainEventLog` | ✅ 通过 | JSONL 持久化，`recordPolicyVerdict()` 双写 ledger + domain event。 |
| **VerificationSnapshot production artifact chain** | `runtime.ts` → `buildVerificationSnapshot()` | ✅ 通过 | 在 `evaluateTerminalDecision()` 冻结，注入 4 个 artifact builder。 |
| **proofGraphDigest / cross-artifact binding** | certification record → `snapshotDigest` | ✅ 通过 | Frozen snapshot digest 绑定全部终端 artifact。 |
| **Shadow compare with durable source** | `runtime.ts` → `refreshSnapshot()` | ✅ 通过 | 读模式 gate 默认 `shadow`，durable JSONL 数据源。 |
| **Recovery diagnostics in default path** | `runtime.ts` → `loadState()` | ✅ 通过 | 使用 `loadRunStateWithDiagnostics()`，异常推送 timeline/telemetry。 |

## Partial Mainline

| Capability | Status | Notes |
|-----------|--------|-------|
| Domain event v2 scaffold | ✅ 通过 | v2 fields exist, default writes remain v1. Not a correctness gap. |

## Experimental / Diagnostics-Only / Not-Mainline

| Capability | Status | Positioning |
|-----------|--------|-------------|
| CyclicDagEngine | Not-mainline | Exists, not default engine. Core barrel does not expose as stable. |
| Benchmark Harness | Experimental | Internal evaluation harness. Not a correctness constraint. |
| Benchmark Source Registry | Experimental | Experimental registry surface. |
| Interop Harness | Experimental | Diagnostic harness, not default authority runtime. |
| Memory Manager keyword recall | Experimental | Not injected into analyze/route/verify/policy decisions. |
| OTel / DagEngineTracer | Experimental | Not imported by daemon runtime. |

## Frozen / Not Recommended

| Capability | Status | Positioning |
|-----------|--------|-------------|
| VectorMemory | Frozen | Not exported, not imported by daemon runtime. |
| VectorMemoryLayer | Frozen | Internal to `VectorMemory`. |

## Conformance Assets / Library-Only Utilities

These capabilities remain useful as conformance assets, but not as daemon mainline runtime features.

| Capability | Status | Positioning |
|-----------|--------|-------------|
| StateInvariantVerifier | Conformance asset | `@experimental`, not used by daemon runtime. |
| BoundedModelChecker | Conformance asset | `@experimental`, not used by daemon runtime. |

## Prohibited Stable Claims

The following must **not** be described as stable or mainline:

- CyclicDagEngine as default runtime capability
- VectorMemory as production feature

> **Note**: GovernanceGateway, VerificationSnapshot, proofGraphDigest, shadow compare, and recovery diagnostics are now **confirmed mainline** as of the 2026-03-13 remediation.

For the current acceptance result, see [ACCEPTANCE_AUDIT_STATUS.md](ACCEPTANCE_AUDIT_STATUS.md).
