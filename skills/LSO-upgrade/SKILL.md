---
name: LSO-upgrade
description: ⬆️ 在 `anws update` 后执行升级编排 — 判断 Minor/Major 并路由到对应工作流。
---

# LSO Upgrade — 升级编排

基于 Anws `/upgrade` 工作流。读取 `.anws/changelog/` 判断升级等级，路由到 `/LSO-change` 或 `/LSO-genesis`。

## 执行步骤
1. 读取 `.agents/workflows/upgrade.md`
2. 读取 `.anws/changelog/` 最新变更
3. 判断 Minor → `/LSO-change`，Major → `/LSO-genesis`
