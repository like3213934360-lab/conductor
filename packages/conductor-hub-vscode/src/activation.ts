/**
 * Conductor Hub VS Code — 激活入口
 *
 * 组装 SettingsManager / DashboardPanel / StatusBar / AutoConfig / WsMcpServer。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SettingsManager } from './settings-manager.js';
import { DashboardPanel } from './dashboard-panel.js';
import type { IHistoryStorage } from './dashboard-panel.js';
import { ConductorStatusBar } from './status-bar.js';
import { ConductorWsMcpServer } from './ws-mcp-server.js';
import { syncKeysToFile, autoRegisterMcpConfig, autoInstallSkill, autoInstallAgcWorkflow, autoInjectRoutingRules } from './auto-config.js';

let statusBar: ConductorStatusBar | undefined;
let wsMcpServer: ConductorWsMcpServer | undefined;

/**
 * 在宿主扩展的 activate() 中调用此函数以初始化 Conductor Hub 全部功能。
 *
 * @param context VS Code 扩展上下文
 * @param extensionUri 扩展根 URI (用于定位 webview 资源)
 * @param storage 可选的历史存储实例 (由宿主 extension 初始化)
 */
export async function activateConductorHub(
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri,
    storage?: IHistoryStorage,
) {
    console.log('[Conductor Hub] Activating...');

    const settings = new SettingsManager(context);

    // ── STEP 1: 注册 Dashboard 命令 ──────────────────────────────────────────
    const openPanelCmd = vscode.commands.registerCommand('conductor-hub.openPanel', () => {
        if (!storage) {
            vscode.window.showWarningMessage('Conductor Hub: History storage unavailable. Dashboard will still work.');
        }
        DashboardPanel.createOrShow(extensionUri, storage || null, settings, () => statusBar?.refresh());
    });
    context.subscriptions.push(openPanelCmd);
    console.log('[Conductor Hub] Command conductor-hub.openPanel registered ✅');

    // ── STEP 2: 同步密钥 + 自动配置 ─────────────────────────────────────────
    const dbFilePath = storage
        ? (storage as any).getDbPath?.() || ''
        : path.join(context.globalStorageUri.fsPath, 'history.db');
    await syncKeysToFile(settings, dbFilePath);
    autoRegisterMcpConfig(context.extensionPath);
    autoInstallSkill(context.extensionPath);
    autoInstallAgcWorkflow(context.extensionPath);
    await autoInjectRoutingRules(settings);

    // ── STEP 3: 状态栏 ─────────────────────────────────────────────────────
    statusBar = new ConductorStatusBar(settings);
    context.subscriptions.push(statusBar.getItem());
    await statusBar.initialize();
    console.log('[Conductor Hub] StatusBar created ✅');

    // ── STEP 4: WebSocket MCP Server (非关键) ───────────────────────────────
    try {
        wsMcpServer = new ConductorWsMcpServer(storage || null, settings);
        await wsMcpServer.start();
        console.log('[Conductor Hub] WS MCP server started ✅');
    } catch (err) {
        console.error('[Conductor Hub] WS server failed (non-critical):', err);
    }

    console.log('[Conductor Hub] Activation complete ✅');
}

/**
 * 在宿主扩展的 deactivate() 中调用
 */
export function deactivateConductorHub() {
    statusBar?.dispose();
    wsMcpServer?.stop();
}
