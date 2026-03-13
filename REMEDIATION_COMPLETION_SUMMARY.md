# Antigravity Daemon 整改完成总表

> 本文档为 PR-01 ~ PR-21 整改工程的正式收尾归档。  
> 生成日期：2026-03-13  
> 状态：**全部完成**

---

## 1. 总体完成结论

PR-01 至 PR-21 共计 21 项整改工作（含 PR-18 的 3 个增强子 PR）已全部完成。本轮整改覆盖了 VERIFY 证据链修正、callback auth/freshness 硬化、authority runtime kernel 收敛、domain event 模型建立与双写迁移、event-derived projection、governance 主链化、artifact proof chain 强化、strict trust mode、package boundary 收口、capability classification 归位、upcasting schema evolution、telemetry sink 铺设、memory/benchmark/interop/formal 边界封冻等全部关键方向。

当前系统已从"工程扎实但主链与研究件双轨运行、边界未完全收敛"的状态，推进至"主链路径明确、能力分层清晰、边界有回归测试守护"的工程化状态。全量测试 442/442 通过（55 个测试文件），0 回归。

---

## 2. PR 完成总表

| PR 编号 | 标题 | 状态 | 结果摘要 |
|----|------|------|----------|
| PR-01 | Fix VERIFY challenger model identity semantics | 已完成 | 修复 VERIFY 节点中 challenger model identity 绑定，消除硬编码伪模型身份，evidence gate 使用真实 runtime 调用结果 |
| PR-02 | Align callback auth advertisement with runtime callback lease | 已完成 | callback lease 与 verified agent-card advertisement 的 auth surface 对齐，消除发现阶段与运行阶段的 surface 不一致 |
| PR-03 | Enforce callback freshness and replay protection | 已完成 | 为 remote callback 增加 timestamp freshness window、duplicate delivery 拒绝和 replay 防护 |
| PR-04 | Introduce AuthorityRuntimeKernel and lifecycle contracts | 已完成 | 抽出 `AuthorityRuntimeKernel`，统一 Bootstrap → Draining → TerminalDecision → Finalizing → Completed 五阶段生命周期 |
| PR-05 | Move transition and skip authority back into daemon runtime | 已完成 | 将 adaptive skip、forceQueue、transition authority 从 driver/executor 迁回 daemon kernel，driver 只保留执行泵职责 |
| PR-06 | Define daemon domain event v1 and append contract | 已完成 | 建立 daemon domain event taxonomy、versioned envelope、schema v1 基线，为双写迁移奠基 |
| PR-07 | Dual-write completion sessions, receipts, handoffs, skips, and verdicts to event log | 已完成 | 关键 side-table 语义（completion session / receipt / handoff / skip / verdict）双写进 event log，保留 legacy ledger 兼容 |
| PR-08 | Add event-derived projection and shadow-compare path | 已完成 | 建立 event-derived projection builder，与 legacy snapshot 做 shadow compare，验证 event canonicalization 正确性 |
| PR-09 | Extract DaemonPolicyEngine into pure evaluator and facts adapter | 已完成 | 将 `DaemonPolicyEngine` 收敛为纯规则评估后端与 facts adapter，为 governance gateway 主链化降低耦合 |
| PR-10 | Add GovernanceGateway stage hooks for daemon lifecycle | 已完成 | `GovernanceGateway` 增加 daemon lifecycle 对应的 preflight / node-release / terminal-release / human-gate stage hooks |
| PR-11 | Cut over release and human-gate decisions to GovernanceGateway | 已完成 | runtime 默认走 gateway 路径评估 release/human-gate 等主链治理决策，产出 stage-tagged policy verdicts |
| PR-12 | Introduce verification snapshot and artifact reference model | 已完成 | 建立统一 verification snapshot 和 artifact reference，各终态 artifact 从同一 snapshot source 获取上游摘要 |
| PR-13 | Harden artifact verifiers and bind transparency ledger to proof graph | 已完成 | 强化 cross-artifact verifier（digest + upstream binding + proof graph），transparency ledger entry 绑定 proof graph digest |
| PR-14 | Add strict trust mode and verified-set delegation | 已完成 | 引入 `strictTrustMode`，remote delegation 只面向 verified worker 集合，未验证 worker 仅出现在 discovery issues |
| PR-15 | Publish stable contracts and remove cross-package src imports | 已完成 | barrel export 最小化，消除跨包内部 `src` 导入，package 边界对齐 runtime 实际消费 |
| PR-16 | Split daemon and MCP into standalone build and release lanes | 已完成 | daemon/MCP 形成独立构建与 smoke 测试链，为 runtime-first 产物铺路 |
| PR-17 | Classify stable versus experimental capabilities and realign docs | 已完成 | 建立 `CAPABILITY_CLASSIFICATION.md` capability classification 基线，完成 stable / experimental / frozen 主分类收口；后续在 PR-20 / PR-21 中进一步补充 memory / benchmark / interop / formal 的最终定位（含 conformance asset 和 internal harness 子分类） |
| PR-18 | Wire UpcastingEventStore into daemon read path | 已完成 | `UpcastingEventStore` wrapping `JsonlEventStore` 进入 daemon 默认读路径，首条 upcast 链 NODE_COMPLETED v1→v2 落地 |
| PR-18C | Multi-chain upcast | 已完成 | PR-18 增强：新增 NODE_STARTED v1→v2、RUN_CREATED v1→v2，共 3 条真实 upcast 链 |
| PR-18D | Domain event v2 scaffold | 已完成 | PR-18 增强：v2 envelope 新增 correlationId / causationId / producer（可选字段），默认写入仍保持 v1，v1/v2 共存 |
| PR-18E | Replay/recovery compatibility strengthening | 已完成 | PR-18 增强：upcast 失败容错（`_upcastError` 标记）、`loadRunStateWithDiagnostics`、混合版本 replay 兼容测试 |
| PR-19 | Add RuntimeTelemetrySink and prepare OTel mainline wiring | 已完成 | 定义 `RuntimeTelemetrySink` 接口（7 方法），`NoOpTelemetrySink` 默认实现，lifecycle/node/remote/recovery 7 个 hook 点接入 |
| PR-20 | Freeze or scope VectorMemory and memory capabilities | 已完成 | VectorMemory/VectorMemoryLayer 冻结，MemoryManager 标记 experimental（record-only），MCP 工具描述修正 |
| PR-21 | Reposition benchmark, interop, and formal capabilities and add boundary regressions | 已完成 | benchmark→internal harness，interop→experimental harness，formal→conformance asset，README/exports 标签对齐 |

