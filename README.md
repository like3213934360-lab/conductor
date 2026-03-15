<div align="center">

# ⚡ Antigravity AI

### **The Next-Gen Liquid Agentic IDE**
### **新一代液态智能体 IDE**

*Powered by the **Liquid Swarm Orchestrator (液态蜂群调度内核)** — a cognitive kernel that thinks, races, fuses, and evolves.*

*驱动核心：**Liquid Swarm Orchestrator（液态蜂群调度内核）**— 一个会思考、竞速、融合并自我进化的认知引擎。*

[![Version](https://img.shields.io/badge/version-0.3.0-00D4FF?style=for-the-badge)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-00FF88?style=for-the-badge)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-≥1.85-007ACC?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/)

</div>

---

> **"In 2026, an AI assistant that runs a single model on a single prompt is a toy. A system that orchestrates a swarm of heterogeneous agents — making them race, collaborate, cross-validate, and self-evolve — is the future."**
>
> **「在 2026 年，只用一个模型回答一条提示的 AI 助手是玩具。能让一群异构智能体竞速、协作、交叉验证并自我进化的系统，才是未来。」**

Antigravity AI is not another VS Code copilot. It is a **full-spectrum agentic operating system** that transforms your IDE into a living neural network of cooperating AI agents. At its core lies the **Liquid Swarm Orchestrator** — a cognitive kernel forged through 37 rounds of extreme architectural refinement — implementing capabilities that define the 2026 state of the art in multi-agent AI systems.

Antigravity AI 不是又一个 VS Code 副驾驶。它是一套**全谱系智能体操作系统**，将你的 IDE 变成由协作 AI 智能体组成的活体神经网络。其核心是 **Liquid Swarm Orchestrator（液态蜂群调度内核）**— 历经 37 轮极限架构锤炼的认知引擎 — 实现了定义 2026 年多智能体系统 SOTA 的核心能力。

---

## 🧬 The Five Pillars / 五大支柱

<table>
<tr>
<td width="20%" align="center">

### 🔀 Tri-State Adaptive Swarm
### 三态自适应蜂群
Token-Nomics driven shape-shifting<br/>算力经济学驱动的动态变形

</td>
<td width="20%" align="center">

### 🕸️ P2P Micro-MCP Mesh
### 去中心化微型 MCP 网格
Decentralized agent consciousness<br/>去中心化智能体意识共享

</td>
<td width="20%" align="center">

### 🛡️ Neuro-Symbolic Reflexion
### 零信任神经符号闭环
Zero-trust dual verification<br/>异源模型红蓝对抗 + 编译器形式化验证

</td>
<td width="20%" align="center">

### 🧠 Intent-Aware ELO Routing
### 意图感知达尔文路由
Darwinian self-evolution<br/>基于赛马遥测的自适应权重演化

</td>
<td width="20%" align="center">

### 🔒 Air-Gapped Sandbox
### 军工级物理隔离沙箱
Military-grade isolation<br/>100% 本地无网降级

</td>
</tr>
</table>

---

### 🔀 Pillar 1 — Tri-State Adaptive Swarm / 三态自适应蜂群

The orchestrator doesn't pick a strategy — it **morphs** between three execution topologies in real-time based on Token-Nomics (computational economics):

调度内核不选策略 — 它根据 Token-Nomics（算力经济学）在三种执行拓扑之间**实时变形**：

```
                    ┌──────────────────────────────────────────┐
                    │         TOKEN-NOMICS EVALUATOR           │
                    │         算力经济学评估器                  │
                    │  estimatedTokens ─┐                      │
                    │  burnRate ─────────┤──→ EXECUTION SHAPE  │
                    │  enableMoA ───────┘                      │
                    └──────────────┬───────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
    ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │  🚗 FRUGAL MODE │  │  🏎️ RACING MODE  │  │  🧬 MoA FUSION   │
    │     节流模式     │  │    赛马模式       │  │    融合模式       │
    │                 │  │                  │  │                  │
    │  Single-model   │  │  Speculative     │  │  Mixture of      │
    │  单体极速执行    │  │  multi-model     │  │  Agents output   │
    │  (cost ↓↓↓)     │  │  first-wins      │  │  synthesis       │
    │                 │  │  多路推测竞速     │  │  多模型输出融合   │
    │                 │  │  (latency ↓↓)    │  │  (quality ↑↑↑)   │
    └─────────────────┘  └──────────────────┘  └──────────────────┘
```

- **Frugal Mode / 节流模式**: Low complexity tasks → single best model, zero waste. 低复杂度任务 → 调度最优单模型，零浪费。
- **Speculative Racing / 推测性赛马**: Dual-model `race()` with `Promise.any` semantics — the first valid result wins, losers are `abort()`ed mid-stream. 双模型竞速，第一个有效结果胜出，败者中途 `abort()`。
- **MoA Fusion / 混合专家融合**: High-complexity tasks trigger `fuse()` with `Promise.allSettled` — all drafts are collected, then a **Synthesizer model** cross-validates and merges them into a superior output. Includes 3-tier graceful degradation. 高复杂度任务 → 收集所有草稿 → **合成器模型**交叉验证并融合为更优输出。包含三级优雅降级。

---

### 🕸️ Pillar 2 — P2P Micro-MCP Mesh / 去中心化微型 MCP 网格

Traditional multi-agent systems use a **centralized blackboard** — a single point of failure and a bottleneck. Antigravity AI breaks this paradigm with a **decentralized peer-to-peer mesh** built on Unix Domain Sockets:

传统多智能体系统使用**中心化黑板** — 单点故障且是瓶颈。Antigravity AI 用基于 Unix Domain Socket 的**去中心化 P2P 网格**打破了这一范式：

- Each Worker process spawns a **Micro-MCP Server** supporting `read_draft` / `peek_symbols` / `write_feedback` tools. 每个 Worker 进程生成一个**微型 MCP 服务器**，支持 `read_draft` / `peek_symbols` / `write_feedback` 工具。
- Concurrent Workers discover peers via the `SwarmMesh` registry and perform **Subconscious Draft Sharing** — one agent can peek at another's in-progress analysis before either has committed. 并发 Worker 通过 `SwarmMesh` 注册表发现对等节点，进行**潜意识草稿共享** — 一个智能体可以窥探另一个正在进行中的分析。
- The mesh is **ephemeral** — it exists only during a job's lifetime and leaves zero footprint after completion. 网格是**临时的** — 仅在作业生命周期内存在，完成后零痕迹。

---

### 🛡️ Pillar 3 — Neuro-Symbolic Reflexion / 零信任神经符号闭环

LLMs are confidently wrong. Antigravity AI never trusts a single model's output:

大语言模型总是自信地犯错。Antigravity AI 绝不信任单一模型的输出：

1. **Semantic Red-Teaming / 语义红蓝对抗**: A heterogeneous adversarial model (`RedTeamCritic`) reviews code changes, hunting for logical flaws, security vulnerabilities, and hallucinated APIs. 异源对抗模型审查代码变更，追猎逻辑缺陷、安全漏洞和幻觉 API。
2. **Formal Verification / 形式化验证**: Generated code is written to an in-memory VFS with `optimistic-lock` semantics, then validated against the local **ArkTS LSP compiler** for syntax and type correctness. 生成代码写入内存 VFS → 由本地 ArkTS LSP 编译器进行语法和类型验证。
3. **Reflexion Loop / 反思闭环**: If either check fails, the system enters a bounded retry loop (max 2 rounds) with previous diagnostics injected as context — achieving **100% logical + syntactic self-consistency**. 任一检查失败 → 进入有界重试（最多 2 轮），注入历史诊断 → 达成**100% 逻辑 + 语法双重自洽**。

---

### 🧠 Pillar 4 — Intent-Aware ELO Routing / 意图感知达尔文路由

The router doesn't use static model rankings. It **evolves**:

路由器不使用静态排名。它会**自我进化**：

- **6-Dimensional Scoring Matrix / 6 维评分矩阵**: `code_quality × long_context × reasoning × speed × cost × chinese` — weighted by task intent (`scout / analyze / generate / verify`). 根据任务意图加权。
- **Per-Intent ELO / 每意图独立 ELO**: Each model maintains an independent performance multiplier **per intent** — codex dominating at `generate` won't inflate its `verify` score. 每个模型在每种意图上维护独立的表现乘数 — codex 在 `generate` 上的优势不会膨胀其 `verify` 评分。
- **Racing Telemetry → ELO Feedback / 赛马遥测 → ELO 反馈**: Every race result feeds back into the router — winners get `+0.08`, losers `-0.03`, errors `-0.15`, clamped to `[0.3, 2.0]`. 每次赛马结果实时反馈路由器。
- **Cost-Efficiency Factor / 性价比因子**: Models with high `emaCostPerCall` are penalized proportionally. 高成本模型被按比例惩罚。
- **Fusion Quality Auto-Disable / 融合质量自动禁用**: If `emaFusionGain < -0.05` after 3+ fusions, the system automatically disables auto-fusion to stop wasting tokens. 融合连续无效 → 自动禁用，停止浪费 Token。

---

### 🔒 Pillar 5 — Enterprise-Grade Air-Gapped Sandbox / 军工级物理隔离沙箱

Deployable in military-grade air-gapped networks / 可部署在军工级物理隔离网络:

- **100% Local Ollama Fallback / 全本地化降级**: When network is unreachable, the system seamlessly degrades to local Ollama models. 网络不可达时无缝降级到本地 Ollama 模型。
- **9-Pattern Secrets Scrubbing / 9 种正则脱敏**: Regex-based real-time interception of AWS keys, database passwords, PII, and 6 other secret categories. 实时拦截 AWS 密钥、数据库密码、PII 等 9 类敏感信息。
- **Anti-OOM Memory Eviction / 防 OOM 记忆淘汰**: Token-based eviction with configurable thresholds. 基于 Token 的可配置阈值淘汰机制。
- **2M Token Global Circuit Breaker / 全局 200 万 Token 熔断器**: `burnRate` fuse monitors cumulative consumption — forces frugal mode when usage exceeds 50%. 累计消耗超 50% 时强制节流模式。

---

## 🏛️ System Architecture / 系统架构

```
antigravity-workflow/                    ← VS Code Extension Host / 扩展宿主
│
├── packages/
│   │
│   │  ── 🖥️ Interaction Layer / 交互层 ──────────────────────
│   ├── antigravity-vscode/              ← VS Code 集成 (commands + Dashboard + Orchestrator)
│   ├── antigravity-webview/             ← React + Vite Dashboard (7 面板 + 生态发现引擎)
│   │
│   │  ── 🤖 Model Intelligence / 模型智能层 ──────────────────
│   ├── antigravity-model-shared/        ← 模型目录类型 + 任务关键字表 (零运行时依赖)
│   ├── antigravity-model-core/          ← 路由引擎 + 共识投票 + 熔断降级 + 并行执行器
│   │
│   │  ── 🔌 Protocol Gateway / 协议网关层 ────────────────────
│   ├── antigravity-mcp-server/          ← MCP 网关 (15 工具 × 2 领域)
│   ├── ace-bridge/                      ← [可选/Optional] DevEco Studio ArkTS LSP 桥接
│   │
│   │  ── 🧠 Cognitive Kernel / 认知内核 — Liquid Swarm Orchestrator ──
│   ├── antigravity-taskd/               ← ⭐ 核心引擎 / THE CORE ENGINE
│   │   ├── runtime.ts                   # 6 阶段流水线 (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE/FINALIZE)
│   │   ├── cognitive/
│   │   │   ├── router.ts                # Per-Intent ELO + 6D 评分 + 性价比路由
│   │   │   ├── racing.ts                # 推测性赛马 (race) + MoA 融合 (fuse)
│   │   │   ├── swarm-mesh.ts            # P2P 微型 MCP 网格 (Unix socket 对等发现)
│   │   │   ├── red-team.ts              # 异源红队对抗审查
│   │   │   ├── memory.ts                # 语义记忆 (Token 淘汰)
│   │   │   └── reflexion.ts             # VFS + LSP 验证 + 有界重试
│   │   ├── journal.ts                   # 阶段级断点 (JSONL + SHA-256)
│   │   ├── merkle.ts                    # 确定性 Merkle 树 Shard 完整性证明
│   │   └── server.ts                    # Unix Socket HTTP + SSE 反压防御
│   │
│   │  ── ⚙️ Runtime Foundation / 运行时基座 ────────────────────
│   ├── antigravity-core/                ← DAG 引擎 + 合规网关
│   ├── antigravity-shared/              ← 共享 Schema (Zod 校验)
│   └── antigravity-persistence/         ← JSONL EventStore + SQLite CheckpointStore
```

---

## 🚀 Quick Start / 快速上手

### Prerequisites / 环境要求

| Tool / 工具 | Version / 版本 |
|------|---------|
| **Node.js** | ≥ 20 |
| **VS Code** | ≥ 1.85.0 |
| **Codex CLI** | Latest / 最新版 (`codex app-server` mode) |
| **Gemini CLI** | Latest / 最新版 (`gemini --output-format stream-json`) |
| **DevEco Studio** | ≥ 4.x (optional / 可选, ArkTS LSP only) |

### Install & Build / 安装与构建

```bash
npm install
npm run build          # Full production build / 完整生产构建
npm run typecheck:all  # Full monorepo type check / 全量类型检查
npm test               # All tests / 全量测试
npm run ci             # typecheck → test → build
```

### Launch / 启动

Press **F5** in VS Code → Extension Development Host → `Cmd+Shift+P` → `Antigravity: 打开控制面板`

### Package & Install / 打包安装

```bash
npm run install-ext  # Build → Package VSIX → Install → Sync / 一键构建打包安装
```

---

## ⚙️ Configuration / 配置

```jsonc
{
  "antigravity.defaultModel": "deepseek",  // Fallback routing model / 兜底路由模型
  "antigravity.retentionDays": 30,         // Auto-cleanup threshold / 自动清理天数
  "arkts.deveco.path": "",                 // DevEco path (auto-detect if empty) / 留空自动检测
  "arkts.trace.server": "off"             // LSP trace level / LSP 日志级别
}
```

| Environment Variable / 环境变量 | Default / 默认值 | Description / 说明 |
|---------------------|---------|-------------|
| `ANTIGRAVITY_TASKD_WORKSPACE_ROOT` | **Required / 必填** | Target workspace / 目标工作区绝对路径 |
| `ANTIGRAVITY_TASKD_DATA_DIR` | `<root>/data/` | Journal & checkpoint storage / 断点文件目录 |
| `ANTIGRAVITY_TASKD_SOCKET_PATH` | `$TMPDIR/antigravity-taskd-*.sock` | Unix socket IPC path / 进程间通信路径 |
| `ANTIGRAVITY_TOOL_DOMAINS` | `model,task` | MCP tool domains to expose / MCP 工具领域 |

---

## 📚 Documentation / 文档

| Document / 文档 | Description / 说明 |
|----------|-------------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Deep-dive whitepaper / 架构白皮书 — 管线生命周期、Mermaid 图、Token-Nomics 决策树 |
| [docs/ANTIGRAVITY_CONTRACT.md](docs/ANTIGRAVITY_CONTRACT.md) | API contract / API 契约规范 |
| [docs/QUICK_START.md](docs/QUICK_START.md) | First-run guide / 快速上手指南 |
| [docs/API_COOKBOOK.md](docs/API_COOKBOOK.md) | Integration recipes / 集成代码示例 |

---

<div align="center">

**Built with obsession. Forged in 37 rounds of architectural refinement.**

**以执念铸就。历 37 轮架构极限淬炼。**

*Antigravity AI — where agents don't just assist, they orchestrate.*

*Antigravity AI — 智能体不只是辅助，而是编排。*

[MIT](./LICENSE) © [like3213934360-lab](https://github.com/like3213934360-lab)

</div>
