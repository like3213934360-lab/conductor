/**
 * Conductor Hub — 状态栏管理器
 *
 * 从 Conductor Hub extension.ts 的 updateStatusBar 提取。
 * 事件驱动: 配置变更时自动刷新，替代原始轮询 timer (架构优化)。
 */
import * as vscode from 'vscode';
import type { SettingsManager } from './settings-manager.js';
export declare class ConductorStatusBar {
    private settings;
    private commandId;
    private item;
    private refreshTimer;
    constructor(settings: SettingsManager, commandId?: string);
    /** 获取底层 StatusBarItem (供 context.subscriptions 注册) */
    getItem(): vscode.StatusBarItem;
    /** 初始刷新 + 启动周期刷新 (60s) */
    initialize(): Promise<void>;
    /** 手动触发刷新 (配置变更时调用) */
    refresh(): Promise<void>;
    /** 清理 */
    dispose(): void;
}
//# sourceMappingURL=status-bar.d.ts.map