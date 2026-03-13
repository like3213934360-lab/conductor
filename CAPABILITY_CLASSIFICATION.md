# Capability Classification

> Authoritative capability boundary for the current repository state.  
> Classification is based on the **default daemon authority runtime path**, not on whether a class, helper, builder, or test exists.

> Current baseline: acceptance audit dated 2026-03-13 (post-remediation round 2).  
> Current overall result: **整改中 — P0 治理执法已加固，P1 配置/文档/联邦待完善**.  
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
| RuntimeTelemetrySink hook surface | `runtime.ts` → `RuntimeTelemetrySink` | ✅ 通过 | Key hooks wired + `onShadowCompareDrift` / `onRecoveryDiagnostics` optional methods. |
| Daemon / MCP standalone build and smoke lanes | `package.json`, `smoke.mjs` | ✅ 通过 | Pass. |
| Release artifact export / verify chain | 6 snapshot-carrying terminal artifact types | ✅ 通过 | Policy / invariant / attestation / dossier / bundle / certification all receive `VerificationSnapshot`; `snapshotDigest` is non-empty. |
| **GovernanceGateway governance evaluation** | `runtime.ts` → `GovernanceGateway.evaluateDaemonLifecycleStage()` | ✅ 加固 | 7 个评估点全部接入 gateway；release + bootstrap preflight 强制执法；preflight/approval/resume/human-gate 已补充 verdict enforcement。 |
| **VerificationSnapshot production artifact chain** | `runtime.ts` → terminal artifact finalization | ✅ 通过 | 在终态 finalization 前冻结，注入 6 个 snapshot-carrying terminal artifacts。 |
| **proofGraphDigest / cross-artifact binding** | certification record + transparency ledger | ✅ 通过 | 基于完整终态 artifact 集计算并写入 certification record / transparency ledger。 |
| **Recovery diagnostics in default path** | `runtime.ts` → `loadState()` | ✅ 通过 | 使用 `loadRunStateWithDiagnostics()`，异常推送 timeline/telemetry。 |

## Partial Mainline / Configurable

| Capability | Status | Notes |
|-----------|--------|-------|
| Domain event v2 scaffold | ✅ 通过 | v2 fields exist, default writes remain v1. Not a correctness gap. |
| **Trust Registry + strict delegation filter** | ⚠️ 部分 | `strictTrustMode` 代码存在且 env 通路已建立 (`ANTIGRAVITY_DAEMON_STRICT_TRUST_MODE`)；**默认关闭**。需显式配置启用。 |
| **Domain-event dual-write** | ⚠️ 部分 | JSONL 持久化审计副本 (fail-open)；SQLite ledger 仍为默认权威 snapshot 来源。不是 canonical source。 |
| **Shadow compare read mode** | ⚠️ 部分 | 读模式 gate 默认 `shadow`，ledger 权威；event-derived 仅比对，未完成 primary cutover。 |

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

| Capability | Status | Positioning |
|-----------|--------|-------------|
| StateInvariantVerifier | Conformance asset | `@experimental`, not used by daemon runtime. |
| BoundedModelChecker | Conformance asset | `@experimental`, not used by daemon runtime. |

## Prohibited Stable Claims

The following must **not** be described as stable or mainline:

- CyclicDagEngine as default runtime capability
- VectorMemory as production feature
- strict trust mode as "default enabled" (it is configurable, default off)
- domain-event JSONL as "canonical source" (it is a fail-open audit copy)
- GovernanceGateway as "unique authoritative enforcement" without qualifying which stages enforce

For the current acceptance result, see [ACCEPTANCE_AUDIT_STATUS.md](ACCEPTANCE_AUDIT_STATUS.md).
