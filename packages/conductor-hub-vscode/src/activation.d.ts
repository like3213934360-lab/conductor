/**
 * Conductor Hub VS Code — 激活入口
 *
 * 组装 SettingsManager / DashboardPanel / StatusBar / AutoConfig / WsMcpServer。
 */
import * as vscode from 'vscode';
import type { IHistoryStorage } from './dashboard-panel.js';
/**
 * 在宿主扩展的 activate() 中调用此函数以初始化 Conductor Hub 全部功能。
 *
 * @param context VS Code 扩展上下文
 * @param extensionUri 扩展根 URI (用于定位 webview 资源)
 * @param storage 可选的历史存储实例 (由宿主 extension 初始化)
 */
export declare function activateConductorHub(context: vscode.ExtensionContext, extensionUri: vscode.Uri, storage?: IHistoryStorage): Promise<void>;
/**
 * 在宿主扩展的 deactivate() 中调用
 */
export declare function deactivateConductorHub(): void;
//# sourceMappingURL=activation.d.ts.map