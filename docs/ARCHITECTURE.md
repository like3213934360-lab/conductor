# 🏗️ Architecture — Conductor AGC

## 系统分层

```mermaid
graph TB
    subgraph Protocol["Protocol Layer"]
        MCP["MCP Server\n(agc.run / get_state / verify)"]
        A2A["A2A Federation\n(P2P Swarm)"]
    end

    subgraph App["Application Layer"]
        AGC["AGCService\n(Orchestrator)"]
    end

    subgraph Core["Core Engine Layer"]
        DAG["DAG Engine\n(Cyclic + Topo)"]
        RISK["Risk Router\n(DR Score → 4 Lanes)"]
        GOV["Governance Gateway\n(GaaS 4 Intercepts)"]
        PLUGIN["Plugin Manager\n(Hook Bus)"]
        FED["Federation Bus\n(Agent Registry)"]
    end

    subgraph Intelligence["Intelligence Layer"]
        REF["Reflexion\n(Actor Loop)"]
        OPT["Prompt Optimizer\n(ELO + Mutation)"]
        BENCH["Benchmark Runner\n(DAG + Gov Suites)"]
        OTEL["OTel Tracer\n(GenAI Semantic)"]
    end

    subgraph Infra["Infrastructure Layer"]
        ES["Event Store\n(Append-Only)"]
        CP["Checkpoint Store\n(Snapshots)"]
        VEC["Vector Memory\n(Semantic Recall)"]
        SAND["Sandbox Manager\n(E2B / Process)"]
    end

    subgraph Shared["Shared Kernel"]
        TYPES["Zod Schema\n(Branded Types)"]
        PROJ["Event Projector\n(Pure Function)"]
    end

    Protocol --> App
    App --> Core
    Core --> Intelligence
    Core --> Infra
    Intelligence --> Infra
    Infra --> Shared
```

## 17 个模块

| # | 模块 | 路径 | 职责 |
|---|------|------|------|
| 1 | **DAG Engine** | `dag/dag-engine.ts` | Kahn 拓扑排序，节点生命周期管理 |
| 2 | **Cyclic DAG** | `dag/cyclic-dag-engine.ts` | 条件回边 + Tarjan SCC 检测 |
| 3 | **Risk Router** | `risk/dr-calculator.ts` + `risk-router.ts` | DR 分歧率 → 4 级路由 |
| 4 | **Governance Gateway** | `governance/governance-gateway.ts` | GaaS PDP/PEP，4 个拦截点 |
| 5 | **Trust Factor** | `governance/trust-factor.ts` | 信任评分 (风险×合规×模型可靠性×证据) |
| 6 | **Workflow Runtime** | `governance/workflow-runtime.ts` | Lease-Based 执行合同 |
| 7 | **Token Budget** | `governance/token-budget-enforcer.ts` | 双层 Token 预算 (全局+节点) |
| 8 | **Plugin Manager** | `plugin/plugin-manager.ts` | VSCode-style 插件生命周期 |
| 9 | **Hook Bus** | `plugin/hook-bus.ts` | 4 模式 Hook (waterfall/parallel/bail/series) |
| 10 | **Capability Sandbox** | `plugin/capability-sandbox.ts` | Deno-style 权限隔离 |
| 11 | **Isolated Sandbox** | `plugin/isolated-sandbox.ts` | E2B 硬件微 VM 隔离 |
| 12 | **Reflexion Actor** | `reflexion/actor-loop.ts` | 反思闭环 (Trial→Error→Reflect→Retry) |
| 13 | **Federation** | `federation/` | A2A Agent Card + Swarm Router + Message Bus |
| 14 | **Benchmark** | `benchmark/benchmark-runner.ts` | DAG 正确性 + 治理覆盖率评估 |
| 15 | **Prompt Optimizer** | `optimization/prompt-optimizer.ts` | ELO 评分 + 突变策略 |
| 16 | **OTel Tracer** | `observability/dag-tracer.ts` | OpenTelemetry GenAI Semantic Convention |
| 17 | **Collusion Detector** | `collusion/embedding-detector.ts` | 向量余弦相似度串通检测 |

## Event Sourcing 数据流

```mermaid
sequenceDiagram
    participant Client
    participant AGCService
    participant EventStore
    participant Projector

    Client->>AGCService: startRun(request)
    AGCService->>AGCService: DAG validate + DR calculate
    AGCService->>AGCService: Gateway preflight
    AGCService->>EventStore: append([RUN_CREATED, CONTEXT_CAPTURED, RISK_ASSESSED, ...])
    AGCService->>Projector: projectState(events)
    Projector-->>AGCService: AGCState

    loop For each node
        Client->>AGCService: advanceNode(callback)
        AGCService->>AGCService: Gateway authorize
        AGCService->>AGCService: callback(lease)
        AGCService->>AGCService: Gateway observe
        AGCService->>EventStore: append([NODE_COMPLETED, NODE_QUEUED...])
    end

    Client->>AGCService: completeRun(candidates)
    AGCService->>AGCService: Gateway release (Trust-Weighted)
    AGCService->>EventStore: append([RUN_COMPLETED])
```

## 治理网关 4 拦截点

```
请求进入 → preflight (input 控制)
                ↓
         authorize (execution + routing 控制)
                ↓
         [执行节点逻辑]
                ↓
         observe (assurance 控制 + 信任更新)
                ↓
         release (output 控制 + Trust-Weighted 释放)
```

每个拦截点独立评估 GovernanceControl，支持 5 种决策：
- **allow** → 放行
- **warn** → 放行但警告
- **degrade** → 降级执行
- **block** → 阻断
- **escalate** → 上报人工

## Federation P2P 消息模型

```mermaid
graph LR
    A[Agent A] -->|task.delegate| B[Agent B]
    B -->|task.result| A
    A -->|handoff.request| C[Agent C]
    C -->|handoff.accept| A
    A -.->|heartbeat| B
    A -.->|heartbeat| C
    A -.->|discovery.query| ALL[Broadcast *]
```

10 种消息类型：`task.delegate` / `task.result` / `task.cancel` / `heartbeat` / `heartbeat.ack` / `handoff.request` / `handoff.accept` / `handoff.reject` / `discovery.query` / `discovery.response`

## 技术栈

| 层 | 技术 |
|---|------|
| Language | TypeScript 5.3+ (strict + NodeNext) |
| Schema | Zod 3.24+ |
| Protocol | MCP SDK 1.12+ |
| Testing | Vitest |
| Build | npm Workspaces + tsc + Webpack |
| UI | React + Liquid Glass Design System |
| Observability | OpenTelemetry |
