<![CDATA[<div align="center">

# ⚡ Antigravity Workflow

**A next-generation multi-agent code intelligence platform, built for the ArkTS/HarmonyOS ecosystem.**

Powered by **MCP (Model Context Protocol)** · Orchestrated by **Codex + Gemini CLI** · Validated by **ArkTS LSP**

[![Version](https://img.shields.io/badge/version-0.3.0-blue?style=flat-square)](./package.json)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue?style=flat-square&logo=visual-studio-code)](https://marketplace.visualstudio.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

</div>

---

## 🚀 Overview

Antigravity Workflow is a **production-grade multi-agent task kernel** embedded inside a VS Code extension. It solves the **ArkTS-scale code-intelligence problem**: large `.ets` codebases that no single model call can reason about in one shot.

The system dispatches a long-running AI job — **SCOUT → SHARD → AGGREGATE → VERIFY → WRITE** — across parallel Codex and Gemini CLI worker processes, validates generated code against a live ArkTS Language Server, and atomically commits results to disk only after passing LSP diagnostics.

### ✨ Hardened Technical Features

| # | Feature | Implementation |
|---|---------|----------------|
| 1 | **Map-Reduce Task Kernel** | `antigravity-taskd` splits any codebase into shards processed by worker pools, then reduces partial results into a single aggregate — with **durable checkpoint resumption** via JSONL EventStore + SQLite |
| 2 | **LSP-Driven Reflexion Loop** | After code generation, generated files are written into an **in-memory VFS**; the ArkTS LSP (`arkts-lsp-provider`) runs `textDocument/didOpen→diagnostics→didClose` in a serialised mutex — up to 2 retry cycles before rollback |
| 3 | **Speculative Racing Execution** | `DefaultRacingExecutor` launches Codex and Gemini concurrently; the first valid result cancels the other via `AbortSignal` + `onAborted()` lifecycle hook — guaranteed resource cleanup, no EventLoop ghost timers |
| 4 | **15-Tool MCP Surface** | `antigravity-mcp-server` exposes a typed, domain-gated MCP tool catalog (`model` domain: `ai_ask / ai_codex_task / ai_gemini_task / ai_parallel_tasks / ai_consensus …`; `task` domain: `task.run / task.getState / task.advance / task.cancel / task.list`) — fully callable by any MCP-compatible AI host |

---

## 🏗️ Package Architecture

```
antigravity-workflow/                    ← VS Code Extension root (dist/extension.js)
│
├── packages/
│   │
│   ├── antigravity-taskd/               ← 🧠 CORE: Long-running task kernel
│   │   src/
│   │   ├── runtime.ts                   #  5-stage Map-Reduce pipeline (SCOUT/SHARD/AGGREGATE/VERIFY/WRITE)
│   │   ├── workers.ts                   #  Codex App Server + Gemini Stream-JSON worker adapters
│   │   ├── journal.ts                   #  Durable checkpoint store (stage-typed payload, VERIFY+vfsPendingPaths)
│   │   ├── merkle.ts                    #  Deterministic SHA-256 Merkle tree integrity proof for shards
│   │   ├── server.ts                    #  Unix-socket + HTTP server that receives job commands from mcp-server
│   │   └── cognitive/
│   │       ├── blackboard.ts            #  MCP-based lazy-pull semantic context board (5MB per-file guard)
│   │       ├── router.ts                #  CQRS-safe intent router: read-only vs read-write tool manifest
│   │       ├── racing.ts                #  Speculative parallel execution with onAborted() cleanup hooks
│   │       ├── reflexion.ts             #  In-memory VFS + LSP-driven correction state machine (MAX_STEPS=2)
│   │       └── arkts-lsp-provider.ts   #  Custom JSON-RPC 2.0 LSP client + LspSessionMutex (no external deps)
│   │
│   ├── antigravity-mcp-server/          ← 🔌 MCP Protocol Gateway
│   │   #  Registers 15 MCP tools across 'model' and 'task' domains; exposes stdio/http transport;
│   │   #  bridges AI host ↔ taskd HTTP API via task-bridge.ts
│   │
│   ├── antigravity-vscode/              ← 🖥️ VS Code Integration Layer
│   │   #  Registers all extension commands, manages ArkTS LSP lifecycle (arkts-lsp-controller),
│   │   #  renders the Dashboard WebView panel, and orchestrates the workflow control plane
│   │
│   ├── antigravity-webview/             ← 🎨 Dashboard React UI
│   │   #  React + Vite webview rendering Overview / Model Management / Job History / Routing / Scheduler tabs
│   │
│   ├── antigravity-core/                ← ⚙️ DAG Engine & Governance
│   │   #  Implements the DAG state machine, risk routing, compliance engine, and application service layer
│   │
│   ├── antigravity-persistence/         ← 💾 Persistence Layer
│   │   #  JSONL EventStore for event-sourced job history + SQLite CheckpointStore (better-sqlite3) + in-memory adapter
│   │
│   ├── antigravity-shared/              ← 📐 Shared Schema & Types
│   │   #  Zod-validated shared schemas: job states, event types, error codes, DAG node definitions
│   │
│   ├── antigravity-model-shared/        ← 🏷️ Model Registry Contracts
│   │   #  Model catalog types, task-type enum, routing configuration schema — zero runtime dependencies
│   │
│   ├── antigravity-model-core/          ← 🤖 Multi-Model Routing Runtime
│   │   #  Smart routing, parallel multi-model queries, voting/consensus engine, CLI agent invocation
│   │
│   └── ace-bridge/                      ← 🛠️ DevEco Studio Bridge
│       #  Parses DevEco project metadata (JSON5) and launches the ace-server LSP process
```

---

## 🔄 Data Flow

```
┌────────────────────────────────────────────────────────────────┐
│                         Developer                              │
│  VS Code: Cmd+Shift+P → "Antigravity: 启动任务"                │
└───────────────────────┬────────────────────────────────────────┘
                        │ activates
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  antigravity-vscode  (extension host)                         │
│  • Registers commands & ArkTS LSP (ace-bridge → ace-server)   │
│  • Manages Dashboard WebView panel                            │
│  • Delegates task commands to → workflow-orchestrator.ts      │
└───────────────────────┬───────────────────────────────────────┘
                        │ MCP stdio/http call
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  antigravity-mcp-server  (MCP Protocol Gateway)               │
│  • Authenticates domain (model | task)                        │
│  • Routes task.run → task-bridge.ts → taskd HTTP API          │
│  • Routes ai_* tools → antigravity-model-core (multi-model)   │
└───────────────────────┬───────────────────────────────────────┘
                        │ HTTP/Unix socket
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  antigravity-taskd  (Task Kernel — the heavy lifter)          │
│                                                               │
│  SCOUT  ─────── Codex/Gemini identifies relevant file shards  │
│    │                                                          │
│  SHARD  ─────── N parallel worker processes (racing enabled)  │
│    │            ShardAnalysis per file group                  │
│  AGGREGATE ──── Merkle-verified reduction of shard results    │
│    │                                                          │
│  VERIFY ─────── Code written to in-memory VFS                 │
│    │            ↕ JSON-RPC  LspSessionMutex                   │
│    │         ArkTS LSP (arkts-lsp-provider)                   │
│    │            Reflexion: up to 2 fix cycles                 │
│    │                                                          │
│  WRITE  ─────── Atomic fsync+rename commit to physical disk   │
│                                                               │
│  Journal: JSONL checkpoints at every stage boundary          │
│  (crash-resume from any stage, VFS desync detection)         │
└───────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Development Guide

### Prerequisites

| Tool | Version |
|------|---------|
| **Node.js** | ≥ 20 |
| **npm** _(workspaces)_ | ≥ 10 |
| **VS Code** | ≥ 1.85.0 |
| **Codex CLI** | latest (`codex app-server` mode) |
| **Gemini CLI** | latest (`gemini --output-format stream-json`) |
| **DevEco Studio** | ≥ 4.x _(optional, for ArkTS LSP)_ |

### Install Dependencies

```bash
npm install
```

### Build

```bash
# Full production build (all packages + webview + extension bundle)
npm run build

# Build only the task kernel
npm run build:antigravity-taskd

# Build only the MCP server
npm run build:antigravity-mcp

# Incremental watch mode (extension entry only)
npm run watch
```

### Type-check

```bash
# Full monorepo type-check (runs clean check first)
npm run typecheck:all

# Per-package
npm run typecheck:antigravity-taskd
npm run typecheck:antigravity-mcp
npm run typecheck:antigravity-vscode
```

### Test

```bash
# All tests
npm test

# Contract tests only (fast, for CI gates)
npm run check:contracts

# MCP server smoke test (builds then exercises live MCP tools)
npm run smoke:mcp

# Coverage report
npm run coverage
```

### Debug in VS Code

1. Press **F5** — launches the Extension Development Host.
2. Open an ArkTS project (`.ets` files).
3. Run **`Cmd+Shift+P` → `Antigravity: 打开控制面板`** to open the Dashboard.
4. Set `arkts.deveco.path` in Settings if DevEco Studio is not auto-detected.

### Package & Install as VSIX

```bash
# Build + package into .vsix
npm run package

# Build, package, install into VS Code, and sync dist files
npm run install-ext
```

### CI Pipeline

```bash
# Full CI: typecheck → test → build
npm run ci
```

### Configuration (`settings.json`)

```jsonc
{
  // Custom DevEco Studio installation path (auto-detect if blank)
  "arkts.deveco.path": "/Applications/DevEco-Studio.app",

  // LSP communication log level
  "arkts.trace.server": "off",       // "off" | "messages" | "verbose"

  // Default fallback model for non-specialised routing
  "antigravity.defaultModel": "deepseek",

  // Auto-purge job history older than N days
  "antigravity.retentionDays": 30
}
```

### Environment Variables (taskd)

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTIGRAVITY_WORKSPACE_ROOT` | _(required)_ | Absolute path to the workspace being analysed |
| `ANTIGRAVITY_DATA_DIR` | `<root>/.antigravity/data` | Journal & checkpoint storage directory |
| `ANTIGRAVITY_SOCKET_PATH` | `<root>/.antigravity/taskd.sock` | Unix domain socket for MCP → taskd IPC |
| `ANTIGRAVITY_TOOL_DOMAINS` | `model,task` | Comma-separated MCP tool domains to expose |

---

## 🏛️ Architectural Guarantees

| Concern | Mechanism |
|---------|-----------|
| **Crash recovery** | 5-stage JSONL journal; resumes from last completed stage; VFS desync detection via `vfsPendingPaths` |
| **Memory safety** | VFS is pure in-memory; commits use `fsync + rename`; 5MB per-file blackboard guard |
| **Concurrency** | `LspSessionMutex` (FIFO Promise queue) serialises LSP access across concurrent shards |
| **OS pipe deadlock** | Raw `child.stderr.on('data', () => {})` drain under readline prevents 64KB pipe saturation |
| **Unicode safety** | `unicodeSafeSlice()` uses `Intl.Segmenter` / `Array.from()` — never cuts surrogate pairs |
| **Deterministic hashing** | `deterministicStringify()` key-sorts all objects before SHA-256 — consistent Merkle roots across Node.js versions |
| **CRLF portability** | `normalizeCRLF()` sniffs disk line-endings and normalises LLM output to match — LSP offsets stay accurate on Windows |

---

## 📄 License

[MIT](./LICENSE) © [like3213934360-lab](https://github.com/like3213934360-lab)
]]>
