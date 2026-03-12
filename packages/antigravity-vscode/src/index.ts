/**
 * antigravity-vscode — barrel export
 */

export { SettingsManager, type ModelConfig } from './settings-manager.js';
export { DashboardPanel, type IHistoryStorage, type HistoryRecord } from './dashboard-panel.js';
export type { ArktsLspControlSurface, ArktsLspStatusSnapshot, ArktsLspLifecycleState } from './arkts-lsp-surface.js';
export { ArktsLspController } from './arkts/arkts-lsp-controller.js';
export { RequestHistoryRepository } from './request-history-repository.js';
export { activateAntigravityHost, deactivateAntigravityHost } from './extension-host.js';
export { AntigravityStatusBar } from './status-bar.js';
export { syncModelCatalogToFile, autoRegisterMcpConfig, autoInstallSkill, autoInjectRoutingRules } from './auto-config.js';
export { activateAntigravityRuntime, deactivateAntigravityRuntime } from './activation.js';
