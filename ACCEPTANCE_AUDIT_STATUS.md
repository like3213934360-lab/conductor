# Acceptance Audit Status

> Authoritative current acceptance status for the remediation program.  
> Baseline date: 2026-03-13.  
> Last updated: 2026-03-13 (remediation round 3 — full P0/P1/P2 closure).

## 1. 总体验收结论

**整改完成 — P0 治理执法 + 权限校验、P1 配置通路 + 签名强化 + 网关统一、P2 账本执法 + 严格回放 全部已修复。**

已确认的工程验证结果：

- `npm test`：全量通过，466/466
- 所有修复进入默认主链

### P0 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| A1 | skip verdict 执法 — 评估在 skip 动作之前，`enforceGovernanceVerdict()` block → `continue` 拒绝跳过 | ✅ |
| A2 | `approveGate()` gateId 校验 — `activeGates` Map 追踪 3 种暂停路径（release/HITL/artifact-recheck），`approveGate` 验证 gateId 匹配，resume 清除 | ✅ |
| A3 | 运行时审批者约束 — 空 `approvedBy` 在策略评估前即被拒绝 | ✅ |
| A4 | 文档口径修正 — 本文件已同步更新，不再抢跑声称 | ✅ |

### P1 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| B1 | `strictTrustMode` + `federationFailPolicy` 用户通路 — VSCode settings → env、MCP env → daemon spawn | ✅ |
| B2 | `federationFailPolicy` 环境变量全链路 — `runtime-contract.ts` + `process-host.ts` → daemon config | ✅ |
| B3 | 制品签名默认强化 — 6 个 release-critical scope `requireSignature: true`（trace-bundle, release-attestation, invariant-report, release-dossier, release-bundle, certification-record） | ✅ |
| B4 | Bootstrap 网关统一 — `bootstrapDaemonRun` 接受 `deps.gateway` 注入，runtime 可传入统一 gateway | ✅ |

### P2 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| C2 | 透明账本写入执法 — 链完整性校验失败时 `throw Error`，拒绝追加（替代 warn-only） | ✅ |
| C3 | 严格回放模式 — `UpcastingEventStore` 接受 `strictReplayMode` 选项，启用时 upcast/malformed 错误上抛（替代 fail-open） | ✅ |

## 2. 已知架构改进方向（非阻塞项）

| 项 | 性质 | 说明 |
|----|------|------|
| Ed25519 签名 | 架构演进 | 当前 HMAC-SHA256，可升级 |
| `strictTrustMode` 默认值 | 配置策略 | 当前默认关闭，可通过策略或版本升级改变 |
| `federationFailPolicy` 默认值 | 配置策略 | 当前默认 fallback，可通过用户配置改变 |
| E2E failure-injection 测试 | 测试增强 | governance-enforcement.spec 为纯函数测试，可补充运行时集成测试 |

## 3. 修改文件清单

| 文件 | 修复项 |
|------|--------|
| `runtime.ts` | A1, A2, A3 |
| `runtime-contract.ts` | B1, B2 |
| `process-host.ts` | B1, B2 |
| `workflow-orchestrator.ts` (vscode) | B1 |
| `daemon-bridge.ts` (mcp) | B1 |
| `trust-registry.ts` | B3 |
| `run-bootstrap.ts` | B4 |
| `transparency-ledger.ts` | C2 |
| `upcasting-event-store.ts` | C3 |
| `runtime-verify.spec.ts` | B3 (test) |
| `server-manifest.spec.ts` | B3 (test) |
