---
name: LSO-daemon
description: ⚙️ 启动和管理 LSO 后台守护进程 — 查看状态、重启、日志。
---

# LSO Daemon — 守护进程管理

管理 Liquid Swarm Orchestrator 的后台 `antigravity-taskd` 守护进程。

## 功能
- **启动/停止**：控制 taskd 守护进程生命周期
- **状态查看**：当前运行中的作业、管线阶段、Worker 状态
- **日志**：查看 JSONL journal 日志（SCOUT → SHARD → AGGREGATE → VERIFY → WRITE）
- **健康检查**：Unix Socket 连通性、Worker 进程存活、内存用量

## 触发条件
- 任务执行异常需要排查
- 想查看后台进程状态
- 需要重启 LSO 引擎
