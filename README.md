<div align="center">

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

---

## 🏛️ 四大支柱

<table>
<tr>
<td width="25%" align="center">

### 🖥️ 可视化体验

VS Code 扩展<br/>React Dashboard

</td>
<td width="25%" align="center">

### 🤖 模型大脑

多模型路由<br/>共识投票 · 熔断降级

</td>
<td width="25%" align="center">

### 🔌 协议网关

MCP 工具目录<br/>DevEco 桥接

</td>
<td width="25%" align="center">

### 🧠 调度内核

Map-Reduce 流水线<br/>投机竞速 · 断点续传

</td>
</tr>
</table>

---

## 🖥️ 支柱一：可视化体验 (VS Code Extension & Webview)

系统不只是一个后台脚本 — 它拥有完整的 GUI 前端。

### 命令面板集成

通过 `Cmd+Shift+P` 触发 6 条注册命令，实现**零学习成本**的无缝操作：

| 命令 | 功能 |
|------|------|
| `Antigravity: 打开控制面板` | 启动 Dashboard WebView |
| `Antigravity: 启动任务` | 启动一个 Map-Reduce 分析/写入任务 |
| `Antigravity: 实时查看任务` | SSE 流式订阅任务进度事件 |
| `Antigravity: 查看当前任务` | 获取最新任务快照 |
| `Antigravity: 取消当前任务` | 终止正在运行的任务 |
| `Antigravity: 切换 ArkTS LSP` | 启用/禁用可选的 ArkTS LSP 子系统 |

### React Dashboard — 7 个功能面板

`antigravity-webview` 使用 **React + Vite** 构建，内嵌于 VS Code WebView：

| 面板 | 功能 |
|------|------|
| **Overview** | 系统全景概要 — 当前运行状态、已配置模型计数、CLI 安装检测 |
| **Config** | 模型管理 CRUD — 添加/编辑/删除模型实例，在线连通性测试（绕过 CORS），API Key 安全存储 |
| **Workflow** | 实时任务流 — 启动任务、SSE 流式查看阶段进度（SCOUT → SHARD → AGGREGATE → VERIFY → WRITE） |
| **Test** | 连接测试面板 — 批量验证已配置模型的 API 可用性 |
| **History** | 请求历史控制台 — SQLite 持久化的调用记录（模型/耗时/Token/状态/预览） |
| **Routing Guide** | 路由引导 — 交互式展示任务类型 → 模型匹配的路由逻辑 |
| **Skill** | 技能面板 — 可用技能列表与文档 |

### CLI 生态发现引擎

Dashboard 的 **Ecosystem** 功能可自动扫描 `~/.codex/config.toml` 和 `~/.gemini/settings.json`，解析用户已安装的所有 MCP Server 和 Gemini Extension：

1. **本地解析**：读取配置文件 → 提取 `command + args` → 匹配内置描述库（40+ 中文条目）
2. **注册表补全**：npm / PyPI 精确查询 → npm 模糊搜索 → 补齐 `package.json` 尚未覆盖的外部包
3. **AI 描述生成**：先尝试 `vscode.lm.selectChatModels()` 编辑器内建 LM → 再尝试用户已配置的 API 模型 → 翻译英文描述或根据名称推断功能

### 流水线编排

`WorkflowOrchestrator` 管理 `antigravity-taskd` 的完整生命周期：

- **按需启动**：首次调用时自动 `spawnAntigravityTaskdProcess()` 拉起 taskd 子进程
- **连接复用**：优先通过 Unix Socket 探活已有进程 → `client.ping()` 成功则直接复用
- **事件流式化**：`streamRun()` 订阅 taskd SSE → 映射为 Legacy Snapshot 格式 → 推送至 WebView

---

## 🤖 支柱二：模型大脑 (Model Core & Routing)

`antigravity-model-core` 和 `antigravity-model-shared` 共同构成系统的"大脑"层。

### 万能模型目录

系统通过 `~/.antigravity-model-catalog.json` 持久化一份统一的模型目录，支持接入任何 **OpenAI 兼容 API** 的大模型。开箱即支持在 `settings.json` 中切换的 8 种预设模型：

