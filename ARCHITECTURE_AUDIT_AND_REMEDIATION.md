# Antigravity Workflow 架构审计与修复方案

| 项目 | 内容 |
|---|---|
| 状态 | Active，整改已全部落地，P0 主链未闭环问题已全部修复 |
| 最后更新时间 | 2026-03-13 |
| 适用范围 | `antigravity-daemon` authority runtime、`antigravity-core` 运行时能力、`antigravity-model-core` 执行泵、`antigravity-persistence` 事实源与投影、`antigravity-vscode`/`antigravity-mcp-server` 壳层与发布边界 |
| 关联材料 | 仓库深度审计结论；修复方案总计划；相关 README、架构说明、runtime / governance / federation / artifact 实现代码 |

## 0. 最终验收更新

本次整改已全部落地，按当前真实代码状态，**最终总验收结论为：已通过，P0 主链未闭环问题已全部修复，建议归档**。

已确认的工程验证结果：

- `npm test`：通过，459/459（含 4 条 runtime 主链证据测试与 13 条 component 级主链佐证测试）
- `npm run smoke:daemon`：通过
- `npm run smoke:mcp`：通过

此前 3 个 P0 未闭环点已全部修复：

1. ✅ `GovernanceGateway` 已成为 runtime 默认治理入口 — `evaluateDaemonLifecycleStage()` 覆盖 5 个决策点
2. ✅ domain-event dual-write 已切换为 durable JSONL — `JsonlDaemonDomainEventLog` + verdict 全覆盖双写
3. ✅ `VerificationSnapshot` / `proofGraphDigest` 已进入生产 artifact 主链 — 6 个 snapshot-carrying 终态 artifact 共享 frozen snapshot，certification + transparency 带同一 `proofGraphDigest`

归档建议：

- 当前**建议归档**
- 残留 P2 级问题不影响系统正确性

当前权威验收状态见 [ACCEPTANCE_AUDIT_STATUS.md](ACCEPTANCE_AUDIT_STATUS.md)。

## 1. 背景

本文档用于整合当前仓库的两份既有材料：

- 架构与代码实现深度审计结论
- 基于审计结论整理出的系统修复方案计划

本文档不是宣传材料，也不是一次性答复记录，而是仓库后续整改的正式主文档。目标是为项目 owner、协作者和后续执行者提供统一的判断基线、整改主线、执行顺序和验收标准。

本文档默认基于以下前提：

- 当前 daemon 主执行链已经真实成立。
- 现有问题集中在主链与研究件脱节、事件事实源分裂、治理未主链化、联邦协议闭环不足、artifact 语义绑定不够硬、包边界与发布形态不一致。
- 后续整改优先级应服务于“把系统修硬”，而不是继续扩展先进概念。

## 2. 一句话结论

该仓库已经具备真实 daemon-owned workflow runtime 的工程基础，但仍处于“主链可用、研究件并存、治理与事件模型未完全收敛”的阶段，整体定位应为工程扎实的研究系统而非接近生产的先进平台。

## 3. 执行摘要

项目最强的部分不是“多智能体”表述，而是 daemon 主路径、completion session、evidence gate、release artifact surface、remote worker 四种响应模式、trace/release/certification/transparency 这一整条审计链已经有真实实现。

项目最大的结构问题仍然是双轨制。真实 authority 主链在 `antigravity-daemon`，但 `GovernanceGateway` 默认治理 cutover、`CyclicDagEngine`、`DagEngineTracer`、`VectorMemory`、formal spec，以及 `VerificationSnapshot` / `proofGraphDigest` 这类 proof-chain 强绑定能力，仍未进入 daemon 默认主路径，却一度在文档层被描述为已落地主能力。`UpcastingEventStore` 已经进入默认读路径，但这并不等于事件事实源和 artifact 语义绑定已经完成收敛。

第二个核心问题是事件流不是唯一事实源。运行状态由 event log 还原，但 receipts、handoffs、policy verdicts、completion sessions、artifact 状态仍主要依赖 ledger side tables 和 snapshot 组装，这直接限制了 replay、审计一致性和 schema evolution 的可信度。

第三个核心问题是治理链没有真正进入关键路径。—— **已修复**：`GovernanceGateway.evaluateDaemonLifecycleStage()` 已成为唯一权威入口，覆盖 5 个 lifecycle governance 决策点。artifact-level policy evaluation 仍由 `DaemonPolicyEngine` 直接执行，其 verdict 统一进入 dual-write 路径。

联邦与 callback 面不是空壳。agent card、taskProtocol、`inline/poll/stream/callback`、callback lease、discovery issue 分类、trust registry 都是真代码。但 callback advertisement 与运行时 header 使用不一致、timestamp freshness 不严格、默认 signer policy 偏松，这使远程输入面仍有明显硬化空间。

artifact 体系整体优于一般 agent 项目，但仍要补强语义绑定。当前 trace/report/dossier/bundle/certification/transparency 链条已经存在，问题不在“有没有 artifact”，而在“这些 artifact 是否能严格证明属于同一条 run、同一份验证快照、同一条治理链”。

整改总体策略应为：

- 先收敛主链，再决定高阶能力的命运
- 先修 authority、governance、event model、trust、artifact 真实性
- 再处理 observability、memory、benchmark、standard alignment
- 所有高级能力必须进入主链或明确降级为 `experimental`

> 说明：第 4 节到后续实施设计部分保留了整改前审计与分步实施语境，主要用于解释整改来源、顺序和设计取舍；这些段落不是当前代码状态的“已完成证明”。当前是否进入默认主链、是否可以归档，以第 0 节和 [ACCEPTANCE_AUDIT_STATUS.md](ACCEPTANCE_AUDIT_STATUS.md) 为准。

## 4. 审计发现的问题

### 4.1 主链与研究件双轨

- 问题描述：仓库同时存在一条真实 daemon 主执行链和一组未接线的研究件/实验件。主链使用 `DagEngine + WorkflowRunDriver + AntigravityDaemonRuntime + DaemonPolicyEngine`，而很多被文档宣称的先进能力并未进入默认 authority runtime。
- 风险等级：高
- 影响范围：`antigravity-daemon`、`antigravity-core`、`antigravity-model-core`、README 与架构文档
- 造成的后果：
  - 系统内部存在两套语义中心
  - 后续增强容易继续走旁路
  - 文档与代码能力边界不一致
  - 维护者无法快速判断哪些能力是真主链能力

### 4.2 事件流不是唯一事实源

- 问题描述：event log 负责还原 `WorkflowState`，但 receipts、handoffs、policy verdicts、skip decisions、completion sessions、timeline 和 artifact 状态主要由 ledger side tables 提供。
- 风险等级：高
- 影响范围：`daemon/runtime`、`daemon/ledger`、`persistence/event-store`、`persistence/checkpoint-store`
- 造成的后果：
  - replay 无法完整还原关键运行语义
  - side table 与 event log 可能出现 drift
  - artifact 校验与治理证明无法完全建立在 append-only log 上
  - upcasting 和 schema evolution 无法真正落地

### 4.3 治理链未中枢化

- 问题描述：bootstrap 阶段存在 `GovernanceGateway`，但 daemon 主路径大量治理决策仍由 `DaemonPolicyEngine.evaluateX` 直接触发，未经过统一的 PDP/PEP stage orchestration。
- 风险等级：高
- 影响范围：`core/governance`、`daemon/policy-engine`、`daemon/runtime`、`run-bootstrap`
- 造成的后果：
  - GaaS 4 拦截点只部分成立
  - policy、trust、evidence 无法统一进入 key path
  - 后续 governance 增强容易继续堆分支

### 4.4 联邦 / callback / trust 闭环不足

- 问题描述：remote worker 发现、分类、签名验证、四种 response mode 都已实现，但 callback advertisement、运行时 callback auth surface、timestamp freshness、strict trust 默认策略仍未收紧。
- 风险等级：高
- 影响范围：`daemon/remote-worker`、`daemon/trust-registry`、`daemon/server`、manifest/schema
- 造成的后果：
  - 远程输入仍可能以“看似已验证”的方式进入本地 authority
  - trust 体系默认过松
  - callback 面难以称为严格的 anti-replay / anti-tamper 入口

### 4.5 artifact proof chain 语义绑定不足

