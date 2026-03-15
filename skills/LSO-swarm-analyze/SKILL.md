---
name: LSO-swarm-analyze
description: 🧬 三态蜂群多模型分析 — 在 Frugal/Racing/MoA Fusion 之间自适应选择最优执行拓扑。
---

# LSO Swarm Analyze — 三态蜂群分析

这是 Liquid Swarm Orchestrator 的**核心差异化能力**。

## 功能
激活 LSO 的 6 阶段分析管线（SCOUT → SHARD_ANALYZE → AGGREGATE → VERIFY → WRITE → FINALIZE），系统根据 Token-Nomics 自动选择执行拓扑：

- **🚗 Frugal 节流**：低复杂度 → 单模型极速执行，零浪费
- **🏎️ Racing 赛马**：`race()` + `Promise.any`，第一个有效结果胜出
- **🧬 MoA Fusion 融合**：`fuse()` + `Promise.allSettled`，合成器交叉验证

## 触发条件
- 用户请求复杂代码分析
- 需要多模型视角时
- 希望获得最高质量输出时

## 使用方法
在聊天中提及 `/LSO-swarm-analyze` 或描述需要多模型协同分析的任务，系统将自动触发 LSO 管线。