| 模型 | 覆盖能力 |
|------|---------|
| **DeepSeek** | 代码生成、长上下文推理 |
| **GLM** (智谱) | 中文理解、翻译 |
| **Qwen** (通义) | 数学推理、工具调用 |
| **MiniMax** | 创意写作 |
| **Kimi** (月之暗面) | 超长上下文 |
| **GPT** (OpenAI) | 通用编码 |
| **Gemini** (Google) | 多模态推理 |
| **Mistral** | 代码审查、架构 |

> 在 Dashboard 的 **Config 面板**中可随时添加自定义模型（如私有部署的 Llama、CodeGeeX 等），只要提供 `baseUrl + modelId + apiKey` 即可。

### 智能任务路由引擎

`routing.ts` 实现了一套**权重评分任务检测器**：

1. **长度感知**：`> 3000 字符` 直接路由到 `long_context` 模型
2. **关键字权重累加**：11 个任务类别（`code_gen / code_review / architecture / documentation / translation / ui_design / long_context / math_reasoning / tool_calling / creative / agentic`），每个关键字按长度贡献 1-2 分
3. **优先级排序**：在命中同一任务类别的多个模型中，按 `priority` 排序选择最优先的模型

### 多模型共识投票引擎

`consensus.ts` 实现了完整的**多模型生成 → 裁判评分 → 最佳答案选择**流程：

```
┌─────────────────────────────────────────────────┐
│  Step 1: 并行查询候选模型（最多 5 个）          │
│       DeepSeek ──┐                              │
│       Qwen    ──┤─→  收集候选答案              │
│       GLM     ──┘                               │
│                                                 │
│  Step 2: 裁判模型评分（1-10 分 + 推理说明）     │
│       Gemini (judge) → 对比评分 → 选出赢家     │
│                                                 │
│  Step 3: 返回 ConsensusResult                   │
│       { judgeText, candidates[], totalMs }      │
└─────────────────────────────────────────────────┘
```

### 三态熔断器 + 自动降级链

`circuit-breaker.ts` + `model-client.ts` 构成了生产级的容错层：

- **Circuit Breaker**：每个 `modelId` 独立管理 `CLOSED → OPEN → HALF_OPEN` 三态转换（连续 3 次失败熔断，60s 后试探性放行）
- **自动降级**：`callModelWithFallback()` 维持 `主模型 → 最多 3 个备选` 的降级队列；仅可重试错误（`429 / 5xx / ETIMEDOUT / ECONNREFUSED`）触发降级，认证错误（`401 / 403`）立即抛出
- **并行多询**：`multi-ask.ts` 并行查询多模型、`parallel-executor.ts` 并发执行子任务

---

## 🔌 支柱三：协议网关 (MCP Server & DevEco Bridge)

### MCP 协议网关 — 15 个注册工具

`antigravity-mcp-server` 是系统对外的**万能接口面**。任何支持 MCP 协议的 AI 宿主（Antigravity / Codex / Gemini / Claude / Cursor 等）都可以通过 stdio 或 HTTP 传输层连入本系统。

工具目录分为两大领域：

**`model` 域 — AI 模型操作**

| 工具 | 功能 |
|------|------|
| `ai_ask` | 智能路由单次问答 |
| `ai_codex_task` | 调度 Codex CLI 自主编码 |
| `ai_gemini_task` | 调度 Gemini CLI 自主推理 |
| `ai_parallel_tasks` | 批量并发执行多个 AI 子任务 |
| `ai_multi_ask` | 同一问题并行询问多模型 |
| `ai_consensus` | 多模型共识投票 + 裁判评分 |
| `ai_start_job` | 异步启动长时间 CLI 任务 |
| `ai_poll_job` | 轮询异步任务状态 |
| `ai_list_models` | 列出已配置模型目录 |
| `ai_list_ecosystem` | 发现本地 MCP/CLI 生态 |

**`task` 域 — 任务调度操作**

| 工具 | 功能 |
|------|------|
| `task.run` | 启动 Map-Reduce 分析/写入任务 |
| `task.getState` | 读取任务最新快照 |
| `task.advance` | 获取任务最近事件流 |
| `task.list` | 列出历史任务 |
| `task.cancel` | 取消运行中任务 |

