# Antigravity Contract

Antigravity 集成采用“插件主控 + 本地 daemon 权威执行”模型。触发工作流后，宿主只负责展示、审批和回显，不负责 DAG 调度。

## Workflow Templates

- `antigravity.strict-full`: 7 节点全量路径，`DEBATE` 不允许跳过。
- `antigravity.adaptive`: 7 节点自适应模板，只有 daemon policy 满足 `PARALLEL` 共识条件时才允许 `DEBATE` 进入 `policy_skipped`。

## Extension Commands

| Command | Purpose |
|---|---|
| `antigravity.openPanel` | 打开 Antigravity / VS Code 控制面板 |
| `antigravity.runWorkflow` | 启动 daemon-owned Antigravity 工作流，可选 `workflowId=antigravity.strict-full|antigravity.adaptive` |
| `antigravity.getRunSession` | 读取当前 run 的 active lease / run session |
| `antigravity.getRun` | 获取当前 run 快照 |
| `antigravity.streamRun` | 流式查看时间线增量 |
| `antigravity.approveGate` | 审批 HITL gate |
| `antigravity.cancelRun` | 取消当前 run |
| `antigravity.replayRun` | 重放当前 run |
| `antigravity.reloadPolicyPack` | 从 workspace 的 `policy-pack.json` 热重载 daemon policy pack |
| `antigravity.reloadTrustRegistry` | 从 workspace 的 `trust-registry.json` 热重载 daemon trust registry |
| `antigravity.exportTraceBundle` | 导出 replayable trace bundle |
| `antigravity.getReleaseArtifacts` | 读取当前 run 的 release artifacts |
| `antigravity.getPolicyReport` | 读取当前 run 的 policy report |
| `antigravity.verifyReleaseArtifacts` | 校验当前 run 的 release artifacts |
| `antigravity.verifyPolicyReport` | 校验当前 run 的 policy report |
| `antigravity.getInvariantReport` | 读取当前 run 的 invariant report |
| `antigravity.verifyInvariantReport` | 校验当前 run 的 invariant report |
| `antigravity.getReleaseAttestation` | 读取当前 run 的 release attestation |
| `antigravity.verifyReleaseAttestation` | 校验当前 run 的 release attestation |
| `antigravity.getReleaseBundle` | 读取当前 run 的 release bundle |
| `antigravity.verifyReleaseBundle` | 校验当前 run 的 release bundle |
| `antigravity.getReleaseDossier` | 读取当前 run 的 release dossier |
| `antigravity.verifyReleaseDossier` | 校验当前 run 的 release dossier |
| `antigravity.getCertificationRecord` | 读取当前 run 的 certification record |
| `antigravity.verifyCertificationRecord` | 校验当前 run 的 certification record |
| `antigravity.getTransparencyLedger` | 读取 workspace transparency ledger |
| `antigravity.verifyTransparencyLedger` | 校验 workspace transparency ledger |
| `antigravity.runBenchmark` | 运行 dataset-backed daemon benchmark harness |
| `antigravity.runInteropHarness` | 运行 Antigravity 互操作 harness |
| `antigravity.toggleArktsLsp` | 启用或关闭可选的 ArkTS LSP / DevEco ace-server 子系统 |

## Daemon HTTP API

所有请求都走本地 IPC HTTP，默认绑定 UDS 或 Windows named pipe。

