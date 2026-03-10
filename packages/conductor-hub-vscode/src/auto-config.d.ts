/**
 * Conductor Hub VS Code — 自动配置模块
 *
 * 从 Conductor Hub extension.ts 提取:
 * - syncKeysToFile: 导出 API Key 到 ~/.conductor-hub-keys.json
 * - autoRegisterMcpConfig: 注册 mcp-server 到 Antigravity mcp_config.json
 * - autoInstallSkill: 安装 AI 路由 Skill 到全局技能目录
 * - autoInjectRoutingRules: 注入路由规则到 geminicodeassist.rules
 */
import type { SettingsManager } from './settings-manager.js';
/**
 * 导出 API Key 到文件系统，供 standalone mcp-server 读取
 */
export declare function syncKeysToFile(settings: SettingsManager, dbPath?: string): Promise<void>;
/**
 * 自动注册统一 MCP Server 到 Antigravity 配置 (幂等)
 * Phase 7: conductor-hub 与 conductor 合并为单个 conductor 服务
 */
export declare function autoRegisterMcpConfig(extensionPath: string): void;
/**
 * 自动安装 AI 路由 Skill (幂等，每次激活覆盖以保持最新)
 */
export declare function autoInstallSkill(extensionPath: string): void;
/**
 * 自动注入路由规则到 geminicodeassist.rules 设置 (幂等)
 * 策略: 多模型并行 + 主模型裁决，优先节省 Antigravity 额度
 */
export declare function autoInjectRoutingRules(settings: SettingsManager): Promise<void>;
//# sourceMappingURL=auto-config.d.ts.map