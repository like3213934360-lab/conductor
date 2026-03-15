---
name: LSO-probe
description: 🔍 探测系统风险 — 分析遗留代码的隐藏耦合和架构暗坑。
---

# LSO Probe — 系统风险探测

基于 Anws `/probe` 工作流协议。

## 执行步骤
1. 读取 `.agents/workflows/probe.md` 获取完整工作流
2. 调用 `nexus-mapper` 技能生成代码库结构图
3. 调用 `runtime-inspector` 技能分析运行时行为
4. 调用 `report-template` 技能生成风险报告
5. 产出：`.anws/v{N}/00_PROBE_REPORT.md`（含系统指纹、Git 热点、风险矩阵）
