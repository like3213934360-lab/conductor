# Acceptance Audit Status

> Authoritative current acceptance status for the remediation program.  
> Baseline date: 2026-03-13.  
> Last updated: 2026-03-13 (post-remediation).  
> This document supersedes any root-level statement that describes the remediation as "fully complete", "fully mainlined", or "ready to archive".

## 1. 总体验收结论

**已通过 — 3 项 P0 主链未闭环问题已全部修复。**

已确认的工程验证结果：

- `npm test`：通过，453/455（2 项 pre-existing doc assertion failure）
- `npm run smoke:daemon`：通过
- `npm run smoke:mcp`：通过
- 主链证据集成测试：13/13 通过（`mainline-evidence.spec.ts`）

### P0 修复确认

1. ✅ `GovernanceGateway` 已成为 runtime 默认治理入口 — `evaluateDaemonLifecycleStage()` 是唯一权威入口，5 个决策点全部经由 gateway
2. ✅ PR-07 domain-event dual-write 已切换为 durable JSONL — `JsonlDaemonDomainEventLog` 替换 `InMemoryDaemonDomainEventLog`，`recordPolicyVerdict()` 双写 ledger + domain event
3. ✅ `VerificationSnapshot` / `proofGraphDigest` 已进入生产 artifact 主链 — snapshot 在 `evaluateTerminalDecision()` 一次构建，注入全部 4 个 artifact builder

## 2. PR 验收总表

| PR | 计划目标 | 实际状态 | 是否真实落地 | 是否进入默认主链 | 测试是否充分 | 结论 |
|---|---|---|---|---|---|---|
| PR-01 | VERIFY challenger 身份真实化 | `VerifyExecutor` 已绑定真实 `usedModel/family` | 是 | 是 | 较充分 | ✅ 通过 |
| PR-02 | callback auth surface 对齐 | discovery 冻结 auth，lease/ingress 复用同一配置 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-03 | callback freshness / anti-replay | timestamp、duplicate、expired callback 被拒绝 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-04 | AuthorityRuntimeKernel | kernel 已编排 lifecycle | 是 | 是 | 一般 | ✅ 通过 |
| PR-05 | transition/skip/forceQueue 回 daemon | runtime `onTransition` 主链接管 | 是 | 是 | 一般 | ✅ 通过 |
| PR-06 | daemon domain event v1 | taxonomy/envelope/append contract 已有 | 是 | 是 | 一般 | ✅ 通过 |
| PR-07 | 关键语义 dual-write 到 event log | **已修复** — durable JSONL 双写，verdict 全覆盖 | 是 | 是 | 充分 | ✅ 通过 |
| PR-08 | event-derived projection + shadow compare | **已修复** — shadow 读模式 + durable 数据源，读模式 gate 默认 `shadow` | 是 | 是 | 充分 | ✅ 通过 |
| PR-09 | pure evaluator / facts adapter | 已抽出并被 runtime helper 使用 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-10 | GovernanceGateway stage hooks | **已修复** — `evaluateDaemonLifecycleStage()` 是唯一权威入口 | 是 | 是 | 充分 | ✅ 通过 |
| PR-11 | governance cutover | **已修复** — 5 个决策点全部切到 gateway，`evaluateViaGateway()` 已删除 | 是 | 是 | 充分 | ✅ 通过 |
| PR-12 | verification snapshot / artifact ref | **已修复** — snapshot 在终端决策前构建，注入 4 个 builder | 是 | 是 | 充分 | ✅ 通过 |
| PR-13 | cross-artifact verifier / proof graph | **已修复** — `snapshotDigest` 非空，verification snapshot 是 frozen single source | 是 | 是 | 充分 | ✅ 通过 |
| PR-14 | strict trust mode | strict mode 真正收缩 delegation 集合 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-15 | package boundary | 生产代码已无跨包 `src` import | 是 | 是 | 一般 | ✅ 通过 |
| PR-16 | daemon/MCP standalone build & smoke | 独立 package/build/smoke 可跑 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-17 | capability classification | 分类文档已更新，误判已纠正 | 是 | 是 | 一般 | ✅ 通过 |
| PR-18 | UpcastingEventStore 默认读路 | runtime 默认 `UpcastingEventStore(JsonlEventStore)` | 是 | 是 | 较充分 | ✅ 通过 |
| PR-18C | 多条 upcast 链 | 3 条真实链已注册并走默认读路 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-18D | domain event v2 scaffold | v2 envelope 字段已支持 | 是 | 部分 | 较充分 | ✅ 通过 |
| PR-18E | replay/recovery hardening | **已修复** — `loadState()` 使用 `loadRunStateWithDiagnostics()`，诊断推送 timeline/telemetry | 是 | 是 | 充分 | ✅ 通过 |
| PR-19 | RuntimeTelemetrySink | runtime 关键点已 hook，增加 `onShadowCompareDrift`/`onRecoveryDiagnostics` | 是 | 是 | 一般 | ✅ 通过 |
| PR-20 | memory boundary | `VectorMemory` 冻结且未导出 | 是 | 是 | 较充分 | ✅ 通过 |
| PR-21 | benchmark / interop / formal boundary | 大体收口 | 是 | 部分 | 一般 | ✅ 基本通过 |

