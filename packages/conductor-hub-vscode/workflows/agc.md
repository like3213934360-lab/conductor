---
description: AGC v6.1 — 多模型编排引擎工作流（7 节点 DAG 状态机）
---

# /agc — 多模型协作工作流 v6.1

> **架构**：7 节点 DAG 状态机（LangGraph 风格）
> **上下文策略**：AOT 索引 + JIT 按需加载

## 前置条件
1. `ai_list_providers` 检查 CLI 可用性
2. AOT 加载：`SKILL.md` + `AGC_RULES.md`

## ⚠️ task_boundary ↔ AGC 节点映射（S11 强制·消除框架冲突）

> **根因**：Antigravity 的 `task_boundary`(PLANNING/EXECUTION/VERIFICATION) 与 AGC 7 节点 DAG 认知冲突，导致 LLM 跳过中间节点。以下映射**强制对齐**两个框架。

| task_boundary Mode | AGC 节点 | TaskName 模板 | 必须产出 |
|:------------------:|----------|--------------|---------|
| **PLANNING** | ANALYZE | "AGC ANALYZE {slug}" | CP-ANALYZE JSON |
| **EXECUTION** | PARALLEL | "AGC PARALLEL {slug}" | CP-PARALLEL JSON |
| **EXECUTION** | DEBATE | "AGC DEBATE {slug}" | CP-DEBATE JSON |
| **VERIFICATION** | VERIFY | "AGC VERIFY {slug}" | CP-VERIFY JSON |
| **EXECUTION** | SYNTHESIZE | "AGC SYNTHESIZE {slug}" | CP-SYNTHESIZE JSON |
| **EXECUTION** | PERSIST | "AGC PERSIST {slug}" | CP-PERSIST JSON |

### 节点执行合同（每个节点必须遵守）

```
1. 入口：回读 data/agc_wal/current_run.json → 确认前序节点 CP 存在
2. 执行：按本节点逻辑处理
3. 出口：写入本节点 CP-* 到 current_run.json → 调用 task_boundary 更新
4. 违反：AGC_BLOCKED → HITL
```

> **若运行时无法满足上述条件，必须输出 `AGC_BLOCKED` 并说明原因，不得静默降级。**（S11/S12 强制）

### 节点 1: ANALYZE（任务解析+风险路由）

**JIT 加载**：`lib/routing.md` + `lib/memory.md`

**步骤**：
1. 解析用户请求 → 任务类型（审查/实现/优化/调研）
2. 读取 `data/manifest.json` → 历史匹配
3. 工具嗅探 → 决策树激活
4. 风险评分矩阵 → risk_level
5. 路由决策 → route_path

**输出 CP-ANALYZE**：
```json
{
  "task_type": "...",
  "tools_available": [],
  "evidence_files": [],
  "risk_level": "low|medium|high|critical",
  "route_path": "fast_track|debate|debate_verify|hitl",
  "token_budget": "S|M|L",
  "history_hits": []
}
```

**失败路径**：证据不足 → 补充重试 → 二次失败 → 降级为单模型直接执行

---

### 节点 2: PARALLEL（双模型并行思考）

**JIT 加载**：`lib/roles.md`

**步骤**：
1. 角色评分 → 选择最优角色组合
2. Codex ‖ Gemini 并行独立思考
3. 计算 DR（0/0.5/1）
4. 各模型输出附带 AGC_META

**输出 CP-PARALLEL**：
```json
{
  "codex": {"summary": "...", "confidence": 85, "option_id": "A"},
  "gemini": {"summary": "...", "confidence": 82, "option_id": "B"},
  "dr_value": 0.5
}
```

**路由决策**：
| DR | risk | 下一节点 |
|:---:|:----:|----------|
| 0 + conf≥85 | low | → SYNTHESIZE (Fast-Track) |
| 0 + conf<85 | any | → SYNTHESIZE |
| 0.5 | any | → DEBATE |
| 1 | any | → DEBATE |

---

### 节点 3: DEBATE（交叉辩论）

**JIT 加载**：`lib/runtime.md`

**步骤**：
1. 论点提取 + 颜色标记（✅❌🔄➡️）
2. 交叉辩论（≤3 轮）
3. 合谋检测（Jaccard > 0.4 → TF-IDF）
4. 收敛判定

**输出 CP-DEBATE**：
```json
{
  "debate_rounds": 2,
  "arguments": [],
  "convergence_score": 0.8,
  "collusion_check": "PASS"
}
```

**路由**：DR=1 或 risk≥high → VERIFY；否则 → SYNTHESIZE

---

### 节点 4: VERIFY（独立验证）

**触发条件**：DR=1 / risk≥high / 合谋 FLAGGED / conf<75

**步骤**：
1. DeepSeek 独立验证（隔离上下文）
2. 合规检查
3. 熔断判断

**输出 CP-VERIFY**：
```json
{
  "deepseek_verdict": "AGREE|PARTIAL|DISAGREE",
  "entropy_gain": 15,
  "compliance_check": "PASS",
  "third_proposal": false
}
```

**熔断（Circuit Breaker）**：compliance=VIOLATION → HITL

---

### 节点 5: SYNTHESIZE（加权集成）

**JIT 加载**：`lib/runtime.md`

**步骤**：
1. 加权集成（0.30 + 0.35 + 0.35）
2. 注意力衰减检测
3. 生成报告（T002/T003 模板）
4. 合规检查

**输出 CP-SYNTHESIZE**：
```json
{
  "final_answer": "...",
  "final_confidence": 88,
  "weighted_scores": {},
  "template_used": "T002|T003"
}
```

---

### 节点 6: PERSIST（持久化+反馈）

**JIT 加载**：`lib/memory.md`

**步骤**：
1. 写入 session 快照
2. 更新 manifest.json
3. 更新语义索引
4. read-after-write 确认
5. 收集反馈报告

**输出 CP-PERSIST**：
```json
{
  "written_files": [],
  "manifest_updated": true,
  "read_after_write": true,
  "feedback_reports": []
}
```

---

## 容错表

| 故障 | 检测 | 降级策略 |
|------|------|----------|
| Codex 超时 | 30s 无响应 | 使用 Gemini 结果 |
| Gemini 超时 | 30s 无响应 | 使用 Codex 结果 |
| DeepSeek 不可用 | API 错误 | 权重分给历史(0.65) |
| 辩论不收敛 | 3 轮后 DR 不降 | 强制 VERIFY |
| 持久化失败 | 写入错误 | 内存缓存+异步重试 |
| 所有模型失败 | 全超时 | HITL |
