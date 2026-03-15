# 🧠 Liquid Swarm Orchestrator / 液态蜂群调度内核

> **The cognitive kernel powering Antigravity AI.**
> **驱动 Antigravity AI 的认知核心引擎。**
>
> Internal package / 内部包名: `@anthropic/antigravity-taskd` | Production identity / 生产身份: **Liquid Swarm Orchestrator (LSO)**

---

## What Is This? / 这是什么？

The Liquid Swarm Orchestrator is the **beating heart** of Antigravity AI — a tri-state adaptive multi-agent kernel that transforms a single user goal into verified, production-quality code changes through a 6-stage pipeline orchestrating heterogeneous AI models.

液态蜂群调度内核是 Antigravity AI 的**心脏** — 一个三态自适应多智能体内核，通过编排异构 AI 模型的 6 阶段流水线，将单一用户目标转化为经验证的生产级代码变更。

It is **not** a simple prompt chain. It is a **cognitive engine** with:

它**不是**简单的提示链。它是一个**认知引擎**，具备：

- 🔀 **Tri-State Adaptive Dispatch / 三态自适应调度** — Frugal / Racing / MoA Fusion, selected by Token-Nomics heuristics / 由算力经济学启发式选择
- 🧠 **Per-Intent ELO Routing / 每意图 ELO 路由** — models earn their ranking through racing telemetry, not static config / 模型通过赛马遥测赢得排名，非静态配置
- 🕸️ **P2P Micro-MCP Mesh / P2P 微型 MCP 网格** — decentralized agent-to-agent draft sharing over Unix sockets / 通过 Unix socket 实现去中心化智能体间草稿共享
- 🛡️ **Neuro-Symbolic Reflexion / 神经符号反思闭环** — Red-Team adversarial review + ArkTS LSP formal verification / 红队对抗审查 + ArkTS LSP 形式化验证
- 🔒 **Air-Gapped Sandbox / 物理隔离沙箱** — 100% local Ollama fallback, 9-pattern secrets scrubbing, 2M token circuit breaker / 100% 本地 Ollama 降级、9 种正则脱敏、200 万 Token 熔断器

## Architecture at a Glance / 架构一览

```
runtime.ts          ← 6-Stage Pipeline / 6 阶段流水线 (SCOUT → SHARD → AGGREGATE → VERIFY → WRITE → FINALIZE)
│
├── cognitive/
│   ├── router.ts    ← Per-Intent ELO + 6D Scoring + Cost-Efficiency / 每意图 ELO + 6D 评分 + 性价比路由
│   ├── racing.ts    ← Speculative Racing (race) + MoA Fusion (fuse) + Telemetry / 推测竞速 + 融合 + 遥测
│   ├── swarm-mesh.ts ← P2P Worker Discovery + Micro-MCP Lifecycle / P2P 发现 + 微型 MCP 生命周期
│   ├── red-team.ts   ← Heterogeneous Adversarial Critic / 异源对抗审查器
│   ├── memory.ts     ← Semantic Memory Store (Token-Based Eviction) / 语义记忆 (Token 淘汰)
│   ├── reflexion.ts  ← VFS + LSP + Bounded Retry / VFS + LSP + 有界重试
│   └── blackboard.ts ← MCP Semantic Blackboard (5MB Per-File) / MCP 语义黑板 (5MB 上限)
│
├── journal.ts       ← Stage-Level Checkpoint (JSONL + SHA-256) / 阶段断点 (JSONL + SHA-256)
├── merkle.ts        ← Deterministic Shard Integrity Proofs / 确定性分片完整性证明
├── governance.ts    ← Provenance Tracking + Audit Trail / 溯源追踪 + 审计日志
├── crypto-identity.ts ← Ed25519 Cryptographic Signing / Ed25519 加密签名
├── workers.ts       ← Codex App-Server / Gemini Stream-JSON Adapters / 工作进程适配器
├── schema.ts        ← Zod-Validated Domain Types (30+ schemas) / Zod 领域类型
└── server.ts        ← Unix Socket HTTP Server + SSE Backpressure / Unix Socket HTTP + SSE 反压
```

## Key Design Decision: Why Per-Intent ELO? / 关键设计决策：为什么要每意图 ELO？

Traditional routing assigns one global score per model. This fails catastrophically when a model excels at code generation but struggles at analysis — winning `generate` races inflates its `analyze` score, causing incorrect routing.

传统路由给每个模型一个全局分数。当一个模型擅长代码生成但在分析上挣扎时，这会灾难性地失败 — 在 `generate` 赛马中获胜会膨胀其 `analyze` 评分，导致错误路由。

Our solution: **each model maintains 4 independent multipliers** — one per intent (`scout`, `analyze`, `generate`, `verify`). Racing telemetry only updates the relevant intent's multiplier:

我们的方案：**每个模型维护 4 个独立乘数** — 每种意图一个。赛马遥测仅更新相关意图的乘数：

```
Codex:  { scout: 1.2, analyze: 0.7, generate: 1.8, verify: 1.0 }
Gemini: { scout: 1.0, analyze: 1.5, generate: 0.9, verify: 1.3 }
```

## Development / 开发

```bash
npm run build       # Build / 构建
npm run typecheck   # TypeScript validation / 类型检查
npm test            # Run tests / 运行测试
npm start           # Start standalone process / 启动独立进程
```

## Deep Dive / 深入了解

See the root / 查看根目录 [ARCHITECTURE.md](../../ARCHITECTURE.md) for full whitepaper with Mermaid diagrams, Token-Nomics decision tree, and P2P mesh sequence diagrams. / 完整白皮书含 Mermaid 图、Token-Nomics 决策树和 P2P 网格序列图。

---

*Part of / 隶属于 [Antigravity AI](../../README.md) — The Next-Gen Liquid Agentic IDE / 新一代液态智能体 IDE.*
