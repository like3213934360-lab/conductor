# 🚀 Quick Start — Antigravity Workflow Runtime

5 分钟快速上手 Antigravity 专用 daemon-owned 多 agent 工作流。

## 1. 安装

```bash
# 克隆项目
git clone https://github.com/like3213934360-lab/conductor.git
cd conductor

# 安装依赖
npm install

# 构建
npm run build
```

## 2. 第一个 Antigravity 工作流

```typescript
import {
  launchAntigravityDaemonHost,
} from '@anthropic/antigravity-daemon'

const workspaceRoot = process.cwd()
const host = await launchAntigravityDaemonHost({ workspaceRoot })

// 2. 使用 daemon client 启动权威工作流
const start = await host.client.startRun({
  invocation: {
    workflowId: 'antigravity.strict-full',
    workflowVersion: '1.0.0',
    goal: '分析代码质量并给出可执行的重构建议',
    workspaceRoot,
    files: [],
    initiator: 'quick-start',
    triggerSource: 'command',
    forceFullPath: true,
    options: {},
    metadata: {},
  },
})

// 3. 读取状态并验证 release gate
const run = await host.client.getRun(start.runId)
const session = await host.client.getRunSession(start.runId)
const verify = await host.client.verifyRun(start.runId)

console.log(`Run ID: ${run.snapshot.runId}`)
console.log(`Status: ${run.snapshot.status}`)
console.log(`Release Gate: ${verify.releaseGateEffect}`)
console.log(`Latest Tribunal: ${session.latestTribunalVerdict?.nodeId ?? 'none'} ${session.latestTribunalVerdict?.verdict ?? ''}`)
console.log(`Pending Receipt: ${session.pendingCompletionReceipt?.nodeId ?? 'none'}`)
console.log(`Callback Ingress: ${host.callbackIngressBaseUrl}`)

await host.close()
```

## 3. 命令面板使用

```bash
Cmd+Shift+P → Antigravity Workflow: 运行 Antigravity 工作流
Cmd+Shift+P → Antigravity Workflow: 查看当前工作流
Cmd+Shift+P → Antigravity Workflow: 实时查看工作流
Cmd+Shift+P → Antigravity Workflow: 导出 Trace Bundle
```

## 4. 配置模型目录

```typescript
// 在 VS Code 中配置 Antigravity Workflow
// 1. Cmd+Shift+P → "Antigravity Workflow: 打开控制面板"
// 2. 切换到 "Models" 标签页
// 3. 添加模型目录项和对应 API Key（DeepSeek、GLM、Qwen 等）
```

## 5. VS Code / Antigravity 面板

1. 安装 Antigravity Workflow 扩展
2. 打开 Dashboard: `Cmd+Shift+P` → "Antigravity Workflow: 打开控制面板"
3. 在控制面板中选择 `strict-full` 或 `adaptive` 模板并启动
4. 实时监控 7 节点状态、治理决策、remote workers 和 HITL gate
5. 如需 ArkTS LSP，可在 `Models` 面板里单独开启或关闭它；它是附加能力，不影响 Antigravity workflow 主链，也不再作为默认激活主轴
6. Antigravity 专用命令和 daemon API 见 [Antigravity Contract](./ANTIGRAVITY_CONTRACT.md)

## 6. 查看 durable completion / tribunal 状态

```typescript
const session = await host.client.getRunSession(start.runId)

console.log(session.activeLease)
console.log(session.pendingCompletionReceipt)
console.log(session.preparedCompletionReceipt)
console.log(session.acknowledgedCompletionReceipt)
console.log(session.latestTribunalVerdict)
```

`GetRunSession` 现在是宿主查看 durable completion protocol 的标准入口：
- `pendingCompletionReceipt`: step 已 staged，但尚未 prepare
- `preparedCompletionReceipt`: payload 已通过 prepare 校验
- `acknowledgedCompletionReceipt`: step 已 commit，可在重启后自动 replay completion
- `latestTribunalVerdict`: 最近一次 judge-required step 的 tribunal summary，只有 `mode=remote` 且 quorum 满足时才可能通过 release gate

---

**👉 进阶使用请参考 [API Cookbook](./API_COOKBOOK.md) 和 [Architecture](./ARCHITECTURE.md)**
