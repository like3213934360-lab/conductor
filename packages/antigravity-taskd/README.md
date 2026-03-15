# 🧠 Liquid Swarm Orchestrator

> **The cognitive kernel powering Antigravity AI.**
> Internal package: `@anthropic/antigravity-taskd` | Production identity: **Liquid Swarm Orchestrator (LSO)**

---

## What Is This?

The Liquid Swarm Orchestrator is the **beating heart** of Antigravity AI — a tri-state adaptive multi-agent kernel that transforms a single user goal into verified, production-quality code changes through a 6-stage pipeline orchestrating heterogeneous AI models.

It is **not** a simple prompt chain. It is a **cognitive engine** with:

- 🔀 **Tri-State Adaptive Dispatch** — Frugal / Racing / MoA Fusion, selected by Token-Nomics heuristics
- 🧠 **Per-Intent ELO Routing** — models earn their ranking through racing telemetry, not static config
- 🕸️ **P2P Micro-MCP Mesh** — decentralized agent-to-agent draft sharing over Unix sockets
- 🛡️ **Neuro-Symbolic Reflexion** — Red-Team adversarial review + ArkTS LSP formal verification
- 🔒 **Air-Gapped Sandbox** — 100% local Ollama fallback, 9-pattern secrets scrubbing, 2M token circuit breaker

## Architecture at a Glance

```
runtime.ts          ← 6-Stage Pipeline Engine (SCOUT → SHARD → AGGREGATE → VERIFY → WRITE → FINALIZE)
│
├── cognitive/
│   ├── router.ts    ← Per-Intent ELO + 6D Scoring + Cost-Efficiency Routing
│   ├── racing.ts    ← Speculative Racing (race) + MoA Fusion (fuse) + Telemetry
│   ├── swarm-mesh.ts ← P2P Worker Discovery + Micro-MCP Lifecycle
│   ├── red-team.ts   ← Heterogeneous Adversarial Critic
│   ├── memory.ts     ← Semantic Memory Store (Token-Based Eviction)
│   ├── reflexion.ts  ← VFS + LSP + Bounded Retry
│   └── blackboard.ts ← MCP Semantic Blackboard (5MB Per-File)
│
├── journal.ts       ← Stage-Level Checkpoint (JSONL + SHA-256)
├── merkle.ts        ← Deterministic Shard Integrity Proofs
├── governance.ts    ← Provenance Tracking + Audit Trail
├── crypto-identity.ts ← Ed25519 Cryptographic Signing
├── workers.ts       ← Codex App-Server / Gemini Stream-JSON Adapters
├── schema.ts        ← Zod-Validated Domain Types (30+ schemas)
└── server.ts        ← Unix Socket HTTP Server + SSE Backpressure
```

## Key Design Decision: Why Per-Intent ELO?

Traditional routing assigns one global score per model. This fails catastrophically when a model excels at code generation but struggles at analysis — winning `generate` races inflates its `analyze` score, causing incorrect routing.

Our solution: **each model maintains 4 independent multipliers** — one per intent (`scout`, `analyze`, `generate`, `verify`). Racing telemetry only updates the relevant intent's multiplier:

```
Codex:  { scout: 1.2, analyze: 0.7, generate: 1.8, verify: 1.0 }
Gemini: { scout: 1.0, analyze: 1.5, generate: 0.9, verify: 1.3 }
```

## Development

```bash
npm run build       # Build
npm run typecheck   # TypeScript validation  
npm test            # Run tests
npm start           # Start standalone process
```

## Deep Dive

See the root [ARCHITECTURE.md](../../ARCHITECTURE.md) for full whitepaper with Mermaid diagrams, Token-Nomics decision tree, and P2P mesh sequence diagrams.

---

*Part of [Antigravity AI](../../README.md) — The Next-Gen Liquid Agentic IDE.*
