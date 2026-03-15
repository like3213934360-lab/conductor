---
name: LSO-design-system
description: 📐 为单个系统设计详细技术文档 — 架构图、接口设计、Trade-offs 讨论。
---

# LSO Design System — 系统详设

基于 Anws `/design-system` 工作流协议。

## 执行步骤
1. 读取 `.agents/workflows/design-system.md`
2. 调用 `system-designer` 技能生成详细设计
3. 产出：`.anws/v{N}/04_SYSTEM_DESIGN/{system-id}.md`（含 Mermaid 图、接口、数据模型）