- 问题描述：trace bundle、policy report、invariant report、release attestation、release dossier、release bundle、certification record、transparency ledger 已构成 proof surface，但各 verifier 对“同一条 run 语义”与“同一份 verification snapshot”的绑定强度不完全一致。
- 风险等级：高
- 影响范围：`daemon/release-*`、`release-artifact-verifier`、`run-verifier`、`transparency-ledger`
- 造成的后果：
  - 存在 artifact substitution 与 digest drift 风险
  - proof chain 更偏“文件层一致性”，不够“语义层一致性”
  - release gate 难以达到真正硬化的发布治理水平

### 4.6 高阶能力停留在概念层

- 问题描述：cyclic DAG、upcasting、OTel tracer、vector memory、formal spec、benchmark registry 等能力代码存在，但多数未对主运行时 correctness、governance、replay 或 route 产生强依赖。
- 风险等级：中
- 影响范围：`core/dag`、`core/observability`、`persistence/memory`、`daemon/benchmark*`、`spec/`
- 造成的后果：
  - 高级能力堆叠但主链未增强
  - 研发优先级容易被概念驱动
  - README 和产品叙事持续超前

### 4.7 包边界与发布边界不一致

- 问题描述：daemon 已经是事实核心，但根发布物仍是 VS Code extension-first；同时仍存在跨包 `src` 内部导入和 release 边界不清的问题。
- 风险等级：中
- 影响范围：根包、`antigravity-vscode`、`antigravity-daemon`、`antigravity-persistence`
- 造成的后果：
  - 真实系统边界无法沉淀为稳定契约
  - runtime-first 演进受阻
  - 构建、发布、文档、外部集成持续围绕 extension 展开

## 5. 能力表述与主链落地情况

本节用于将当前文档、README 叙事和真实主链落地情况对齐。判断标准不是“仓库里是否有代码”，而是“是否进入 daemon authority runtime 默认主路径，并对 correctness / governance / replay / release 产生强约束”。

| 能力表述 | 当前表述 | 实际落地情况 | 是否属于主链能力 | 当前更准确的定位 |
|---|---|---|---|---|
| cyclic DAG | README 曾将其表述为 `7 节点状态机 + 循环 DAG` | 仓库中存在 `CyclicDagEngine` 与 loop event 建模，但 daemon 主路径仍实例化普通 `DagEngine`，默认 run 不使用 loop semantics | 否 | 已有实验实现，但当前仍未进入 authority runtime 主链，应标记为 `not-mainline DAG extension` |
| GaaS 4 interception points / PDP / PEP | README 与 `core` 中一度表述为 `preflight / authorize / observe / release` 四拦截点 | `GovernanceGateway.evaluateDaemonLifecycleStage()` 已成为默认治理入口，覆盖 preflight/release/human-gate/approval/resume 5 个决策点。artifact-level evaluation 仍由 policyEngine 直接执行 | 是 | 治理主链已统一为 gateway 驱动，artifact policy 有意分层 |
| Event Sourcing + Upcasting + Snapshot | README 曾表述为 `不可变事件流 + Replayable Ledger + Upcasting+Snap` | 工作流事件流、checkpoint 与 `UpcastingEventStore` 默认读路径真实存在；daemon domain events 已切换为 `JsonlDaemonDomainEventLog` durable dual-write，所有 verdict 均进入双写路径。`VerificationSnapshot` 已进入产 artifact 主链 | 是 | 事件流、upcasting、durable dual-write、verification snapshot 均已主链化 |
| OTel / LangSmith 级 observability | README 表述为 `OpenTelemetry GenAI Semantic` | 仓库中存在 `DagEngineTracer` 和 GenAI semantic conventions 建模，但 daemon 主运行时没有端到端接线，默认观测仍以 timeline、logs、artifact verify 为主 | 否 | 具备 observability 抽象和实验工具，不具备 LangSmith/OTel 级贯通可观测主链 |
| Vector Search + Snapshot / memory | README 表述为 `Vector Search + Snapshot` 和长期记忆能力 | `MemoryManager` 实际走 episodic + semantic memory；`VectorMemoryLayer` 存在但未接入默认 recall/record 路径；memorySearch 只是查询接口，未进入 analyze/route/verify 决策 | 否 | 当前主链记忆是“查询型 episodic/semantic memory”，向量检索与决策注入尚未落地 |
| A2A-style federation | README 表述为 `A2A-style remote worker federation` | agent card、taskProtocol、四种 response mode、callback lease、discovery issue 分类和 trust policy 都是真实现；但任务协议仍是项目自定义 HTTP contract，并非标准 A2A runtime | 部分 | 更准确定位应为“具备 agent-card 与多生命周期的 federation runtime 原型”，而不是标准 A2A 实现 |
| formal specs / formal verification | README 与 spec 目录容易被理解为正式形式化验证能力 | 目前保留了 TLA 风格 spec 文本与 bounded model checking smoke test；仓库内没有看到将 spec 直接用于运行时验证、模型校验流水线或 release gate 的闭环 | 否 | 当前是 conformance / invariant fixture，不应表述为已建立正式 formal verification 体系 |

结论：

- 当前最容易被“说大了”的能力集中在 cyclic DAG、统一 GaaS、upcasting、OTel、vector memory、formal verification。
- 当前最名副其实的能力是 daemon-owned authority、completion session、remote worker 四模式、artifact proof surface、release governance 基础链。
- 后续文档策略必须执行二选一：进入主链的能力继续保留为主能力；未接线能力一律降级为 `experimental` 或明确写为“已建模、未主链化”。

补充判断：

- 当前最容易被说大的能力，并不是“完全没有代码”，而是“代码已经存在，但尚未进入 daemon authority runtime 默认主链”。
- 当前最主要的风险，也不是“仓库里什么都没做”，而是“术语和模块命名先于 runtime contract 成立”，导致外部叙事和内部主链并不同步。
- 后续整改必须坚持同一条规则：**进入主链，或标记为 `experimental`**。任何继续停留在灰色地带的能力，都会持续污染架构边界和整改优先级。

## 6. 世界先进对标评分

本节使用严格口径对标当前世界先进方案。评分不是鼓励分，而是“当前真实完成度”评分。

| 维度 | 分数（0~10） | 对标对象 | 当前水平判断 | 主要差距 | 是否只是概念对标 | 达到真正先进还缺什么 |
|---|---:|---|---|---|---|---|
| 编排能力 | 6.0 | LangGraph、Temporal | 固定 7 节点 workflow、条件 skip、forceQueue、恢复可用，主路径可跑 | 缺真正主链循环、子图、统一 runtime IR、通用 DSL 演化能力 | 部分 | 把循环、恢复、版本演化、route policy 都收进统一 runtime kernel |
| 状态持久化 / replay | 6.0 | Temporal、EventStoreDB | event log、checkpoint、recovery 真实存在 | ledger side tables 仍承载关键运行与治理语义，不能纯事件重建 | 否 | 把 receipt / handoff / verdict / session / artifact state 事件化并完成 replay cutover |
| 治理能力 | 5.0 | OPA、NeMo Guardrails | evidence gate、human gate、release gate 已具备工程可用性 | `GovernanceGateway` 未接管主链，PDP/PEP 未统一 | 部分 | 将 preflight / authorize / observe / release 全部 stage 化，消除 direct evaluator 分支 |
| 可验证性 / 签名 / provenance | 6.0 | Sigstore、SLSA 风格 provenance | trace/report/dossier/bundle/certification 都可 verify，proof surface 明显强于一般 agent 仓库 | 仍以 HMAC 和 digest binding 为主，身份与语义绑定不够硬 | 部分 | 引入 verification snapshot、proof graph、非对称签名与 identity-backed provenance |
| 联邦 / 远程 worker | 6.0 | A2A、ADK、CrewAI 联邦运行时 | agent card、四种 response mode、callback lease、remote tribunal 真实存在 | 协议仍自定义，callback trust 闭环不足，strict trust 缺位 | 部分 | 完成 callback/security 收紧，版本化协议，并逐步对齐标准 agent/task/session contract |
| 记忆 | 3.0 | MemGPT、Letta、Mem0 | episodic + semantic memory 可查，具备基础预算/eviction 机制 | vector memory 未接线，memory 不参与 workflow 决策 | 更偏概念 | 让 memory 进入 analyze/route/verify/policy，明确 recall/admission/forget 策略 |
| 可观测性 | 3.0 | LangSmith、OpenTelemetry AI/GenAI 实践 | timeline、artifact、release verify 足够排障 | 无端到端 span/trace，无主链 OTel 接线 | 更偏概念 | 构建 runtime telemetry sink，并贯通 daemon、model 调用、remote worker、artifact verify |
| benchmark | 5.0 | AgentBench、workflow benchmark harness | manifest/dataset/source registry 设计认真，具备 evidence-backed case | 仍偏内部 harness，外部可比性和第三方 baseline 不足 | 部分 | 发布公开数据集、第三方基线、复现实验与对外评分规范 |
| 人类审批 / 发布治理 | 7.0 | 发布门禁 / release governance 系统 | pause/resume、artifact verify、release 回退 `paused_for_human` 做得扎实 | governance 主链仍未完全中枢化 | 否 | 让 artifact verify、approval、resume 都通过统一 gateway 和 verification snapshot 驱动 |
| 工程成熟度 | 6.0 | LangGraph / Temporal 生态级系统 | 类型检查通过、测试密度明显高于一般 agent 项目、模块化较完整 | 双轨实现、边界泄漏、发布形态与主边界不一致 | 否 | 收敛包边界、事件模型、发布形态和 stable contract，减少研究件主仓污染 |