| Method | Path | Operation |
|---|---|---|
| `GET` | `/health` | `HealthCheck` |
| `GET` | `/manifest` | `GetManifest` |
| `GET` | `/policy-pack` | `GetPolicyPack` |
| `GET` | `/trust-registry` | `GetTrustRegistry` |
| `GET` | `/benchmark-source-registry` | `GetBenchmarkSourceRegistry` |
| `GET` | `/transparency-ledger` | `GetTransparencyLedger` |
| `POST` | `/memory/search` | `SearchMemory` |
| `POST` | `/policy-pack/reload` | `ReloadPolicyPack` |
| `POST` | `/trust-registry/reload` | `ReloadTrustRegistry` |
| `POST` | `/benchmark-source-registry/reload` | `ReloadBenchmarkSourceRegistry` |
| `POST` | `/verify-transparency-ledger` | `VerifyTransparencyLedger` |
| `GET` | `/remote-workers` | `ListRemoteWorkers` |
| `POST` | `/remote-workers/refresh` | `RefreshRemoteWorkers` |
| `POST` | `/remote-worker-callbacks/:callbackToken` | `ReceiveRemoteWorkerCallback` |
| `POST` | `/runs/start` | `StartRun` |
| `GET` | `/runs/:runId` | `GetRun` |
| `GET` | `/runs/:runId/session` | `GetRunSession` |
| `POST` | `/runs/:runId/session/heartbeat` | `RecordStepHeartbeat` |
| `POST` | `/runs/:runId/session/prepare-completion` | `PrepareStepCompletionReceipt` |
| `POST` | `/runs/:runId/session/commit-completion` | `CommitStepCompletionReceipt` |
| `GET` | `/runs/:runId/stream` | `StreamRun` |
| `POST` | `/runs/:runId/verify` | `VerifyRun` |
| `POST` | `/runs/:runId/verify-trace-bundle` | `VerifyTraceBundle` |
| `GET` | `/runs/:runId/release-attestation` | `GetReleaseAttestation` |
| `GET` | `/runs/:runId/release-artifacts` | `GetReleaseArtifacts` |
| `GET` | `/runs/:runId/policy-report` | `GetPolicyReport` |
| `GET` | `/runs/:runId/invariant-report` | `GetInvariantReport` |
| `GET` | `/runs/:runId/release-bundle` | `GetReleaseBundle` |
| `GET` | `/runs/:runId/release-dossier` | `GetReleaseDossier` |
| `GET` | `/runs/:runId/certification-record` | `GetCertificationRecord` |
| `POST` | `/runs/:runId/verify-release-attestation` | `VerifyReleaseAttestation` |
| `POST` | `/runs/:runId/verify-release-artifacts` | `VerifyReleaseArtifacts` |
| `POST` | `/runs/:runId/verify-policy-report` | `VerifyPolicyReport` |
| `POST` | `/runs/:runId/verify-invariant-report` | `VerifyInvariantReport` |
| `POST` | `/runs/:runId/verify-release-bundle` | `VerifyReleaseBundle` |
| `POST` | `/runs/:runId/verify-release-dossier` | `VerifyReleaseDossier` |
| `POST` | `/runs/:runId/verify-certification-record` | `VerifyCertificationRecord` |
| `POST` | `/runs/:runId/approve` | `ApproveGate` |
| `POST` | `/runs/:runId/cancel` | `CancelRun` |
| `POST` | `/runs/:runId/replay` | `ReplayRun` |
| `POST` | `/runs/:runId/resume` | `ResumeRun` |
| `POST` | `/runs/:runId/export-trace-bundle` | `ExportTraceBundle` |
| `POST` | `/benchmark` | `RunBenchmark` |
| `POST` | `/interop-harness` | `RunInteropHarness` |

## Execution Invariants

