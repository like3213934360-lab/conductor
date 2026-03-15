---
name: LSO-genesis
description: 🌅 从零启动新项目 — 生成 PRD、Architecture、ADR，建立版本化架构基础。
---

# LSO Genesis — 从零到架构

基于 Anws `/genesis` 工作流协议，由 Liquid Swarm Orchestrator 驱动。

## 执行步骤
1. 读取 `.agents/workflows/genesis.md` 获取完整工作流步骤
2. 调用 `concept-modeler` 技能澄清领域概念
3. 调用 `spec-writer` 技能生成 PRD
4. 调用 `system-architect` 技能识别系统边界
5. 调用 `tech-evaluator` 技能输出 ADR
6. 产出：`.anws/v1/` 目录下的完整架构文档
7. 更新 `AGENTS.md` 状态区

> **检查点**：每个步骤完成后暂停等待用户确认。
