/**
 * Conductor Hub VS Code — Dashboard WebView 面板
 *
 * 从 Conductor Hub webview-provider.ts 重构迁移。
 * 管理 WebView 面板生命周期 + webview ↔ extension 消息协议。
 */
import * as vscode from 'vscode';
import type { SettingsManager } from './settings-manager.js';
/** 请求历史存储接口 — 解耦具体实现 */
export interface IHistoryStorage {
    queryHistory(page: number, pageSize: number): {
        records: HistoryRecord[];
        total: number;
    };
    getDbPath(): string;
}
export interface HistoryRecord {
    id: string;
    timestamp: number;
    method: string;
    model?: string;
    duration: number;
    status: 'success' | 'error';
    totalTokens?: number;
    toolName?: string;
    inputTokens?: number;
    outputTokens?: number;
    requestPreview: string;
    responsePreview: string;
    errorMessage?: string;
    clientName: string;
    clientVersion: string;
}
export declare class DashboardPanel {
    private storage;
    private settings;
    static currentPanel: DashboardPanel | undefined;
    private readonly _panel;
    private readonly _extensionUri;
    private _disposables;
    private _onConfigChanged?;
    private _modelTestCache;
    static createOrShow(extensionUri: vscode.Uri, storage: IHistoryStorage | null, settings: SettingsManager, onConfigChanged?: () => void): void;
    private constructor();
    /** webview → extension 消息协议 */
    private _setupMessageHandler;
    /** 概览面板统计数据 */
    private _handleOverviewStats;
    /** 批量测试所有启用模型 */
    private _handleTestAllModels;
    /** 收集所有模型的 API Key */
    private _collectModelApiKeys;
    /** 刷新 v2 模型列表并通知 webview */
    private _refreshModelsV2;
    /** 同步模型配置到文件系统 (供 standalone mcp-server 读取) */
    private _syncModelsToFile;
    dispose(): void;
    private _update;
    private _getHtmlForWebview;
}
//# sourceMappingURL=dashboard-panel.d.ts.map