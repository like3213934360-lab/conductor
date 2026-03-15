---
name: LSO-red-team-verify
description: 🛡️ 红队对抗 + ArkTS LSP 形式化验证 — 零信任神经符号双重自洽检查。
---

# LSO Red Team Verify — 零信任验证

激活 Liquid Swarm Orchestrator 的 VERIFY 阶段：

## 验证管线
1. **Semantic Red-Teaming** — 异源对抗模型 (`RedTeamCritic`) 审查代码，追猎逻辑缺陷、安全漏洞和幻觉 API
2. **ArkTS LSP Formal Verification** — 代码写入内存 VFS → 本地 ArkTS LSP 编译器语法 + 类型验证
3. **Reflexion Loop** — 任一检查失败 → 有界重试（≤2 轮），注入历史诊断 → 100% 自洽

## 触发条件
- 代码变更后需要安全审查
- 希望验证生成代码的正确性
- 在提交前进行最后质量把关
