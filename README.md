<div align="center">

# ⚡ Antigravity AI

### **The Next-Gen Liquid Agentic IDE**

*Powered by the **Liquid Swarm Orchestrator** — a cognitive kernel that thinks, races, fuses, and evolves.*

[![Version](https://img.shields.io/badge/version-0.3.0-00D4FF?style=for-the-badge)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-00FF88?style=for-the-badge)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![VS Code](https://img.shields.io/badge/VS%20Code-≥1.85-007ACC?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/)

</div>

---

> **"In 2026, an AI assistant that runs a single model on a single prompt is a toy. A system that orchestrates a swarm of heterogeneous agents — making them race, collaborate, cross-validate, and self-evolve — is the future."**

Antigravity AI is not another VS Code copilot. It is a **full-spectrum agentic operating system** that transforms your IDE into a living neural network of cooperating AI agents. At its core lies the **Liquid Swarm Orchestrator** — a cognitive kernel forged through 37 rounds of extreme architectural refinement — implementing capabilities that define the 2026 state of the art in multi-agent AI systems.

---

## 🧬 The Five Pillars of the Liquid Swarm

<table>
<tr>
<td width="20%" align="center">

### 🔀 Tri-State Adaptive Swarm
Token-Nomics driven shape-shifting

</td>
<td width="20%" align="center">

### 🕸️ P2P Micro-MCP Mesh
Decentralized agent consciousness

</td>
<td width="20%" align="center">

### 🛡️ Neuro-Symbolic Reflexion
Zero-trust dual verification

</td>
<td width="20%" align="center">

### 🧠 Intent-Aware ELO Routing
Darwinian self-evolution

</td>
<td width="20%" align="center">

### 🔒 Air-Gapped Sandbox
Military-grade isolation

</td>
</tr>
</table>

---

### 🔀 Pillar 1 — Tri-State Adaptive Swarm

The orchestrator doesn't pick a strategy — it **morphs** between three execution topologies in real-time based on Token-Nomics (computational economics):

```
                    ┌──────────────────────────────────────────┐
                    │         TOKEN-NOMICS EVALUATOR           │
                    │  estimatedTokens ─┐                      │
                    │  burnRate ─────────┤──→ EXECUTION SHAPE  │
                    │  enableMoA ───────┘                      │
                    └──────────────┬───────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
    ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │  🚗 FRUGAL MODE │  │  🏎️ RACING MODE  │  │  🧬 MoA FUSION   │
    │                 │  │                  │  │                  │
    │  Single-model   │  │  Speculative     │  │  Mixture of      │
    │  execution      │  │  multi-model     │  │  Agents output   │
    │  (cost ↓↓↓)     │  │  first-wins      │  │  synthesis       │
    │                 │  │  (latency ↓↓)    │  │  (quality ↑↑↑)   │
    └─────────────────┘  └──────────────────┘  └──────────────────┘
```

- **Frugal Mode**: Low complexity tasks → single best model, zero waste.
- **Speculative Racing**: Dual-model `race()` with `Promise.any` semantics — the first valid result wins, losers are `abort()`ed mid-stream.
- **MoA Fusion**: High-complexity tasks trigger `fuse()` with `Promise.allSettled` — all drafts are collected, then a **Synthesizer model** cross-validates and merges them into a superior output. Includes 3-tier graceful degradation.

### 🕸️ Pillar 2 — P2P Micro-MCP Mesh

Traditional multi-agent systems use a **centralized blackboard** — a single point of failure and a bottleneck. Antigravity AI breaks this paradigm with a **decentralized peer-to-peer mesh** built on Unix Domain Sockets:

- Each Worker process spawns a **Micro-MCP Server** supporting `read_draft` / `peek_symbols` / `write_feedback` tools.
- Concurrent Workers discover peers via the `SwarmMesh` registry and perform **Subconscious Draft Sharing** — one agent can peek at another's in-progress analysis before either has committed.
- The mesh is **ephemeral** — it exists only during a job's lifetime and leaves zero footprint after completion.

### 🛡️ Pillar 3 — Neuro-Symbolic Reflexion

LLMs are confidently wrong. Antigravity AI never trusts a single model's output:

1. **Semantic Red-Teaming**: A heterogeneous adversarial model (`RedTeamCritic`) reviews code changes, hunting for logical flaws, security vulnerabilities, and hallucinated APIs.
2. **Formal Verification**: Generated code is written to an in-memory VFS with `optimistic-lock` semantics, then validated against the local **ArkTS LSP compiler** for syntax and type correctness.
3. **Reflexion Loop**: If either check fails, the system enters a bounded retry loop (max 2 rounds) with previous diagnostics injected as context — achieving **100% logical + syntactic self-consistency**.

### 🧠 Pillar 4 — Intent-Aware ELO Routing

The router doesn't use static model rankings. It **evolves**:

- **6-Dimensional Scoring Matrix**: `code_quality × long_context × reasoning × speed × cost × chinese` — weighted by task intent (`scout / analyze / generate / verify`).
- **Per-Intent ELO**: Each model maintains an independent performance multiplier **per intent** — codex dominating at `generate` won't inflate its `verify` score.
- **Racing Telemetry → ELO Feedback**: Every race result feeds back into the router via `ingestTelemetry()` — winners get `+0.08`, losers `-0.03`, errors `-0.15`, clamped to `[0.3, 2.0]`.
- **Cost-Efficiency Factor**: Models with high `emaCostPerCall` are penalized proportionally, preventing expensive models from monopolizing the routing table.
- **Fusion Quality Auto-Disable**: If `emaFusionGain < -0.05` after 3+ fusions, the system automatically disables auto-fusion to stop wasting tokens.

### 🔒 Pillar 5 — Enterprise-Grade Air-Gapped Sandbox

Deployable in military-grade air-gapped networks:

- **100% Local Ollama Fallback**: When network is unreachable, the system seamlessly degrades to local Ollama models without any user intervention.
- **9-Pattern Secrets Scrubbing**: Regex-based real-time interception of AWS keys, database passwords, PII, and 6 other secret categories — scrubbed before any data leaves the process boundary.
- **Anti-OOM Memory Eviction**: The Semantic Memory Store enforces token-based eviction with configurable thresholds, preventing unbounded memory growth during long-running analysis.
- **2M Token Global Circuit Breaker**: A `burnRate` fuse monitors cumulative token consumption — when usage exceeds 50% of the 2M budget, the system forces frugal mode.

---

## 🏛️ System Architecture

```
antigravity-workflow/                    ← VS Code Extension Host
│
├── packages/
│   │
│   │  ── 🖥️ Interaction Layer ──────────────────────────────────
│   ├── antigravity-vscode/              ← VS Code integration (commands + Dashboard + Orchestrator)
│   ├── antigravity-webview/             ← React + Vite Dashboard (7 panels + Ecosystem Discovery)
│   │
│   │  ── 🤖 Model Intelligence Layer ──────────────────────────
│   ├── antigravity-model-shared/        ← Model catalog types + task keyword table (zero-runtime)
│   ├── antigravity-model-core/          ← Routing engine + Consensus voting + Circuit breaker
│   │
│   │  ── 🔌 Protocol Gateway Layer ────────────────────────────
│   ├── antigravity-mcp-server/          ← MCP Gateway (15 tools × 2 domains)
│   ├── ace-bridge/                      ← [Optional] DevEco Studio ArkTS LSP bridge
│   │
│   │  ── 🧠 Cognitive Kernel — The Liquid Swarm Orchestrator ──
│   ├── antigravity-taskd/               ← ⭐ THE CORE ENGINE
│   │   ├── runtime.ts                   # 6-stage pipeline (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE/FINALIZE)
│   │   ├── cognitive/
│   │   │   ├── router.ts                # Per-Intent ELO + 6D scoring + cost-efficiency routing
│   │   │   ├── racing.ts                # Speculative Racing (race) + MoA Fusion (fuse)
│   │   │   ├── swarm-mesh.ts            # P2P Micro-MCP Mesh (Unix socket peer discovery)
│   │   │   ├── red-team.ts              # Heterogeneous Red-Team adversarial critic
│   │   │   ├── memory.ts                # Semantic memory with token-based eviction
│   │   │   └── reflexion.ts             # VFS + LSP verification + bounded retry
│   │   ├── journal.ts                   # JSONL checkpoint (SHA-256 integrity)
│   │   ├── merkle.ts                    # Deterministic Merkle tree for shard verification
│   │   ├── governance.ts                # Provenance tracking + audit trail
│   │   └── crypto-identity.ts           # Ed25519 cryptographic identity
│   │
│   │  ── ⚙️ Runtime Foundation ─────────────────────────────────
│   ├── antigravity-core/                ← DAG engine + Compliance gateway
│   ├── antigravity-shared/              ← Shared schemas (Zod validated)
│   └── antigravity-persistence/         ← JSONL EventStore + SQLite CheckpointStore
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| **Node.js** | ≥ 20 |
| **VS Code** | ≥ 1.85.0 |
| **Codex CLI** | Latest (`codex app-server` mode) |
| **Gemini CLI** | Latest (`gemini --output-format stream-json`) |
| **DevEco Studio** | ≥ 4.x (optional, ArkTS LSP only) |

### Install & Build

```bash
npm install
npm run build        # Full production build
npm run typecheck:all  # Full monorepo type check
npm test             # All tests
npm run ci           # typecheck → test → build
```

### Launch

Press **F5** in VS Code → Extension Development Host → `Cmd+Shift+P` → `Antigravity: 打开控制面板`

### Package & Install

```bash
npm run install-ext  # Build → Package VSIX → Install → Sync dist files
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Deep-dive whitepaper — pipeline lifecycle, Mermaid diagrams, Token-Nomics decision tree |
| [docs/ANTIGRAVITY_CONTRACT.md](docs/ANTIGRAVITY_CONTRACT.md) | API contract specification |
| [docs/QUICK_START.md](docs/QUICK_START.md) | First-run guide |
| [docs/API_COOKBOOK.md](docs/API_COOKBOOK.md) | Integration recipes |

---

## ⚙️ Configuration

```jsonc
{
  "antigravity.defaultModel": "deepseek",  // Fallback routing model
  "antigravity.retentionDays": 30,         // Auto-cleanup threshold
  "arkts.deveco.path": "",                 // DevEco path (auto-detect if empty)
  "arkts.trace.server": "off"             // LSP trace level
}
```

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `ANTIGRAVITY_TASKD_WORKSPACE_ROOT` | **Required** | Target workspace absolute path |
| `ANTIGRAVITY_TASKD_DATA_DIR` | `<root>/data/` | Journal & checkpoint storage |
| `ANTIGRAVITY_TASKD_SOCKET_PATH` | `$TMPDIR/antigravity-taskd-*.sock` | Unix socket IPC path |
| `ANTIGRAVITY_TOOL_DOMAINS` | `model,task` | MCP tool domains to expose |

---

<div align="center">

**Built with obsession. Forged in 37 rounds of architectural refinement.**

*Antigravity AI — where agents don't just assist, they orchestrate.*

[MIT](./LICENSE) © [like3213934360-lab](https://github.com/like3213934360-lab)

</div>
