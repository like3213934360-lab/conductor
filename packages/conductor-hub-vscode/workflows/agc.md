---
description: AGC v8.0 — GaaS 多模型治理编排引擎（Lease-Based DAG 状态机）
---

# /agc — 多模型协作工作流 v8.0

> **架构**：GaaS (Governance-as-a-Service) — Lease-Based DAG 状态机
> **上下文策略**：MemGPT 风格分页 + TF-IDF 语义相关性 + AOT/JIT 混合加载
> **治理模型**：4 拦截点 PDP/PEP + 动态信任因子 + 形式化不变量验证

## 前置条件
1. `ai_list_providers` 检查 CLI 可用性
2. AOT 加载：`SKILL.md` + `AGC_RULES.md`
3. GovernanceGateway 初始化 + DefaultControlPack 注册

## v8.0 架构概览

### 从 v6.1 到 v8.0 的关键进化

| 维度 | v6.1 | v8.0 |
|:---:|:---:|:---:|
| **治理模型** | ComplianceEngine 洋葱管道 | GaaS PDP/PEP 4 拦截点 |
| **权重系统** | 固定权重 0.30/0.35/0.35 | 动态信任因子 (4 信号加权) |
| **验证引擎** | DeepSeek-as-Judge 硬编码 | AssuranceEngine 可插拔检查器 |
| **工作流调度** | LLM 决定下一步 | Lease-Based Runtime (LLM 不可绕过) |
| **DAG 拓扑** | 固定 7 节点 | 动态拓扑 (子图 + 受控循环 + 运行时注入) |
| **形式化验证** | 无 | 5 个安全不变量 (TLA+ 风格) |
| **容错** | 手动重试 | 幂等执行器 + 崩溃恢复 (Event Sourcing) |
| **上下文管理** | 简单截断 | MemGPT 分页 + TF-IDF 语义排序 |
| **规则编号** | S1-S13 扁平编号 | 按阶段分组控制 (GC-I/E/O/R) |
| **策略引擎** | .md 文本规则 | Policy DSL → TypeScript 谓词 |

---

## ⚠️ task_boundary ↔ AGC 节点映射（S11 强制·消除框架冲突）

> **根因**：Antigravity 的 `task_boundary`(PLANNING/EXECUTION/VERIFICATION) 与 AGC 节点 DAG 认知冲突，导致 LLM 跳过中间节点。以下映射**强制对齐**两个框架。

| task_boundary Mode | AGC 节点 | TaskName 模板 | 必须产出 |
|:------------------:|----------|--------------|---------|
| **PLANNING** | ANALYZE | "AGC ANALYZE {slug}" | CP-ANALYZE JSON |
| **EXECUTION** | PARALLEL | "AGC PARALLEL {slug}" | CP-PARALLEL JSON |
| **EXECUTION** | DEBATE | "AGC DEBATE {slug}" | CP-DEBATE JSON |
| **VERIFICATION** | VERIFY | "AGC VERIFY {slug}" | CP-VERIFY JSON |
| **EXECUTION** | SYNTHESIZE | "AGC SYNTHESIZE {slug}" | CP-SYNTHESIZE JSON |
| **EXECUTION** | PERSIST | "AGC PERSIST {slug}" | CP-PERSIST JSON |

---

## 核心子系统

### 1. Lease-Based Workflow Runtime (Layer 1)

> **核心理念**：LLM 不决定下一步，Runtime 发放执行租约。

**SOTA 参考**：LangGraph 编译时图拓扑 · Temporal.io 活动租约 · Kubernetes Controller pattern

**节点执行合同**：
```
1. 入口：Runtime.claimNext() → 获取 NodeLease (UUID 防重放)
2. 执行：按本节点逻辑处理
3. 出口：Runtime.submitCheckpoint() → Schema 验证 + BoundaryGuard 断言 + 路由计算
4. 违反：8 种偏差检测 → AGC_BLOCKED → HITL
```

**8 种偏差检测**：

| Code | 描述 | 强制等级 |
|:-----|:-----|:-------:|
| `UNLEASED_NODE` | 尝试执行无租约的节点 | 10/10 |
| `STALE_LEASE` | 租约过期 (默认 5min TTL) | 10/10 |
| `SCHEMA_INVALID` | 检查点格式不符 Zod Schema | 10/10 |
| `ILLEGAL_ROUTE` | 尝试非法跳转 | 10/10 |
| `ILLEGAL_SKIP` | 跳过不可跳过的节点 | 10/10 |
| `DUPLICATE_SUBMIT` | 重复提交同一租约 | 10/10 |
| `VERSION_MISMATCH` | 租约版本与当前状态版本不一致 | 10/10 |
| `BUDGET_EXCEEDED` | Token 预算耗尽 | 10/10 |

