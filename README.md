# Antigravity Task Kernel

Antigravity Task Kernel 是当前仓库的唯一主执行架构。长任务执行权由 `antigravity-taskd` 持有，编辑器、MCP 和控制面只消费统一的 `jobs` 协议。

## Current Architecture

- `packages/antigravity-taskd`
  任务内核。负责任务创建、分片、worker 调度、语义进度、单 writer 提交、事件流和快照持久化。
- `packages/antigravity-vscode`
  VS Code 集成层。命令与面板只对接 `taskd /jobs`。
- `packages/antigravity-mcp-server`
  MCP 工具入口。提供 `task.run / task.getState / task.advance / task.list / task.cancel`。
- `packages/antigravity-model-core`
  CLI 与模型调用能力层。为 `taskd` 提供 Codex / Gemini worker 调度。

旧的 `antigravity-daemon` workflow 运行时已经从主产品路径移除，不再参与编辑器、MCP 或根构建。

## Execution Model

- 任务阶段固定为：
  - `SCOUT`
  - `SHARD_ANALYZE`
  - `AGGREGATE`
  - `VERIFY`
  - `WRITE`
  - `FINALIZE`
- 默认并发：
  - 小任务：单 worker
  - 中任务：`1 Codex + 1 Gemini`
  - 大任务：`2 Codex + 1 Gemini`
- 写入类任务始终采用“多分析、单 writer 提交”。
- 超时只由 `hardBudgetMs` 决定；不会再因为旧 workflow 节点 deadline、lease 或 session heartbeat 提前误杀长分析。

## Commands

- `antigravity.openPanel`
- `antigravity.runTask`
- `antigravity.getTask`
- `antigravity.streamTask`
- `antigravity.cancelTask`
- `antigravity.toggleArktsLsp`

## MCP Tools

- `task.run`
- `task.getState`
- `task.advance`
- `task.list`
- `task.cancel`

## Build

```bash
npm run build
```

构建产物：

- `dist/extension.js`
- `dist/antigravity-mcp-server.js`
- `dist/antigravity-taskd.js`

## Verification

推荐最小验证集：

```bash
npx vitest run --config vitest.config.ts \
  packages/antigravity-taskd/src/__tests__/runtime.spec.ts \
  packages/antigravity-vscode/src/__tests__/workflow-contract.spec.ts \
  packages/antigravity-mcp-server/src/__tests__/tool-registry.spec.ts
```

## Docs

- [Task Contract](docs/ANTIGRAVITY_CONTRACT.md)
- [Quick Start](docs/QUICK_START.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API Cookbook](docs/API_COOKBOOK.md)