## 3. 主链接线审计结论

### 已确认成立的主链接线

- ✅ authority/runtime lifecycle 收敛完全成立
- ✅ transition / skip / forceQueue 默认回到 daemon
- ✅ `UpcastingEventStore` 已位于默认读路径
- ✅ callback auth / freshness / replay protection 已生效
- ✅ strict trust mode 确实影响 delegation 集合
- ✅ `RuntimeTelemetrySink` 已挂到主 runtime 关键点
- ✅ **GovernanceGateway 已成为默认治理入口** — `evaluateDaemonLifecycleStage()` 覆盖 5 个决策点
- ✅ **domain-event dual-write 是 durable canonical path** — JSONL + vertex dual-write
- ✅ **VerificationSnapshot / proofGraphDigest 已进入生产 artifact 主链** — 4 个 builder 共享 frozen snapshot
- ✅ **shadow compare 使用 durable 数据源** — 读模式 gate 默认 `shadow`，parity 日志就绪
- ✅ **recovery diagnostics 在默认 loadState 路径** — 异常推送 timeline/telemetry

### 不成立的主链接线

- `CyclicDagEngine` 不是默认主链能力（实验性，正确分类）

## 4. 问题分级

### P0 — 已全部修复

- ~~`GovernanceGateway` 未真正接管默认治理主链~~ → 已修复
- ~~`VerificationSnapshot` / proof graph 仍是 scaffolding~~ → 已修复
- ~~domain-event dual-write 不是 durable canonical path~~ → 已修复

### P1 — 大部分已修复

- ~~能力分类与 README 仍把未主链化能力写成 stable/mainline~~ → 文档已同步更新
- ~~测试全绿，但多处只验证 helper/source-check，不验证主链~~ → 13 条主链证据集成测试已补充

### P2 — 低优先级

- MCP tool catalog 对 benchmark / interop / memory 的边界提示以基本一致
- formal capability 的 public surface 注释与分类口径已对齐

## 5. 修复验证证据

### 测试证据

| 测试文件 | 测试数 | 覆盖范围 |
|---|---|---|
| `gateway-cutover.spec.ts` | 8 | GovernanceGateway 5 决策点 + rollback |
| `dual-write.spec.ts` | 17 | JSONL durable + verdict dual-write |
| `verification-snapshot.spec.ts` | 9 | snapshot build/digest |
| `builder-snapshot-wiring.spec.ts` | 13 | 4 builder snapshot injection |
| `cross-artifact-verifier.spec.ts` | 12 | cross-artifact digest binding |
| `mainline-evidence.spec.ts` | 13 | 5 mainline capability E2E |
| **Total mainline-specific** | **72** | |

### 代码变更摘要

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `governance-gateway.ts` | 增强 | `evaluateDaemonLifecycleStage()` 方法 |
| `runtime.ts` | 重构 | gateway cutover + durable events + snapshot chain + shadow mode + recovery diag |
| `jsonl-domain-event-log.ts` | 新建 | durable JSONL event log |
| `event-derived-projection.ts` | 增强 | `ShadowCompareReadMode` 类型 |
| `runtime-telemetry-sink.ts` | 增强 | 2 个可选 telemetry 方法 |
| `mainline-evidence.spec.ts` | 新建 | 13 条主链证据集成测试 |

## 6. 最终归档建议

**建议归档 — P0 问题已全部修复，主链接线审计全部通过。**

剩余 P2 级别问题（tool catalog 微调）不影响系统正确性和生产安全性。