总体判断：

- 本项目已经超出“概念包装”层，具备真实工程硬度。
- 但距离“接近生产的先进系统”仍有明显差距，主要差在主链统一、事实源统一、治理中枢化、联邦收紧和 proof chain 语义绑定。
- 当前更准确的外部定位仍应保持为“工程扎实的研究系统”。

## 7. 根因归并

| 根因编号 | 根因 | 根因描述 | 导致的问题 | 危险性 | 影响模块 |
|---|---|---|---|---|---|
| R1 | 主链与研究件双轨 | 真实 authority runtime 与研究件/实验件并行演化，未形成单一语义中心 | README 能力超前、主链与旁路脱节、模块边界含混 | 高 | `antigravity-daemon`, `antigravity-core`, `antigravity-model-core`, docs |
| R2 | 事件流不是唯一事实源 | ledger side tables 承载关键运行语义，event log 只覆盖部分状态 | replay 不完整、projection drift、schema evolution 停留框架 | 高 | `daemon/runtime`, `daemon/ledger`, `persistence/event-store`, `checkpoint-store` |
| R3 | 治理能力强但未统一中枢化 | governance 以多处 evaluator 和分支形式存在，未由统一 gateway 驱动 | GaaS 4 拦截点未主链化、PDP/PEP 边界不清 | 高 | `core/governance`, `daemon/policy-engine`, `daemon/runtime` |
| R4 | 联邦协议闭环不足 | remote worker 校验做得多，但 callback、header、freshness、strict trust 默认策略不一致 | callback 安全面不够硬，远程 worker 进入门槛不够严 | 高 | `daemon/remote-worker`, `trust-registry`, `server` |
| R5 | artifact 语义绑定弱于文件绑定 | proof surface 存在，但各 artifact 间的统一 verification snapshot 不够硬 | proof chain 易出现语义替换和不一致 | 高 | `release-*`, `release-artifact-verifier`, `transparency-ledger` |
| R6 | 高阶能力未进入主运行时 | cyclic/upcasting/otel/vector/formal/benchmark 多数未主链接线 | 概念完整但运行时未增强 | 中 | `core/dag`, `observability`, `persistence/memory`, `daemon/benchmark*`, `spec/` |
| R7 | 包边界与发布形态不一致 | daemon 是核心，但发布与集成仍 extension-first；跨包内部导入存在 | 契约不稳、发布形态与系统边界错位 | 中 | 根包、`vscode`, `daemon`, `persistence` |

## 8. 总体整改原则

- 先收敛主链，再扩展能力。
- 先修 authority/runtime 语义，再修 README 叙事。
- 先修一致性和真实性，再补“先进功能”。
- 能事件化的关键治理语义尽量事件化。
- side table、snapshot、projection 一律按派生物处理，不再当事实源。
- 运行时强依赖能力与实验能力分层隔离。
- correctness / trust / release 级缺陷优先于 observability / benchmark / memory 增强。
- 高风险整改优先采用双写、影子校验、分阶段切读，避免大爆炸。
- 对外契约和发布边界必须与真实架构边界一致。
- 每项整改必须有明确验收标准、回归测试和回滚面。

## 9. 整改工作流

| Workstream | 目标 | 涉及模块 | 风险 | 预计收益 | 完成标志 |
|---|---|---|---|---|---|
| WS1 主链收敛与 runtime 去双轨 | 建立单一 daemon authority kernel | `daemon/runtime`, `run-bootstrap`, `workflow-run-driver`, `node-executor` | 高 | 统一运行时语义，停止继续分叉 | 主链决策点集中到 daemon |
| WS2 事件模型统一与 replay 强化 | 让 event log 成为关键语义事实源 | `daemon/ledger`, `daemon/schema`, `event-store`, `checkpoint-store` | 高 | 真 replay、真恢复、真 schema evolution | 关键运行/治理/artifact 语义可由 event log 重建 |
| WS3 治理网关主链化 | 收敛 policy/gateway，统一 PDP/PEP | `core/governance`, `daemon/policy-engine`, `daemon/runtime` | 高 | governance 真进入 key path | preflight/authorize/observe/release 全部由统一 gateway 驱动 |
| WS4 federation / callback / trust 收紧 | 修复 callback 与 trust 关键缺陷 | `daemon/remote-worker`, `trust-registry`, `server`, schema | 高 | 封住远程污染面 | strict trust 下不合规 worker 不能被委派 |
| WS5 artifact / attestation / ledger 一致性强化 | 把 proof chain 升级为强一致语义链 | `release-*`, `release-artifact-verifier`, `transparency-ledger`, `run-verifier` | 高 | 发布治理真正变硬 | 任一 artifact substitution 都会被阻断 |
| WS6 高阶能力接线或降级 | 决定 cyclic/upcasting/otel/vector/formal/benchmark 的主链命运 | `core/dag`, `observability`, `persistence/memory`, `benchmark*`, `spec/` | 中 | 去掉概念噪音，集中研发资源 | 文档与实际接线状态一致 |
| WS7 包边界、发布形态与文档对齐 | 形成 runtime-first 边界和正式文档 | 根包、`vscode`, `daemon`, `mcp-server`, `persistence`, docs | 中 | 支撑长期维护和独立发布 | daemon/MCP 可独立构建，文档与代码一致 |

## 10. 详细修复方案

### 10.1 WS1：主链收敛与 runtime 去双轨

#### 10.1.1 改造目标

- 建立单一 `authority runtime kernel`，统一 `startRun -> bootstrap -> drain -> terminal -> finalize` 语义。
- 将 driver 收敛为执行泵，将策略、治理、终态判定、finalize 责任全部归拢至 daemon。
- 保留 7 节点对外模型，但停止让象征性节点承载真实系统责任之外的额外叙事。

#### 10.1.2 现状问题

- `run-bootstrap`、`runtime`、`workflow-run-driver` 共同决定运行语义。
- `evaluateTransition` 与 adaptive skip 逻辑仍在 `model-core`。
- `VERIFY` 的 challenger model 身份与实际使用模型不一致。
- `PERSIST/HITL` 是 workflow 节点，但真正 persistence/release/human gate 逻辑主要在 daemon 后处理。

#### 10.1.3 设计决策

- 引入 `AuthorityRuntimeKernel`，作为 daemon 主路径唯一协调器。
- `WorkflowRunDriver` 只负责 lease 驱动执行、结果回传、事件追加，不再拥有 authority 语义。
- 将 transition/skip/terminal route 逻辑从 `model-core` 下沉到 daemon。
- 保留 7 节点结构，但将 `PERSIST/HITL` 明确为 daemon-owned system stage，不再暗示它们单独完成全部 persistence/release 语义。
- 采用小步重构，最后一次切除遗留分支。

#### 10.1.4 改造范围

- 需要修改的 package：
  - `antigravity-daemon`
  - `antigravity-model-core`
  - `antigravity-core`
- 需要新增或调整的模块：
  - 新增 `runtime-kernel` / `lifecycle-orchestrator`
  - 新增 `workflow-transition`
  - 下沉 `evaluateTransition`
  - 调整 `workflow-definition` 中的 step metadata