> **若运行时无法满足上述条件，必须输出 `AGC_BLOCKED` 并说明原因，不得静默降级。**

---

### 2. GovernanceGateway (GaaS PDP/PEP)

> **从 ComplianceEngine 洋葱管道进化为 OPA 风格的策略决策点。**

**设计参考**：OPA (Open Policy Agent) · NIST AI RMF · NeMo Guardrails

**4 个拦截点**：

| 拦截点 | 阶段 | 控制类型 | 用途 |
|:------:|:----:|:-------:|:----:|
| `preflight()` | input | GC-I* | 运行前全局筛查 |
| `authorize()` | execution + routing | GC-E* + GC-R* | 每个动作前授权 |
| `observe()` | assurance | GC-A* | 动作后观察 + 更新信任因子 |
| `release()` | output | GC-O* | Trust-Weighted 最终输出释放 |

**默认控制包 (7 控制)**：
- `GC-I01` 状态一致性 · `GC-I02` DAG 图完整性
- `GC-E01` 检查点链接 · `GC-E02` 动作授权
- `GC-O01` Schema 强制 · `GC-O02` 无检查点无结果
- `GC-R01` 路由合规性

---

### 3. 动态信任因子 (Trust Factor Service)

> **替代固定权重 (0.30/0.35/0.35) 的动态评分系统。**

**设计参考**：GaaS Trust Factor (arXiv 2025) · NIST SP 800-207 Zero Trust · Bayesian Trust Models

**4 信号公式**：
```
trustScore = Σ(signal_i × weight_i)

信号:
  riskScore (0.25)      = 1 - DREAD/100      ← 低风险 = 高信任
  complianceRate (0.30)  = 滑动窗口 pass 率    ← 历史合规
  modelReliability (0.25) = 指数衰减加权成功率   ← 模型可靠性
  evidenceQuality (0.20)  = citations/content   ← 引用密度
```

**4 信任等级**：
| 等级 | 阈值 | 路由 |
|:----:|:----:|:----:|
| `trusted` | ≥ 0.75 | express (快速通道) |
| `guarded` | ≥ 0.50 | standard |
| `restricted` | ≥ 0.25 | full (完整辩论) |
| `escalated` | < 0.25 | HITL |

**Release 决策逻辑**：
```
candidateScore = (confidence / 100) × trustFactor.score

top-2 差距 < ε (0.05) → revise (challenger needed)
score < threshold (0.4) → degrade
AssuranceEngine 验证失败 → escalate
正常 → release
```

---

### 4. AssuranceEngine (统一验证引擎)

> **替代 DeepSeek-as-Judge 硬编码。可插拔检查器架构。**

**设计参考**：AgentSpec (arXiv 2025) · NeMo Guardrails · NIST AI RMF

**4 层验证**：
1. **确定性检查**：schema / tool output / policy controls
2. **语义挑战者**：可插拔模型 (不绑定 DeepSeek)
3. **矛盾检测**：候选输出 vs 证据一致性
4. **升级策略**：allow | revise | degrade | escalate

**默认检查器**：
- `NonEmptyChecker` — 非空检查
- `ConfidenceBoundsChecker` — 置信度边界 (0-100, >95 可疑)
- `CitationPresenceChecker` — 高风险运行引用存在检查

---

### 5. 形式化验证 (State Invariant Verifier)

> **TLA+ 风格的安全属性，在 EventStore append 前验证。**

**设计参考**：TLA+ (Lamport) · Azure COYOTE · Alloy Analyzer

**5 个预定义安全不变量**：

| ID | 名称 | 时序逻辑表达 |
|:--:|:-----|:-----------|
| P1 | MandatoryVerifyOnHighRisk | ∀ run. risk ∈ {high, critical} ∧ terminating → VERIFY.completed |
| P2 | NoSkippedMandatoryNodes | ∀ node. skippable=false → status ≠ 'skipped' |
| P3 | VersionMonotonicity | nextState.version > prevState.version |
| P4 | NoOrphanedNodes | ∀ runtime_node. ∃ graph_node |
| P5 | TerminationCondition | RUN_COMPLETED → ∀ mandatory_node.completed |

---

### 6. 动态拓扑扩展 (Dynamic Topology)

> **在固定 DAG 上叠加拓扑覆盖层，支持子图、受控循环、运行时节点注入。**