- 执行 authority 固定为 `antigravity-daemon`。
- 宿主固定为 `antigravity`。
- 远程 worker 只作为外部执行单元，不能拥有 workflow authority。
- `PARALLEL`、`DEBATE`、`VERIFY` 这三个 `judgeRequired` 步骤必须产出 tribunal summary；只有 `mode=remote`、`quorumSatisfied=true`、`confidence>=0.6` 且 verdict 不是 `disagree|needs_human` 时才满足 release。
- tribunal 的 `hybrid` / `local-fallback` 只作为诊断证据保留，不再作为 release 放行条件。
- 终态只允许 `completed`、`failed`、`cancelled`、`paused_for_human`。
- `paused_for_human` 只能通过 `ApproveGate` 或 `ResumeRun` 进入完成态。
- release 默认走 evidence gate + policy pack；证据不足时 run 会进入 `paused_for_human`，而不是直接放行。
- `policy_skipped` 只允许出现在声明了 `skipPolicy` 的节点上，并且必须生成 `SkipDecision`、skip receipt 和 handoff envelope。
- `trace bundle` 必须包含 policy pack、benchmark source registry、run、events、checkpoints、timeline、receipts、handoff envelopes、policy verdicts 和 daemon manifest。
- 已导出的 `trace bundle` 必须携带 `integrity.algorithm / entryDigests / bundleDigest`，并允许通过 `VerifyTraceBundle` 重新计算与比对。
- 如果 trust registry 为 `trace-bundle` scope 提供 signer policy 与有效 key，daemon 会在 trace bundle 顶层附加 `signaturePolicyId` 与 HMAC 签名；`VerifyTraceBundle` 会同时校验 digest 和 signer policy。
- terminal run 会默认生成 `release attestation`，它基于 run snapshot、trace bundle report、policy verdicts、trust registry 和 benchmark source registry 汇总成稳定发布证明。
- 如果 trust registry 为 `release-attestation` scope 提供 signer policy 与有效 key，daemon 会为 attestation 附加签名；`VerifyReleaseAttestation` 会同时校验 payload digest 与 signer policy。
- terminal run 还会默认生成 `release dossier`，它把 `releaseArtifacts`、`verifyRun` 摘要、policy verdict 摘要、trust registry 和 benchmark source registry 汇总成单一发布档案。
- 如果 trust registry 为 `release-dossier` scope 提供 signer policy 与有效 key，daemon 会为 dossier 附加签名；`VerifyReleaseDossier` 会同时校验 payload digest、releaseArtifacts 摘要和 verifyRun 摘要一致性。
- terminal run 还会默认生成 `release bundle`，它把 `releaseArtifacts`、`release dossier`、verifyRun 摘要、trust registry 和 benchmark source registry 收成最终统一发布包。
- 如果 trust registry 为 `release-bundle` scope 提供 signer policy 与有效 key，daemon 会为 bundle 附加签名；`VerifyReleaseBundle` 会同时校验 payload digest、releaseArtifacts 摘要、release dossier 摘要和 verifyRun 摘要一致性。
- terminal run 还会默认生成 `certification record`，它把 release bundle digest、dossier/artifact/policy/invariant 摘要、trust registry、benchmark source registry、remote worker advertisement digests 和最终 governance verdict 固定成最终认证记录。
- 如果 trust registry 为 `certification-record` scope 提供 signer policy 与有效 key，daemon 会为 certification record 附加签名；`VerifyCertificationRecord` 会同时校验 payload digest、release bundle digest、proof chain 摘要与 governance verdict 一致性。
- workspace 级 `transparency ledger` 是 append-only hash chain，本地保存在 daemon data dir；每条 entry 至少固定 `runId`、`certificationRecordDigest`、`releaseBundleDigest`、`previousEntryDigest` 和 `entryDigest`。
- `VerifyTransparencyLedger` 会检查整条链的 `previousEntryDigest -> entryDigest` 关系，检测 ledger 被篡改或分叉。
- terminal run 还会默认生成 `invariant report`，它把终态 snapshot、releaseArtifacts 与 invariant failure 列表固定成单独约束证明。
- 如果 trust registry 为 `invariant-report` scope 提供 signer policy 与有效 key，daemon 会为 report 附加签名；`VerifyInvariantReport` 会同时校验 payload digest、releaseArtifacts 摘要和 invariant failure 列表一致性。
- terminal run 还会默认生成 `policy report`，它把所有 policy verdict、scope、effect、evidence linkage 和 block/warn 摘要固定成单独治理证明。
- 如果 trust registry 为 `policy-report` scope 提供 signer policy 与有效 key，daemon 会为 report 附加签名；`VerifyPolicyReport` 会同时校验 payload digest、verdict 列表与 summary 一致性。
- daemon 会为当前正在执行的节点发放 step lease，并通过 `GetRunSession` / snapshot 中的 `activeLease` 暴露当前租约；宿主只应消费 daemon 发放的节点授权，而不应自行决定推进顺序。
- daemon 现在把 step completion protocol 作为 durable completion session 持久化到 ledger，session phase 固定为 `pending|prepared|committed`；`GetRunSession` / snapshot 中的 pending/prepared/acknowledged surface 由 completion session 派生，而不是由 timeline 的 latest-kind 推断。
- daemon 重启时如果发现 `committed` 但尚未写入 `NODE_COMPLETED` 的 completion session，会自动重放 completion；如果只有 stale active lease 且没有 staged completion bundle，会显式回收到 `queued`，避免 run 永久挂在 `running`。