- 接口变化：
  - 为 node result 增加真实 `usedModelId`、`usedModelFamily`、`judgeSource`
  - 为 system stage 增加显式 `executorKind` 或 `executionMode`

#### 10.1.5 分步骤实施

1. 抽出 lifecycle hook 契约与 kernel 边界。
2. 将 `transition/skip/forceQueue` 从 `model-core` 迁回 daemon。
3. 修复 `VerifyExecutor` 的模型身份和 output contract。
4. 将 bootstrap、resume、recovery 统一走 kernel。
5. 将未接线 runtime 研究件从 stable exports/documentation 中剥离。

#### 10.1.6 测试方案

- 集成测试：`startRun`、`resumeInterruptedRun`、`cancel/replay/resume` 走统一 kernel。
- 回归测试：adaptive skip、VERIFY->HITL、PERSIST/HITL 终态。
- 合同测试：driver 不再决定 skip/terminal。
- 反例测试：host/model 输出不能改变下一个节点顺序。

#### 10.1.7 验收标准

- 主链决策点只剩 daemon kernel。
- `WorkflowRunDriver` 不再承载 authority 语义。
- `VERIFY` 相关 evidence 和 receipt 中的模型元数据与真实调用一致。
- README 保留的 runtime 主能力都能在 daemon 主链中找到唯一实现入口。

### 10.2 WS2：事件模型统一与 replay 强化

#### 10.2.1 改造目标

- 让运行、治理、artifact 关键语义尽可能事件化。
- 将 ledger side tables 彻底降为 projection/cache。
- 建立真实可用的 schema evolution 和 replay 基座。

#### 10.2.2 现状问题

- 当前 `WorkflowState` 来自 event log，但 receipt/handoff/verdict/session/artifact 状态依赖 ledger side tables。
- `refreshSnapshot` 与 `verifyRun` 都需要混合读取多个事实源。
- upcasting 存在框架，没有接入 daemon 默认读路径。

#### 10.2.3 设计决策

- 引入 daemon domain event taxonomy，不直接复用现有 side table JSON 作为事实模型。
- 使用双写迁移策略：先 append event，再投影 side table。
- 先覆盖 correctness、recovery、trust、release 所需关键语义，再考虑非关键事件。
- upcasting 仅在 daemon domain event version 明确后接入。

#### 10.2.4 改造范围

- 需要修改的 package：
  - `antigravity-daemon`
  - `antigravity-shared`
  - `antigravity-persistence`
- 需要新增或调整的模块：
  - `daemon-event` / `daemon-projection`
  - `replay-rebuild` / `projection-compare`
  - `UpcastingRegistry` 初始化接线
- 需要统一的状态与 schema：
  - `CompletionSessionRecord`
  - `ExecutionReceipt`
  - `HandoffEnvelope`
  - `SkipDecision`
  - `PolicyVerdict`
  - artifact export/verify state

#### 10.2.5 分步骤实施

1. 定义 daemon domain event 枚举、payload 和 version 规则。
2. 为 receipt/handoff/skip/verdict/session 增加 dual-write。
3. 实现 event-derived projection，并与 legacy snapshot 做 shadow compare。
4. 切换 recovery/replay 读路径优先使用 event-derived projection。
5. 在 read path 接入 upcasting decorator 与 registry。

#### 10.2.6 测试方案

- projector 单元测试
- event log-only replay 集成测试
- interrupted run recovery 测试
- dual-write drift 对比测试
- upcasting 兼容测试
- 篡改 side table、保留 event log 的反例测试

#### 10.2.7 验收标准

- receipt / handoff / verdict / skip / completion session / artifact export state 可由 event log 重建。
- 删除 projection/side table 后可重新投影恢复关键 run 语义。
- recovery 可以在缺失 ledger projection 时从 event log 自愈。
- 至少存在一组真实 event schema 演进与 upcast 测试。

### 10.3 WS3：治理网关主链化

#### 10.3.1 改造目标

- 让治理能力成为 runtime lifecycle 的强依赖机制。
- 收敛 `DaemonPolicyEngine` 与 `GovernanceGateway`，形成统一的 PDP/PEP 模型。

#### 10.3.2 现状问题

- bootstrap 用 `GovernanceGateway.preflight`，主运行时大量阶段却直接调用 `DaemonPolicyEngine.evaluate*`。
- `authorize/observe` 阶段没有真正接入 daemon 主链。
- policy verdict 已经是证据，但来源路径不统一。

#### 10.3.3 设计决策

- 保留 `DaemonPolicyEngine` 的 pack、rule、fact builder 价值，但收编为 pure evaluator。
- 让 `GovernanceGateway` 成为 daemon runtime stage orchestrator。
- daemon kernel 作为 PEP，gateway + evaluator 作为 PDP。
- 先适配，再替换，避免一次性重写现有 policy pack。

#### 10.3.4 改造范围

- 需要修改的 package：
  - `antigravity-core`
  - `antigravity-daemon`
- 需要新增或调整的模块：
  - `governance-context-builder`
  - `policy-facts-adapter`
  - `governance-stage-hooks`
- 需要改的接口：
  - `PolicyVerdict` 增加 `stage`、`subjectRef`、`decisionSource`
  - `Gateway` stage types 扩展为 daemon lifecycle 所需阶段

#### 10.3.5 分步骤实施

1. 提取 `DaemonPolicyEngine` 的 pure evaluator 与 facts adapter。
2. 给 `GovernanceGateway` 增加 daemon lifecycle stages。
3. 将 lease issuance、remote delegation、node completion、terminal release 接入 gateway。
4. 将 policy verdict 统一从 gateway 输出并事件化。
5. 删除 runtime 中 legacy direct evaluate 分支。

#### 10.3.6 测试方案

- gateway stage order 单元测试
- remote delegation authorize 测试
- node observe verdict 生成测试
- release block/human-gate 测试
- skip/approval/resume policy 回归测试

#### 10.3.7 验收标准

- 所有 policy verdict 都由统一 gateway stage evaluation 产生。
- `preflight/authorize/observe/release` 成为真实主链调用点。
- runtime 不再包含大量直接 `policyEngine.evaluateX` 分支。
- policy 可以在 lease issuance 和 remote delegation 前阻断。

### 10.4 WS4：federation / callback / trust 收紧

#### 10.4.1 改造目标

- 修复 remote worker delegation 的关键协议和 trust 缺陷。
- 让 callback advertisement、runtime callback auth、ingress 验签、freshness、anti-replay 完整闭环。

#### 10.4.2 现状问题

- callback 广告校验和实际使用的 header/config 不一致。
- timestamp 只有 parse，没有 freshness 约束。
- 默认 signer policy 过松，strict trust mode 缺位。
- 发现失败分类存在，但 verified 与可委派集合未完全分离。

#### 10.4.3 设计决策

- 增加 `RemoteProtocolVersion` 和 `ResolvedCallbackAuthConfig`。
- callback auth surface 采用“协商后固定”的模式：一旦 worker 被接纳，outbound lease 和 inbound ingress 使用同一套 negotiated config。
- 新增 `strictTrustMode`，开发可宽松，生产或显式启用时严格。
- 短期继续自定义协议；中期逐步靠近标准 A2A 风格字段与行为。

#### 10.4.4 改造范围

- 需要修改的 package：
  - `antigravity-daemon`
- 需要新增或调整的模块：
  - `callback-auth-config`
  - `remote protocol versioning`
  - `replay cache`
- 需要调整的 schema / manifest：
  - callback auth advertisement
  - strict trust mode
  - callback skew config
  - discovery issue surface

#### 10.4.5 分步骤实施

1. 修正 callback header/config 解析和使用的一致性。
2. 增加 callback freshness window 和 replay cache。
3. 引入 strict trust mode 与 verified-set delegation。
4. 把 discovery 与 delegation 的 trust 规则分开建模。
5. 增加 protocol version，并形成标准对齐文档。

#### 10.4.6 测试方案

- header 一致性测试
- stale / future timestamp 测试
- duplicate callback / replay 测试
- strict trust mode 下 unsigned worker 拒绝测试
- issuer / rotation group / schema version / digest mismatch 测试
- inline/poll/stream/callback 四模式回归测试

#### 10.4.7 验收标准

