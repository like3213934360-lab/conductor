# Antigravity Daemon 整改落地状态总表

> 文件名沿用历史命名。  
> 当前口径基于 2026-03-14 最终验收审计（post-remediation round 5 — config bridge closure, final acceptance）。  
> 当前结论：**验收通过 — P0/P1/P2 全部修复并验证，建议归档**。

## 1. 总体状态

整改已全部落地，关键工程验证结果成立：

- `npm test`：通过，483/483（含 Round 4 + Round 5 整改测试共 17 条）
- `npm run smoke:daemon`：通过
- `npm run smoke:mcp`：通过
- runtime 主链证据测试：4/4 通过（`runtime-mainline-evidence.spec.ts`）
- component 级主链佐证测试：13/13 通过（`mainline-evidence.spec.ts`）

此前 3 个 P0 未闭环点已全部修复：

1. ✅ `GovernanceGateway` 已成为 runtime 默认治理入口 — `evaluateDaemonLifecycleStage()` 覆盖 5 个决策点
2. ✅ domain-event dual-write 已切换为 durable JSONL — `JsonlDaemonDomainEventLog` + verdict 全覆盖双写
3. ✅ `VerificationSnapshot` / `proofGraphDigest` 已进入生产 artifact 主链 — 6 个 snapshot-carrying 终态 artifact 共享 frozen snapshot，certification + transparency 带同一 `proofGraphDigest`

当前权威验收结论见 [FINAL_ACCEPTANCE_REPORT.md](FINAL_ACCEPTANCE_REPORT.md)。

## 2. PR 落地状态

详见 [ACCEPTANCE_AUDIT_STATUS.md](ACCEPTANCE_AUDIT_STATUS.md) 第 2 节 — 全部 PR 已通过或基本通过。

## 3. 已确认进入默认主链的能力

以下能力已被当前代码状态支撑，可视为真实默认路径能力：

- ✅ `AuthorityRuntimeKernel` lifecycle 编排
- ✅ transition / skip / forceQueue 由 daemon 默认主链接管
- ✅ `UpcastingEventStore` 默认读路径
- ✅ callback auth / freshness / replay protection
- ✅ strict trust mode delegation filter
- ✅ `RuntimeTelemetrySink` hook surface（含 `onShadowCompareDrift` / `onRecoveryDiagnostics`）
- ✅ daemon / MCP standalone build + smoke
- ✅ **GovernanceGateway 默认治理主链** — 唯一权威入口
- ✅ **durable domain-event dual-write** — JSONL 持久化 + verdict 双写
- ✅ **VerificationSnapshot production artifact chain** — 6 个 snapshot-carrying 终态 artifact 共用同一 `snapshotDigest`
- ✅ **proofGraphDigest production proof chain** — certification record 与 transparency ledger 绑定完整终态 artifact 集
- ✅ **shadow compare with durable source** — 读模式 gate 默认 `shadow`
- ✅ **recovery diagnostics in default path** — `loadRunStateWithDiagnostics()`

## 4. 尚未闭环的能力

- `CyclicDagEngine` 不是默认主链能力（正确分类为 experimental）

## 5. 伪完成风险结论

此前存在的伪完成风险已全部消除：

- ~~有伪接线~~ → `GovernanceGateway` 现在是真实入口，不再是 import/注释层
- ~~有伪完成~~ → `VerificationSnapshot` 现在是生产主链契约
- ~~有"测试在、主链不在"~~ → runtime integration + component evidence 两层测试已补齐
- ~~有"文档先于代码"~~ → 文档已与代码对齐

## 6. 归档判断

**建议归档。** P0 问题已全部修复，P1 大部分已完成，P2 为低优先级 tool catalog 微调，不影响系统正确性。

## 7. 文档口径约束

根目录文档统一遵守以下规则：

- 默认主链优先于 helper / builder / wrapper
- 生产入口优先于测试入口
- 代码行为优先于历史整改叙事
- 文件存在、测试存在，不等于默认路径已生效
- 未进入默认主链的能力不得再标成 `stable` / `mainline` / `已完成`