**设计参考**：LangGraph SubGraph · Temporal.io Workflow · Tarjan SCC Algorithm

**3 种扩展能力**：
- **子图 (Subgraph)**：`kind='subgraph'` 节点嵌套独立 RunGraph
- **受控循环 (Loop)**：`kind='loop'` 边 + LoopPolicy (maxIterations + convergenceCondition)
- **运行时变更 (Mutation)**：addNode / removeNode / addEdge / removeEdge (支持插件)

**安全保证**：Tarjan 强连通分量检测 O(V+E)，非法循环 (无 loop 边) 直接报错。

---

### 7. 容错增强 (Fault Tolerance)

> **Event Sourcing 驱动的崩溃恢复 + 幂等执行。**

**设计参考**：Temporal.io 确定性重放 · Amazon Step Functions · Microsoft Orleans

**2 个核心组件**：

**IdempotentExecutor**：
- 查询 EventStore 中的 `IO_EFFECT_RECORDED` 事件
- 命中 → 跳过 IO，返回缓存结果
- 未命中 → 执行 + 原子持久化 + 缓存
- 并发去重：相同 idempotencyKey 共享 Promise

**CrashRecoveryManager**：
- 加载最近 CheckpointDTO → 增量事件重放 → 状态重建
- 每步检查点 (checkpointPerStep)：节点完成后立即写入

---

### 8. MemGPT 分页上下文管理 (Paged Context Manager)

> **语义感知的 Token 预算管理，替代简单截断。**

**设计参考**：MemGPT (UC Berkeley) · LlamaIndex · DSPy Compiling · BM25/TF-IDF

**3 维综合排序**：
```
compositeScore = (semanticRelevance × 0.5) + (recency × 0.3) + (sizeEfficiency × 0.2)
```

**MemGPT 工具注入**：
- `recall_file` — 从回忆区召回被驱逐的文件
- `evict_file` — 主动驱逐低相关性文件
- `search_recall_memory` — TF-IDF 搜索回忆区

---

## 节点定义

### 节点 1: ANALYZE（任务解析+风险路由）

**JIT 加载**：`lib/routing.md` + `lib/memory.md`

**步骤**：
1. 解析用户请求 → 任务类型（审查/实现/优化/调研）
2. 读取 `data/manifest.json` → 历史匹配
3. 工具嗅探 → 决策树激活
4. DREAD 风险评分矩阵 → risk_level
5. 路由决策 → route_path
6. GovernanceGateway.preflight() → 输入预检

**输出 CP-ANALYZE**：
```json
{
  "task_type": "...",
  "tools_available": [],
  "evidence_files": [],
  "risk_level": "low|medium|high|critical",
  "route_path": "fast_track|debate|debate_verify|hitl",
  "token_budget": "S|M|L",
  "history_hits": [],
  "trust_band": "trusted|guarded|restricted|escalated"
}
```

**失败路径**：证据不足 → 补充重试 → 二次失败 → 降级为单模型直接执行

---

### 节点 2: PARALLEL（双模型并行思考）

**JIT 加载**：`lib/roles.md`

**步骤**：
1. 角色评分 → 选择最优角色组合
2. GovernanceGateway.authorize() → 动作授权
3. Codex ‖ Gemini 并行独立思考 (IdempotentExecutor 幂等执行)
4. 计算 DR（0/0.5/1）
5. 各模型输出附带 AGC_META

**输出 CP-PARALLEL**：
```json
{
  "codex": {"summary": "...", "confidence": 85, "option_id": "A"},
  "gemini": {"summary": "...", "confidence": 82, "option_id": "B"},
  "dr_value": 0.5
}
```

**路由决策** (Runtime 代码计算，非 LLM)：
| DR | trust_band | 下一节点 |
|:---:|:----------:|----------|
| 0 + conf≥85 | trusted | → SYNTHESIZE (Fast-Track) |
| 0 + conf<85 | any | → SYNTHESIZE |
| 0.5 | any | → DEBATE |
| 1 | any | → DEBATE |

---

### 节点 3: DEBATE（交叉辩论）

**JIT 加载**：`lib/runtime.md`

**步骤**：
1. 论点提取 + 颜色标记（✅❌🔄➡️）
2. 交叉辩论（≤3 轮，受 LoopPolicy 控制）
3. 合谋检测（Jaccard > 0.4 → TF-IDF）
4. 收敛判定
5. GovernanceGateway.observe() → 更新信任因子

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

**触发条件**：DR=1 / risk≥high / 合谋 FLAGGED / conf<75 / trust_band=restricted|escalated

