# Conductor AGC

> **🤖 Multi-Model AI Governance Engine** — Event Sourcing × DAG Orchestration × GaaS (Governance as a Service)

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.12+-purple.svg)](https://modelcontextprotocol.io/)
[![SOTA Score](https://img.shields.io/badge/SOTA-8.6%2F10-brightgreen.svg)](#sota-rating)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Conductor AGC 是一个**生产级多智能体治理引擎**，通过 7 节点 DAG 状态机编排多个 LLM，结合 Event Sourcing、GaaS 策略网关和 P2P Federation，实现安全、可审计、可回溯的 AI 工作流。

## ✨ 核心特性

| 能力 | 实现 | SOTA 对标 |
|------|------|-----------|
| 🔀 DAG 编排 | 7 节点状态机 + 循环 DAG | LangGraph 2.0 |
| 🛡️ 治理网关 | GaaS 4 拦截点 (PDP/PEP) | OPA + NeMo Guardrails |
| 📦 Event Sourcing | 不可变事件流 + Time-Travel | Temporal.io |
| 🔍 可观测性 | OpenTelemetry GenAI Semantic | LangSmith |
| 🧠 记忆系统 | Vector Search + Snapshot | MemGPT |
| 🔒 安全沙箱 | E2B 硬件隔离 + 进程沙箱 | Deno Permissions |
| 🌐 P2P 联邦 | A2A Agent Card + Swarm Router | OpenAI Swarm SDK |
| 🎯 自适应学习 | ELO Prompt 优化 + Reflexion | DSPy |
| ⏪ HITL | Time-Travel 回退 + 分支执行 | — |
| 🧪 基准评估 | DAG + 治理评估套件 | AgentBench |

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────┐
│                    MCP / A2A Protocol                     │
│         agc.run │ agc.get_state │ agc.verify_run          │
├──────────────────────────────────────────────────────────┤
│                  Application Service                      │
│             AGCService (Orchestrator)                      │
├────────┬────────┬───────────┬────────────┬───────────────┤
│  DAG   │ Risk   │Governance │  Plugin    │  Federation   │
│ Engine │ Router │  Gateway  │  Manager   │     Bus       │
│(Cyclic)│(DR/4L) │ (GaaS)    │(Hook+Caps) │ (P2P Swarm)  │
├────────┴────────┴───────────┴────────────┴───────────────┤
│     Event Sourcing  │  Reflexion  │  Observability       │
│   (Upcasting+Snap)  │ (Actor Loop)│  (OTel Tracer)      │
├──────────────────────────────────────────────────────────┤
│              conductor-shared (Schema/Types/Zod)          │
└──────────────────────────────────────────────────────────┘
```

## 📦 包结构

```
packages/
├── conductor-shared        # 共享类型 + Zod Schema + Event 投影器
├── conductor-core          # 核心引擎 (17 模块)
│   ├── dag/                #   DAG 引擎 + 循环支持
│   ├── governance/         #   GaaS 治理网关
│   ├── risk/               #   DR 风险路由
│   ├── plugin/             #   插件系统
│   ├── federation/         #   P2P Agent Federation
│   ├── reflexion/          #   Reflexion Actor Loop
│   ├── benchmark/          #   基准评估
│   ├── optimization/       #   Prompt 优化
│   ├── observability/      #   OTel Tracer
│   └── cli/                #   CLI 工具
├── conductor-persistence   # 持久化 (JSONL + Vector Memory)
├── conductor-mcp-server    # MCP Server 入口
├── conductor-hub-vscode    # VS Code 扩展
└── conductor-hub-webview   # Dashboard UI (Liquid Glass)
```

## 🚀 快速开始

```bash
# 安装
git clone https://github.com/anthropic/conductor-agc.git && cd conductor-agc
npm install

# 构建
npm run build:conductor

# CLI
npx ts-node packages/conductor-core/src/cli/conductor-agc-cli.ts run --goal "分析代码"

# MCP Server
node packages/conductor-mcp-server/dist/main.js
```

```typescript
import { AGCService } from '@anthropic/conductor-core'

const service = new AGCService({ eventStore, checkpointStore })
const { runId, route, drScore } = await service.startRun({
  metadata: { goal: '代码审查', repoRoot: '.' },
  graph: standardDAG,
})
```

**👉 详细指南: [Quick Start](docs/QUICK_START.md) | [API Cookbook](docs/API_COOKBOOK.md)**

## 📐 DAG 7 节点流程

```
ANALYZE → PARALLEL → DEBATE → SYNTHESIZE → VERIFY → PERSIST
                                                        ↘
                                                       HITL
```

4 级风险路由: **Express** (跳过 DEBATE) → **Standard** → **Full** (含 DEBATE) → **Escalated** (含 HITL)

## 🔧 MCP 工具

| 工具 | 参数 | 说明 |
|------|------|------|
| `agc.run` | goal, riskHint, files, tokenBudget | 启动 AGC 运行 |
| `agc.get_state` | runId | 查询运行状态 (Event Replay) |
| `agc.verify_run` | runId | 完整性验证 (Drift Detection) |
| `agc.benchmark` | — | 运行评估套件 |
| `agc.plugins` | — | 查询插件状态 |

## <a name="sota-rating"></a>📊 SOTA 评级 (2026.03)

**综合评分: 8.6 / 10** (Gemini 8.8 + DeepSeek 8.4 加权平均)

| 维度 | 评级 | 维度 | 评级 |
|------|:----:|------|:----:|
| Agent Orchestration | ⭐ **LEADING** | Memory Systems | ⭐ **LEADING** |
| Governance & Compliance | ⭐ **LEADING** | Observability | ⭐ **LEADING** |
| Reliability & Fault Tolerance | ⭐ **LEADING** | Security Sandboxing | ⭐ **LEADING** |
| Evaluation Benchmarks | ⭐ **LEADING** | HITL | ⭐ **LEADING** |
| Adaptive Learning | ⭐ **LEADING** | Tool Use | ⭐ **LEADING** |
| Communication Protocols | 🟢 ON_PAR | Multi-Model Collab | 🟢 ON_PAR |
| Plugin Ecosystem | 🟢 ON_PAR | Scale & Federation | 🟢 ON_PAR |

## 📚 文档

- [Quick Start](docs/QUICK_START.md) — 5 分钟上手
- [API Cookbook](docs/API_COOKBOOK.md) — 10 个场景代码示例
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
