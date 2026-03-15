/**
 * Antigravity — 状态栏管理器
 *
 * 事件驱动的状态栏刷新器。
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SettingsManager } from './settings-manager.js';

const execFileAsync = promisify(execFile);

export class AntigravityStatusBar {
    private item: vscode.StatusBarItem;
    private refreshTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private settings: SettingsManager,
        private commandId: string = 'antigravity.openPanel',
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = this.commandId;
        this.item.name = 'Antigravity Workflow';
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
                this.item.text = `${icon} Antigravity Workflow: 未配置`;
            } else if (readyCount < total) {
                this.item.text = `${icon} Antigravity Workflow: ${readyCount}/${total} 就绪`;
            } else {
                this.item.text = `${icon} Antigravity Workflow: ${readyCount} 模型就绪`;
            }
            this.item.backgroundColor = color;

            // 富 Tooltip
            const tooltip = new vscode.MarkdownString('', true);
            tooltip.isTrusted = true;
            tooltip.supportHtml = true;
            tooltip.appendMarkdown('### 🔌 Antigravity Workflow 模型状态\n\n');
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

            // CLI 检测 (异步，不阻塞 Extension Host 主线程)
            let codexOk = false;
            let geminiOk = false;
            try {
                await execFileAsync('codex', ['--version'], { encoding: 'utf8', timeout: 3000 });
                codexOk = true;
            } catch { /* not installed or timeout */ }
            try {
                await execFileAsync('gemini', ['--version'], { encoding: 'utf8', timeout: 3000 });
                geminiOk = true;
            } catch { /* not installed or timeout */ }
            tooltip.appendMarkdown(`🤖 Codex CLI: ${codexOk ? '✅ 已安装' : '❌ 未安装'}  \n`);
            tooltip.appendMarkdown(`🔷 Gemini CLI: ${geminiOk ? '✅ 已安装' : '❌ 未安装'}  \n`);
            tooltip.appendMarkdown('\n---\n\n_点击打开 Dashboard_');

            this.item.tooltip = tooltip;
            this.item.show();
        } catch (err) {
            console.error('[Antigravity Workflow] StatusBar refresh error:', err);
            this.item.text = '$(error) Antigravity Workflow';
            this.item.tooltip = 'Antigravity Workflow: 状态获取失败';
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
