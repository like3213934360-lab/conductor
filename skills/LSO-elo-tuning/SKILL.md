---
name: LSO-elo-tuning
description: 🧠 查看和调整 Per-Intent ELO 路由排位 — 意图感知达尔文路由调优。
---

# LSO ELO Tuning — 路由排位调优

查看和调整 Liquid Swarm Orchestrator 的 Per-Intent ELO 路由系统。

## 功能
- 查看各模型在 4 种意图上的 ELO 排位：`scout` / `analyze` / `generate` / `verify`
- 查看赛马遥测报告：胜率、平均延迟、Token 消耗
- 查看融合质量追踪：`emaFusionGain` 趋势
- 调整 6D 评分权重：`code_quality × long_context × reasoning × speed × cost × chinese`
- 重置 ELO 到默认值

## 触发条件
- 模型响应太慢或质量不佳
- 想了解哪个模型在哪种任务上表现最好
- 需要优化路由策略降低成本
