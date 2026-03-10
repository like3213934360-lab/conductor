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
import { syncKeysToFile, autoRegisterMcpConfig, autoInstallSkill, autoInjectRoutingRules } from './auto-config.js';
import { AgcOrchestrator } from './agc-orchestrator.js';

let statusBar: ConductorStatusBar | undefined;
let wsMcpServer: ConductorWsMcpServer | undefined;
let agcOrchestrator: AgcOrchestrator | undefined;

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
            console.log('[Conductor Hub] History storage not provided — history features disabled.');
        }
        DashboardPanel.createOrShow(extensionUri, storage || null, settings, agcOrchestrator!, () => statusBar?.refresh());
    });
    context.subscriptions.push(openPanelCmd);
    console.log('[Conductor Hub] Command conductor-hub.openPanel registered ✅');

    agcOrchestrator = new AgcOrchestrator();
    context.subscriptions.push(agcOrchestrator);

    const runAgcCmd = vscode.commands.registerCommand('conductor-hub.runAgc', async () => {
        const goal = await vscode.window.showInputBox({
            title: 'Run AGC',
            prompt: 'Describe the AGC analysis goal',
            placeHolder: 'Audit this workspace against global SOTA and identify gaps',
            ignoreFocusOut: true,
            validateInput: (value) => value.trim().length === 0 ? 'Goal is required' : undefined,
        });

        if (!goal) {
            return;
        }

        DashboardPanel.createOrShow(extensionUri, storage || null, settings, agcOrchestrator!, () => statusBar?.refresh());

        try {
            const result = await agcOrchestrator.startRun({ goal });
            vscode.window.showInformationMessage(`AGC started: ${result.runId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start AGC: ${message}`);
        }
    });
    context.subscriptions.push(runAgcCmd);
    console.log('[Conductor Hub] Command conductor-hub.runAgc registered ✅');

    // ── STEP 2: 状态栏（最优先，确保始终可见）──────────────────────────────
    statusBar = new ConductorStatusBar(settings);
    context.subscriptions.push(statusBar.getItem());
    try {
        await statusBar.initialize();
    } catch (e) {
        console.error('[Conductor Hub] StatusBar initialize failed (bar still visible):', e);
    }
    console.log('[Conductor Hub] StatusBar created ✅');

    // ── STEP 3: 同步密钥 + 自动配置（每步独立 try-catch，不影响核心功能）──
    const dbFilePath = storage
        ? (storage as any).getDbPath?.() || ''
        : path.join(context.globalStorageUri.fsPath, 'history.db');
    try { await syncKeysToFile(settings, dbFilePath); } catch (e) { console.error('[Conductor Hub] syncKeysToFile failed:', e); }
    try { autoRegisterMcpConfig(context.extensionPath); } catch (e) { console.error('[Conductor Hub] autoRegisterMcpConfig failed:', e); }
    try { autoInstallSkill(context.extensionPath); } catch (e) { console.error('[Conductor Hub] autoInstallSkill failed:', e); }
    try { await autoInjectRoutingRules(settings); } catch (e) { console.error('[Conductor Hub] autoInjectRoutingRules failed:', e); }

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
    agcOrchestrator?.dispose();
}