---

## 3. 结构性成果总结

### 3.1 VERIFY 证据链与 challenger model 修正（PR-01）

- **整改前**：VERIFY 节点 output 中 challenger model identity 硬编码，evidence gate 的 distinct-family 校验基于伪语义。
- **完成后**：challenger model 元数据绑定到真实 runtime 调用结果，evidence policy 不再依赖固定语义常量。

### 3.2 callback auth / freshness / trust 硬化（PR-02, PR-03, PR-14）

- **整改前**：callback advertisement 与运行时 auth surface 不一致，callback 无 freshness 校验和 replay 防护，trust registry 与 delegation 未联动。
- **完成后**：callback lease 使用与 verified agent-card advertisement 一致的 auth surface。timestamp freshness + duplicate detection + replay 防护已进入 callback ingress。`strictTrustMode` 可拒绝未经验证的 worker，trust registry 成为签名信任面唯一事实源。

### 3.3 authority runtime 收敛（PR-04, PR-05）

- **整改前**：lifecycle phase 散落在 runtime 多处方法中，transition/skip/forceQueue 由 driver/executor 持有。
- **完成后**：`AuthorityRuntimeKernel` 统一管理五阶段生命周期。transition、skip、forceQueue 决策完全由 daemon authority 持有，driver 仅保留执行泵职责。

### 3.4 event model / dual-write / projection / upcasting / replay 强化（PR-06, PR-07, PR-08, PR-18, PR-18C, PR-18D, PR-18E）

- **整改前**：event log 是辅助记录，关键语义存储在 side-table JSON 中。无 schema evolution 能力。replay/recovery 对旧版本事件无诊断。
- **完成后**：daemon domain event v1 taxonomy 建立，关键操作 dual-write 进 event log。event-derived projection + shadow compare 验证 event stream 与 legacy snapshot 一致性。`UpcastingEventStore` 进入默认读路径，3 条真实 upcast 链。v2 envelope scaffold（correlationId / causationId / producer）就绪。upcast 失败不崩溃读路径，`loadRunStateWithDiagnostics` 提供诊断计数，混合版本 replay 有测试覆盖。

### 3.5 governance 主链化（PR-09, PR-10, PR-11）

