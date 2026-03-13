# Antigravity Workflow

> **Daemon-owned workflow runtime with audited mainline boundaries** — DAG orchestration × policy evaluation × artifact verification

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.12+-purple.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Antigravity Workflow 是一个**Antigravity 专用、daemon-owned 多智能体协作系统**。当前真实默认路径是一条以 `antigravity-daemon` 为中心的 workflow authority runtime：默认使用 7 节点状态机、`DagEngine`、`AuthorityRuntimeKernel`、`JsonlEventStore` + `UpcastingEventStore` 读路径、policy-as-code、A2A-style remote worker federation，以及一组可验证的 release artifacts。ArkTS LSP / DevEco ace-server 仍然保留，但作为插件内可单独开关的附加能力，不再驱动宿主激活与产品入口。

## 当前验收状态

- 构建与验证：`npm test` 474/474、`npm run smoke:daemon`、`npm run smoke:mcp` 已通过
- 当前总体验收结论：**验收通过 — P0/P1/P2 全部修复并验证**
- 已进入默认主链：`AuthorityRuntimeKernel`、daemon-owned transition/skip authority、`UpcastingEventStore` 默认读路、callback hardening、`RuntimeTelemetrySink` hook surface、`GovernanceGateway` 默认治理入口（7 个评估点 + verdict enforcement + bootstrap 统一网关）、`VerificationSnapshot` / `proofGraphDigest` production artifact chain、recovery diagnostics、active gate SQLite 持久化、skip/approval/resume/human-gate 全阶段执法
- 部分主链 / 需配置：strict trust mode（默认关闭，VSCode Settings 或 env 启用）、federation fail policy（默认 fallback，VSCode Settings 或 env 修改）、strict replay mode（默认关闭，DaemonConfig 编程 API 启用）
- 未进入默认主链：`CyclicDagEngine`（experimental）

当前权威验收状态见 [FINAL_ACCEPTANCE_REPORT.md](FINAL_ACCEPTANCE_REPORT.md)。

## ✨ 核心特性

| 能力 | 当前默认路径 | 状态 | 备注 |
|------|------|------|------|
| DAG 编排 | 7 节点状态机 + `DagEngine` | 通过 | `CyclicDagEngine` 不是默认主链能力 |
| 治理 | `GovernanceGateway` + policy engine + stage-tagged verdicts | 通过 | 7 个评估点 + verdict enforcement + bootstrap 统一网关 |
| Event Sourcing / Replay | JSONL event log + checkpoint + `UpcastingEventStore` 读路 + domain events | 通过 | Domain-event JSONL 是 fail-open 审计副本；SQLite ledger 仍为默认权威 snapshot 来源 |
| 可观测性 | `RuntimeTelemetrySink` hook surface | 通过 | `DagEngineTracer` / OTel 仍是 experimental |
| 记忆系统 | keyword recall search | 通过 | experimental，不参与运行时决策 |
| 信任治理 | Trust Registry + callback hardening + strict trust mode | 部分通过 | callback hardening 真实生效；strict trust mode 需 env 配置启用，默认关闭 |
| 远程 Worker 联邦 | Agent Card + Remote Worker Directory | 通过 | A2A-style，自定义项目协议而非标准 A2A runtime |
| 自适应协作 | policy-authorized skip / forceQueue | 基本通过 | daemon 默认主链持有 authority；driver 仍保留 legacy fallback |
| 发布产物 | trace bundle + policy / invariant / attestation / dossier / bundle / certification + `VerificationSnapshot` | 通过 | 6 个 snapshot-carrying 终态 artifact 共享 frozen `snapshotDigest` |
| 基准 / 互操作 | benchmark harness / interop harness | 通过 | experimental harness，不是 correctness constraint |

## 🏗️ 架构

