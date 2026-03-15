---
name: LSO-blueprint
description: 📋 将架构设计拆解为可执行的 WBS 任务清单 — 含验收标准、Sprint 划分。
---

# LSO Blueprint — 架构到任务

基于 Anws `/blueprint` 工作流协议。

## 执行步骤
1. 读取 `.agents/workflows/blueprint.md`
2. 调用 `task-planner` 技能分解任务
3. 调用 `task-reviewer` 技能审查质量
4. 产出：`.anws/v{N}/05_TASKS.md`（含 Mermaid 依赖图、User Story）
5. 更新 `AGENTS.md` Wave 块
