# API Cookbook — Daemon-First Antigravity Workflow

下面的示例都基于当前仓库里真实存在的新架构接口：`antigravity-daemon` 是工作流 authority，`antigravity-model-core` 负责 host-facing 模型目录与 CLI 调度。

---

## 1. 启动 Antigravity strict-full 工作流

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const paths = resolveAntigravityDaemonPaths(process.cwd())
const client = new AntigravityDaemonClient(paths.socketPath)

await client.waitForReady()

const started = await client.startRun({
  invocation: {
    workflowId: 'antigravity.strict-full',
    workflowVersion: '1.0.0',
    goal: '审查当前仓库的高风险改动并给出结论',
    files: ['src/index.ts'],
    initiator: 'cookbook',
    workspaceRoot: process.cwd(),
    triggerSource: 'command',
    forceFullPath: true,
    options: {
      riskHint: 'high',
      tokenBudget: 120000,
    },
    metadata: {
      source: 'api-cookbook',
    },
  },
})

console.log(started.runId, started.snapshot.status)
```

---

## 2. 流式读取 run timeline

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

let cursor = 0
const { snapshot, entries, nextCursor } = await client.streamRun(runId, cursor)
cursor = nextCursor

for (const entry of entries) {
  console.log(entry.sequence, entry.kind, entry.nodeId, entry.payload)
}

console.log(snapshot.phase, snapshot.status)
```

---

## 3. 校验 release gate 与 receipt 完整性

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)
const report = await client.verifyRun(runId)

if (!report.ok) {
  console.error(report.releaseGateEffect, report.rationale)
  console.error('missing receipts:', report.missingReceiptNodes)
  console.error('missing skip decisions:', report.missingSkipDecisionNodes)
}
```

---

## 4. 人工批准 / 恢复 / 重放 run

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

// 处理 paused_for_human 的 gate
await client.approveGate({
  runId,
  gateId: 'antigravity-final-gate',
  approvedBy: 'reviewer@antigravity',
  comment: 'Evidence chain reviewed.',
})

// 或者恢复一个暂停中的 run
await client.resumeRun({
  runId,
  approvedBy: 'reviewer@antigravity',
  comment: 'Resume after manual review',
})

// 或者基于既有 run 重放
const replay = await client.replayRun({
  runId,
  hostSessionId: 'antigravity-session-42',
})

console.log(replay.runId)
```

---

## 5. 导出 trace bundle

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)
const bundle = await client.exportTraceBundle(runId)

console.log(bundle.bundlePath)
console.log(bundle.executionReceipts, bundle.handoffEnvelopes, bundle.skipDecisions)
console.log(bundle.integrity.bundleDigest)
console.log(bundle.signaturePolicyId, bundle.signature?.keyId)

// bundle JSON 内还包含 manifest、policyPack、policy verdicts 和 remote workers
```

---

## 6. 校验 trace bundle 完整性

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)
const report = await client.verifyTraceBundle(runId)

console.log(report.ok, report.actualBundleDigest, report.expectedBundleDigest)
console.log(report.mismatchedEntries, report.missingEntries)
console.log(report.signatureVerified, report.signatureRequired, report.signatureKeyId)
```

---

## 7. 读取 run session / active lease

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)
const session = await client.getRunSession(runId)

console.log(session.status, session.authorityOwner)
console.log(session.activeLease?.nodeId, session.activeLease?.leaseId)
console.log(session.activeLease?.requiredEvidence, session.activeLease?.allowedModelPool)

if (session.activeLease) {
  await client.recordStepHeartbeat(runId, {
    leaseId: session.activeLease.leaseId,
    nodeId: session.activeLease.nodeId,
    attempt: session.activeLease.attempt,
  })
}
```

---

## 8. 读取并校验 release attestation

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const attestation = await client.getReleaseAttestation(runId)
console.log(attestation.attestationPath, attestation.document.signaturePolicyId)

const verification = await client.verifyReleaseAttestation(runId)
console.log(verification.ok, verification.payloadDigestOk, verification.signatureVerified)
console.log(verification.issues)
```

---

## 9. 读取并校验 policy report

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const report = await client.getPolicyReport(runId)
console.log(report.reportPath, report.document.signaturePolicyId)

const verification = await client.verifyPolicyReport(runId)
console.log(verification.ok, verification.payloadDigestOk, verification.signatureVerified)
console.log(verification.issues)
```

---

## 10. 读取并校验 invariant report

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const report = await client.getInvariantReport(runId)
console.log(report.reportPath, report.document.signaturePolicyId)

const verification = await client.verifyInvariantReport(runId)
console.log(verification.ok, verification.payloadDigestOk, verification.signatureVerified)
console.log(verification.issues)
```

---

