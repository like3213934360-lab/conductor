<![CDATA[<div align="center">

# ⚡ Antigravity Workflow

**专为 [Antigravity](https://github.com/like3213934360-lab/conductor) 设计的多智能体协作系统**

基于 **MCP (Model Context Protocol)** 协议 · **Codex + Gemini CLI** 多模型协同 · 可选 **ArkTS LSP** 集成

[![版本](https://img.shields.io/badge/版本-0.3.0-blue?style=flat-square)](./package.json)
[![许可证](https://img.shields.io/badge/许可证-MIT-green?style=flat-square)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## 🚀 项目愿景

Antigravity Workflow 是一套**专为 Antigravity 打造的多 Agent 协作系统**。它的核心使命是：**让多个 AI 智能体通过结构化的 Map-Reduce 流水线，协同完成任何单次大模型调用无法胜任的复杂代码分析与生成任务**。

系统将一次 AI 任务调度为完整的 5 阶段流水线 — **SCOUT → SHARD → AGGREGATE → VERIFY → WRITE** — 跨 Codex 和 Gemini CLI 多工作进程并行执行，通过投机竞速、结果校验、反思纠错等机制保证输出质量，最终原子提交到磁盘。

ArkTS 语言服务器（LSP）支持是系统的一个**可选能力**，可通过命令面板随时启用或禁用，不影响核心 workflow 运行。

### ✨ 核心技术特性

| # | 特性 | 实现机制 |
|---|------|---------|
| 1 | **Map-Reduce 多 Agent 调度内核** | `antigravity-taskd` 将目标代码库拆分为多个 Shard，分配给并行 Worker 进程独立推理，再将分片结果归约合并。每个阶段通过 **JSONL 断点 + SQLite 校验** 持久化，崩溃后可从最后完成阶段恢复 |
| 2 | **投机竞速并行执行** | `DefaultRacingExecutor` 同时启动 Codex 和 Gemini 两条推理路径；首个通过校验的结果立即采纳，另一条路径通过 `AbortSignal + onAborted()` 生命周期钩子终止并清理资源 |
| 3 | **LSP 驱动的反思纠错闭环（可选）** | 生成代码先写入**纯内存 VFS**；可选启用 ArkTS LSP 在 `LspSessionMutex` 排他锁保护下进行静态诊断；最多 2 轮自动修复，失败则回滚 |
| 4 | **15 工具 MCP 接口面** | `antigravity-mcp-server` 对外暴露类型安全的 MCP 工具目录（`model` 域：`ai_ask / ai_codex_task / ai_gemini_task / ai_parallel_tasks / ai_consensus …`；`task` 域：`task.run / task.getState / task.advance / task.cancel / task.list`），任何 MCP 兼容的 AI 宿主均可调用 |

---

## 🏗️ 包架构拓扑

```
antigravity-workflow/                    ← VS Code 扩展根包 (dist/extension.js)
│
├── packages/
│   │
│   │  ────── 核心层 ─────────────────────────────────────────────
│   │
│   ├── antigravity-taskd/               ← 🧠 任务调度内核（系统核心）
│   │   src/
│   │   ├── runtime.ts                   #  5 阶段 Map-Reduce 流水线 (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE)
│   │   ├── workers.ts                   #  Codex App Server + Gemini Stream-JSON 工作进程适配器
│   │   ├── journal.ts                   #  阶段级断点续传存储（强类型 payload，含 VFS 脑裂检测）
│   │   ├── merkle.ts                    #  确定性 SHA-256 Merkle 树 Shard 完整性证明
│   │   ├── server.ts                    #  Unix Socket + HTTP 服务，接收 mcp-server 指令
│   │   └── cognitive/
│   │       ├── blackboard.ts            #  MCP 语义黑板：按需懒加载上下文（单文件 5MB 上限）
│   │       ├── router.ts                #  CQRS 安全意图路由器：只读 vs 读写工具清单隔离
│   │       ├── racing.ts                #  投机竞速执行器 + onAborted() 资源清理钩子
│   │       ├── reflexion.ts             #  内存 VFS + 反思状态机（最多 2 轮重试 + 原子落盘）
│   │       └── arkts-lsp-provider.ts   #  [可选] ArkTS LSP 客户端（手写 JSON-RPC + LspSessionMutex）
│   │
│   ├── antigravity-mcp-server/          ← 🔌 MCP 协议网关
│   │   #  注册 15 个 MCP 工具（model + task 两大领域）；提供 stdio/http transport；
│   │   #  通过 task-bridge.ts 桥接 AI 宿主 ↔ taskd HTTP API
│   │
│   ├── antigravity-vscode/              ← 🖥️  VS Code 集成层
│   │   #  注册扩展命令；管理可选的 ArkTS LSP 子系统（toggleArktsLsp 开关）；
│   │   #  渲染 Dashboard WebView 面板；负责 workflow 控制平面编排
│   │
│   │  ────── 运行时支撑层 ───────────────────────────────────────
│   │
│   ├── antigravity-core/                ← ⚙️  DAG 引擎与合规治理
│   │   #  DAG 状态机、风险路由、合规引擎、应用服务层
│   │
│   ├── antigravity-shared/              ← 📐 共享 Schema 与类型
│   │   #  Zod 校验的共享定义：Job 状态、事件类型、错误码、DAG 节点结构
│   │
│   ├── antigravity-persistence/         ← 💾 持久化层
│   │   #  JSONL EventStore（事件溯源）+ SQLite CheckpointStore + 内存适配器
│   │
│   │  ────── 模型路由层 ────────────────────────────────────────
│   │
│   ├── antigravity-model-shared/        ← 🏷️  模型注册表协议
│   │   #  模型目录类型、任务类型枚举、路由配置 Schema（零运行时依赖）
│   │
│   ├── antigravity-model-core/          ← 🤖 多模型路由运行时
│   │   #  智能路由、并行多模型查询、投票/共识引擎、CLI Agent 调用
│   │
│   │  ────── UI 与可选能力 ─────────────────────────────────────
│   │
│   ├── antigravity-webview/             ← 🎨 Dashboard React 仪表盘
│   │   #  React + Vite WebView，提供概览 / 模型管理 / 任务历史 / 调度等 Tab
│   │
│   └── ace-bridge/                      ← 🛠️  [可选] DevEco Studio 桥接
│       #  解析 DevEco 项目元数据（JSON5），启动 ace-server LSP 进程
```

---

## 🔄 核心数据流转

```
┌─────────────────────────────────────────────────────────────────┐
│                           开发者                                │
│  VS Code：Cmd+Shift+P → "Antigravity: 启动任务"                 │
└───────────────────────┬─────────────────────────────────────────┘
                        │ 命令激活
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  antigravity-vscode  （扩展宿主进程）                           │
│  • 注册命令 & 管理 Dashboard WebView                            │
│  • [可选] 管理 ArkTS LSP 子系统（ace-bridge → ace-server）      │
│  • 将任务指令委托给 → workflow-orchestrator.ts                  │
└───────────────────────┬─────────────────────────────────────────┘
                        │ MCP stdio/http 调用
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  antigravity-mcp-server  （MCP 协议网关）                       │
│  • 验证工具领域（model | task）                                 │
│  • task.run → task-bridge.ts → taskd HTTP API                   │
│  • ai_* 工具 → antigravity-model-core（多模型并行路由）         │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTP / Unix Socket
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  antigravity-taskd  （任务调度内核 — 系统核心）                 │
│                                                                 │
│  SCOUT  ─── Codex/Gemini 扫描代码库，识别相关文件并分片         │
│    │                                                            │
│  SHARD  ─── N 个并行 Worker 进程独立推理（支持投机竞速）        │
│    │        每个 Shard 产出独立的 ShardAnalysis                 │
│  AGGREGATE ── Merkle 校验后合并所有 Shard 结果                  │
│    │                                                            │
│  VERIFY ─── 生成代码写入纯内存 VFS                              │
│    │        [可选] ArkTS LSP 诊断 + 反思修复（最多 2 轮）       │
│    │                                                            │
│  WRITE  ─── fsync + rename 原子提交到物理磁盘                   │
│                                                                 │
│  Journal：每个阶段边界写入 JSONL 断点                           │
│  （支持从任意阶段崩溃恢复，含 VFS 脑裂检测）                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ 开发与构建指南

### 环境要求

| 工具 | 版本要求 |
|------|---------|
| **Node.js** | ≥ 20 |
| **npm**（Workspaces 模式）| ≥ 10 |
| **VS Code** | ≥ 1.85.0 |
| **Codex CLI** | 最新版（`codex app-server` 模式）|
| **Gemini CLI** | 最新版（`gemini --output-format stream-json`）|
| **DevEco Studio** | ≥ 4.x（可选，仅 ArkTS LSP 功能需要）|

### 安装依赖

```bash
npm install
```

### 构建

```bash
# 完整生产构建（所有子包 + WebView + 扩展 Bundle）
npm run build

# 仅构建任务调度内核
npm run build:antigravity-taskd

# 仅构建 MCP Server
npm run build:antigravity-mcp

# 增量 Watch 模式（仅监听扩展入口）
npm run watch
```

### 类型检查

```bash
# 全 Monorepo 类型检查（含 src 目录产物污染检测）
npm run typecheck:all

# 按包单独检查
npm run typecheck:antigravity-taskd
npm run typecheck:antigravity-mcp
npm run typecheck:antigravity-vscode
```

### 测试

```bash
# 全量测试
npm test

# 契约测试（快速，适合 CI 门控）
npm run check:contracts

# MCP Server 烟雾测试（构建后端到端调用 MCP 工具）
npm run smoke:mcp

# 覆盖率报告
npm run coverage
```

### VS Code 调试

1. 按 **F5** — 启动扩展开发宿主窗口。
2. 在宿主窗口中打开任意项目。
3. 执行 **`Cmd+Shift+P` → `Antigravity: 打开控制面板`** 打开仪表盘。
4.（可选）如需 ArkTS LSP，执行 `Antigravity: 切换 ArkTS LSP` 并配置 `arkts.deveco.path`。

### 打包与安装 VSIX

```bash
# 构建并打包为 .vsix 安装包
npm run package

# 构建 → 打包 → 安装到 VS Code → 同步 dist 文件（一键完成）
npm run install-ext
```

### CI 流水线

```bash
# 完整 CI：类型检查 → 测试 → 构建
npm run ci
```

### 配置项（`settings.json`）

```jsonc
{
  // 默认兜底路由大模型
  "antigravity.defaultModel": "deepseek",

  // 自动清理超过 N 天的历史记录
  "antigravity.retentionDays": 30,

  // [可选] DevEco Studio 安装路径（仅 ArkTS LSP 功能需要，留空则自动检测）
  "arkts.deveco.path": "/Applications/DevEco-Studio.app",

  // [可选] LSP 通信日志级别
  "arkts.trace.server": "off"       // "off" | "messages" | "verbose"
}
```

### 环境变量（taskd 进程）

| 变量名 | 默认值 | 说明 |
|--------|-------|------|
| `ANTIGRAVITY_TASKD_WORKSPACE_ROOT` | **必填** | 被分析工作区的绝对路径 |
| `ANTIGRAVITY_TASKD_DATA_DIR` | `<root>/data/antigravity_taskd/` | Journal 与断点文件存储目录 |
| `ANTIGRAVITY_TASKD_SOCKET_PATH` | `$TMPDIR/antigravity-taskd-<safe>.sock` | MCP → taskd 进程间通信的 Unix Socket 路径 |
| `ANTIGRAVITY_TOOL_DOMAINS` | `model,task` | MCP 对外暴露的工具领域（逗号分隔）|

---

## 🏛️ 架构安全保证

| 关注点 | 防御机制 |
|--------|---------|
| **崩溃恢复** | 5 阶段 JSONL Journal；从最后完成阶段恢复；`vfsPendingPaths` 检测 VFS-Journal 脑裂 |
| **内存安全** | VFS 纯内存操作；`fsync + rename` 原子落盘；黑板单文件 5MB 上限 |
| **并发安全** | `LspSessionMutex`（FIFO Promise 队列）串行化多 Shard 对 LSP 的并发访问 |
| **OS 管道死锁** | `child.stderr.on('data', () => {})` 原始 drain 底网，防止 64KB 管道死锁 |
| **Unicode 安全** | `unicodeSafeSlice()` 使用 `Intl.Segmenter` / `Array.from()`，绝不切断代理对 |
| **确定性哈希** | `deterministicStringify()` 递归按键名排序后 SHA-256，跨环境 Merkle 根一致 |
| **跨平台兼容** | `normalizeCRLF()` 嗅探磁盘换行符，强制对齐 LLM 输出，LSP Offset 不错位 |

---

## 📚 深入文档

| 文档 | 说明 |
|------|------|
| [docs/ANTIGRAVITY_CONTRACT.md](docs/ANTIGRAVITY_CONTRACT.md) | 命令契约规范 — MCP 工具与扩展命令的对外 API 契约 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构详解 — 流水线各阶段实现细节与模块交互 |
| [docs/QUICK_START.md](docs/QUICK_START.md) | 快速上手 — 从安装到第一次运行任务的完整指南 |
| [docs/API_COOKBOOK.md](docs/API_COOKBOOK.md) | API Cookbook — 常见集成场景的代码示例 |

---

## 📄 开源许可

[MIT](./LICENSE) © [like3213934360-lab](https://github.com/like3213934360-lab)
]]>