- callback advertisement 与 runtime header/config 完全一致。
- strict trust mode 下未签名或未验证 worker 一律不进入可委派集合。
- callback timestamp 超出 freshness window 必须拒绝。
- protocol version 可识别不兼容 worker。

### 10.5 WS5：artifact / attestation / ledger 一致性强化

#### 10.5.1 改造目标

- 将现有 proof surface 升级为统一 verification snapshot 驱动的 proof chain。
- 保证 artifact 之间是强一致语义绑定，而不是仅局部文件 digest 一致。

#### 10.5.2 现状问题

- trace bundle 比较完整，但部分下游 artifact verifier 仍以 digest + 局部字段为主。
- 缺少统一 `verification snapshot`，导致多个 builder/verify path 各自计算 payload。
- transparency ledger 链接的是结果摘要，未统一引用更强的 proof graph identity。

#### 10.5.3 设计决策

- 引入统一 `VerificationSnapshot` / `ArtifactReference` / `ProofGraphDigest`。
- 所有 snapshot-carrying 终态 artifact 从同一 frozen snapshot 生成。
- verifier 同时验证 payload、自身签名、上游 artifact refs、policy id、summary binding。
- HMAC 短期保留，proof graph 先做硬。

#### 10.5.4 改造范围

- 需要修改的 package：
  - `antigravity-daemon`
- 需要新增或调整的模块：
  - `verification-snapshot`
  - `artifact-reference`
  - `proof-graph`
  - 聚合 verifier
- 需要调整的 artifact：
  - `policy report`
  - `invariant report`
  - `release attestation`
  - `release dossier`
  - `release bundle`
  - `certification record`
  - `transparency ledger`

#### 10.5.5 分步骤实施

1. 定义统一 verification snapshot 与 artifact reference schema。
2. 让 `verifyRun` 产出稳定 snapshot。
3. 让所有 snapshot-carrying 终态 artifact 从该 snapshot 生成。
4. 强化各 verifier 的 cross-artifact 检查。
5. 让 transparency ledger 追加 proof graph digest。

#### 10.5.6 测试方案

- artifact substitution 测试
- digest drift 测试
- mismatch policy/invariant/dossier/bundle 测试
- wrong upstream digest 测试
- end-to-end release gate regression 测试

#### 10.5.7 验收标准

- 任一上游 artifact 被替换，下游 verify 必须失败。
- 所有 snapshot-carrying 终态 artifact 引用同一 verification snapshot。
- transparency ledger 能证明 certification record 与 release bundle 属于同一 proof graph。
- release 流程在 artifact 验证失败时不能继续对外暴露“已完成”语义。

### 10.6 WS6：高阶能力接线或降级

#### 10.6.1 改造目标

- 对未接线高级能力做明确分层，停止概念堆砌。
- 把值得接入主链的能力纳入 roadmap，不值得立即接的能力标记为 `experimental` 或冻结。

#### 10.6.2 现状问题

- cyclic DAG、upcasting、Dag tracer、vector memory、formal spec、benchmark 都是“有代码/有测试/有文档”，但主链依赖度有限。
- memorySearch 是查询工具，不参与 analyze/route/verify 决策。
- benchmark/interop 更像内部 harness，而不是对外严肃评测。

#### 10.6.3 设计决策

- `GovernanceGateway` 立即主链接入。
- `CyclicDagEngine` 保留但降级为 `experimental`。
- `UpcastingEventStore` 先重写事件模型，再接主链。
- `DagEngineTracer` 保留，先降级为 telemetry sink 的候选实现。
- `VectorMemory` 冻结为 `experimental`，后续如果要接，必须定义 embedding provider、memory admission、runtime 注入策略。
- formal spec 保留为 conformance 资产，不再对外表述为正式证明。
- benchmark 短期定位为内部回归与 evidence harness。

#### 10.6.4 改造范围

- 需要修改的 package：
  - `antigravity-core`
  - `antigravity-persistence`
  - `antigravity-daemon`
  - docs / README
- 需要新增或调整的模块：
  - `experimental` export namespace
  - `RuntimeTelemetrySink`
  - capability stability matrix

#### 10.6.5 分步骤实施

1. 为高阶模块建立 stable / experimental / frozen 分类表。
2. 在代码 export 和 README 中同步落地。
3. 给 observability 引入轻量 telemetry sink 接口，默认 NoOp。
4. 将 vector memory 从默认叙事中剥离。
5. 调整 benchmark / interop / formal spec 的文档定位。

#### 10.6.6 测试方案

- export contract 测试
- telemetry sink smoke test
- feature flag off-by-default 测试
- benchmark output 稳定性测试

#### 10.6.7 验收标准

- README 中所有主能力都已接主链，或明确标记为 `experimental`。
- 默认运行路径不再依赖未接线高级能力。
- benchmark、formal、memory、observability 的产品定位与代码状态一致。

### 10.7 WS7：包边界、发布形态与文档对齐

#### 10.7.1 改造目标

- 让 daemon 成为真实核心产物，而不是只存在于 extension bundle 内部。
- 建立清晰的 package contract 和正式文档体系。

#### 10.7.2 现状问题

- 根发布物仍然是 VS Code extension-first。
- daemon 包仍然是内部产物。
- 存在跨包 `src` 导入，说明 contract 还没稳定。
- 文档已经使用 runtime-first 叙事，但 build/release 仍围绕 extension 展开。

#### 10.7.3 设计决策

- 中期形成 `daemon/runtime-first + MCP + optional extension shell` 双发布形态。
- 先建立公共 contracts export，再拆发布链。
- 保留当前 VSIX 路线作为迁移期兼容产物。

#### 10.7.4 改造范围

- 需要修改的 package：
  - 根包
  - `antigravity-core`
  - `antigravity-daemon`
  - `antigravity-mcp-server`
  - `antigravity-vscode`
  - `antigravity-persistence`
- 需要调整的内容：
  - package exports
  - CI/build matrix
  - release artifacts
  - README / Architecture / Quick Start / Contract 文档

#### 10.7.5 分步骤实施

1. 建立公共 contract exports，消除跨包内部导入。
2. 拆 CI：daemon、mcp-server、extension 分开构建与 smoke。
3. 让 extension 通过稳定 runtime contract 启动/连接 daemon。
4. 将 daemon 和 mcp-server 升级为一等发布目标。
5. 重写正式文档，建立 stable vs experimental 文档规范。

#### 10.7.6 测试方案

- package import boundary 测试
- standalone daemon build/run smoke test
- standalone MCP build/run smoke test
- extension-to-external-daemon 集成测试
- 文档与命令一致性检查

#### 10.7.7 验收标准

- 仓库内不存在 `@.../src/...` 跨包内部导入。
- daemon 与 MCP 可独立构建并启动。
- extension 不再是架构中心，只是可选 UI 壳层。
- 正式文档与实际发布边界一致。

## 11. 问题到修复项映射

| 问题 | 风险等级 | 根因 | 对应 Workstream | 修复策略 |
|---|---|---|---|---|
| 主路径与研究件双轨 | 高 | R1 | WS1, WS6 | 抽 kernel、driver 去 authority、研究件分层 |
| 事件流不是唯一事实源 | 高 | R2 | WS2 | daemon domain events + projection cutover |
| 治理链未中枢化 | 高 | R3 | WS3 | gateway 主链化、policy engine 收编 |
| callback advertisement 与 runtime header 不一致 | 高 | R4 | WS4 | negotiated callback auth config |
| callback timestamp 仅 parse | 高 | R4 | WS4 | freshness window + replay cache |
| 默认 signer policy 过松 | 中 | R4 | WS4 | strict trust mode + policy profile |
| artifact proof chain 语义绑定不足 | 高 | R5 | WS5 | unified verification snapshot + cross-artifact verify |
| transparency ledger 仅本地 hash chain | 中 | R5 | WS5 | proof graph digest 与更强引用绑定 |
| cyclic DAG 未进入主链 | 中 | R6 | WS6 | experimental 化，后续再决定是否 mainline |
| upcasting 未接线 | 中 | R6 | WS2, WS6 | event schema v2 后接入 |
| OTel tracer 未贯通 | 中 | R6 | WS6 | telemetry sink 先行，OTel 后接 |
| vector memory 未接线 | 中 | R6 | WS6 | 冻结或重写后再接 |
| formal spec 价值被过度表述 | 中 | R6 | WS6 | 降级为 conformance 资产 |
| benchmark 更像内部 harness | 中 | R6 | WS6 | 对齐定位，后续再外化 |
| 包边界泄漏 | 中 | R7 | WS7 | contracts export 清理内部导入 |
| extension-first 发布形态与核心边界不一致 | 中 | R7 | WS7 | runtime-first 双发布 |
| README 能力表述超前 | 中 | R1, R6, R7 | WS6, WS7 | 文档重写与能力分层 |

