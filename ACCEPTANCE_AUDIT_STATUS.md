# Acceptance Audit Status

> Authoritative current acceptance status for the remediation program.  
> Baseline date: 2026-03-14.  
> Last updated: 2026-03-14 (remediation round 5 — config bridge closure, final acceptance).

## 1. 总体验收结论

**P0/P1/P2 全部已修复并验证。**

已确认的工程验证结果：

- `npm test`：全量通过

### P0 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| A1 | skip verdict 执法 — 评估在 skip 动作之前，`enforceGovernanceVerdict()` block → `continue` 拒绝跳过 | ✅ |
| A2 | `approveGate()` gateId 校验 — `activeGates` Map + **SQLite 持久化**，daemon 重启后恢复 | ✅ |
| A3 | 运行时审批者约束 — 空 `approvedBy` 在策略前被拒绝 | ✅ |
| A4 | 文档口径修正 — 本文件保持代码事实一致 | ✅ |

### P1 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| B1 | `strictTrustMode` + `federationFailPolicy` 用户通路 — VSCode `contributes.configuration` 声明 + subprocess env → `main.ts` 读取 → `host.ts` → DaemonConfig 全链路 | ✅ |
| B2 | `federationFailPolicy` 全链路 — env → `main.ts` → `host.ts` → `DaemonConfig` → `runtime` → `RemoteWorkerDirectory` → `RemoteAwareNodeExecutor` 第 5 参数 | ✅ |
| B3 | 制品签名默认强化 — 6 个 release-critical scope `requireSignature: true` | ✅ |
| B4 | Bootstrap 网关统一 — `runtime.ts` 默认路径传入 `this.governanceGateway` 到 `bootstrapDaemonRun` | ✅ |

### P2 修复确认

| # | 修复项 | 状态 |
|---|--------|------|
| C2 | 透明账本写入执法 — 链完整性校验失败时 throw，拒绝追加 | ✅ |
| C3 | 严格回放模式 — `DaemonConfig.strictReplayMode` → `UpcastingEventStore` 构造，默认 false | ✅ |

## 2. 关于默认值的诚实说明

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `strictTrustMode` | `false` | 可通过 VSCode Settings 或 `ANTIGRAVITY_DAEMON_STRICT_TRUST_MODE=true` 环境变量启用 |
| `federationFailPolicy` | `'fallback'` | 可通过 VSCode Settings 或 `ANTIGRAVITY_DAEMON_FEDERATION_FAIL_POLICY=fail-closed` 修改 |
| `strictReplayMode` | `false` | 可通过 `DaemonConfig.strictReplayMode` 配置启用。默认 fail-open 保持后向兼容 |

## 3. 修改文件清单

| 文件 | 修复项 |
|------|--------|
| `ledger.ts` | P1-1 (migration v4 + upsert/delete/list methods) |
| `runtime.ts` | A1, A2, A3, P1-1, B4, C3 |
| `runtime-contract.ts` | B1, B2 |
| `process-host.ts` | B1, B2 |
| `workflow-orchestrator.ts` (vscode) | B1 |
| `daemon-bridge.ts` (mcp) | B1 |
| `trust-registry.ts` | B3 |
| `run-bootstrap.ts` | B4 |
| `transparency-ledger.ts` | C2 |
| `upcasting-event-store.ts` | C3 |
| `antigravity-vscode/package.json` | P1-2 |
| `gate-persistence.spec.ts` | P1-1 (test) |
| `strict-replay-mode.test.ts` | C3 (test) |
| `governance-enforcement.spec.ts` | P0 (test) |
| `config-bridge.spec.ts` | B1, B2 (test, Round 5) |
