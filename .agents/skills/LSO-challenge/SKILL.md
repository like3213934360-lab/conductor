---
name: LSO-challenge
description: ⚔️ 对项目决策进行系统性挑战 — Pre-Mortem 分析、假设验证。
---

# LSO Challenge — 对抗性审查

基于 Anws `/challenge` 工作流协议。

## 执行步骤
1. 读取 `.agents/workflows/challenge.md`
2. 调用 `design-reviewer` 技能三维审查
3. 产出：`.anws/v{N}/07_CHALLENGE_REPORT.md`（含分级问题清单）
