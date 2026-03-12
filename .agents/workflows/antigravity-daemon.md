---
description: Antigravity daemon-owned workflow runtime
---

# Antigravity Workflow Runtime

> Authority owner: `conductor-daemon`
> Projection: `data/conductor_daemon/run-projection.json`
> Execution rule: host model may produce content, but may not reorder, skip, or terminate the workflow

## Runtime contract

1. Every run starts through the daemon `StartRun` path.
2. The compiled workflow definition is the only legal execution graph.
3. Every node must finish in one of:
   `completed`, `failed`, `policy_skipped`, `paused_for_human`, `cancelled`.
4. Every completion must emit an `ExecutionReceipt`.
5. Every skip must emit a `SkipDecision` and a skip receipt.
6. Release requires evidence gate + policy pack approval.

## Projection contract

The projection file is not the source of truth. It is only a daemon-owned mirror for external inspection.

```json
{
  "runId": "workflow-run-YYYYMMDD-HHMMSS",
  "status": "running",
  "phase": "VERIFY",
  "workflow": "antigravity.strict-full@1.0.0",
  "version": 8,
  "updatedAt": "2026-03-11T12:00:00.000Z",
  "timelineCursor": 42,
  "authorityOwner": "conductor-daemon",
  "authorityHost": "antigravity",
  "traceBundlePath": "data/conductor_daemon/traces/workflow-run-...json",
  "nodes": {
    "ANALYZE": { "status": "completed" },
    "PARALLEL": { "status": "completed" },
    "DEBATE": { "status": "skipped" },
    "VERIFY": { "status": "running" },
    "SYNTHESIZE": { "status": "pending" },
    "PERSIST": { "status": "pending" },
    "HITL": { "status": "pending" }
  }
}
```

## Workflow templates

### `antigravity.strict-full`

`ANALYZE → PARALLEL → DEBATE → VERIFY → SYNTHESIZE → PERSIST → HITL`

- Debate is mandatory.
- Full-path evidence collection is required.

### `antigravity.adaptive`

`ANALYZE → PARALLEL → (DEBATE | policy_skipped) → VERIFY → SYNTHESIZE → PERSIST → HITL`

- `DEBATE` may be skipped only by daemon policy.
- Skip requires explicit strategy id, trigger condition, evidence, approver, and trace id.

## Node semantics

| Node | Responsibility |
|:---|:---|
| `ANALYZE` | Task parsing, risk framing, initial routing signals |
| `PARALLEL` | Parallel worker execution and evidence collection |
| `DEBATE` | Deliberation when uncertainty or disagreement is high |
| `VERIFY` | Critic/verifier pass and evidence validation |
| `SYNTHESIZE` | Final synthesis and answer packaging |
| `PERSIST` | Artifact, trace, receipt, and memory persistence |
| `HITL` | Human approval or escalation gate |

## Failure handling

- Worker failure: fall back to local worker or continue under policy.
- Remote lifecycle timeout: daemon decides retry, poll, or fallback.
- Missing evidence: block release and enter `paused_for_human`.
- Cancellation: daemon writes a terminal state and stops progression.
- Restart recovery: daemon resumes from ledger and replay state, not from projection.