**步骤**：
1. AssuranceEngine.verify() → 4 层验证（确定性 + 语义 + 矛盾 + 策略）
2. 可插拔挑战者模型验证（不绑定 DeepSeek）
3. StateInvariantVerifier.verifyPatch() → P1-P5 形式化验证
4. 熔断判断

**输出 CP-VERIFY**：
```json
{
  "assurance_verdict": "PASS|REVISE|ESCALATE",
  "findings": [],
  "invariant_check": "PASS",
  "trust_update": {"band": "guarded", "score": 0.62}
}
```

**熔断（Circuit Breaker）**：critical findings → HITL

---

### 节点 5: SYNTHESIZE（Trust-Weighted 集成）

**JIT 加载**：`lib/runtime.md`

**步骤**：
1. GovernanceGateway.release() → Trust-Weighted 释放决策
2. 注意力衰减检测
3. 生成报告（T002/T003 模板）
4. 合规检查
5. StateInvariantVerifier → 终止条件验证 (P5)

**输出 CP-SYNTHESIZE**：
```json
{
  "final_answer": "...",
  "final_confidence": 88,
  "release_decision": "release|degrade|revise|escalate",
  "trust_factor": {"score": 0.78, "band": "trusted"},
  "template_used": "T002|T003"
}
```

---

### 节点 6: PERSIST（持久化+反馈）

**JIT 加载**：`lib/memory.md`

**步骤**：
1. CrashRecoveryManager.checkpointPerStep() → 写入检查点
2. 更新 manifest.json
3. 更新语义索引
4. read-after-write 确认
5. Token 预算快照持久化
6. 收集反馈报告

**输出 CP-PERSIST**：
```json
{
  "written_files": [],
  "manifest_updated": true,
  "read_after_write": true,
  "checkpoint_id": "cp-{runId}-v{version}",
  "budget_snapshot": {"used": 5200, "remaining": 2800},
  "feedback_reports": []
}
```

---

## 容错表

| 故障 | 检测 | 降级策略 |
|------|------|----------|
| Codex 超时 | 30s 无响应 | IdempotentExecutor 缓存 → 使用 Gemini 结果 |
| Gemini 超时 | 30s 无响应 | IdempotentExecutor 缓存 → 使用 Codex 结果 |
| 验证模型不可用 | API 错误 | AssuranceEngine 跳过 semantic checker |
| 辩论不收敛 | LoopPolicy.maxIterations 到达 | 强制 VERIFY |
| 持久化失败 | 写入错误 | 内存缓存+异步重试 (CheckpointStore) |
| 所有模型失败 | 全超时 | HITL |
| 崩溃恢复 | 进程重启 | CrashRecoveryManager 事件重放 |
| Token 预算耗尽 | BUDGET_EXCEEDED | 跳过低优先节点 / 降级模型 |
| 形式化不变量违反 | InvariantViolationError | 阻止状态转换 → HITL |

---

## 技术规格索引

| 子系统 | 源码路径 |
|:-------|:--------|
| GovernanceGateway | `packages/conductor-core/src/governance/governance-gateway.ts` |
| WorkflowRuntime | `packages/conductor-core/src/governance/workflow-runtime.ts` |
| TrustFactorService | `packages/conductor-core/src/governance/trust-factor.ts` |
| AssuranceEngine | `packages/conductor-core/src/governance/assurance-engine.ts` |
| DefaultControlPack | `packages/conductor-core/src/governance/default-control-pack.ts` |
| BoundaryGuard | `packages/conductor-core/src/governance/boundary-guard.ts` |
| TokenBudgetEnforcer | `packages/conductor-core/src/governance/token-budget-enforcer.ts` |
| StateInvariantVerifier | `packages/conductor-core/src/dag/formal-verifier.ts` |
| DynamicTopology | `packages/conductor-core/src/dag/dynamic-topology.ts` |
| ModelChecker | `packages/conductor-core/src/dag/model-checker.ts` |
| RecoveryManager | `packages/conductor-core/src/fault-tolerance/recovery-manager.ts` |
| PagedContextManager | `packages/conductor-hub-core/src/context/paged-context-manager.ts` |
| PolicyCompiler | `packages/conductor-core/src/compliance/policy-compiler.ts` |
| PromptTemplates | `packages/conductor-hub-core/src/prompt-templates.ts` |
| PreflightValidator | `packages/conductor-hub-core/src/preflight-validator.ts` |
| TaskPartitioner | `packages/conductor-hub-core/src/task-partitioner.ts` |
