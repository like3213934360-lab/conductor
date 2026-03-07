/**
 * Conductor Hub VS Code — Dashboard WebView 面板
 *
 * 从 Conductor Hub webview-provider.ts 重构迁移。
 * 管理 WebView 面板生命周期 + webview ↔ extension 消息协议。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import type { SettingsManager } from './settings-manager.js';

/** 请求历史存储接口 — 解耦具体实现 */
export interface IHistoryStorage {
    queryHistory(page: number, pageSize: number): { records: HistoryRecord[]; total: number };
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

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _onConfigChanged?: () => void;
    private _modelTestCache: Map<string, 'online' | 'offline'> = new Map();

    public static createOrShow(
        extensionUri: vscode.Uri,
        storage: IHistoryStorage | null,
        settings: SettingsManager,
        onConfigChanged?: () => void,
    ) {
        const column = vscode.window.activeTextEditor?.viewColumn;
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'conductorDashboard', 'Conductor Hub',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                    vscode.Uri.joinPath(extensionUri, 'images'),
                ],
                retainContextWhenHidden: true,
            },
        );
        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, storage, settings, onConfigChanged);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private storage: IHistoryStorage | null,
        private settings: SettingsManager,
        onConfigChanged?: () => void,
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._onConfigChanged = onConfigChanged;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._setupMessageHandler();
    }

    /** webview → extension 消息协议 */
    private _setupMessageHandler() {
        this._panel.webview.onDidReceiveMessage(
            async (message: any) => {
                switch (message.command) {
                    // ── Legacy key management ────────────────────────────────
                    case 'getApiKeys': {
                        const keys = await this.settings.getAllApiKeys();
                        this._panel.webview.postMessage({ command: 'loadApiKeys', data: keys });
                        break;
                    }
                    case 'saveApiKey': {
                        if (message.provider && message.key !== undefined) {
                            await this.settings.saveApiKey(message.provider, message.key);
                        }
                        break;
                    }

                    // ── v2 Model management ──────────────────────────────────
                    case 'getModelsV2': {
                        const models = await this.settings.getModels();
                        const apiKeys = await this._collectModelApiKeys(models);
                        this._panel.webview.postMessage({ command: 'loadModelsV2', models, apiKeys });
                        break;
                    }
                    case 'addModel': {
                        await this.settings.addModel(message.modelConfig);
                        if (message.apiKey) {
                            await this.settings.saveApiKey(`model.${message.modelConfig.id}`, message.apiKey);
                        }
                        await this._syncModelsToFile();
                        await this._refreshModelsV2();
                        break;
                    }
                    case 'removeModel': {
                        await this.settings.removeModel(message.id);
                        await this._syncModelsToFile();
                        await this._refreshModelsV2();
                        break;
                    }
                    case 'updateModel': {
                        await this.settings.updateModel(message.id, message.patch);
                        if (message.apiKey !== undefined) {
                            await this.settings.saveApiKey(`model.${message.id}`, message.apiKey);
                        }
                        await this._syncModelsToFile();
                        await this._refreshModelsV2();
                        break;
                    }

                    // ── Connection test (bypass CORS) ────────────────────────
                    case 'testConnection': {
                        const { modelId, baseUrl, apiKey, requestId } = message;
                        try {
                            const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
                            const res = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
                                body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
                                signal: AbortSignal.timeout(15000),
                            });
                            const json = await res.json() as any;
                            if (res.ok) {
                                this._panel.webview.postMessage({ command: 'testResult', requestId, ok: true, msg: '已连通' });
                            } else {
                                const err = json?.error?.message || json?.message || `HTTP ${res.status}`;
                                this._panel.webview.postMessage({ command: 'testResult', requestId, ok: false, msg: (err as string).substring(0, 70) });
                            }
                        } catch (e: any) {
                            const msg = e.message?.includes('timeout') ? '超时 15s' : (e.message || 'Error').substring(0, 60);
                            this._panel.webview.postMessage({ command: 'testResult', requestId, ok: false, msg });
                        }
                        break;
                    }

                    // ── History ───────────────────────────────────────────────
                    case 'getHistory': {
                        if (!this.storage) break;
                        const data = this.storage.queryHistory(message.page || 1, message.pageSize || 50);
                        this._panel.webview.postMessage({ command: 'loadHistory', data });
                        break;
                    }

                    // ── Utility ──────────────────────────────────────────────
                    case 'openUrl':
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                        break;
                    case 'copyToClipboard':
                        vscode.env.clipboard.writeText(message.text || '');
                        break;
                    case 'openTerminalWithCmd': {
                        const terminal = vscode.window.createTerminal('ArkTS Setup');
                        terminal.show();
                        terminal.sendText(message.cmd);
                        break;
                    }

                    // ── Diagnostics ──────────────────────────────────────────
                    case 'generateDiagnostics': {
                        const models = await this.settings.getModels();
                        const enabledCount = models.filter(m => m.enabled).length;
                        const codexVer = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true });
                        const geminiVer = spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true });
                        const report = [
                            '## Conductor Hub 诊断报告',
                            `- 时间: ${new Date().toISOString()}`,
                            `- 已配置模型: ${models.length} 个（${enabledCount} 个已启用）`,
                            `- Codex CLI: ${codexVer.error ? '未安装' : (codexVer.stdout || '').trim()}`,
                            `- Gemini CLI: ${geminiVer.error ? '未安装' : (geminiVer.stdout || '').trim()}`,
                        ].join('\n');
                        vscode.env.clipboard.writeText(report);
                        vscode.window.showInformationMessage('诊断报告已复制到剪贴板');
                        break;
                    }

                    // ── CLI status ────────────────────────────────────────────
                    case 'getCodexStatus': {
                        const ver = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000, shell: true });
                        if (ver.error) {
                            this._panel.webview.postMessage({ command: 'codexStatus', installed: false, loggedIn: false });
                        } else {
                            const version = (ver.stdout || '').trim();
                            this._panel.webview.postMessage({ command: 'codexStatus', installed: true, version, loggedIn: true });
                        }
                        break;
                    }
                    case 'getGeminiStatus': {
                        const gVer = spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 5000, shell: true });
                        if (gVer.error) {
                            this._panel.webview.postMessage({ command: 'geminiStatus', installed: false, loggedIn: false });
                        } else {
                            const gVersion = (gVer.stdout || '').trim();
                            const credPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
                            const loggedIn = fs.existsSync(credPath);
                            this._panel.webview.postMessage({ command: 'geminiStatus', installed: true, version: gVersion, loggedIn });
                        }
                        break;
                    }

                    // ── Overview Stats ────────────────────────────────────────
                    case 'getOverviewStats': {
                        await this._handleOverviewStats();
                        break;
                    }

                    // ── Test All Models ───────────────────────────────────────
                    case 'testAllModels': {
                        await this._handleTestAllModels();
                        break;
                    }
                }
            },
            null,
            this._disposables,
        );
    }

    /** 概览面板统计数据 */
    private async _handleOverviewStats() {
        const allModels = await this.settings.getModels();
        const modelStatuses: any[] = [];
        for (const m of allModels) {
            const key = await this.settings.getApiKey(`model.${m.id}`);
            modelStatuses.push({
                id: m.id, label: m.label || m.modelId, modelId: m.modelId,
                group: (m as any).group || '', enabled: m.enabled !== false,
                status: this._modelTestCache.get(m.id) || (key ? 'unknown' : 'offline'),
                testMsg: key ? undefined : 'No API Key',
            });
        }

        let todayRequests = 0, successCount = 0, totalLatency = 0, totalTokens = 0;
        const recentRequests: any[] = [];
        const tokenMap = new Map<string, number>();
        try {
            if (this.storage) {
                const data = this.storage.queryHistory(1, 200);
                const todayTs = new Date().setHours(0, 0, 0, 0);
                for (const r of data.records) {
                    if (r.timestamp >= todayTs) {
                        todayRequests++;
                        if (r.status === 'success') successCount++;
                        totalLatency += r.duration || 0;
                        const rTokens = r.totalTokens || 0;
                        totalTokens += rTokens;
                        // 按 model 分组统计 token
                        if (rTokens > 0 && r.model) {
                            const existing = tokenMap.get(r.model) || 0;
                            tokenMap.set(r.model, existing + rTokens);
                        }
                    }
                }
                for (const r of data.records.slice(0, 8)) {
                    recentRequests.push({
                        id: r.id, timestamp: r.timestamp, method: r.method,
                        model: r.model || '', duration: r.duration || 0,
                        status: r.status, totalTokens: r.totalTokens || 0,
                    });
                }
            }
        } catch { /* storage might not be available */ }

        // Provider 颜色映射
        const PROVIDER_COLORS: Record<string, string> = {
            'DeepSeek': '#4A90D9', 'deepseek': '#4A90D9',
            'GLM': '#8B5CF6', 'glm': '#8B5CF6',
            'Qwen': '#F97316', 'qwen': '#F97316',
            'OpenAI': '#10A37F', 'gpt': '#10A37F', 'codex': '#10A37F',
            'Claude': '#D97706', 'claude': '#D97706',
            'Gemini': '#4285F4', 'gemini': '#4285F4',
            'Mistral': '#FF6F00', 'mistral': '#FF6F00',
        };
        const getProviderColor = (model: string): string => {
            const lower = model.toLowerCase();
            for (const [key, color] of Object.entries(PROVIDER_COLORS)) {
                if (lower.includes(key.toLowerCase())) return color;
            }
            return '#6B7280';
        };
        const tokensByProvider = Array.from(tokenMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([model, tokens]) => ({
                provider: model,
                label: model,
                tokens,
                color: getProviderColor(model),
            }));

        // ── Codex CLI token 统计 (读取本地 SQLite) ─────────────────────────
        try {
            const codexDbPath = path.join(os.homedir(), '.codex', 'state_5.sqlite');
            if (fs.existsSync(codexDbPath)) {
                // 查询今日各 model_provider 的 token 总量
                const sqlResult = spawnSync('sqlite3', [
                    codexDbPath,
                    '-separator', '|',
                    `SELECT model_provider, SUM(tokens_used) FROM threads WHERE date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime') GROUP BY model_provider;`,
                ], { encoding: 'utf8', timeout: 5000 });

                if (!sqlResult.error && sqlResult.stdout) {
                    for (const line of sqlResult.stdout.trim().split('\n')) {
                        if (!line) continue;
                        const parts = line.split('|');
                        if (parts.length >= 2) {
                            const provider = parts[0] || 'unknown';
                            const tokens = parseInt(parts[1], 10) || 0;
                            if (tokens > 0) {
                                totalTokens += tokens;
                                tokensByProvider.push({
                                    provider: `codex-cli:${provider}`,
                                    label: `Codex CLI (${provider === 'openai' ? 'OpenAI' : provider})`,
                                    tokens,
                                    color: '#10A37F', // OpenAI 绿
                                });
                            }
                        }
                    }
                }
            }
        } catch { /* Codex CLI 数据不可用不影响核心功能 */ }

        // ── Gemini CLI token 统计 (读取本地会话 JSON) ──────────────────────
        try {
            const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
            if (fs.existsSync(geminiTmpDir)) {
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayMs = todayStart.getTime();
                const geminiTokenMap = new Map<string, number>();

                // 遍历所有项目目录下的 chats 目录
                for (const projectDir of fs.readdirSync(geminiTmpDir)) {
                    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
                    if (!fs.existsSync(chatsDir) || !fs.statSync(chatsDir).isDirectory()) continue;

                    for (const file of fs.readdirSync(chatsDir)) {
                        if (!file.endsWith('.json')) continue;
                        const filePath = path.join(chatsDir, file);
                        // 按文件修改时间粗筛今日文件
                        const stat = fs.statSync(filePath);
                        if (stat.mtimeMs < todayMs) continue;

                        try {
                            const session = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (!session.messages || !Array.isArray(session.messages)) continue;
                            for (const msg of session.messages) {
                                if (msg.tokens && typeof msg.tokens.total === 'number' && msg.tokens.total > 0) {
                                    const model = msg.model || 'gemini';
                                    const existing = geminiTokenMap.get(model) || 0;
                                    geminiTokenMap.set(model, existing + msg.tokens.total);
                                }
                            }
                        } catch { /* 单个文件解析失败跳过 */ }
                    }
                }

                // 合并到 tokensByProvider
                for (const [model, tokens] of geminiTokenMap) {
                    totalTokens += tokens;
                    tokensByProvider.push({
                        provider: `gemini-cli:${model}`,
                        label: `Gemini CLI (${model})`,
                        tokens,
                        color: '#4285F4', // Google 蓝
                    });
                }
            }
        } catch { /* Gemini CLI 数据不可用不影响核心功能 */ }

        // 按 token 量重新排序
        tokensByProvider.sort((a, b) => b.tokens - a.tokens);

        // CLI statuses
        const codexVer = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true });
        const geminiVer = spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true });
        const gCredPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
        const cliStatuses = [
            {
                id: 'codex-cli', label: 'Codex CLI', modelId: 'codex-cli', group: 'cli', enabled: true,
                status: codexVer.error ? 'offline' : 'online',
                testMsg: codexVer.error ? '未安装' : `v${(codexVer.stdout || '').trim()}`,
            },
            {
                id: 'gemini-cli', label: 'Gemini CLI', modelId: 'gemini-cli', group: 'cli', enabled: true,
                status: geminiVer.error ? 'offline' : 'online',
                testMsg: geminiVer.error ? '未安装' : (fs.existsSync(gCredPath) ? `v${(geminiVer.stdout || '').trim()} · 已登录` : `v${(geminiVer.stdout || '').trim()} · 未登录`),
            },
        ];

        const successRate = todayRequests > 0 ? Math.round((successCount / todayRequests) * 100) : 100;
        const avgLatency = todayRequests > 0 ? Math.round(totalLatency / todayRequests) : 0;

        this._panel.webview.postMessage({
            command: 'overviewStats',
            stats: {
                models: [...modelStatuses, ...cliStatuses],
                todayRequests, successRate, avgLatency, totalTokens, tokensByProvider, recentRequests,
            },
        });
    }

    /** 批量测试所有启用模型 */
    private async _handleTestAllModels() {
        const models = await this.settings.getModels();
        const enabled = models.filter(m => m.enabled !== false);
        for (let i = 0; i < enabled.length; i++) {
            const m = enabled[i];
            if (i > 0) await new Promise(r => setTimeout(r, 1500));
            const key = await this.settings.getApiKey(`model.${m.id}`);
            if (!key || !m.baseUrl) continue;
            const requestId = `autotest_${m.id}_${Date.now()}`;
            try {
                const url = m.baseUrl.replace(/\/$/, '') + '/chat/completions';
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
                    body: JSON.stringify({ model: m.modelId, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
                    signal: AbortSignal.timeout(15000),
                });
                const json = await res.json() as any;
                if (res.ok) {
                    this._modelTestCache.set(m.id, 'online');
                    this._panel.webview.postMessage({ command: 'testResult', requestId, ok: true, msg: '已连通' });
                } else {
                    this._modelTestCache.set(m.id, 'offline');
                    const err = json?.error?.message || json?.message || `HTTP ${res.status}`;
                    this._panel.webview.postMessage({ command: 'testResult', requestId, ok: false, msg: (err as string).substring(0, 70) });
                }
            } catch (e: any) {
                this._modelTestCache.set(m.id, 'offline');
                const msg = e.message?.includes('timeout') ? '超时 15s' : (e.message || 'Error').substring(0, 60);
                this._panel.webview.postMessage({ command: 'testResult', requestId, ok: false, msg });
            }
        }
        this._panel.webview.postMessage({ command: 'testAllComplete' });
    }

    /** 收集所有模型的 API Key */
    private async _collectModelApiKeys(models: any[]): Promise<Record<string, string>> {
        const apiKeys: Record<string, string> = {};
        for (const m of models) {
            const k = await this.settings.getApiKey(`model.${m.id}`);
            if (k) { apiKeys[m.id] = k; }
        }
        return apiKeys;
    }

    /** 刷新 v2 模型列表并通知 webview */
    private async _refreshModelsV2() {
        const models = await this.settings.getModels();
        const apiKeys = await this._collectModelApiKeys(models);
        this._panel.webview.postMessage({ command: 'loadModelsV2', models, apiKeys });
        this._onConfigChanged?.();
    }

    /** 同步模型配置到文件系统 (供 standalone mcp-server 读取) */
    private async _syncModelsToFile() {
        const KEYS_FILE = path.join(os.homedir(), '.conductor-hub-keys.json');
        try {
            const models = await this.settings.getModels();
            const enriched: any[] = [];
            for (const m of models) {
                const k = await this.settings.getApiKey(`model.${m.id}`);
                enriched.push({ ...m, apiKey: k || '' });
            }
            const legacy = await this.settings.getAllApiKeys();
            const dbPath = this.storage?.getDbPath() || '';
            fs.writeFileSync(KEYS_FILE, JSON.stringify({ version: 2, models: enriched, legacy, dbPath }, null, 2), 'utf8');
        } catch (e) {
            console.error('[Conductor Hub] Failed to sync models to file:', e);
        }
    }

    public dispose() {
        DashboardPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; connect-src https: wss:;">
    <title>Conductor Hub</title>
    <style>
        body { padding:0; margin:0; background-color:var(--vscode-editor-background); color:var(--vscode-editor-foreground); font-family:var(--vscode-font-family); height:100vh; display:flex; flex-direction:column; }
        #root { flex:1; display:flex; flex-direction:column; overflow:hidden; }
        @keyframes pulse-glow { 0%,100%{box-shadow:0 0 4px currentColor;opacity:1} 50%{box-shadow:0 0 12px currentColor,0 0 24px currentColor;opacity:.85} }
        @keyframes gradient-shift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes fade-in-up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        .animate-in{animation:fade-in-up .4s ease-out both}
        .animate-in-1{animation-delay:.05s} .animate-in-2{animation-delay:.1s} .animate-in-3{animation-delay:.15s} .animate-in-4{animation-delay:.2s}
        .dot-online{animation:pulse-glow 2s ease-in-out infinite;color:#34A853}
        .gradient-bg{background-size:200% 200%;animation:gradient-shift 6s ease infinite}
        .shimmer-bar{background:linear-gradient(90deg,transparent 30%,rgba(255,255,255,.08) 50%,transparent 70%);background-size:200% 100%;animation:shimmer 2s ease-in-out infinite}
        ::-webkit-scrollbar{width:6px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}
    </style>
</head>
<body>
    <div id="root" data-logo-uri="${logoUri}"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