此外还提供 `search_tools` 工具，支持按关键字模糊搜索工具目录。

工具领域可通过环境变量 `ANTIGRAVITY_TOOL_DOMAINS=model,task` 按需开关。

### DevEco Studio 桥接 — ace-bridge

`ace-bridge` 是系统的**次元壁穿透器**，让 VS Code 可以直接调用华为 DevEco Studio 内置的 ArkTS 语言服务：

1. **环境探测**：`deveco-detector.ts` 自动在 macOS (`/Applications/DevEco-Studio.app/Contents`)、Windows (`%LOCALAPPDATA%/Huawei/DevEco Studio`) 和 Linux (`/opt/deveco-studio`) 三平台搜索安装路径
2. **SDK 路径推导**：从 DevEco 安装根推导出 `aceServerEntry`、`sdkJsPath`、`sdkComponentPath`、`hosSdkPath`、`aceLoaderPath`、`nodeExecutable` 等完整路径链
3. **LSP 进程启动**：`launchAceServer()` 使用 **DevEco 自带的 Node.js**（非系统 Node）启动 `ace-server`，通过 `--stdio` 管道与 VS Code `LanguageClient` 对接

---

## 🧠 支柱四：调度内核 (Taskd) 的极限防御

`antigravity-taskd` 是整个系统的核心引擎 — 它将一个目标拆解为可并行执行的多 Agent 流水线。

### 5 阶段 Map-Reduce 流水线

```
SCOUT  ── 扫描代码库，识别相关文件并提出分片策略
  │
SHARD  ── N 个并行 Worker 进程独立推理（Codex / Gemini，支持投机竞速）
  │        每个 Shard 产出独立的 ShardAnalysis
AGGREGATE ── Merkle 校验后合并所有 Shard 结果
  │
VERIFY ── 生成代码写入纯内存 VFS → [可选] ArkTS LSP 诊断 + 反思修复（最多 2 轮）
  │
WRITE  ── fsync + rename 原子提交到物理磁盘
```

### 架构安全保证

| 关注点 | 防御机制 |
|--------|---------| 
| **崩溃恢复** | 5 阶段 JSONL Journal + SHA-256 完整性哈希；崩溃后从最后完成阶段恢复；`vfsPendingPaths` 检测 VFS-Journal 脑裂 |
| **内存安全** | 纯内存 VFS 操作；黑板单文件 5MB 上限；`MAX_LINE_BYTES` 限制单行 JSON 大小 |
| **并发安全** | `LspSessionMutex`（FIFO Promise 队列）串行化多 Shard 对 LSP 的并发访问 |
| **OS 管道死锁** | `child.stderr.on('data', () => {})` 原始 drain 底网，防止 64KB 管道缓冲区死锁 |
| **SSE 反压** | `safeSseWrite()` 检查 `res.write()` 返回值 + `drain` 事件监听 + 128 条积压硬上限断连 |
| **Unicode 安全** | `unicodeSafeSlice()` 使用 `Intl.Segmenter` / `Array.from()`，绝不切断代理对 |
| **确定性哈希** | `deterministicStringify()` 递归按键名排序后 SHA-256，跨环境 Merkle 根一致 |
| **跨平台兼容** | `normalizeCRLF()` 嗅探磁盘换行符，强制对齐 LLM 输出，LSP Offset 不错位 |

---

## 🏗️ 包架构拓扑

