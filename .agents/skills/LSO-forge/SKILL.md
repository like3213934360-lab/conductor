---
name: LSO-forge
description: 🔨 按照任务清单将设计锻造为代码 — 波次执行、零降级护栏。
---

# LSO Forge — 设计到代码

基于 Anws `/forge` 工作流协议，由 Liquid Swarm Orchestrator 的三态蜂群驱动编码执行。

## 执行步骤
1. 读取 `.agents/workflows/forge.md`
2. 读取 `.anws/v{N}/05_TASKS.md` 确认待执行任务
3. 按 Wave 顺序逐任务执行
4. 每个任务通过 LSO 6 阶段管线（SCOUT → SHARD → AGGREGATE → VERIFY → WRITE → FINALIZE）
5. 更新 `AGENTS.md` Wave 状态