## 12. 开发任务清单

### P0：持续污染主链或影响 correctness / trust / release 的任务

| 任务 | 背景 | 修改范围 | 依赖 | 风险 | 验收标准 |
|---|---|---|---|---|---|
| P0-1 修复 VERIFY 模型身份语义 | 当前 evidence gate 使用伪 challenger model 语义 | `model-core`, `daemon` output contract | 无 | 低 | VERIFY 使用真实 model id/family |
| P0-2 抽 AuthorityRuntimeKernel | 运行语义分散在 bootstrap/runtime/driver | `daemon/runtime`, `run-bootstrap`, `workflow-run-driver` | 无 | 中 | 主链存在单一 lifecycle coordinator |
| P0-3 transition/skip authority 回迁 | driver 仍持有 authority 语义 | `model-core`, `daemon` | P0-2 | 中 | skip/forceQueue 由 daemon 发起 |
| P0-4 事件化 session/receipt/handoff/verdict/skip | event log 非唯一事实源 | `daemon/schema`, `runtime`, `ledger` | P0-2 | 高 | dual-write event append 上线 |
| P0-5 callback header 一致性修复 | 协议闭环缺失 | `remote-worker`, `server`, schema | 无 | 中 | callback 广告与 ingress 使用同一 auth surface |
| P0-6 callback freshness 与 anti-replay | 远程回调安全边界不足 | `remote-worker` | P0-5 | 中 | stale/replayed callback 被拒绝 |
| P0-7 gateway 主链接入骨架 | 治理未中枢化 | `core/governance`, `daemon/policy-engine`, `daemon/runtime` | P0-2 | 高 | lifecycle hook 可统一调用 gateway |

### P1：增强系统完整性与一致性的任务

| 任务 | 背景 | 修改范围 | 依赖 | 风险 | 验收标准 |
|---|---|---|---|---|---|
| P1-1 event-derived projection 与 shadow compare | 为 replay cutover 做准备 | `daemon/projection`, `verifyRun`, `refreshSnapshot` | P0-4 | 高 | legacy 与 event-derived snapshot 可对比 |
| P1-2 收敛 `DaemonPolicyEngine` 为 pure evaluator | 为 gateway 主链化减耦 | `daemon/policy-engine`, `core/governance` | P0-7 | 中 | runtime 不再直接散落 policy branch |
| P1-3 strict trust mode | 默认策略过松 | `trust-registry`, `remote-worker`, manifest | P0-5 | 中 | strict 模式下未验证 worker 不可委派 |
| P1-4 verification snapshot + artifact ref 统一 | artifact 语义绑定不足 | `release-*`, `release-artifact-verifier` | P1-1 | 高 | 全部终态 artifact 引用同一 snapshot |
| P1-5 public contracts export | 包边界不清 | `core`, `persistence`, `daemon` | 无 | 低 | 无跨包 `src` 导入 |
| P1-6 daemon/MCP 独立构建与 smoke | 发布边界与系统边界不一致 | 根构建、CI、runtime packages | P1-5 | 中 | daemon/MCP 可单独构建启动 |
| P1-7 README / API / 文档对齐 | 防止继续包装 | docs, README, contract 文档 | WS6/WS7 决策完成 | 低 | 文档只保留 stable/mainline 能力 |

### P2：提升先进性、标准化和长期演进能力的任务

| 任务 | 背景 | 修改范围 | 依赖 | 风险 | 验收标准 |
|---|---|---|---|---|---|
| P2-1 CyclicDagEngine experimental 化 | 当前未接主链 | `core/dag`, docs | WS6 | 低 | 文档和 exports 标明 experimental |
| P2-2 UpcastingEventStore 真接线 | 目前只有框架 | `event-store`, daemon init | WS2 | 中 | 至少 1 条真实 upcast 链投入使用 |
| P2-3 RuntimeTelemetrySink + OTel 接线 | 可观测性未贯通 | `core/observability`, `daemon/runtime` | WS1 | 中 | run/node/remote/artifact verify 有统一 tracing hook |
| P2-4 VectorMemory 策略化接线或冻结 | 当前只是概念层能力 | `persistence/memory`, docs | WS6 | 中 | 要么具备 runtime 注入语义，要么正式冻结 |
| P2-5 benchmark 对外化路线 | 当前更像内部 harness | `daemon/benchmark*`, docs | WS6 | 低 | 对外前有 baseline/dataset/interop 说明 |
| P2-6 A2A-style 标准对齐层 | 当前仍是自定义协议 | `remote-worker`, schema, docs | WS4 | 中 | 自定义协议具备版本化与标准映射 |
| P2-7 非对称签名双栈 | HMAC 长期上限明显 | trust/provenance 全链 | WS4, WS5 | 高 | HMAC + asymmetric 双栈验证可用 |

## 13. 建议 PR 拆分

1. PR-1：`VERIFY` 模型身份语义修复 + output contract 校正
2. PR-2：callback auth surface 一致性修复 + freshness/anti-replay
3. PR-3：`AuthorityRuntimeKernel` 抽象 + driver 去 transition authority
4. PR-4：daemon domain event v1 + dual-write `completion session / receipt / skip / verdict / handoff`
5. PR-5：event-derived projection + replay shadow compare
6. PR-6：`GovernanceGateway` 适配 daemon stages + `DaemonPolicyEngine` pure evaluator 化
7. PR-7：verification snapshot / artifact reference / verifier 强化
8. PR-8：strict trust mode + verified-set delegation
9. PR-9：public contracts export + 消除跨包 `src` 导入
10. PR-10：daemon/MCP 独立构建与 runtime-first 发布链
11. PR-11：stable vs experimental 模块分层 + README/架构文档重写
12. PR-12：upcasting / telemetry sink / vector memory / benchmark 路线的后续独立演进

## 14. 版本化路线图

### Phase 1（1~2 周）

- 阶段目标：先封住 correctness / trust / release 的主链缺陷，停止继续污染。
- 交付物：
  - `VERIFY` 模型身份语义修复
  - callback header 一致性修复
  - callback freshness 与 anti-replay
  - lifecycle kernel 骨架
  - transition authority 回迁
  - daemon event v1 设计与首批 dual-write
- 风险：
  - adaptive skip、recovery、remote callback 回归
- 不做的代价：
  - release/evidence 判断继续带伪语义
  - 远程 callback 安全面继续偏软
- 完成后系统状态：
  - daemon authority 主链更加清晰
  - 最危险的远程协议缺陷被修复
  - event canonicalization 开始落地

### Phase 2（1~2 月）

- 阶段目标：完成结构性收敛，让 runtime、event、governance、artifact 真正一致。
- 交付物：
  - gateway 主链化
  - event-derived projection / replay / recovery cutover
  - verification snapshot + artifact reference 统一
  - strict trust mode
  - public contracts export
  - daemon/MCP 独立构建与 smoke
- 风险：
  - 历史 run 兼容
  - cutover 时行为细节差异
- 不做的代价：
  - 系统继续停留在双轨研究系统
- 完成后系统状态：
  - 关键运行、治理、artifact 语义可以由统一主链解释
  - replay、verify、release 开始真正变硬
  - runtime-first 边界基本成立

### Phase 3（3~6 月）

- 阶段目标：只把值得做实的先进能力接主链，其余能力保持严格分层。
- 交付物：
  - upcasting 真接线
  - telemetry sink / OTel 主链化
  - vector memory 明确是主链能力还是冻结
  - benchmark 对外化路线
  - A2A-style 协议对齐层
  - asymmetric signature 双栈试运行
- 风险：
  - 过早标准化导致再次分散资源
- 不做的代价：
  - 系统上限会停在“工程扎实的研究系统”
- 完成后系统状态：
  - 主链不仅硬，而且部分高阶能力真正落地
  - 对外叙事与真实实现开始接近

