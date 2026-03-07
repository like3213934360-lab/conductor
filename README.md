# Conductor AGC

> **多智能体治理引擎** — 基于 Event Sourcing + Neuro-Symbolic AI 的 MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.12+-purple.svg)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 概述

Conductor 是一个多智能体治理引擎（AGC, AI Governance & Collaboration），通过 MCP（Model Context Protocol）协议向 LLM 宿主暴露工具，实现：

- **DAG 编排** — 自定义异步 DAG 引擎（Kahn 拓扑排序），7 节点标准流程
- **风险路由** — DR 分歧率驱动的四级路由（express/standard/full/escalated）
- **合规引擎** — 策略模式 + 洋葱管道，S1-S13 规则可插拔
- **Event Sourcing** — 不可变事件流 + 纯函数投影，支持 Time-Travel Debugging
- **MCP 工具** — `agc.run` / `agc.get_state` / `agc.verify_run`

## 架构

```
┌─────────────────────────────────────────────────────┐
│                  MCP Server (stdio)                 │
│  agc.run  │  agc.get_state  │  agc.verify_run       │
├─────────────────────────────────────────────────────┤
│               Application Service                   │
│                  (AGCService)                        │
├──────────┬──────────┬──────────┬────────────────────┤
│ DAG      │ Risk     │ Compliance│ Event Sourcing     │
│ Engine   │ Router   │ Engine    │ (Projector)        │
├──────────┴──────────┴──────────┴────────────────────┤
│             conductor-shared (Schema/Types)          │
└─────────────────────────────────────────────────────┘
```

## 包结构

| 包 | 说明 |
|---|---|
| `conductor-shared` | Branded Types + Zod Schema + Event Sourcing 投影器 + 错误码 |
| `conductor-core` | DAG 引擎 + DR 风险路由 + 合规引擎(S1-S13) + AGCService |
| `conductor-mcp-server` | MCP Server 入口 + 3 个工具 + 内存适配器 |

## 快速开始

### 安装

```bash
npm install
```

### 构建

```bash
npm run build:conductor
```

### 启动 MCP Server

```bash
node packages/conductor-mcp-server/dist/main.js
```

### 在 MCP 配置中注册

```json
{
  "mcpServers": {
    "conductor": {
      "command": "node",
      "args": ["packages/conductor-mcp-server/dist/main.js"]
    }
  }
}
```

## MCP 工具

### `agc.run`

启动 AGC 多模型治理流程。

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `goal` | string | ✅ | 任务描述/目标 |
| `repoRoot` | string | - | 项目根目录 |
| `files` | string[] | - | 相关文件路径 |
| `riskHint` | enum | - | 预设风险等级 (low/medium/high/critical) |
| `tokenBudget` | number | - | Token 预算上限 |
| `debug` | boolean | - | 调试模式 |

### `agc.get_state`

查询运行状态（通过事件回放还原）。

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `runId` | string | ✅ | 运行 ID |

### `agc.verify_run`

验证运行完整性（漂移检测 + 合规重算）。

| 参数 | 类型 | 必选 | 说明 |
|------|------|------|------|
| `runId` | string | ✅ | 运行 ID |

## DAG 流程

标准 7 节点 DAG：

```
ANALYZE → PARALLEL → DEBATE → VERIFY → SYNTHESIZE → PERSIST → HITL
                      (可跳过)                                (可跳过)
```

风险路由通道：
- **Express** — DR=0 时跳过 DEBATE，快速通过
- **Standard** — 低/中风险，执行全部非可跳过节点
- **Full** — 高风险，执行全部节点含 DEBATE
- **Escalated** — 极高风险或合规阻断，含 HITL 人类审核

## 技术栈

- **TypeScript 5.3+** — 严格模式 + NodeNext 模块
- **Zod 3.24+** — Schema 定义 + 运行时校验
- **MCP SDK 1.12+** — Model Context Protocol 服务端
- **Event Sourcing** — 不可变事件 + 纯函数投影
- **npm Workspaces** — Monorepo 管理

## 学术参考

| 领域 | 参考 |
|------|------|
| 图执行引擎 | LangGraph (Harrison Chase, 2024) |
| 合规检查 | Constitutional AI (Anthropic, 2022) |
| 风险路由 | NeMo Guardrails (NVIDIA, 2023) |
| Event Sourcing | Greg Young CQRS/ES (2010) |
| 多智能体协作 | Multi-Agent Debate (MIT, Du et al., 2023) |

## 路线图

- [x] **Phase 1** — 核心基础 (DAG + Risk + Compliance + MCP)
- [ ] **Phase 2** — Memory & State (JSONL 持久化 + SQLite)
- [ ] **Phase 3** — Multi-Model 协作 (辩论 + 投票)
- [ ] **Phase 4** — Plugin SDK + HarmonyOS 插件
- [ ] **Phase 5** — E2E 测试 + OpenTelemetry 可观测性

## License

MIT