## Remote Worker Config

远程 worker 配置文件路径固定为 `data/antigravity_daemon/remote-workers.json`。daemon 启动时会自动发现、健康检查并在本地路由时择优委派。

```json
[
  {
    "id": "verify-remote-1",
    "baseUrl": "http://127.0.0.1:7788",
    "expectedAgentCardSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "requiredAdvertisementSchemaVersion": "a2a.agent-card.v1",
    "maxAdvertisementAgeMs": 300000,
    "advertisementTrustPolicyId": "remote-advertisement-strict",
    "preferredResponseMode": "callback",
    "callbackTimeoutMs": 15000,
    "allowCapabilities": ["verification"],
    "preferredNodeIds": ["VERIFY"],
    "minTrustScore": 80
  }
]
```

远程端点需要提供：
- `GET /.well-known/agent-card.json`
- `POST /a2a/tasks`

`remote-workers.json` 只声明本地路由策略和运行时约束，不再声明协议细节。`taskEndpoint`、`supportedResponseModes`、`statusEndpointTemplate`、`streamEndpointTemplate` 和 callback auth surface 必须由 `AgentCard.taskProtocol` 广告。

除了普通 workflow node delegation，remote worker 还可以广告 `tribunal-judge` capability。daemon 会用同一个 `POST /a2a/tasks` surface 发起 tribunal task，只是 `taskType=tribunal`，请求体中会额外带：
- `tribunal.subjectNodeId`
- `tribunal.subjectOutput`
- `tribunal.heuristicBaseline`
- `tribunal.forbiddenJudgeModelFamilies`

daemon 会在 discovery 阶段执行 agent-card verification，至少校验：
- agent card 的 `id/name/version/endpoint/capabilities`
- 本地 `allowCapabilities` 与远端 capability overlap
- `minTrustScore` 与远端 `trustScore`
- 可选的 `expectedAgentCardSha256` digest pin
- 可选的 `requiredAdvertisementSchemaVersion` 和 `maxAdvertisementAgeMs`
- 可选的 advertisement signer policy：`advertisementTrustPolicyId`
- task protocol 的主选 lifecycle 所需 surface
- callback lifecycle 的 `hmac-sha256` auth、signature/timestamp headers

验证通过的 worker 会带 `verification.summary=verified|warning` 和完整 checks 暴露在 `workflow.remoteWorkers` / `GET /remote-workers`，同时快照还会带 `advertisementTrustPolicyId`、`agentCardSha256`、`agentCardSchemaVersion`、`agentCardPublishedAt`、`agentCardExpiresAt`、`agentCardAdvertisementSignatureKeyId`、`agentCardAdvertisementSignatureIssuer`、`agentCardAdvertisementSignedAt`、`agentCardEtag`、`agentCardLastModified`。验证失败的端点不会进入 worker 列表，而会进入 `discoveryIssues`，并带 `issueKind=discovery|agent-card|protocol|auth|routing`；如果配置了 pinning / trust policy 约束，还会保留 `expectedAgentCardSha256`、`expectedAdvertisementSchemaVersion`、`advertisementTrustPolicyId`、`requiredAdvertisementSignature`、`allowedAdvertisementKeyStatuses`、`allowedAdvertisementRotationGroups`、`allowedAdvertisementKeyIds` 和 `allowedAdvertisementIssuers`。

