---
description: AGC v8.0 — GaaS 多模型治理编排引擎
---

# /agc — 多模型协作工作流 v8.0

> **架构**：Lease-Based DAG 状态机 + GaaS 治理网关
> **运行时强制**：偏差检测、Schema 验证、形式化不变量 — 均由代码保证，无需 LLM 遵守

## 节点映射

| Mode | 节点 | TaskName | 输出 |
|:----:|:----:|:--------:|:----:|
| PLANNING | ANALYZE | "AGC ANALYZE {slug}" | CP-ANALYZE |
| EXECUTION | PARALLEL | "AGC PARALLEL {slug}" | CP-PARALLEL |
| EXECUTION | DEBATE | "AGC DEBATE {slug}" | CP-DEBATE |
| VERIFICATION | VERIFY | "AGC VERIFY {slug}" | CP-VERIFY |
| EXECUTION | SYNTHESIZE | "AGC SYNTHESIZE {slug}" | CP-SYNTHESIZE |
| EXECUTION | PERSIST | "AGC PERSIST {slug}" | CP-PERSIST |

## 节点职责

### ANALYZE — 任务解析 + 风险路由
- 解析用户请求 → 任务类型
- DREAD 风险评分 → risk_level
- 路由决策 → route_path
- JIT 加载：`lib/routing.md` + `lib/memory.md`

### PARALLEL — 双模型并行思考
- 角色评分 → 最优角色组合
- Codex ‖ Gemini 并行独立执行
- 计算决策比 DR (0/0.5/1)
- JIT 加载：`lib/roles.md`

### DEBATE — 交叉辩论（按需）
- 论点提取 + 交叉辩论 (≤3 轮)
- 合谋检测 (Jaccard > 0.4 → TF-IDF)
- 收敛判定
- JIT 加载：`lib/runtime.md`

### VERIFY — 独立验证（按需）
- 触发：DR=1 / risk≥high / 合谋 FLAGGED / conf<75
- AssuranceEngine 4 层验证
- 形式化不变量检查

### SYNTHESIZE — 加权集成
- Trust-Weighted 释放决策
- 注意力衰减检测
- 报告生成 (T002/T003)
- JIT 加载：`lib/runtime.md`

### PERSIST — 持久化
- 检查点写入 + manifest 更新
- read-after-write 确认
- JIT 加载：`lib/memory.md`

## 路由规则

| 条件 | 下一节点 |
|:-----|:---------|
| DR=0 + conf≥85 + trusted | SYNTHESIZE (Fast-Track) |
| DR=0 + conf<85 | SYNTHESIZE |
| DR=0.5 或 DR=1 | DEBATE |
| risk≥high 或 合谋 FLAGGED | VERIFY |

## 容错

| 故障 | 降级 |
|:-----|:-----|
| 单模型超时 (30s) | 使用另一模型结果 |
| 验证模型不可用 | 跳过 semantic checker |
| 辩论不收敛 | 强制 VERIFY |
| 持久化失败 | 内存缓存 + 异步重试 |
| 所有模型失败 | HITL |
| Token 预算耗尽 | 降级模型 / 跳过低优先节点 |

> **运行时保证（代码强制，不依赖 LLM）**：
> Lease 租约系统 · 8 种偏差检测 · Zod Schema 验证 · 5 个 TLA+ 不变量 ·
> 动态信任评分 · 幂等执行器 · 崩溃恢复 · MemGPT 分页