## 15. 架构取舍建议

### 15.1 模块命运表

| 模块 | 建议 |
|---|---|
| `GovernanceGateway` | 立即接入主链 |
| `CyclicDagEngine` | 暂时保留但标 `experimental` |
| `UpcastingEventStore` | 重写事件模型后再接 |
| `DagEngineTracer` | 暂时保留但标 `experimental`，先作为 telemetry sink 候选实现 |
| `VectorMemory` | 暂时冻结 / `experimental`，后续重写或接线后再考虑主链化 |

### 15.2 关键取舍

- `DaemonPolicyEngine` 与 `GovernanceGateway`：
  - 明确立场：`GovernanceGateway` 做主链 stage orchestrator，`DaemonPolicyEngine` 收编为 pure evaluator / rule backend。
- `ledger side tables` 与 `event log`：
  - 明确立场：event log 为 canonical source，side tables 全部降为 projection/cache。
- `VS Code extension-first` 发布形态：
  - 明确立场：要改成 runtime-first，但通过双发布平滑迁移，不立即打断当前 VSIX。
- `A2A-style` 演进方式：
  - 明确立场：短期继续自定义增强，必须版本化；中期逐步向标准协议靠拢。
- trust/provenance 路线：
  - 明确立场：短期继续 HMAC 并加 strict mode；中期引入 asymmetric 双栈；长期转向非对称签名为主。

## 16. 风险与回滚策略

- 风险最大的改动：
  - event canonicalization
  - gateway 主链化
  - artifact verification snapshot 统一
  - strict trust mode 默认收紧
- 最容易破坏兼容性的改动：
  - daemon event schema
  - callback protocol/header/freshness 规则
  - artifact payload schema
  - daemon/MCP 独立发布与 extension 契约
- 适合 behind feature flag 的改动：
  - strict trust mode
  - event-derived projection read path
  - gateway 主链 cutover
  - telemetry sink / OTel
  - asymmetric signature dual-stack
- 必须一次切换的改动：
  - runtime 中 legacy direct policy branches 的最终移除
  - stable vs experimental 能力分类的文档收敛
  - callback auth 语义与广告字段的一致性切换
- 迁移期兼容策略：
  - dual-write event + legacy table projection
  - 新旧 snapshot 并行比对
  - artifact schema additive 版本化
  - remote worker 协议引入 `protocolVersion`
  - 保留 extension shell，逐步改为连接外部 daemon
- 回滚方式：
  - governance cutover 保留 legacy branch 开关
  - strict trust mode 先 opt-in，再 default-on
  - projection 切读前保留 legacy `refreshSnapshot`
  - 新旧 verifier 并行一段时间
  - runtime-first 发布前保留现有 VSIX 构建链

## 17. 推荐执行顺序

1. 修复 `VerifyExecutor` 的模型身份语义。
2. 修复 callback advertisement 与 runtime header 的一致性。
3. 增加 callback freshness 与 anti-replay。
4. 抽出 `AuthorityRuntimeKernel` 与 lifecycle hooks。
5. 将 transition/skip/forceQueue authority 从 driver 迁回 daemon。
6. 定义 daemon domain events 词汇表和 version 规则。
7. 为 session/receipt/handoff/skip/verdict 开启 dual-write event append。
8. 实现 event-derived projection 并做 shadow compare。
9. 提取 `DaemonPolicyEngine` 的 pure evaluator 和 facts adapter。
10. 将 `GovernanceGateway` 接入 preflight/authorize/observe/release 四阶段。
11. 移除 runtime 中 legacy direct policy branches。
12. 定义统一 `VerificationSnapshot` 与 `ArtifactReference`。
13. 让 attestation/dossier/bundle/certification/transparency 全部绑定统一 snapshot。
14. 引入 strict trust mode，并让 delegate selector 只看 verified worker 集合。
15. 建立公共 contracts export，消除跨包 `src` 导入。
16. 拆 CI 和 build matrix，让 daemon/MCP 可独立构建。
17. 对 cyclic/upcasting/otel/vector/formal/benchmark 做 stable vs experimental 分类。
18. 重写 README、Architecture、Contract、Cookbook。
19. 在主链稳定后，再决定 upcasting、OTel、vector memory 的后续接线。
20. 最后推进 runtime-first 发布与 extension shell 化。

## 18. 需要复核的点

- 现有外部 remote worker 是否已经依赖固定 callback header，而不是 agent card 广告值。
- 仓库外是否存在依赖 `@anthropic/*/src/*` 的内部消费者。
- 是否已有历史 run 数据需要长期兼容 ledger-only 语义。
- VS Code Marketplace 或现有分发链路是否要求继续把 extension 作为唯一主入口。
- formal spec 是否在仓库外有独立验证流水线，如果有，需要避免误判其当前成熟度。
- 现有 benchmark 是否已有第三方消费者或外部公开结果，影响后续定位调整。

## 19. 文档维护说明

- 本文档是整改主文档，后续 PR 不应绕开本文档新增新的整改主线。
- 若某个 workstream 的设计决策发生变化，应直接更新对应章节，而不是另建平行文档。
- 每个 Phase 完成后，应更新：
  - 执行摘要
  - 工作流状态
  - backlog 优先级
  - PR 序列完成情况
  - 需要复核的点
- 新增能力如果未接入主链，必须先更新本文档中的“模块命运表”和“stable vs experimental”结论。
- 当 event canonicalization、governance 主链化、runtime-first 发布三件事全部完成后，应考虑将本文档拆分为：
  - 稳定架构文档
  - 迁移与兼容文档
  - 历史整改记录

## 20. 附录：关键审计证据点与关键技术债/亮点

### 附录 A：关键审计证据点

#### A.1 主路径仍然是 `DagEngine`，而不是 `CyclicDagEngine`

- 证据点：
  - `AntigravityDaemonRuntime.startRun()` 默认实例化 `new DagEngine()`。
  - interrupted run recovery 路径同样实例化 `new DagEngine()`。
- 说明：
  - 虽然仓库中存在 `CyclicDagEngine`、loop event 和 dynamic topology 代码，但默认 authority runtime 并未启用受控循环能力。
- 为什么重要：
  - 这说明“循环 DAG”当前不是主链能力，而是实验能力；如果继续按主能力表述，会误导架构判断和后续依赖设计。

#### A.2 callback advertisement 与 runtime header/config 不一致

- 证据点：
  - remote worker 发现阶段会校验 callback signature header、timestamp header、encoding 广告。
  - 运行时下发 callback lease 与 ingress 验签使用的是固定常量，而不是完全使用广告解析后的协商结果。
- 说明：
  - 协议表面有 advertisement，实际执行面仍保留部分硬编码。
- 为什么重要：
  - 这会导致“广告存在但不是协议事实”，从而削弱 callback auth advertisement 的可信度。

#### A.3 callback timestamp 只 parse，不校验 freshness

- 证据点：
  - callback ingress 会检查 timestamp 是否可解析，但没有强制校验时间偏差窗口。
- 说明：
  - 当前防护更接近“格式校验”，不是严格 anti-replay freshness 检查。
- 为什么重要：
  - 远程 callback 入口是 authority 边界之一，缺少 freshness 会显著降低回调安全强度。

#### A.4 默认 trust policy 偏松

- 证据点：
  - trust registry 默认 signer policy 对 remote worker advertisement、benchmark source registry、trace/release artifact 多数设置为 `requireSignature: false`。
- 说明：
  - 仓库支持严格验证，但默认基线仍允许较多 unsigned / non-strict 场景存在。
- 为什么重要：
  - 如果不引入 strict trust mode，trust surface 很容易停留在“可用但不够硬”的状态。

#### A.5 `challengerModelId` 存在硬编码语义

- 证据点：
  - `VerifyExecutor` 返回的 output 中存在固定 `challengerModelId` 字段，而不是直接绑定真实使用模型。
- 说明：
  - distinct-family、verification receipt 和 release gate evidence 会被伪造的 challenger 元数据污染。
- 为什么重要：
  - 这类问题不会让系统立即崩溃，但会直接破坏“证据链可信度”。

#### A.6 memory 未进入 runtime 决策

- 证据点：
  - daemon 提供 `memorySearch` 接口。
  - `MemoryManager` 会记录 episodic / semantic memory。
  - 但主运行时未在 analyze/route/verify/release 中消费 recall 结果。