`POST /a2a/tasks` 返回的任务响应必须采用 lifecycle-aware 语义：
- `inline`: 直接返回 `status=completed|failed`
- `poll`: 先返回 `status=accepted|running`，再由 daemon 轮询 `statusEndpoint`
- `stream`: 先返回 `status=accepted|running`，再由 daemon 消费 `streamEndpoint` 的 SSE/NDJSON 终态事件
- `callback`: 先返回 `status=accepted|running` 与 `responseMode=callback`，再使用请求体中的 callback lease 把终态 JSON 回推到 daemon 的 `/remote-worker-callbacks/:callbackToken`

对于 `taskType=tribunal`，终态 `output` 必须返回结构化 verdict：
- `verdict=agree|partial|disagree|needs_human`
- `confidence=0..1`
- `rationale`
- 可选的 `evidenceIds`、`issues`、`model`、`modelFamily`

callback lease 现在包含：
- `callbackUrl`: daemon 广播给 remote worker 的 authority callback URL
- `callbackToken`: 单次使用的 callback 路径 token
- `auth.scheme=hmac-sha256`
- `auth.secret`: 用于对 `timestamp.rawBody` 做 HMAC-SHA256 签名的短时密钥
- `auth.signatureHeader=x-antigravity-callback-signature`
- `auth.timestampHeader=x-antigravity-callback-timestamp`
- `auth.signatureEncoding=hex`

默认情况下，daemon 会在本机 loopback 上启动 callback ingress；如果远程 worker 不在本机或同网段，应该通过反向代理暴露该入口，并把 `ANTIGRAVITY_DAEMON_CALLBACK_BASE_URL` 指向外部可达地址。daemon 会在 callback ingress 处验证 `hmac-sha256` 签名，未签名或签名错误的 callback 会直接被拒绝。

## Policy Pack Config

workspace 级 policy pack 文件路径固定为 `data/antigravity_daemon/policy-pack.json`。daemon 启动时会自动加载，控制面和 MCP 也可以显式触发热重载。

```json
{
  "packId": "workspace-policy-pack",
  "version": "2026.03.11",
  "rules": [
    {
      "ruleId": "preflight.high-disagreement-warning",
      "when": { "kind": "gte", "fact": "drScore", "value": 0.65 },
      "message": "Initial disagreement score {{drScore}} reached workspace threshold 0.65."
    },
    {
      "ruleId": "preflight.normal-disagreement",
      "when": { "kind": "lt", "fact": "drScore", "value": 0.65 }
    },
    {
      "ruleId": "approval.approver-required",
      "enabled": true
    },
    {
      "ruleId": "skip.evidence-required",
      "enabled": true
    }
  ]
}
```

## Benchmark Manifest Config

workspace 级 benchmark manifest 文件路径固定为 `data/antigravity_daemon/benchmark-manifest.json`。daemon benchmark harness 会加载它来决定启用哪些 suite，以及 suite 的展示元数据。

如果工作区还存在 `data/antigravity_daemon/trust-registry.json`，daemon 会用它统一解析 signed remote worker advertisement 和 signed benchmark source registry 所需的 key/issuer/scope/envVar。如果工作区还存在 `data/antigravity_daemon/benchmark-source-registry.json`，manifest 和 request 里的 `datasetSources` 就可以通过 registry id 引用 source，而不是每次都内联完整 source object。

```json
{
  "harnessId": "workspace-harness",
  "manifestVersion": "2026.03.11",
  "datasetSources": [
    "registry:gaia-lite",
    {
      "registryRef": "remote-regression-pack",
      "required": false,
      "expectedVersion": "2026.03.11",
      "allowStaleOnError": true
    }
  ],
  "suites": [
    {
      "suiteId": "workflow-authority",
      "name": "Workspace Workflow Authority"
    },
    {
      "suiteId": "federation-readiness",
      "enabled": false
    }
  ]
}
```