```
antigravity-workflow/                    ← VS Code 扩展根包 (dist/extension.js)
│
├── packages/
│   │
│   │  ────── 🖥️ 交互层 ──────────────────────────────────────
│   │
│   ├── antigravity-vscode/              ← VS Code 集成（6 命令 + Dashboard + Orchestrator）
│   │
│   ├── antigravity-webview/             ← React + Vite Dashboard（7 面板 + 生态发现引擎）
│   │
│   │  ────── 🤖 模型层 ──────────────────────────────────────
│   │
│   ├── antigravity-model-shared/        ← 模型目录类型 + 11 类任务关键字表（零运行时依赖）
│   │
│   ├── antigravity-model-core/          ← 路由引擎 + 共识投票 + 熔断降级 + 并行执行器
│   │
│   │  ────── 🔌 协议层 ──────────────────────────────────────
│   │
│   ├── antigravity-mcp-server/          ← MCP 网关（15 工具 × 2 领域 + search_tools）
│   │
│   ├── ace-bridge/                      ← [可选] DevEco Studio 桥接（三平台自动检测）
│   │
│   │  ────── 🧠 内核层 ──────────────────────────────────────
│   │
│   ├── antigravity-taskd/               ← Map-Reduce 任务调度内核（系统核心）
│   │   src/
│   │   ├── runtime.ts                   #  5 阶段流水线 (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE)
│   │   ├── workers.ts                   #  Codex App Server + Gemini Stream-JSON 工作进程适配器
│   │   ├── journal.ts                   #  阶段级断点续传（原子写入 + SHA-256 完整性校验）
│   │   ├── merkle.ts                    #  确定性 Merkle 树 Shard 完整性证明
│   │   ├── server.ts                    #  Unix Socket HTTP 服务 + SSE 反压防御
│   │   └── cognitive/
│   │       ├── blackboard.ts            #  MCP 语义黑板（按需懒加载，5MB 上限）
│   │       ├── router.ts                #  CQRS 意图路由（只读 vs 读写工具隔离）
│   │       ├── racing.ts                #  投机竞速执行器 + onAborted() 清理
│   │       ├── reflexion.ts             #  VFS + 反思状态机（最多 2 轮重试 + 原子落盘）
│   │       └── arkts-lsp-provider.ts    #  [可选] ArkTS LSP 客户端
│   │
│   │  ────── ⚙️ 运行时支撑 ──────────────────────────────────
│   │
│   ├── antigravity-core/                ← DAG 引擎 + 合规治理 + 风险路由
│   │
│   ├── antigravity-shared/              ← 共享 Schema（Zod 校验的 Job/Event/Error 定义）
│   │
│   └── antigravity-persistence/         ← JSONL EventStore + SQLite CheckpointStore
```

---

## 🔄 核心数据流转

```
┌───────────────────────────────────────────────────────────────────────────┐
│                              开发者                                      │
│  VS Code：Cmd+Shift+P → "Antigravity: 启动任务"                          │
│  或：Dashboard WebView → Workflow 面板 → 输入目标 → 启动                 │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ 命令激活
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  antigravity-vscode（扩展宿主进程）                                      │
│  • WorkflowOrchestrator：按需启动 / 复用 taskd 子进程(Unix Socket 探活)   │
│  • DashboardPanel：7 面板 WebView + 生态发现引擎                         │
│  • RequestHistoryRepository：SQLite 持久化调用记录                       │
│  • [可选] ArktsLspController → ace-bridge → DevEco ace-server           │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ HTTP / Unix Socket
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  antigravity-mcp-server（MCP 协议网关）                                  │
│  • 验证工具领域（model | task）                                          │
│  • task.* 工具 → task-bridge.ts → taskd HTTP API                        │
│  • ai_* 工具 → antigravity-model-core（路由 → 熔断 → 降级 → 调用）      │
└──────────────────────────────┬────────────────────────────────────────────┘
                               │ HTTP / Unix Socket
                               ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  antigravity-taskd（任务调度内核 — 系统核心）                             │
│                                                                          │
│  SCOUT  → 动态路由选择 Codex/Gemini 扫描代码库，识别文件并分片            │
│    │                                                                     │
│  SHARD  → N 个并行 Worker 进程独立推理（投机竞速 + Merkle 校验）         │
│    │                                                                     │
│  AGGREGATE → 合并所有 ShardAnalysis，生成统一结果                        │
│    │                                                                     │
│  VERIFY → 代码写入内存 VFS → [可选] LSP 诊断 + 反思修复（≤ 2 轮）       │
│    │                                                                     │
│  WRITE  → fsync + rename 原子提交到物理磁盘                              │
│                                                                          │
│  Journal：每个阶段边界写入 JSONL 断点（含 SHA-256 完整性哈希）            │
│  （支持从任意阶段崩溃恢复，含 VFS 脑裂检测）                             │
└───────────────────────────────────────────────────────────────────────────┘
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

# 仅构建模型层
npm run build:antigravity-model

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
npm run typecheck:antigravity-model
npm run typecheck:ace-bridge
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
