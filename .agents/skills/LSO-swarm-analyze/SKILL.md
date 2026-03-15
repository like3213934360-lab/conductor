---
name: LSO-swarm-analyze
description: 🧬 三态蜂群多模型分析 — 自动发现所有可用模型，全员出动协同分析。
---

# LSO Swarm Analyze — 三态蜂群分析

这是 Liquid Swarm Orchestrator 的**核心差异化能力**。

## 核心原则

> **有多少可用模型，就调度多少模型。**
> 绝不因为工具限制而退化为单模型执行。

## 触发条件
- 用户请求复杂代码分析、架构审计
- 需要多模型视角时
- 希望获得最高质量输出时
- 用户显式提及 `/LSO-swarm-analyze`

---

## 🔧 执行协议（必须严格遵循）

### Phase 0: 模型自动发现 (PROBE)

**在执行任何分析之前，必须先探测所有可用模型。**

1. 调用 `ai_list_providers` 工具获取完整模型清单
2. 记录以下三类可用模型：
   - **API 模型**：所有 `✅` 状态的 API 端点（如 deepseek、glm、moonshot 等）
   - **Codex CLI**：检查是否 `✅ Installed`
   - **Gemini CLI**：检查是否 `✅ Installed`
3. 汇总可出动模型总数 N

> [!IMPORTANT]
> 如果 N < 2，警告用户："当前仅 1 个模型可用，蜂群分析效果受限。建议配置更多模型。"
> 如果 N >= 2，继续执行全员调度。

### Phase 1: SCOUT — 代码库全景扫描

使用主模型（Antigravity 自身）执行：
- 项目结构扫描（包数量、文件数、LoC）
- 依赖 DAG 映射
- 初始风险面识别

### Phase 2: SHARD_ANALYZE — 全员并发分析

**核心：使用 `ai_parallel_tasks` 将同一分析任务同时发送给所有可用模型。**

根据 Phase 0 探测到的 N 个模型，构建 `ai_parallel_tasks` 调用：

```
每个模型 = 1 个 parallel task:
- API 模型 → type: "ask", provider: "{model_id}"
- Codex CLI → type: "codex"
- Gemini CLI → type: "gemini"
```

**所有模型收到相同的分析 prompt + Phase 1 的 SCOUT 数据。**

示例（假设有 deepseek + codex + gemini 三个模型）：

```javascript
ai_parallel_tasks({
  tasks: [
    { type: "ask",    provider: "deepseek", prompt: ANALYSIS_PROMPT },
    { type: "codex",  prompt: ANALYSIS_PROMPT },
    { type: "gemini", prompt: ANALYSIS_PROMPT }
  ],
  max_concurrency: 3
})
```

> [!IMPORTANT]
> - 如果某个模型超时或失败，不影响其他模型的结果
> - 收集所有成功返回的分析结果
> - 记录每个模型的响应时间和 token 消耗

### Phase 3: AGGREGATE — 交叉融合

将所有模型的分析结果合并：

1. **共识提取**：多个模型一致指出的问题 → 高置信度发现
2. **分歧标注**：模型间存在矛盾的判断 → 标记为需人工裁决
3. **独特洞察**：仅单个模型发现的问题 → 标记为潜在盲点

如果可用模型 N >= 3，可以再使用 `ai_consensus` 对聚合结果进行裁判评分。

### Phase 4: VERIFY — 红方验证

对 AGGREGATE 提出的 Top 5 发现，用代码搜索（grep_search、find_by_name）进行**证据验证**：
- 声称存在的问题是否有代码证据？
- 推荐的修复方案是否可行？

### Phase 5: FINALIZE — 生成报告

输出结构化报告，包含：
- 参与模型数量和各模型响应概要
- 共识发现 vs 分歧发现 vs 独特洞察
- 按严重度排序的优先行动清单

---

## 三态拓扑自适应选择

根据任务复杂度和可用模型数 N，自动选择执行拓扑：

| 模型数 N | 任务复杂度 | 拓扑 | 策略 |
|---------|-----------|------|------|
| N = 1   | 任意      | 🚗 **Frugal** | 单模型执行，跳过 AGGREGATE |
| N = 2   | 低/中     | 🏎️ **Racing** | `Promise.any` — 第一个有效结果胜出 |
| N >= 2  | 高        | 🧬 **MoA Fusion** | `Promise.allSettled` — 全员结果交叉融合 |
| N >= 3  | 高        | 🧬 **MoA + Judge** | Fusion + `ai_consensus` 裁判 |

> 蜂群分析默认使用 **MoA Fusion**（最高质量输出）。
> 用户可以显式请求 Racing 模式以获得更快响应。

---

## 常见错误（必须避免）

1. ❌ **只用 `ai_consensus`** — 它只查询 API 模型，不调度 CLI Agent
2. ❌ **不探测就调度** — 必须先 `ai_list_providers` 再构建任务列表
3. ❌ **硬编码模型名** — 必须动态发现，用户环境不同模型不同
4. ✅ **`ai_parallel_tasks` 是蜂群核心工具** — 它同时支持 API + CLI 类型