`workflow.benchmark` / `RunBenchmark` 也支持 request 级 `datasetSources`，会在当前 workspace dataset 之外追加临时外部数据源。request 级 source 支持三种表达方式：
- 字符串 location：本地路径、目录、`file://` 或 `http(s)` URL
- registry string：`registry:<sourceId>`
- source object：完整 source object，或 `{ "registryRef": "<sourceId>" }` 形式的 registry override object

dataset source registry 的约束是：
- remote source 会缓存在 `data/antigravity_daemon/cache/benchmark-datasets/`
- cache 未过期时直接命中；过期后使用 `ETag` / `Last-Modified` 做条件重验证
- `expectedDatasetId`、`expectedVersion`、`expectedSha256` 会在加载时强校验
- 当 `allowStaleOnError=true` 时，remote source 拉取失败可以退回到 stale cache
- 只要用户显式配置了外部 dataset source 或 registry ref，daemon 就不会再静默回退到内置默认 dataset；失败会显式产出 `dataset-source:*` issue case，并保留 `registryRef` / `registryPath` 证据
- registry 文件可选 `signature`，daemon 会通过 `trust-registry.json` 中声明的 signer policy 和 key set 做 `hmac-sha256` 验签，并把 `digestSha256` / `signature` / `verification` 暴露到 control plane
- 当 registry source 带 `locked=true` 时，daemon 只接受 `verification.summary=verified` 的 registry；registry 顶层 `trustPolicyId` 会决定签名是否必须存在、允许哪些 key status、允许哪些 rotation group、允许哪些 key/issuer、以及签名年龄窗口。未签名、签名失败、key status 不允许、rotation group 不允许或签名元数据无效都会让该 source 退化成 `dataset-source:*` issue case
- `locked=true` 的 registry source 只允许 `enabled` 和 `required` override；`authEnvVar`、`expectedDatasetId`、`expectedVersion`、`expectedSha256`、`cacheTtlMs`、`allowStaleOnError` 会被显式拒绝并生成 issue case

## Benchmark Source Registry Config

workspace 级 benchmark source registry 文件路径固定为 `data/antigravity_daemon/benchmark-source-registry.json`。它是外部 benchmark source 的单一事实源，供 manifest 和 request 通过 `registry:<sourceId>` 或 `registryRef` 引用。

## Trust Registry Config

workspace 级 trust registry 文件路径固定为 `data/antigravity_daemon/trust-registry.json`。它是 signed remote worker advertisement 与 signed benchmark source registry 的统一信任面。

```json
{
  "registryId": "workspace-trust-registry",
  "version": "2026.03.11",
  "keys": [
    {
      "keyId": "remote-signing",
      "issuer": "antigravity-lab",
      "envVar": "ANTIGRAVITY_TRUST_KEY_REMOTE_SIGNING",
      "scopes": ["remote-worker-advertisement"],
      "status": "active",
      "validFrom": "2026-03-01T00:00:00.000Z",
      "expiresAt": "2026-06-01T00:00:00.000Z",
      "rotationGroup": "remote-workers.primary"
    },
    {
      "keyId": "benchmark-registry",
      "envVar": "ANTIGRAVITY_TRUST_KEY_BENCHMARK_REGISTRY",
      "scopes": ["benchmark-source-registry"],
      "status": "staged",
      "rotationGroup": "benchmark-sources.primary"
    }
  ],
  "signerPolicies": [
    {
      "policyId": "remote-advertisement-strict",
      "scope": "remote-worker-advertisement",
      "enabled": true,
      "requireSignature": true,
      "allowedKeyStatuses": ["active"],
      "allowedKeyIds": ["remote-signing"],
      "allowedIssuers": ["antigravity-lab"],
      "maxSignatureAgeMs": 300000
    }
  ]
}
```