- **整改前**：`GovernanceGateway` 存在但未进入 runtime 默认路径，policy 评估散落为 direct `evaluateX` 调用。
- **完成后**：`DaemonPolicyEngine` 解耦为纯 evaluator + facts adapter。gateway 接入 preflight / node-release / terminal-release / human-gate 四个 lifecycle 拦截点。runtime 默认走 gateway 评估 policy，verdicts 带 stage tag 形成实际约束。

### 3.6 artifact / proof chain 强化（PR-12, PR-13）

- **整改前**：各终态 artifact 各自重算摘要，缺乏统一 proof graph，verifier 主要做 digest 校验。
- **完成后**：统一 verification snapshot 和 artifact reference model。cross-artifact verifier 增加 digest + upstream binding + proof graph binding。transparency ledger entry 绑定 proof graph digest。任一上游 artifact 被替换，下游 verify 必须失败。

### 3.7 package boundary / build lane（PR-15, PR-16）

- **整改前**：存在跨包内部 `src` 导入，daemon/MCP 是 extension bundle 内部副产物。
- **完成后**：barrel export 最小化，跨包 `src` 导入消除。daemon/MCP 可独立构建，形成 runtime-first 产物通道。

### 3.8 capability classification / docs / exports 收口（PR-17, PR-20, PR-21）

- **整改前**：README 存在自评式 SOTA 评分，能力表述超前于代码实际，experimental 能力在 exports 中无标记。
- **完成后**：`CAPABILITY_CLASSIFICATION.md` 建立四级分类（stable / experimental / frozen / conformance asset）。README 和 MCP 工具描述与代码对齐。VectorMemory 冻结，benchmark→internal harness，formal→conformance asset。boundary regression tests 守护分类不漂移。

### 3.9 telemetry sink（PR-19）

- **整改前**：无统一观测出口，timeline 和 logger 散落。
- **完成后**：`RuntimeTelemetrySink` 接口（7 方法）+ `NoOpTelemetrySink` 默认实现。lifecycle/node/remote/recovery hook 已接入。未配置 sink 时零行为变化。为后续 OTel 接入铺好插口。

---

## 4. 当前能力分层结果

### Stable

以下能力已进入 daemon 默认主路径，形成真实 correctness / governance / replay / release 约束：

| 能力 | 入口 |
|------|------|
| DAG Engine / daemon-owned workflow runtime | runtime → core |
| Governance Gateway (GaaS) | runtime → GovernanceGateway |
| Event Sourcing (JsonlEventStore) | runtime → persistence |
| UpcastingEventStore | runtime → UpcastingEventStore wrapping JsonlEventStore |
| Policy Engine | runtime → DaemonPolicyEngine |
| Authority Runtime Kernel | runtime → AuthorityRuntimeKernel |
| Remote Worker Directory | runtime → RemoteWorkerDirectory |
| Trust Registry | runtime → TrustRegistryStore |
| HITL / Human Approval Gate | runtime → deriveHumanApprovalRequirement |
| Release Artifacts + Verifiers | runtime → artifact builders + verifiers |
| Transparency Ledger + Proof Graph | runtime → DaemonLedger |
| Checkpoint + Snapshot | runtime → SqliteCheckpointStore |
| RuntimeTelemetrySink | runtime → telemetrySink (NoOp default) |

### Experimental

以下能力有工作代码和测试，但未进入 daemon 默认主路径，不形成 correctness 约束：

| 能力 | 定位 |
|------|------|
| Benchmark Harness | 内部评测 harness，非外部成熟平台 |
| Benchmark Source Registry | evidence-backed dataset registry，在 snapshot 但非 release gate |
| Interop Harness | 实验性诊断 harness，非主链协议能力 |
| Memory Manager | SQLite keyword recall，record-only，不参与 runtime 决策 |
| OTel / DagEngineTracer | 结构化 tracer，无 OTel SDK，daemon 未导入 |

### Frozen

保留为代码资产，不在任何活跃主线路径，不推荐新集成：

| 能力 | 原因 |
|------|------|
| VectorMemory | 代码存在，未从 barrel 导出，daemon 未导入 |
| VectorMemoryLayer | VectorMemory 内部，无 embedding provider |

### Conformance Asset

| 能力 | 定位 |
|------|------|
| StateInvariantVerifier | 在 core 库，不在 daemon runtime 路径，可用于一致性验证 |
| BoundedModelChecker | 在 core 库，不在 daemon runtime 路径，可用于状态空间检查 |

---

## 5. 本轮整改关闭的高风险问题

