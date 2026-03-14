# Quick Start

## VS Code

1. 打开工作区。
2. 运行 `Antigravity Task Kernel: 启动任务`。
3. 选择 `Analysis` 或 `Write`。
4. 在控制面板或 `streamTask` 命令中查看实时进度。

## MCP

启动 MCP server 后，使用以下工具：

- `task.run`
- `task.getState`
- `task.advance`
- `task.list`
- `task.cancel`

## Programmatic Client

```ts
import { AntigravityTaskdClient, resolveAntigravityTaskdPaths } from '@anthropic/antigravity-taskd'

const workspaceRoot = process.cwd()
const paths = resolveAntigravityTaskdPaths(workspaceRoot)
const client = new AntigravityTaskdClient(paths.socketPath)

await client.waitForReady()
const created = await client.createJob({
  goal: 'Analyze this workspace and identify architectural risks',
  mode: 'analysis',
  workspaceRoot,
})

const snapshot = await client.getJob(created.jobId)
console.log(snapshot.status, snapshot.currentStageId)
```
