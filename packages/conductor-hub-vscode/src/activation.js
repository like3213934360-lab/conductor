"use strict";
/**
 * Conductor Hub VS Code — 激活入口
 *
 * 组装 SettingsManager / DashboardPanel / StatusBar / AutoConfig / WsMcpServer。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activateConductorHub = activateConductorHub;
exports.deactivateConductorHub = deactivateConductorHub;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const settings_manager_js_1 = require("./settings-manager.js");
const dashboard_panel_js_1 = require("./dashboard-panel.js");
const status_bar_js_1 = require("./status-bar.js");
const ws_mcp_server_js_1 = require("./ws-mcp-server.js");
const auto_config_js_1 = require("./auto-config.js");
let statusBar;
let wsMcpServer;
/**
 * 在宿主扩展的 activate() 中调用此函数以初始化 Conductor Hub 全部功能。
 *
 * @param context VS Code 扩展上下文
 * @param extensionUri 扩展根 URI (用于定位 webview 资源)
 * @param storage 可选的历史存储实例 (由宿主 extension 初始化)
 */
async function activateConductorHub(context, extensionUri, storage) {
    console.log('[Conductor Hub] Activating...');
    const settings = new settings_manager_js_1.SettingsManager(context);
    // ── STEP 1: 注册 Dashboard 命令 ──────────────────────────────────────────
    const openPanelCmd = vscode.commands.registerCommand('conductor-hub.openPanel', () => {
        if (!storage) {
            console.log('[Conductor Hub] History storage not provided — history features disabled.');
        }
        dashboard_panel_js_1.DashboardPanel.createOrShow(extensionUri, storage || null, settings, () => statusBar?.refresh());
    });
    context.subscriptions.push(openPanelCmd);
    console.log('[Conductor Hub] Command conductor-hub.openPanel registered ✅');
    // ── STEP 2: 同步密钥 + 自动配置 ─────────────────────────────────────────
    const dbFilePath = storage
        ? storage.getDbPath?.() || ''
        : path.join(context.globalStorageUri.fsPath, 'history.db');
    await (0, auto_config_js_1.syncKeysToFile)(settings, dbFilePath);
    (0, auto_config_js_1.autoRegisterMcpConfig)(context.extensionPath);
    (0, auto_config_js_1.autoInstallSkill)(context.extensionPath);
    (0, auto_config_js_1.autoInstallAgcWorkflow)(context.extensionPath);
    await (0, auto_config_js_1.autoInjectRoutingRules)(settings);
    // ── STEP 3: 状态栏 ─────────────────────────────────────────────────────
    statusBar = new status_bar_js_1.ConductorStatusBar(settings);
    context.subscriptions.push(statusBar.getItem());
    await statusBar.initialize();
    console.log('[Conductor Hub] StatusBar created ✅');
    // ── STEP 4: WebSocket MCP Server (非关键) ───────────────────────────────
    try {
        wsMcpServer = new ws_mcp_server_js_1.ConductorWsMcpServer(storage || null, settings);
        await wsMcpServer.start();
        console.log('[Conductor Hub] WS MCP server started ✅');
    }
    catch (err) {
        console.error('[Conductor Hub] WS server failed (non-critical):', err);
    }
    console.log('[Conductor Hub] Activation complete ✅');
}
/**
 * 在宿主扩展的 deactivate() 中调用
 */
function deactivateConductorHub() {
    statusBar?.dispose();
    wsMcpServer?.stop();
}
//# sourceMappingURL=activation.js.map