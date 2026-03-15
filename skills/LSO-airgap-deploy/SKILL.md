---
name: LSO-airgap-deploy
description: 🔒 物理隔离部署 — 配置 Ollama 本地模型 + 9 种脱敏规则 + 全离线运行。
---

# LSO Air-Gap Deploy — 物理隔离部署

配置 Liquid Swarm Orchestrator 在军工级物理隔离网络中运行。

## 配置步骤
1. **Ollama 检测**：自动检测本地 Ollama 实例是否可用
2. **模型下载**：引导下载适合离线使用的模型（如 `codellama`, `deepseek-coder`）
3. **云端禁用**：关闭所有需要网络的模型后端（Codex CLI, Gemini CLI）
4. **脱敏规则**：确认 9 种正则拦截模式已激活（AWS Key, DB Password, PII 等）
5. **熔断器**：配置 2M Token 全局预算
6. **验证**：运行一次端到端测试确认离线能力

## 触发条件
- 在内网/涉密环境部署
- 需要确保数据不出本地
- 使用自托管模型