| 风险 | 关闭方式 |
|------|----------|
| **VERIFY challenger model 伪语义** | PR-01 将 challenger model identity 绑定到真实 runtime 调用结果，evidence gate 不再依赖硬编码常量 |
| **callback auth surface 不一致** | PR-02 让 callback lease 与 verified agent-card advertisement auth surface 对齐 |
| **callback freshness 缺失** | PR-03 增加 timestamp freshness + duplicate detection + replay 防护 |
| **主链与研究件双轨运行** | PR-04/05 抽出 `AuthorityRuntimeKernel` 统一 lifecycle，PR-17 建立 capability classification，boundary tests 守护 |
| **event log 非唯一关键事实源** | PR-06/07 建立 domain event taxonomy 并 dual-write，PR-08 shadow compare 验证一致性 |
| **governance 未进入关键路径** | PR-09/10/11 将 policy 评估从 direct 调用切换到 GovernanceGateway，gateway verdicts 形成实际约束 |
| **artifact proof chain 语义绑定不足** | PR-12/13 建立统一 verification snapshot + cross-artifact verifier + transparency ledger proof graph binding |
| **trust enforcement 不完整** | PR-14 引入 `strictTrustMode`，未验证 worker 被排除出可委派集合 |
| **package boundary 泄漏** | PR-15/16 消除跨包 src 导入，形成独立构建链 |
| **docs/exports/能力表述超前** | PR-17/20/21 建立四级分类，README 对齐实际，MCP 工具描述标注实验性 |
| **schema evolution 无路径** | PR-18/18C/18D/18E 建立 upcasting registry、3 条真实 upcast 链、v2 scaffold、replay hardening |
| **telemetry 无统一出口** | PR-19 建立 RuntimeTelemetrySink 接口 + NoOp 默认 + 7 个 hook 点 |

---

## 6. 当前仍保留但不构成阻塞的后续项

以下为后续可选增强路线，不影响"本轮整改闭环完成"的结论：

| 后续项 | 说明 | 为什么不阻塞 |
|--------|------|-------------|
| 完整 OTel 主链化 | 将 RuntimeTelemetrySink 接到 OTel SDK | PR-19 已铺好统一插口，NoOp default 已满足整改要求 |
| Memory runtime 注入 | 探索 recall 驱动 routing/policy | MemoryManager 当前 record-only 已明确标记 experimental |
| Benchmark 对外化 | 外化数据集、接入第三方评测 | benchmark harness 已正确标记为 internal harness |
| Interop 标准对齐 | 对齐 A2A 等正式标准 | interop harness 已正确标记为 experimental |
| Formal asset 工程利用 | 将 StateInvariantVerifier 接入 CI/release gate | 已正确标记为 conformance asset |
| 非对称签名深化 | HMAC-SHA256 升级为非对称签名 | 当前 HMAC 签名已满足整改要求 |
| Domain event v2 默认写入 | 将默认写入从 v1 切换到 v2 | v2 scaffold 就绪，当前 v1 写入不影响功能 |
| 更多 upcast 链 | 按需扩展 schema upgrade 路径 | 3 条真实链已验证 schema evolution 路径可行性 |
| Event log 读路径最终切换 | 将读路径完全切换到 event-derived projection | shadow compare 已验证一致性，当前 dual-write + legacy read 仍然安全 |

---

## 7. 最终归档结论

PR-01 至 PR-21 的全部整改工作已完成。当前仓库已从"工程扎实的研究系统，但主链和边界未完全收敛"推进至以下状态：

- **主链路径明确**：authority lifecycle kernel、governance gateway、event sourcing dual-write、artifact proof chain、trust enforcement 均已进入 daemon 默认主路径
- **能力分层清晰**：stable / experimental / frozen / conformance asset 四级分类已建立，由 `CAPABILITY_CLASSIFICATION.md` 和 20+ boundary regression tests 共同守护
- **观测能力就绪**：RuntimeTelemetrySink 提供统一观测插口，为后续 OTel 接入铺好基础
- **Schema 演进可行**：UpcastingEventStore + v2 scaffold + replay hardening 确保旧事件与混合版本事件不拖垮读路径
- **文档与代码对齐**：README、MCP 工具描述、barrel export 注释均与实际代码状态一致
- **证据链完整**：VERIFY challenger identity 真实化，callback auth/freshness 硬化，cross-artifact verifier + transparency ledger proof graph binding 形成端到端证据链

后续工作的性质已从"整改"正式转为"增强与演进"。本轮整改主线闭环。

---

> 全量测试：442/442 通过（55 个测试文件），0 回归。
