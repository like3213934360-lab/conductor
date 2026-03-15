---
name: LSO-change
description: 🔧 处理微调级变更请求 — 仅修改已有任务的细节，禁止新增功能。
---

# LSO Change — 微调变更

基于 Anws `/change` 工作流。仅允许修改现有任务描述和验收标准，超出范围时路由到 `/LSO-genesis`。

## 执行步骤
1. 读取 `.agents/workflows/change.md`
2. 验证变更范围（禁止新增任务/功能）
3. 更新 TASKS + SYSTEM_DESIGN + CHANGELOG