``` 
┌──────────────────────────────────────────────────────────┐
│                 MCP / Workflow Protocol                   │
│ workflow.run │ workflow.getState │ workflow.advance      │
├──────────────────────────────────────────────────────────┤
│                 Daemon Control Plane                      │
│      antigravity-daemon (authority + durable runtime)      │
├────────┬────────┬───────────┬───────────────┤
│  DAG   │ Risk   │ Policy /  │ Remote Worker │
│ Engine │ Router │ Governance│  Directory    │
│(default)│(DR/4L)│ (gateway) │ (A2A-style)   │
├────────┴────────┴───────────┴───────────────┤
│  Event Log + Replay │  Evidence   │  Telemetry Hooks     │
│ (JSONL+Upcasting)   │    Gate     │ (OTel not mainline)  │
├──────────────────────────────────────────────────────────┤
│             antigravity-shared (Schema/Types/Zod)         │
└──────────────────────────────────────────────────────────┘
```

## 📦 包结构

```
packages/
├── antigravity-shared      # 共享类型 + Zod Schema + Event 投影器
├── antigravity-core        # 核心工作流运行时
│   ├── contracts/          #   运行时接口
│   ├── dag/                #   DAG 引擎（CyclicDagEngine 非默认主链）
│   ├── governance/         #   治理原语 + GovernanceGateway（默认治理入口）
│   ├── risk/               #   DR 风险路由
│   ├── federation/         #   Agent card + handoff primitives
│   ├── observability/      #   Structural Tracer (experimental)
│   └── ...                 #   核心运行时子模块
├── antigravity-persistence # 持久化 (JSONL + Upcasting + Keyword Memory)
├── antigravity-model-shared # 模型目录共享契约
├── antigravity-model-core  # Host-facing 模型编排服务
├── antigravity-daemon      # Antigravity daemon-owned runtime
├── antigravity-mcp-server  # MCP Server 入口
├── antigravity-vscode      # VS Code / Antigravity 集成层
└── antigravity-webview     # Dashboard UI
```

## 🚀 快速开始

```bash
# 安装
git clone https://github.com/like3213934360-lab/conductor.git && cd conductor
npm install

# 构建
npm run build

# Antigravity / VS Code
Cmd+Shift+P → Antigravity Workflow: 运行 Antigravity 工作流
```

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const paths = resolveAntigravityDaemonPaths(process.cwd())
const client = new AntigravityDaemonClient(paths.socketPath)

const run = await client.startRun({
  invocation: {
    workflowId: 'antigravity.strict-full',
    workflowVersion: '1.0.0',
    goal: '代码审查',
    workspaceRoot: process.cwd(),
    files: [],
    initiator: 'readme-example',
    triggerSource: 'command',
    forceFullPath: true,
    options: {},
    metadata: {},
  },
})