## 11. 读取并校验 release dossier

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const dossier = await client.getReleaseDossier(runId)
console.log(dossier.dossierPath, dossier.document.signaturePolicyId)

const verification = await client.verifyReleaseDossier(runId)
console.log(verification.ok, verification.payloadDigestOk, verification.signatureVerified)
console.log(verification.issues)
```

---

## 12. 读取并校验 release bundle

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const bundle = await client.getReleaseBundle(runId)
console.log(bundle.bundlePath, bundle.document.signaturePolicyId)

const verification = await client.verifyReleaseBundle(runId)
console.log(verification.ok, verification.payloadDigestOk, verification.signatureVerified)
console.log(verification.issues)
```

---

## 13. 查看与刷新 remote workers

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const before = await client.listRemoteWorkers()
console.log(before.workers.map(worker => ({
  id: worker.id,
  agentCardVersion: worker.agentCardVersion,
  agentCardSchemaVersion: worker.agentCardSchemaVersion,
  agentCardPublishedAt: worker.agentCardPublishedAt,
  agentCardExpiresAt: worker.agentCardExpiresAt,
  agentCardSha256: worker.agentCardSha256,
  agentCardEtag: worker.agentCardEtag,
  agentCardLastModified: worker.agentCardLastModified,
  health: worker.health,
  selectedResponseMode: worker.selectedResponseMode,
  supportedResponseModes: worker.supportedResponseModes,
  taskProtocolSource: worker.taskProtocolSource,
  verification: worker.verification,
  callbackUrlTemplate: worker.callbackUrlTemplate,
  callbackAuthScheme: worker.callbackAuthScheme,
  capabilities: worker.capabilities,
})))
console.log(before.discoveryIssues)

const after = await client.refreshRemoteWorkers()
console.log(after.refreshedAt)
```

`discoveryIssues` 现在带 `issueKind`，可以区分是 endpoint 不可达、agent card 结构错误、task protocol 缺失、callback auth 广告错误，还是本地 routing policy 与远端能力/信任分不匹配。如果工作区配置了 `expectedAgentCardSha256`、`requiredAdvertisementSchemaVersion` 或 `advertisementTrustPolicyId`，这些期望值以及 trust policy 展开的 `requiredAdvertisementSignature`、`allowedAdvertisementKeyStatuses`、`allowedAdvertisementRotationGroups`、`allowedAdvertisementKeyIds`、`allowedAdvertisementIssuers` 都会被原样带回到 discovery issue，方便定位 pinning / signed advertisement 失败。

---

## 14. 读取或热重载 policy pack

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const currentPack = await client.getPolicyPack()
console.log(currentPack.packId, currentPack.version, currentPack.sourcePath)

const reloadedPack = await client.reloadPolicyPack()
console.log(reloadedPack.loadedAt)
```

---

## 15. 运行 benchmark harness 与 interop harness

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const benchmark = await client.runBenchmark({
  suiteIds: ['workflow-dataset-cases', 'control-plane-surface'],
  caseIds: ['adaptive-debate-policy-skip'],
  datasetSources: [
    'registry:gaia-lite',
    {
      registryRef: 'remote-regression-pack',
      expectedVersion: '2026.03.11',
      allowStaleOnError: true,
    },
  ],
})
const interop = await client.runInteropHarness({
  suiteIds: ['authority-surface', 'federation-surface'],
})

console.log(benchmark.harnessId, benchmark.ok, benchmark.suiteIds, benchmark.caseIds)
console.log(interop.harnessId, interop.ok, interop.suiteIds)

const registry = await client.getBenchmarkSourceRegistry()
console.log(registry.registryId, registry.sources.map(source => source.sourceId))
```

`benchmark-dataset.json` 中的 case 现在支持两类：
- `compiledWorkflow`: 编译 workflow DSL 并校验节点、边、approval gate、skip policy。
- `traceBundle`: 读取 workspace 内的 trace bundle JSON，校验 run snapshot、timeline、policy verdict、remote worker lifecycle，以及 agent-card digest / advertisement schema / signed advertisement provenance 等真实执行证据。

`datasetSources` 现在支持两种表达方式：
- 字符串：本地文件路径、目录路径、`file://` URL、`http(s)` URL，或者 `registry:<sourceId>`
- source object：在完整 location source 之外，还可以使用 `{ registryRef: "<sourceId>" }` 引用 workspace source registry，并附带 `expectedDatasetId`、`expectedVersion`、`expectedSha256`、`cacheTtlMs`、`allowStaleOnError`、`authEnvVar` 这类 override；但如果 registry source 带 `locked=true`，这些 override 会被拒绝，只有 `enabled` 和 `required` 可以覆盖

