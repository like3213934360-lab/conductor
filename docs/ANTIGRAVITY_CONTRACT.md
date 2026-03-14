# Antigravity Task Contract

Antigravity 当前使用单一长任务内核：`antigravity-taskd`。

## Extension Commands

| Command | Purpose |
|---|---|
| `antigravity.openPanel` | 打开 Antigravity Task Kernel 控制面板 |
| `antigravity.runTask` | 启动一个新的 `taskd` 长任务 |
| `antigravity.getTask` | 读取当前任务快照 |
| `antigravity.streamTask` | 实时查看任务事件流 |
| `antigravity.cancelTask` | 取消当前任务 |
| `antigravity.toggleArktsLsp` | 开关 ArkTS LSP |

## Taskd HTTP API

所有请求都走本地 IPC HTTP。

| Method | Path | Operation |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/jobs` | Create task job |
| `GET` | `/jobs` | List recent jobs |
| `GET` | `/jobs/:jobId` | Read latest job snapshot |
| `GET` | `/jobs/:jobId/stream` | Stream SSE events for the job |
| `POST` | `/jobs/:jobId/cancel` | Cancel the job |

## Stage Graph

- `SCOUT`
- `SHARD_ANALYZE`
- `AGGREGATE`
- `VERIFY`
- `WRITE`
- `FINALIZE`

## Invariants

- `taskd` 是唯一任务 authority。
- 编辑器和 MCP 只读取 `jobs` 快照与事件流，不直接管理 worker 进程。
- 分析类任务允许多 worker 并行。
- 写入类任务只允许单 writer 执行真实落盘。
- 长任务不会再依赖旧 workflow 节点 timeout、lease 或 session heartbeat。
- 真正超时只由 `hardBudgetMs` 判定。
