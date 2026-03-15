# Liquid Swarm Orchestrator — Architecture Whitepaper

> **Antigravity AI v0.3.0 | March 2026**
> Internal code name: `antigravity-taskd` | Production identity: **Liquid Swarm Orchestrator (LSO)**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Global Neural Topology](#1-global-neural-topology)
3. [Pipeline Lifecycle — SCOUT to WRITE](#2-pipeline-lifecycle)
4. [Token-Nomics Driven Dispatch Decision Tree](#3-token-nomics-dispatch-decision-tree)
5. [Agent-to-Agent (A2A) P2P Mesh Interaction](#4-a2a-p2p-mesh-interaction)
6. [Per-Intent ELO Routing Deep Dive](#5-per-intent-elo-routing)
7. [Security & Isolation](#6-security--isolation)
8. [Design Principles](#7-design-principles)

---

## Executive Summary

The Liquid Swarm Orchestrator (LSO) is the cognitive kernel powering Antigravity AI. It implements a **6-stage pipeline** that transforms a high-level user goal into verified, atomically-committed code changes — orchestrating multiple AI models across heterogeneous backends (Codex CLI, Gemini CLI, Ollama) with zero human intervention.

What makes LSO unique in the 2026 multi-agent landscape:

| Capability | Implementation | SOTA Comparison |
|------------|---------------|-----------------|
| **Tri-State Adaptive Dispatch** | Runtime morphing between Frugal/Racing/Fusion | Together AI MoA (static 3-layer only) |
| **Per-Intent ELO** | `intentMultiplier[intent]` with EMA feedback | No known peer implementation |
| **Speculative Racing** | `Promise.any` with per-candidate `AbortController` | Google speculative decoding (LLM-internal only) |
| **P2P Agent Mesh** | Unix socket Micro-MCP servers per Worker | CrewAI (centralized blackboard only) |
| **Neuro-Symbolic Reflexion** | Red-Team critic + ArkTS LSP formal verification | Reflexion paper (no formal verification) |
| **Fusion Quality Auto-Disable** | `emaFusionGain` tracking + self-kill switch | No known implementation |

---

## 1. Global Neural Topology

The following diagram shows the macro-level architecture — from the VS Code host process through the Protocol Gateway, down to the Liquid Swarm Orchestrator's cognitive subsystems.

```mermaid
graph TB
    subgraph HOST["🖥️ VS Code Extension Host"]
        EXT["Extension Entry<br/>6 Commands"]
        DASH["React Dashboard<br/>7 Panels"]
        ORCH["WorkflowOrchestrator<br/>Lifecycle Manager"]
    end

    subgraph GATEWAY["🔌 Protocol Gateway"]
        MCP["MCP Server<br/>15 Tools × 2 Domains"]
        BRIDGE["ace-bridge<br/>DevEco LSP"]
    end

    subgraph LSO["🧠 Liquid Swarm Orchestrator"]
        direction TB
        
        subgraph ROUTING["Intent-Aware Darwinian Router"]
            ROUTER["DynamicRouterPolicy<br/>6D Scoring × Per-Intent ELO"]
            ELO["ELO Feedback Loop<br/>ingestTelemetry()"]
        end

        subgraph DISPATCH["Tri-State Adaptive Dispatch"]
            FRUGAL["🚗 Frugal<br/>Single Model"]
            RACING["🏎️ Racing<br/>Speculative Dual"]
            FUSION["🧬 MoA Fusion<br/>AllSettled + Synthesizer"]
        end

        subgraph EXECUTION["Worker Execution Layer"]
            W1["Codex Worker<br/>+ Micro-MCP Server"]
            W2["Gemini Worker<br/>+ Micro-MCP Server"]
            W3["Ollama Worker<br/>Air-Gap Fallback"]
        end

        subgraph VERIFICATION["Zero-Trust Verification"]
            VFS["In-Memory VFS<br/>Optimistic Lock"]
            RED["Red-Team Critic<br/>Adversarial Review"]
            LSP["ArkTS LSP<br/>Formal Verification"]
            REFL["Reflexion Loop<br/>≤ 2 Rounds"]
        end

        subgraph MEMORY["Cognitive Memory"]
            SEM["Semantic Memory<br/>Token-Based Eviction"]
            BB["MCP Blackboard<br/>5MB Per-File Cap"]
            JOURNAL["JSONL Journal<br/>SHA-256 Integrity"]
        end

        MESH["🕸️ SwarmMesh<br/>P2P Peer Registry"]
    end

    subgraph STORAGE["💾 Persistence"]
        DISK["Atomic fsync+rename<br/>Physical Disk"]
        SQLITE["SQLite<br/>History + Checkpoints"]
    end

    EXT --> ORCH
    DASH --> ORCH
    ORCH -->|"Unix Socket"| MCP
    MCP -->|"HTTP/Socket"| LSO
    BRIDGE -.->|"Optional"| LSP

    ROUTER --> DISPATCH
    ELO -->|"Telemetry"| ROUTER
    DISPATCH --> EXECUTION
    W1 <-->|"Draft Sharing"| MESH
    W2 <-->|"Draft Sharing"| MESH
    EXECUTION --> VERIFICATION
    RACING -->|"RaceTelemetry"| ELO
    FUSION -->|"FusionQuality"| ELO
    VFS --> RED
    RED --> LSP
    LSP --> REFL
    REFL -->|"Pass"| DISK
    VERIFICATION --> MEMORY

    classDef kernel fill:#1a1a2e,stroke:#00d4ff,stroke-width:2px,color:#fff
    classDef host fill:#16213e,stroke:#0f3460,stroke-width:1px,color:#fff
    classDef dispatch fill:#0f3460,stroke:#e94560,stroke-width:2px,color:#fff
    
    class LSO kernel
    class HOST host
    class DISPATCH dispatch
```

---

## 2. Pipeline Lifecycle

Every job traverses 6 stages. The pipeline is **interruptible** at any stage boundary — the JSONL journal enables crash recovery from the last completed stage.

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  SCOUT ──→ SHARD_ANALYZE ──→ AGGREGATE ──→ VERIFY ──→ WRITE ──→ ✅ │
│    │            │                │            │          │           │
│    │       ┌────┴────┐           │       ┌────┴────┐     │           │
│    │       │ Racing  │           │       │  VFS    │     │           │
│    │       │   OR    │           │       │ + LSP   │     │           │
│    │       │ Fusion  │           │       │ + Red   │     │           │
│    │       └─────────┘           │       │  Team   │     │           │
│    │                             │       └─────────┘     │           │
│  Journal                       Journal                 Journal      │
│  Checkpoint                    Checkpoint              Checkpoint   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Stage Details

| Stage | Input | Output | Key Mechanism |
|-------|-------|--------|--------------|
| **SCOUT** | User goal + workspace | `ScoutManifest` (file list + shard strategy) | Single-model routing via `route('scout')` |
| **SHARD_ANALYZE** | Manifest + source files | `ShardAnalysis[]` | **Tri-State Dispatch** (see §3) |
| **AGGREGATE** | All shard results | `AggregateResult` | Merkle root verification + result merging |
| **VERIFY** | Proposed code changes | Validated changes | VFS → Red-Team → LSP → Reflexion (≤2 rounds) |
| **WRITE** | Verified changes | Committed files | `fsync + rename` atomic disk write |
| **FINALIZE** | Job metadata | `COMPLETED` status | Governance audit trail emission |

---

## 3. Token-Nomics Dispatch Decision Tree

This is the brain of the Tri-State Adaptive Swarm — the decision logic that determines whether a SHARD stage uses Frugal, Racing, or MoA Fusion mode.

```mermaid
flowchart TD
    START["🎯 SHARD_ANALYZE Stage Entry"] --> ROUTE["routeMulti('analyze', tokenEstimate)<br/>Per-Intent ELO × Cost-Efficiency Scoring"]
    
    ROUTE --> CANDIDATES{"Candidates ≥ 2?"}
    CANDIDATES -->|"No"| FRUGAL["🚗 FRUGAL MODE<br/>Single model execution"]
    CANDIDATES -->|"Yes"| TOKENOMICS["📊 Token-Nomics Evaluation"]

    TOKENOMICS --> CALC["Calculate:<br/>estimatedTokens = ceil(totalBytes / 4)<br/>burnRate = totalUsed / 2M_LIMIT"]
    
    CALC --> FUSION_CHECK{"Fusion Conditions Met?"}
    
    FUSION_CHECK -->|"enableMoA = true"| FUSION_QUALITY
    FUSION_CHECK -->|"estimatedTokens > 5K<br/>AND burnRate < 0.5"| FUSION_QUALITY
    FUSION_CHECK -->|"Neither"| RACING["🏎️ RACING MODE<br/>race() → Promise.any winner"]

    FUSION_QUALITY{"📊 shouldAutoFuse?<br/>emaFusionGain > -0.05<br/>OR fusionCount < 3"} -->|"Yes"| MOA["🧬 MoA FUSION MODE<br/>fuse() → Promise.allSettled"]
    FUSION_QUALITY -->|"No — fusion historically unhelpful"| RACING

    MOA --> FUSE_RESULT{"canFuse?<br/>≥ 2 valid drafts"}
    FUSE_RESULT -->|"Yes"| SYNTH["🔮 Synthesizer Prompt<br/>Cross-validate + merge drafts<br/>via routeMulti('verify')"]
    FUSE_RESULT -->|"Only 1 draft"| DEGRADE1["⚠️ Graceful Degradation<br/>Use single draft as-is"]
    FUSE_RESULT -->|"0 drafts"| DEGRADE2["🛑 Full Degradation<br/>Route to single model"]

    SYNTH --> QUALITY_TRACK["📊 Track Fusion Quality<br/>delta = fusedConf - avg(draftConfs)<br/>→ ingestFusionQuality()"]

    RACING --> RACE_RESULT{"Winner found?"}
    RACE_RESULT -->|"Yes"| TELEMETRY["📡 Emit RaceTelemetry<br/>intent='analyze'<br/>→ ingestTelemetry()"]
    RACE_RESULT -->|"All failed"| FAIL["❌ Job Failed"]

    QUALITY_TRACK --> ELO_UPDATE["🧬 ELO Feedback<br/>intentMultiplier[analyze] ±=<br/>Winner: +0.08<br/>Loser: -0.03<br/>Error: -0.15"]
    TELEMETRY --> ELO_UPDATE
    ELO_UPDATE --> CLAMP["🛡️ Clamp [0.3, 2.0]<br/>→ Next route() call"]

    style START fill:#00d4ff,stroke:#000,color:#000
    style MOA fill:#e94560,stroke:#000,color:#fff
    style RACING fill:#f5a623,stroke:#000,color:#000
    style FRUGAL fill:#00ff88,stroke:#000,color:#000
    style ELO_UPDATE fill:#9b59b6,stroke:#000,color:#fff
```

### Scoring Formula

```
finalScore = staticScore × intentMultiplier[currentIntent] × costEfficiencyFactor

where:
  staticScore = Σ(dimensionScore × intentWeight)    // 6 dimensions × 4 intents
  intentMultiplier ∈ [0.3, 2.0]                     // Per-intent EMA evolution
  costEfficiencyFactor = max(0.7, 1.0 - 0.1 × (emaCostPerCall / 8K - 1))
```

---

## 4. A2A P2P Mesh Interaction

This sequence diagram shows how concurrent Worker processes use the **Micro-MCP Mesh** to perform cross-process draft sharing during a SHARD stage.

```mermaid
sequenceDiagram
    participant RT as Runtime (Orchestrator)
    participant SM as SwarmMesh Registry
    participant W1 as Codex Worker<br/>+ MicroMCP :50001
    participant W2 as Gemini Worker<br/>+ MicroMCP :50002
    participant FUSE as Synthesizer

    Note over RT: SHARD_ANALYZE starts (MoA Fusion Mode)

    RT->>SM: registerWorker("codex", socket:/tmp/mcp-codex.sock)
    RT->>SM: registerWorker("gemini", socket:/tmp/mcp-gemini.sock)
    
    par Concurrent Execution
        RT->>W1: execute(shardPrompt, files)
        RT->>W2: execute(shardPrompt, files)
    end

    Note over W1,W2: Both workers begin analysis independently

    W1->>SM: discoverPeers() → ["gemini"]
    W1->>W2: MCP call: peek_symbols("utils.ts")
    W2-->>W1: { exports: ["formatDate", "parseConfig"], types: 12 }
    
    Note over W1: Codex enriches its analysis<br/>with Gemini's symbol insights

    W2->>SM: discoverPeers() → ["codex"]
    W2->>W1: MCP call: read_draft("analysis")
    W1-->>W2: { draft: "partial analysis...", confidence: 0.7 }
    
    Note over W2: Gemini sees Codex's early draft<br/>and adjusts its own analysis

    W1-->>RT: ShardOutcome (codex) ✅
    W2-->>RT: ShardOutcome (gemini) ✅

    Note over RT: fuse() collected 2 valid drafts

    RT->>RT: buildFusionPrompt(draftA, draftB, goal)
    RT->>FUSE: Synthesizer model (strongest reasoner)
    FUSE-->>RT: Fused output (cross-validated)

    RT->>RT: ingestFusionQuality(fusedConf, [confA, confB])
    
    RT->>SM: deregisterAll()
    Note over SM: Mesh dissolves — zero footprint
```

### Key Design Constraints

- **Ephemeral Lifecycle**: The mesh exists only during a single job's SHARD stage. No persistent state leaks between jobs.
- **Non-Blocking Discovery**: `discoverPeers()` is lock-free and returns immediately. If no peers are registered yet, the worker proceeds solo.
- **Draft Versioning**: `read_draft` returns the latest available snapshot — workers can call it multiple times as their analysis evolves.
- **Unidirectional Influence**: Draft sharing is advisory only. A worker is never forced to incorporate peer insights.

---

## 5. Per-Intent ELO Routing

### The Problem with Global ELO

Traditional ELO systems assign **one score per model**. This creates a critical flaw:

> If Codex is fast at `generate` but slow at `analyze`, a global multiplier cannot capture both. Winning at `generate` inflates its `analyze` score, causing it to be incorrectly preferred for analysis tasks.

### Our Solution: Intent-Dimensional ELO

```typescript
interface ModelEloState {
  intentMultiplier: Record<TaskIntent, number>
  //  scout: 1.2    ← Codex is good at scouting
  //  analyze: 0.7  ← but slow at analysis (doesn't contaminate scout)
  //  generate: 1.8 ← and exceptional at code generation
  //  verify: 1.0   ← neutral at verification
  
  emaCostPerCall: number     // EMA smoothed token cost
  totalTokensConsumed: number // Cumulative tracking
}
```

### Feedback Loop

```
Race completes → RaceTelemetry { intent: 'analyze', candidates: [...] }
                        │
                        ▼
              ingestTelemetry(telemetry)
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
         Update only   Update    Update
         EMA latency   token     intentMultiplier
         (global)      cost      ['analyze'] ONLY
                        │
                        ▼
              Clamp to [0.3, 2.0]
```

---

## 6. Security & Isolation

| Layer | Mechanism | Guarantee |
|-------|-----------|-----------|
| **Process Isolation** | Each Worker runs in a separate Node.js child process | Worker crash cannot bring down the orchestrator |
| **VFS Sandbox** | All code changes go through in-memory VFS before disk | No partial writes, no corrupted files |
| **Secrets Scrubbing** | 9 regex patterns intercept secrets before LLM context | Zero data exfiltration to external APIs |
| **Memory Eviction** | Token-based eviction in SemanticMemoryStore | Prevents OOM during long-running analysis |
| **Token Circuit Breaker** | 2M global budget with `burnRate` monitoring | Prevents runaway costs |
| **Journal Integrity** | SHA-256 hash per checkpoint stage | Tamper-evident crash recovery |
| **Merkle Verification** | Deterministic shard hashing | Proves shard completeness |
| **Network Fallback** | Ollama auto-detection for air-gapped deployments | 100% offline capability |
| **Ed25519 Identity** | Cryptographic signing of governance events | Non-repudiable audit trail |

---

## 7. Design Principles

1. **Fail Narrow, Not Wide**: Every failure is contained to its scope — a Worker crash doesn't kill the job, a fusion failure degrades to racing, racing failure degrades to single-model.

2. **Measure Before You Trust**: No model output is accepted without measurement. ELO scores are earned, not configured. Fusion is earned through quality delta, not assumed.

3. **Evolve, Don't Configure**: The system should get better over time without manual tuning. Per-Intent ELO, fusion auto-disable, and cost-efficiency factors all operate autonomously.

4. **Zero Footprint**: The P2P mesh, VFS sandbox, and Worker processes all exist ephemerally. When a job completes, nothing persists except the intended output and the audit trail.

5. **Air-Gap Ready**: Every cloud dependency has a local fallback. The system must function at 100% capability in a physically isolated network.

---

<div align="center">

*This document describes the architecture of Antigravity AI v0.3.0 as of March 2026.*
*The Liquid Swarm Orchestrator — where agents don't just execute, they evolve.*

</div>
