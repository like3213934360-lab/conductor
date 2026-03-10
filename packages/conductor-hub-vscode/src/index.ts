/**
 * conductor-hub-vscode — barrel export
 */

export { SettingsManager, type ModelConfig, type BridgeConfig, type Provider, SUPPORTED_PROVIDERS } from './settings-manager.js';
export { DashboardPanel, type IHistoryStorage, type HistoryRecord } from './dashboard-panel.js';
export { ConductorStatusBar } from './status-bar.js';
export { ConductorWsMcpServer } from './ws-mcp-server.js';
export { syncKeysToFile, autoRegisterMcpConfig, autoInstallSkill, autoInjectRoutingRules } from './auto-config.js';
export { activateConductorHub, deactivateConductorHub } from './activation.js';