- 说明：
  - 当前 memory 是查询能力，不是 runtime 决策能力。
- 为什么重要：
  - 这意味着 README 中更强的“长期记忆 agent”叙事尚未成立。

#### A.7 `persistence` 仍存在跨包 `src` 导入

- 证据点：
  - `antigravity-persistence` 中仍直接依赖 `@anthropic/antigravity-core/src/...` 的内部路径。
- 说明：
  - 说明公共 contracts export 尚未稳定，模块边界存在泄漏。
- 为什么重要：
  - 这会阻碍 daemon/runtime-first 发布与独立演进，也增加重构摩擦。

#### A.8 server 中存在重复与整洁性问题

- 证据点：
  - daemon server 路由分发中存在重复的 `/transparency-ledger` 与 `/verify-transparency-ledger` 分支。
- 说明：
  - 这不一定影响功能，但说明控制面仍存在未收敛的实现细节。
- 为什么重要：
  - 在发布治理与证据接口层出现这种重复，说明服务面尚未完全进入“严格维护状态”。

#### A.9 `PERSIST/HITL` 更像象征性节点

- 证据点：
  - `PERSIST` executor 本身只返回轻量标记结果，真正 artifact export/verify 在 daemon finalize 阶段完成。
  - `HITL` 节点主要输出审批需求，而真正 pause/resume/release gate 仍由 daemon 控制。
- 说明：
  - 7 节点模型成立，但其中部分节点更多承担显式状态机可视化角色，而非全部系统语义。
- 为什么重要：
  - 这要求后续文档和实现都要明确“workflow node semantics”与“daemon system stage semantics”的边界。

#### A.10 artifact verifier 仍偏 digest 校验，而非强语义绑定

- 证据点：
  - 各类 verifier 已经会做 payload digest 和部分上游一致性检查。
  - 但统一 verification snapshot、proof graph digest 和跨 artifact 强语义绑定尚未完全建立。
- 说明：
  - 当前 proof chain 已经强于一般项目，但还没有达到“任一语义替换都能被统一阻断”的级别。
- 为什么重要：
  - 这是从“工程可用 artifact surface”升级到“硬发布治理体系”的关键门槛。

### 附录 B：最危险的技术债

1. 主链与研究件长期双轨，继续演化会不断制造新分叉。
2. event log 不是唯一事实源，导致 replay 上限受限。
3. gateway 与 policy engine 双中心，治理难以统一主链化。
4. callback advertisement 与 runtime auth surface 不一致。
5. callback timestamp 缺少 freshness window。
6. 默认 trust policy 过松，strict trust 缺位。
7. `challengerModelId` 硬编码污染 verification evidence。
8. artifact proof chain 仍缺统一 verification snapshot。
9. memory 与 observability 都存在但未接入主链关键决策。
10. 包边界与发布边界未收敛，daemon-first 仍被 extension-first 形态覆盖。

### 附录 C：最值得保留的设计亮点

1. daemon 已经是真实 authority，而不是概念中心。
2. completion session 的 `pending -> prepared -> committed -> applied` 设计扎实。
3. interrupted run recovery 和 stale lease recovery 有真实实现。
4. remote worker 四种 response mode 都是主实现，不是接口占位。
5. tribunal 支持 remote juror + local fallback + quorum 逻辑。
6. trust registry 已经统一 key lifecycle、issuer、rotation group 与 policy scope。
7. trace/report/dossier/bundle/certification/transparency 已形成完整证据面。
8. release gate 可以在终态后再次将 run 打回 `paused_for_human`。
9. benchmark source registry 的 `locked + signed + override restriction` 设计有长期价值。
10. 测试与类型检查密度明显高于一般 agent 仓库。

### 附录 D：结论标签

**工程扎实的研究系统**

解释：该仓库已经具备真实 daemon-owned authority runtime、artifact proof surface 与联邦执行基础，但主链、事件模型、治理中枢化和高级能力接线仍未完全收敛，因此当前最佳定位仍是工程扎实的研究系统，而不是接近生产的先进平台。

### 附录 E：优先补齐的关键测试方向

#### E.1 纯 event-log 重建完整 run 语义

- 测试目标：验证在 projection、side table 或 snapshot 缺失的情况下，仍可仅凭 append-only event log 重建完整 run 语义。
- 为什么优先级高：这是事件流从“运行状态基底”升级到“关键事实源”的前提，也是 WS2 是否真正成立的核心验收面。
- 主要覆盖范围：`completion session`、`execution receipt`、`handoff`、`skip decision`、`policy verdict`、artifact export state、recovery / replay / refreshSnapshot。

#### E.2 artifact substitution / digest drift / verification snapshot mismatch

- 测试目标：验证任一上游 artifact 被替换、篡改或与统一 verification snapshot 不一致时，下游 verifier 和 release gate 都能阻断。
- 为什么优先级高：artifact surface 已经是当前系统最强能力之一，若不补强这一类反例测试，proof chain 很容易停留在“文件级正确”而不是“语义级正确”。
- 主要覆盖范围：trace bundle、policy report、invariant report、release attestation、release dossier、release bundle、certification record、transparency ledger。

#### E.3 callback replay / stale / skew / duplicate delivery

- 测试目标：覆盖 callback token 过期、时间戳过旧/过新、重复投递、同 token 不同 body、重复签名等关键反例。
- 为什么优先级高：callback ingress 是本地 authority 与远程 worker 的关键边界，当前又正好存在 freshness 和协议闭环不足的问题。
- 主要覆盖范围：`remote-worker callback ingress`、callback token 生命周期、HMAC 验签、freshness window、anti-replay cache、timeline 审计记录。

#### E.4 strict trust mode 反例测试

- 测试目标：验证 strict trust mode 下，未签名、签名不满足 policy、issuer 不匹配、rotation group 不匹配、schema version 不匹配、digest pin 不匹配、广告过期的 worker 或 registry 都不能进入可用集合。
- 为什么优先级高：strict trust mode 是后续从“支持 trust”走向“trust 真变硬”的关键闸门，必须先建立反例测试。
- 主要覆盖范围：remote worker discovery、benchmark source registry、trust registry signer policy、delegate selector、discovery issues。

#### E.5 stable vs experimental capability boundary regression

- 测试目标：验证主链默认路径不再依赖未接线高级能力，同时 stable/export/docs 与实际运行状态一致。
- 为什么优先级高：整改的一个核心目标就是消除“能力存在但未主链化”的灰色地带，这需要回归测试来长期防止重新漂移。
- 主要覆盖范围：`CyclicDagEngine`、`UpcastingEventStore`、`DagEngineTracer`、`VectorMemory`、formal spec、benchmark/interop 描述、README 与 package exports。

### 附录 F：与原始审计/修复材料的对齐自检

| 对齐项 | 当前状态 | 说明 |
|---|---|---|
| 总体结论标签 | 已纳入 | 已在附录 D 明确保留单一结论标签，并与主文判断一致 |
| 包装词 vs 真能力 | 已纳入 | 已在“能力表述与主链落地情况”中补回并加总括判断 |
| 世界先进对标评分 | 已纳入 | 已补独立对标评分章节，含分数、对标对象、差距与补齐路径 |
| 关键审计证据点 | 已纳入 | 已在附录 A 汇总为证据点 -> 说明 -> 为什么重要 |
| 最危险技术债 | 已纳入 | 已在附录 B 汇总 |
| 最值得保留设计亮点 | 已纳入 | 已在附录 C 汇总 |
| Workstream | 已纳入 | 主体文档已包含 7 个 workstream 与详细整改方案 |
| P0 / P1 / P2 任务 | 已纳入 | 开发任务清单已分层整理 |
| Phase 路线图 | 已纳入 | 已按 1~2 周 / 1~2 月 / 3~6 月整理 |
| 需要复核的点 | 已纳入 | 已保留独立章节并继续有效 |
| 关键测试补齐方向 | 已纳入 | 已新增附录 E，作为全局测试补齐汇总 |

自检结论：

- 当前文档已经覆盖原始审计结论与修复方案中的主体判断、结构性问题、整改 workstream、阶段路线、风险与取舍建议。
- 现阶段剩余工作不再是“文档缺大项”，而是随着整改推进持续更新状态、完成标志和兼容策略细节。
