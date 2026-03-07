/**
 * Conductor Hub — 状态栏管理器
 *
 * 从 Conductor Hub extension.ts 的 updateStatusBar 提取。
 * 事件驱动: 配置变更时自动刷新，替代原始轮询 timer (架构优化)。
 */

import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import type { SettingsManager } from './settings-manager.js';

export class ConductorStatusBar {
    private item: vscode.StatusBarItem;
    private refreshTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private settings: SettingsManager,
        private commandId: string = 'conductor-hub.openPanel',
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = this.commandId;
        this.item.name = 'Conductor Hub';
    }

    /** 获取底层 StatusBarItem (供 context.subscriptions 注册) */
    public getItem(): vscode.StatusBarItem {
        return this.item;
    }

    /** 初始刷新 + 启动周期刷新 (60s) */
    public async initialize() {
        await this.refresh();
        this.refreshTimer = setInterval(() => this.refresh(), 60_000);
    }

    /** 手动触发刷新 (配置变更时调用) */
    public async refresh() {
        try {
            const models = await this.settings.getModels();
            const modelStatuses: Array<{ label: string; enabled: boolean; hasKey: boolean }> = [];
            for (const m of models) {
                const key = await this.settings.getModelApiKey(m.id);
                modelStatuses.push({ label: m.label, enabled: m.enabled, hasKey: !!key });
            }

            const ready = modelStatuses.filter(m => m.enabled && m.hasKey);
            const total = modelStatuses.length;
            const readyCount = ready.length;

            // 图标 & 颜色
            let icon: string;
            let color: vscode.ThemeColor | undefined;
            if (readyCount === 0) {
                icon = '$(error)'; color = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (readyCount < total) {
                icon = '$(warning)'; color = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                icon = '$(pulse)'; color = undefined;
            }

            // 文本
            if (readyCount === 0) {
                this.item.text = `${icon} ArkTS: 未配置`;
            } else if (readyCount < total) {
                this.item.text = `${icon} ArkTS: ${readyCount}/${total} 就绪`;
            } else {
                this.item.text = `${icon} ArkTS: ${readyCount} 模型就绪`;
            }
            this.item.backgroundColor = color;

            // 富 Tooltip
            const tooltip = new vscode.MarkdownString('', true);
            tooltip.isTrusted = true;
            tooltip.supportHtml = true;
            tooltip.appendMarkdown('### 🔌 Conductor Hub 模型状态\n\n');
            if (modelStatuses.length === 0) {
                tooltip.appendMarkdown('_未配置任何模型。请打开 Dashboard 添加。_\n\n');
            } else {
                for (const m of modelStatuses) {
                    const status = (m.enabled && m.hasKey) ? '✅' : '❌';
                    const note = !m.hasKey ? ' — 未配置 Key' : (!m.enabled ? ' — 已禁用' : '');
                    tooltip.appendMarkdown(`${status} **${m.label}**${note}  \n`);
                }
                tooltip.appendMarkdown('\n---\n\n');
            }

            // CLI 检测
            const codexOk = !spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 3000 }).error;
            const geminiOk = !spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 3000 }).error;
            tooltip.appendMarkdown(`🤖 Codex CLI: ${codexOk ? '✅ 已安装' : '❌ 未安装'}  \n`);
            tooltip.appendMarkdown(`🔷 Gemini CLI: ${geminiOk ? '✅ 已安装' : '❌ 未安装'}  \n`);
            tooltip.appendMarkdown('\n---\n\n_点击打开 Dashboard_');

            this.item.tooltip = tooltip;
            this.item.show();
        } catch (err) {
            console.error('[Conductor Hub] StatusBar refresh error:', err);
            this.item.text = '$(error) Conductor Hub';
            this.item.tooltip = 'Conductor Hub: 状态获取失败';
            this.item.show();
        }
    }

    /** 清理 */
    public dispose() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }
}