trust registry 的 key 现在有完整生命周期：
- `status`: `active | staged | retired`
- `validFrom` / `expiresAt`: 控制 key 的生效窗口
- `rotationGroup`: 用于表达同一轮换组的 signer lineage

signer policy 会在对应 scope 上展开为：
- 是否必须签名
- 允许哪些 key status
- 允许哪些 rotation group
- 允许哪些 key id / issuer
- 最长允许的签名年龄

```json
{
  "registryId": "workspace-source-registry",
  "version": "2026.03.11",
  "sources": [
    {
      "sourceId": "gaia-lite",
      "location": "fixtures/external/gaia-lite-dataset.json",
      "expectedDatasetId": "gaia-lite",
      "expectedVersion": "2026.03.11",
      "tags": ["gaia", "local"],
      "locked": true
    },
    {
      "sourceId": "remote-regression-pack",
      "location": "https://example.com/antigravity/benchmark-dataset.json",
      "required": false,
      "expectedDatasetId": "antigravity-regression-pack",
      "expectedVersion": "2026.03.11",
      "expectedSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "cacheTtlMs": 300000,
      "allowStaleOnError": true,
      "authEnvVar": "ANTIGRAVITY_BENCHMARK_TOKEN"
    }
  ],
  "signature": {
    "scheme": "hmac-sha256",
    "keyId": "workspace-benchmarks",
    "signedAt": "2026-03-11T00:00:00.000Z",
    "signature": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

## Benchmark Dataset Config

workspace 级 benchmark dataset 文件路径固定为 `data/antigravity_daemon/benchmark-dataset.json`。daemon benchmark harness 会把其中的 dataset case 编译成 case-level benchmark result，并聚合回 suite/report；case 既可以是 workflow DSL 编译检查，也可以是对 workspace trace bundle 的 evidence-backed 校验。

```json
{
  "datasetId": "workspace-dataset",
  "version": "2026.03.11",
  "cases": [
    {
      "caseKind": "compiledWorkflow",
      "caseId": "workspace-adaptive-case",
      "name": "Workspace Adaptive Case",
      "workflowId": "antigravity.adaptive",
      "goal": "Compile the adaptive workflow from the workspace dataset.",
      "expectedTemplate": "antigravity.adaptive.v1",
      "requiredNodeIds": ["ANALYZE", "VERIFY", "HITL"],
      "requiredApprovalGateIds": ["antigravity-final-gate"],
      "expectDebateSkippable": true,
      "expectedDebateStrategyId": "adaptive.debate-express.v1"
    },
    {
      "caseKind": "traceBundle",
      "caseId": "workspace-trace-case",
      "name": "Workspace Trace Case",
      "sourcePath": "fixtures/trace-bundles/adaptive-run.trace.json",
      "expectedRunStatus": "completed",
      "expectedWorkflowTemplate": "antigravity.adaptive.v1",
      "requiredTimelineKinds": ["run.started", "run.completed"],
      "requiredPolicyScopes": ["preflight", "release"],
      "requiredNodeStatuses": {
        "DEBATE": "policy_skipped",
        "HITL": "completed"
      },
      "requiredRemoteWorkerResponseModes": ["stream"],
      "requireAgentCardDigests": true,
      "requiredAgentCardSchemaVersions": ["a2a.agent-card.v1"]
    }
  ]
}
```

## Interop Manifest Config

workspace 级 interop manifest 文件路径固定为 `data/antigravity_daemon/interop-manifest.json`。daemon interop harness 会加载它来决定启用哪些互操作 suite，以及 suite 的展示元数据。

```json
{
  "harnessId": "workspace-interop-harness",
  "manifestVersion": "2026.03.11",
  "suites": [
    {
      "suiteId": "authority-surface",
      "name": "Workspace Authority Surface"
    },
    {
      "suiteId": "federation-surface",
      "enabled": false
    }
  ]
}
```