console.log(run.runId, run.snapshot.status)
```

**👉 详细指南: [Quick Start](docs/QUICK_START.md) | [API Cookbook](docs/API_COOKBOOK.md) | [Antigravity Contract](docs/ANTIGRAVITY_CONTRACT.md)**

## 📐 Antigravity 7 节点流程

```
ANALYZE → PARALLEL → DEBATE → VERIFY → SYNTHESIZE → PERSIST → HITL
```

Antigravity 触发后，工作流执行主权切换到本地 `antigravity-daemon`。宿主模型只返回内容和工具结果，不决定节点顺序、跳过或提前结束。

默认运行时实例化的是 `DagEngine`，不是 `CyclicDagEngine`。仓库中虽然保留了循环 DAG 代码资产，但它当前不是 daemon 默认主链能力，不应被理解为已完成的默认运行时能力。

默认模板是 `antigravity.strict-full`。如果显式选择 `antigravity.adaptive`，daemon 只会在 `PARALLEL` 结果显示双 worker 共识足够强时，把 `DEBATE` 标记为 `policy_skipped`，并同时生成 `SkipDecision`、skip receipt 和 downstream handoff。

release 阶段默认走 evidence gate + policy pack：节点执行完成并不等于允许发布，daemon 会基于导出的 policy-as-code 规则检查 receipt、artifact、judge signal 和 handoff 证据后再决定 `completed`、`paused_for_human` 或 `policy_skipped`。当前治理主链已统一为 `GovernanceGateway.evaluateDaemonLifecycleStage()` 作为唯一权威入口，覆盖 preflight / release / human-gate / approval / resume 5 个决策点。artifact-level policy evaluation（traceBundle / releaseAttestation / releaseDossier / releaseBundle / skip）仍由 `DaemonPolicyEngine` 直接执行，其 verdict 通过 `recordPolicyVerdict()` 统一进入 ledger + durable domain event dual-write 路径。

如果工作区存在 `data/antigravity_daemon/remote-workers.json`，daemon 会发现并路由远程 worker，但远程端始终只是执行单元，workflow authority 依旧只在本地。这个配置文件现在只承担本地路由策略和运行时约束；真正的 task protocol 由 `GET /.well-known/agent-card.json` 返回的 `taskProtocol` 广告。除了 `preferredResponseMode`、`allowCapabilities`、`preferredNodeIds`、`minTrustScore` 这些本地调度约束外，还可以声明 `expectedAgentCardSha256`、`requiredAdvertisementSchemaVersion`、`maxAdvertisementAgeMs` 和 `advertisementTrustPolicyId`。具体的 signed advertisement 规则不再散落在 worker 配置里，而是统一由 `trust-registry.json` 中的 signer policy 定义，例如是否必须签名、允许哪些 key status、允许哪些 rotation group、允许哪些 key/issuer、签名最长有效期。这样 daemon 不只 pin agent-card digest/schema/freshness，还会按统一 trust policy 强制验证“这份 advertisement 是谁签的、是否过期、当前 key 是否处于允许状态、是否落在有效期窗口内、是否属于允许的轮换组”。remote worker 支持四种 A2A-style response mode：`inline`、`poll`、`stream`、`callback`。其中 `callback` 由 daemon 启动独立 callback ingress，远程端拿到 callback lease 后再把终态结果回推给本地 authority runtime；callback lease 默认带 `hmac-sha256` 签名约束，远程端必须用 timestamp + raw JSON body 生成签名后才能完成回调。daemon 现在会对 agent card 做显式协议验证：校验 agent-card 基础字段、capability overlap、trust threshold、task protocol surface、callback auth advertisement，以及 advertisement digest/schema/freshness/signature；运行时快照会暴露 `advertisementTrustPolicyId`、`agentCardSha256`、`agentCardSchemaVersion`、`agentCardPublishedAt`、`agentCardExpiresAt`、`agentCardAdvertisementSignatureKeyId`、`agentCardAdvertisementSignatureIssuer`、`agentCardAdvertisementSignedAt`、`agentCardEtag`、`agentCardLastModified`。发现失败会带 `issueKind`（`discovery`、`agent-card`、`protocol`、`auth`、`routing`）以及 `advertisementTrustPolicyId`、`allowedAdvertisementKeyStatuses`、`allowedAdvertisementRotationGroups`、`allowedAdvertisementKeyIds`、`allowedAdvertisementIssuers` 这些 policy 展开结果单独进入 discovery issues，而不是伪装成可委派 worker。如果需要跨主机回调，可通过 `ANTIGRAVITY_DAEMON_CALLBACK_BASE_URL` 把 callback 广播地址切到反向代理或公网入口。

如果工作区存在 `data/antigravity_daemon/policy-pack.json`，daemon 会在启动时自动加载它作为 workspace 级 policy-as-code 输入，并支持在控制面或 MCP 中热重载。

如果工作区存在 `data/antigravity_daemon/trust-registry.json`，daemon 会把它作为签名信任面的单一事实源，用来解析 signed remote worker advertisement 和 signed benchmark source registry 所需的 key/issuer/scope/envVar，同时统一承载 signer policy。trust registry 里的 key 已经不是简单的“开/关”开关，而是带 `status=active|staged|retired`、`validFrom`、`expiresAt`、`rotationGroup` 的生命周期实体；signer policy 则用 `allowedKeyStatuses`、`allowedRotationGroups`、`allowedKeyIds`、`allowedIssuers`、`maxSignatureAgeMs` 控制哪些签名当前可被接受。这样 remote worker 不再直接从散落的 env 命名约定里找 secret，benchmark source registry 也不再自带独立 secret 解析逻辑，而是统一走 daemon trust registry。随后如果工作区存在 `data/antigravity_daemon/benchmark-manifest.json`，daemon benchmark harness 会按 manifest 中启用的 suite 执行本地评测；如果还存在 `data/antigravity_daemon/benchmark-dataset.json`，其中的 dataset case 不仅可以编译 workflow DSL，也可以直接读取 workspace 内的 trace bundle / run artifact 做 evidence-backed benchmark，产出 case/check 双层结果，而不是固定写死一组本地检查。trace-bundle case 现在还能要求 remote worker evidence 暴露 `agentCardSha256`、`agentCardSchemaVersion`，以及 signed advertisement 的 `agentCardAdvertisementSignatureKeyId/Issuer/SignedAt`，把 federation advertisement provenance 也纳入 benchmark。benchmark source 现在支持 registry-first 组织方式：工作区可选 `data/antigravity_daemon/benchmark-source-registry.json` 作为单一事实源，manifest 和 `workflow.benchmark` request 里的 `datasetSources` 可以直接引用 `registry:<sourceId>` 或 `{ registryRef: "<sourceId>" }`，不再要求每次都内联完整 source object。registry entry 仍然支持 `expectedDatasetId`、`expectedVersion`、`expectedSha256`、`cacheTtlMs`、`allowStaleOnError` 和 `authEnvVar`，而 registry 顶层则显式声明 `trustPolicyId`。registry 可选 `signature` 会通过 trust registry 中同 scope 的 signer policy 和 key set 做 `hmac-sha256` 验签；一旦某个 source 被标记为 `locked`，daemon 就要求整个 registry 处于 `verification.summary=verified`，并且拒绝 `authEnvVar`、`expectedDatasetId`、`expectedVersion`、`expectedSha256`、`cacheTtlMs`、`allowStaleOnError` 这类 override。remote dataset 会走本地缓存、ETag/Last-Modified 重验证和 sha256 完整性校验；如果用户显式配置了外部 source 或 registry ref，加载失败时 daemon 会生成 issue case，而不会静默回退到内置 benchmark dataset 掩盖错误。

如果工作区存在 `data/antigravity_daemon/interop-manifest.json`，daemon interop harness 会按 manifest 中启用的 suite 执行互操作诊断，而不是在 runtime 里写死一组检查。

Model 域工具也已经切换到 model-catalog 语义：`ai_ask` 使用 `model_hint`，`ai_multi_ask` 使用 `model_hints`，`ai_consensus` 使用 `judge_model_hint`，模型清单工具为 `ai_list_models`。

## 🔧 MCP 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `workflow.run` | goal, workflowId, riskHint, files, tokenBudget | 启动 daemon-owned workflow 运行 |
| `workflow.runSession` | runId | 读取当前 run 的 active lease / session 状态 |
| `workflow.getState` | runId | 查询最新 run snapshot |
| `workflow.advance` | runId, cursor | 读取 timeline 增量 |
| `workflow.verifyRun` | runId | 校验 receipt / skip / release gate 完整性 |
| `workflow.verifyTraceBundle` | runId | 校验已导出 trace bundle 的完整性与 digest |
| `workflow.releaseArtifacts` | runId | 读取统一的 release artifact surface |
| `workflow.policyReport` | runId | 读取 policy report 治理证明 |
| `workflow.invariantReport` | runId | 读取 invariant report 运行约束证明 |
| `workflow.releaseAttestation` | runId | 读取已导出的 release attestation |
| `workflow.releaseBundle` | runId | 读取 release bundle 统一发布包 |
| `workflow.releaseDossier` | runId | 读取 release dossier 发布档案 |
| `workflow.verifyReleaseArtifacts` | runId | 校验统一的 release artifact surface |
| `workflow.verifyPolicyReport` | runId | 校验 policy report 的 payload digest、签名 provenance 与 verdict 列表一致性 |
| `workflow.verifyInvariantReport` | runId | 校验 invariant report 的 payload digest、签名 provenance 与 invariant failure 一致性 |
| `workflow.verifyReleaseAttestation` | runId | 校验 release attestation 的 payload digest 与签名 provenance |
| `workflow.verifyReleaseBundle` | runId | 校验 release bundle 的 payload digest、签名 provenance、dossier/verifyRun 摘要一致性 |
| `workflow.verifyReleaseDossier` | runId | 校验 release dossier 的 payload digest、签名 provenance 与 verifyRun 摘要一致性 |
| `workflow.transparencyLedger` | — | 读取本地 append-only transparency ledger |
| `workflow.verifyTransparencyLedger` | — | 校验 transparency ledger 的 hash chain |
| `workflow.policyPack` | `reload?` | 读取 daemon 当前 policy-as-code pack，可选热重载 workspace 中的 `policy-pack.json` |
| `workflow.trustRegistry` | `reload?` | 读取或热重载 daemon trust registry，查看签名 key、issuer、scope 与 secret 解算状态 |
| `workflow.traceExport` | runId | 导出 replayable trace bundle |
| `workflow.benchmark` | `suiteIds?`, `caseIds?`, `datasetSources?` | 运行 daemon benchmark harness（实验性，内部评测工具，非外部成熟平台） |
| `workflow.benchmarkSources` | `reload?` | 读取或热重载 daemon benchmark source registry，查看 registry-first dataset source 配置 |
| `workflow.interop` | `suiteIds?` | 运行 daemon 互操作诊断 harness（实验性，非主链协议能力） |
| `workflow.remoteWorkers` | — | 查询 daemon 已发现的 remote workers、agent-card verification summary 与 classified discovery issues |
| `workflow.memorySearch` | `query`, `files?`, `topK?` | 搜索 daemon keyword 记忆（实验性，不参与运行时决策） |

trace bundle 现在是 tamper-evident 且可签名的证据产物。`workflow.traceExport` 会在 bundle 顶层写入 `integrity.algorithm / generatedAt / entryDigests / bundleDigest`，覆盖 `manifest`、`policyPack`、`trustRegistry`、`benchmarkSourceRegistry`、`remoteWorkers`、`run`、`events`、`checkpoints`、`timeline`、`receipts`、`handoffs`、`skips`、`verdicts` 这些导出段；如果 workspace trust registry 为 `trace-bundle` scope 提供了可用 signer policy 和 key，daemon 还会附加 `signaturePolicyId` 与 HMAC 签名。`workflow.verifyTraceBundle` 会重新计算 section digest，并按 `trace-bundle` signer policy 校验签名来源，用来检测导出后被篡改或损坏的证据包。

release attestation 是终态默认生成的发布证明。它基于 run snapshot、trace bundle report、policy verdicts、trust registry 和 benchmark source registry 汇总成稳定 artifact；如果 workspace trust registry 为 `release-attestation` scope 提供了 signer policy 和 key，daemon 会为 attestation 附加签名。`workflow.releaseAttestation` 用于读取该文档，`workflow.verifyReleaseAttestation` 用于校验 payload digest 与签名 provenance。

invariant report 是终态默认生成的运行约束证明。它把当前 run 的终态 snapshot、releaseArtifacts 与 invariant failure 列表固定成独立 artifact；如果 workspace trust registry 为 `invariant-report` scope 提供 signer policy 和 key，daemon 会为该 report 附加签名。`workflow.invariantReport` 用于读取该文档，`workflow.verifyInvariantReport` 用于校验 payload digest、签名 provenance 与 invariant failure 一致性。

policy report 是终态默认生成的治理证明。它把所有 policy verdict、scope、effect、evidence linkage 和 block/warn 摘要固定成独立 artifact；如果 workspace trust registry 为 `policy-report` scope 提供 signer policy 和 key，daemon 会为该 report 附加签名。`workflow.policyReport` 用于读取该文档，`workflow.verifyPolicyReport` 用于校验 payload digest、签名 provenance 与 verdict 列表一致性。

release dossier 是更高层的单一发布档案。它把 `releaseArtifacts`、`verifyRun` 摘要、policy verdict 摘要、trust registry 和 benchmark source registry 组合成单一证明包；如果 workspace trust registry 为 `release-dossier` scope 提供了 signer policy 和 key，daemon 会为 dossier 附加签名。`workflow.releaseDossier` 用于读取该文档，`workflow.verifyReleaseDossier` 用于校验 payload digest、签名 provenance 与 verifyRun 摘要一致性。

release bundle 是最终统一发布包。它把 `releaseArtifacts`、`release dossier`、verifyRun 摘要、trust registry 和 benchmark source registry 收成单一 artifact；如果 workspace trust registry 为 `release-bundle` scope 提供了 signer policy 和 key，daemon 会为 bundle 附加签名。`workflow.releaseBundle` 用于读取该文档，`workflow.verifyReleaseBundle` 用于校验 payload digest、签名 provenance、release dossier 摘要与 verifyRun 摘要一致性。

transparency ledger 是 workspace 级长期证明链。它是 append-only 的本地 hash chain，每条 entry 至少固定 `runId`、`certificationRecordDigest`、`releaseBundleDigest`、`previousEntryDigest` 和 `entryDigest`，用于把单次 certification record 扩展成可长期追溯的透明账本。`workflow.transparencyLedger` 用于读取当前 ledger，`workflow.verifyTransparencyLedger` 用于校验整条 hash chain。

`VerificationSnapshot` 会在终态 artifact finalization 前冻结，并注入全部 6 个 snapshot-carrying 终态 artifact 生成路径（policy report / invariant report / release attestation / release dossier / release bundle / certification record）。这些 artifact 共享同一 `snapshotDigest`。`proofGraphDigest` 由 cross-artifact verifier 基于完整终态 artifact 集计算，并同时写入 certification record 与 transparency ledger。

## 📊 Benchmark 状态

公开 benchmark 和第三方互操作结果仍在补齐中。当前仓库已经切到可复现的 benchmark harness 语义，默认运行 workspace manifest 启用的本地 benchmark suites，以及 `benchmark-dataset.json` 中的 compiled-workflow case 和 trace-bundle case、类型检查、测试和 trace bundle 导出能力，不再给出自评式 “SOTA 评分”。

## 📚 文档

- [Quick Start](docs/QUICK_START.md) — 5 分钟上手
- [API Cookbook](docs/API_COOKBOOK.md) — 10 个场景代码示例
- [Antigravity Contract](docs/ANTIGRAVITY_CONTRACT.md) — 插件命令与 daemon API 契约
- [Architecture](docs/ARCHITECTURE.md) — 系统架构详解
- [Contributing](CONTRIBUTING.md) — 贡献指南

## 🔬 学术参考

| 领域 | 参考 |
|------|------|
| 图执行引擎 | LangGraph 2.0 (Harrison Chase, 2024) |
| 治理框架 | OPA + NIST AI RMF |
| 风险路由 | NeMo Guardrails (NVIDIA, 2023) |
| Event Sourcing | Greg Young CQRS/ES (2010) |
| 多智能体 | Multi-Agent Debate (MIT, Du et al., 2023) |
| 记忆系统 | MemGPT (UC Berkeley, Packer et al., 2023) |
| 自适应学习 | DSPy + Reflexion (Stanford, 2023) |

## License

MIT
