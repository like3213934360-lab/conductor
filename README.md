<![CDATA[<div align="center">

# ⚡ Antigravity Workflow

**面向 ArkTS/HarmonyOS 生态深度定制的下一代多智能体代码智能平台**

由 **MCP (Model Context Protocol)** 驱动 · **Codex + Gemini CLI** 协同编排 · **ArkTS LSP** 闭环验证

[![版本](https://img.shields.io/badge/版本-0.3.0-blue?style=flat-square)](./package.json)
[![许可证](https://img.shields.io/badge/许可证-MIT-green?style=flat-square)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## 🚀 项目愿景

Antigravity Workflow 是一个**生产级多智能体任务调度核心**，以 VS Code 扩展形态交付。它专门解决**大规模 ArkTS 代码库的智能分析难题**：任何单次大模型调用都无法一次性完成推理的超大 `.ets` 代码仓库，可通过本系统进行批量、并行、可恢复的深度分析与代码生成。

系统将一次 AI 任务拆解为完整流水线 — **SCOUT → SHARD → AGGREGATE → VERIFY → WRITE** — 跨多个并行 Codex/Gemini CLI 工作进程调度，利用 ArkTS 语言服务器验证生成代码，仅在通过 LSP 诊断后才原子提交到磁盘。

### ✨ 核心技术特性

| # | 特性 | 实现机制 |
|---|------|---------|
| 1 | **Map-Reduce 任务调度内核** | `antigravity-taskd` 将代码库拆分为 Shard 并行推理，再将分片结果归约为全局分析。每个阶段均有 **JSONL EventStore + SQLite 断点续传**，崩溃后可从最后完成阶段恢复 |
| 2 | **LSP 驱动的反思纠错闭环** | 生成代码先写入**纯内存 VFS**；`arkts-lsp-provider` 在 `LspSessionMutex` 排他锁保护下运行 `didOpen → publishDiagnostics → didClose` 完整会话；最多 2 轮修复重试，失败则回滚 |
| 3 | **投机竞速并行执行** | `DefaultRacingExecutor` 同时启动 Codex 和 Gemini 两条路径；胜出者通过 `AbortSignal + onAborted()` 生命周期钩子立即终止失败方，确保 LSP 资源零泄漏 |
| 4 | **15 工具 MCP 接口面** | `antigravity-mcp-server` 对外暴露类型安全、领域隔离的 MCP 工具目录（`model` 域：`ai_ask / ai_codex_task / ai_gemini_task / ai_parallel_tasks / ai_consensus …`；`task` 域：`task.run / task.getState / task.advance / task.cancel / task.list`） |

---

## 🏗️ 包架构拓扑

```
antigravity-workflow/                    ← VS Code 扩展根包 (dist/extension.js)
│
├── packages/
│   │
│   ├── antigravity-taskd/               ← 🧠 核心：长任务调度内核
│   │   src/
│   │   ├── runtime.ts                   #  5 阶段 Map-Reduce 流水线 (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE)
│   │   ├── workers.ts                   #  Codex App Server + Gemini Stream-JSON 工作进程适配器
│   │   ├── journal.ts                   #  阶段级断点续传存储（强类型 payload，VERIFY 含 vfsPendingPaths）
│   │   ├── merkle.ts                    #  确定性 SHA-256 Merkle 树 Shard 完整性证明
│   │   ├── server.ts                    #  接收 mcp-server 指令的 Unix Socket + HTTP 服务
│   │   └── cognitive/
│   │       ├── blackboard.ts            #  基于 MCP 的懒加载语义黑板（单文件 5MB 防爆限制）
│   │       ├── router.ts                #  CQRS 安全意图路由器：只读 vs 读写工具清单隔离
│   │       ├── racing.ts                #  投机竞速执行器，含 onAborted() 资源清理钩子
│   │       ├── reflexion.ts             #  内存 VFS + LSP 驱动反思状态机（最多 2 轮重试）
│   │       └── arkts-lsp-provider.ts   #  手写 JSON-RPC 2.0 LSP 客户端 + LspSessionMutex（零外部依赖）
│   │
│   ├── antigravity-mcp-server/          ← 🔌 MCP 协议网关
│   │   #  注册 15 个 MCP 工具（model + task 两大领域）；提供 stdio/http transport；
│   │   #  通过 task-bridge.ts 桥接 AI 宿主 ↔ taskd HTTP API
│   │
│   ├── antigravity-vscode/              ← 🖥️  VS Code 集成层
│   │   #  注册全部扩展命令；管理 ArkTS LSP 生命周期（arkts-lsp-controller）；
│   │   #  渲染 Dashboard WebView 面板；负责 workflow 控制平面编排
│   │
│   ├── antigravity-webview/             ← 🎨 Dashboard React 仪表盘
│   │   #  React + Vite WebView，提供概览 / 模型管理 / 任务历史 / 路由 / 调度 / 测试等 Tab
│   │
│   ├── antigravity-core/                ← ⚙️  DAG 引擎与合规治理
│   │   #  实现 DAG 状态机、风险路由、合规引擎和应用服务层（依赖 antigravity-shared）
│   │
│   ├── antigravity-persistence/         ← 💾 持久化层
│   │   #  JSONL EventStore（事件溯源）+ SQLite CheckpointStore（better-sqlite3）+ 内存适配器
│   │
│   ├── antigravity-shared/              ← 📐 共享 Schema 与类型
│   │   #  Zod 校验的共享定义：Job 状态、事件类型、错误码、DAG 节点结构
│   │
│   ├── antigravity-model-shared/        ← 🏷️  模型注册表协议
│   │   #  模型目录类型、任务类型枚举、路由配置 Schema — 零运行时依赖
│   │
│   ├── antigravity-model-core/          ← 🤖 多模型路由运行时
│   │   #  智能路由、并行多模型查询、投票/共识引擎、CLI Agent 调用
│   │
│   └── ace-bridge/                      ← 🛠️  DevEco Studio 桥接
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
│  • 注册命令 & 管理 ArkTS LSP（ace-bridge → ace-server）         │
│  • 管理 Dashboard WebView 面板渲染                              │
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
│  antigravity-taskd  （任务调度内核 — 重型计算核心）             │
│                                                                 │
│  SCOUT  ─── Codex/Gemini 识别相关文件 Shard 切片               │
│    │                                                            │
│  SHARD  ─── N 个并行工作进程（支持投机竞速）                    │
│    │        每个 Shard 产出 ShardAnalysis                       │
│  AGGREGATE ── Merkle 校验后合并所有 Shard 结果                  │
│    │                                                            │
│  VERIFY ─── 生成代码写入纯内存 VFS                              │
│    │        ↕ JSON-RPC  LspSessionMutex 排他锁                 │
│    │     ArkTS LSP（arkts-lsp-provider）诊断                   │
│    │        反思状态机：最多 2 轮修复重试                        │
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
| **npm** （Workspaces 模式）| ≥ 10 |
| **VS Code** | ≥ 1.85.0 |
| **Codex CLI** | 最新版（`codex app-server` 模式）|
| **Gemini CLI** | 最新版（`gemini --output-format stream-json`）|
| **DevEco Studio** | ≥ 4.x（可选，用于 ArkTS LSP 功能）|

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

# MCP Server 烟雾测试（构建后对 MCP 工具进行端到端调用）
npm run smoke:mcp

# 覆盖率报告
npm run coverage
```

### VS Code 调试

1. 按 **F5** — 启动扩展开发宿主窗口。
2. 在宿主窗口中打开任意 ArkTS 项目（含 `.ets` 文件）。
3. 执行 **`Cmd+Shift+P` → `Antigravity: 打开控制面板`** 打开仪表盘。
4. 如 DevEco Studio 未被自动检测，请在设置中配置 `arkts.deveco.path`。

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
  // DevEco Studio 安装路径（留空则自动检测）
  "arkts.deveco.path": "/Applications/DevEco-Studio.app",

  // LSP 通信日志级别
  "arkts.trace.server": "off",       // "off" | "messages" | "verbose"

  // 默认兜底路由大模型
  "antigravity.defaultModel": "deepseek",

  // 自动清理超过 N 天的历史记录
  "antigravity.retentionDays": 30
}
```

### 环境变量（taskd 进程）

| 变量名 | 默认值 | 说明 |
|--------|-------|------|
| `ANTIGRAVITY_WORKSPACE_ROOT` | **必填** | 被分析工作区的绝对路径 |
| `ANTIGRAVITY_DATA_DIR` | `<root>/.antigravity/data` | Journal 与断点文件存储目录 |
| `ANTIGRAVITY_SOCKET_PATH` | `<root>/.antigravity/taskd.sock` | MCP → taskd 进程间通信的 Unix Socket 路径 |
| `ANTIGRAVITY_TOOL_DOMAINS` | `model,task` | MCP 对外暴露的工具领域（逗号分隔）|

---

## 🏛️ 架构安全保证

| 关注点 | 防御机制 |
|--------|---------|
| **崩溃恢复** | 5 阶段 JSONL Journal；从最后完成阶段恢复；`vfsPendingPaths` 检测 VFS-Journal 脑裂 |
| **内存安全** | VFS 纯内存操作；`fsync + rename` 原子落盘；黑板单文件 5MB 上限 |
| **并发安全** | `LspSessionMutex`（FIFO Promise 队列）串行化多 Shard 对 LSP 的并发访问 |
| **OS 管道死锁** | `child.stderr.on('data', () => {})` 原始 drain 底网，防止 64KB 管道塞满导致子进程被内核挂起 |
| **Unicode 安全** | `unicodeSafeSlice()` 使用 `Intl.Segmenter` / `Array.from()`，绝不切断代理对 |
| **确定性哈希** | `deterministicStringify()` 递归按键名字典序排序，跨 Node.js 版本 Merkle 根完全一致 |
| **CRLF 可移植性** | `normalizeCRLF()` 嗅探磁盘换行符并强制对齐 LLM 输出，确保 Windows 下 LSP Offset 不错位 |

---

## 📄 开源许可

[MIT](./LICENSE) © [like3213934360-lab](https://github.com/like3213934360-lab)
]]>