remote source registry 的运行语义是：
- 首次拉取会写入 workspace cache，并记录 sha256
- cache 未过期时直接命中本地缓存
- cache 过期后优先用 `ETag` / `Last-Modified` 做条件请求
- 拉取失败且 `allowStaleOnError=true` 时，daemon 会退回到 stale cache，并把 `cacheStatus=stale-fallback` 暴露到 case metadata
- 如果显式配置的 source 失败、version pin 不匹配或 sha256 不匹配，daemon 会生成 `dataset-source:*` issue case，而不是静默切回内置默认数据集
- registry 文件可选 `signature`，daemon 会通过 `trust-registry.json` 中声明的 signer policy 和 key set 做 `hmac-sha256` 验签；带 `locked=true` 的 source 只有在 registry `verification.summary=verified` 时才允许加载

`trust-registry.json` 里的 key 现在使用生命周期模型，而不是简单的开关：
- `status`: `active | staged | retired`
- `validFrom` / `expiresAt`: 控制 key 的时间窗口
- `rotationGroup`: 把同一轮换链上的 key 收进同一组

signer policy 会用 `allowedKeyStatuses`、`allowedRotationGroups`、`allowedKeyIds`、`allowedIssuers`、`maxSignatureAgeMs` 统一约束 remote worker advertisement 和 benchmark source registry 的签名验证。

---

## 9. 通过模型目录做单模型查询

```typescript
import { AntigravityModelService } from '@anthropic/antigravity-model-core'

const antigravity = new AntigravityModelService()

const answer = await antigravity.ask({
  message: '请总结这个仓库的 daemon authority 设计',
  modelHint: 'gpt-5.1',
  filePaths: ['docs/ARCHITECTURE.md'],
})

console.log(answer.usedModel, answer.didFallback)
console.log(answer.text)
```

---

## 10. 搜索 daemon-owned workflow 记忆

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)

const recall = await client.searchMemory({
  query: 'auth timeout mitigation',
  files: ['src/auth.ts'],
  topK: 5,
})

console.log(recall.promptCount, recall.factCount)
console.log(recall.reflexionPrompts)
console.log(recall.relevantFacts)
console.log(recall.budgetStatus)
```

这条接口现在由 daemon 直接提供，而不是 MCP 进程内自己打开 SQLite。运行终态会被写入 daemon memory，再通过 `/memory/search` / `workflow.memorySearch` 暴露给控制面和工具层。

---

## 10.1 读取 durable completion session 与 tribunal summary

```typescript
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths } from '@anthropic/antigravity-daemon'

const client = new AntigravityDaemonClient(resolveAntigravityDaemonPaths(process.cwd()).socketPath)
const session = await client.getRunSession(runId)

console.log(session.activeLease)
console.log(session.pendingCompletionReceipt)
console.log(session.preparedCompletionReceipt)
console.log(session.acknowledgedCompletionReceipt)
console.log(session.latestTribunalVerdict)
```

推荐把 `getRunSession()` 当作宿主侧 completion protocol 的事实来源：
- `pendingCompletionReceipt`: step output 已 staged，等待 prepare
- `preparedCompletionReceipt`: 已通过 payload prepare
- `acknowledgedCompletionReceipt`: 已 commit；daemon 重启后如果发现 `committed but not NODE_COMPLETED`，会自动 replay completion
- `latestTribunalVerdict`: 最近一次 tribunal summary；release 只接受 `mode=remote` 且 quorum 满足的裁决

---

## 11. 并行多模型比较与裁判

```typescript
import { AntigravityModelService } from '@anthropic/antigravity-model-core'

const antigravity = new AntigravityModelService()

const multi = await antigravity.multiAsk({
  message: '给出这个问题的三个实现方向',
  modelHints: ['gpt-5.1', 'claude-opus-4-6', 'gemini-3.1-pro-preview'],
})

console.log(multi.formatted)

const voted = await antigravity.consensus({
  message: '哪种方案最适合当前代码库？',
  modelHints: ['gpt-5.1', 'claude-opus-4-6'],
  judgeModelHint: 'gemini-3.1-pro-preview',
  criteria: 'architecture quality and implementation risk',
})

console.log(voted.judgeModel)
console.log(voted.judgeText)
```

---

## 10. 通过 AntigravityModelService 直接消费模型执行能力

```typescript
import { AntigravityModelService } from '@anthropic/antigravity-model-core'

const antigravity = new AntigravityModelService()

const single = await antigravity.ask({
  message: '生成一个更严格的类型定义',
  modelHint: 'claude-sonnet-4-6',
})

const consensus = await antigravity.consensus({
  message: '评估两个方案的可维护性',
  modelHints: ['gpt-5.1', 'claude-opus-4-6'],
  judgeModelHint: 'gemini-3.1-pro-preview',
  criteria: 'maintainability',
})

console.log(single.usedModel, consensus.judgeModel)
```
