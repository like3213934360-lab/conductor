/**
 * Antigravity Workflow VS Code — Dashboard WebView 面板
 *
 * Antigravity / Antigravity Workflow Dashboard 面板。
 * 管理 WebView 生命周期 + webview ↔ extension 消息协议。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import type { SettingsManager } from './settings-manager.js';
import type { WorkflowOrchestrator } from './workflow-orchestrator.js';
import type { ArktsLspControlSurface } from './arkts-lsp-surface.js';

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

interface ArktsLspStatusPayload {
    enabled: boolean;
    state: 'disabled' | 'starting' | 'running' | 'error';
    message: string;
    workspaceRoot?: string;
    devecoDetected: boolean;
}

export class DashboardPanel {
    public static currentPanel: DashboardPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _onConfigChanged?: () => void;
    private _modelTestCache: Map<string, 'online' | 'offline'> = new Map();
    private _workflowBenchmarkState: any = null;
    private _workflowInteropState: any = null;
    private _workflowReleaseArtifactsState: any = null;
    private _workflowReleaseArtifactsVerification: any = null;
    private _workflowPolicyReportState: any = null;
    private _workflowInvariantReportState: any = null;
    private _workflowReleaseBundleState: any = null;
    private _workflowReleaseDossierState: any = null;
    private _workflowCertificationRecordState: any = null;
    private _workflowRemoteWorkersState: any = null;
    private _workflowTrustRegistryState: any = null;
    private _workflowBenchmarkSourceRegistryState: any = null;
    private _taskStreamDisposable?: vscode.Disposable;
    private _streamedTaskId?: string;

    public static createOrShow(
        extensionUri: vscode.Uri,
        storage: IHistoryStorage | null,
        settings: SettingsManager,
        workflowOrchestrator: WorkflowOrchestrator,
        arktsLspController: ArktsLspControlSurface | undefined,
        onConfigChanged?: () => void,
    ) {
        const column = vscode.window.activeTextEditor?.viewColumn;
        if (DashboardPanel.currentPanel) {
            DashboardPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'antigravityDashboard', 'Antigravity Workflow',
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
        DashboardPanel.currentPanel = new DashboardPanel(panel, extensionUri, storage, settings, workflowOrchestrator, arktsLspController, onConfigChanged);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private storage: IHistoryStorage | null,
        private settings: SettingsManager,
        private workflowOrchestrator: WorkflowOrchestrator,
        private arktsLspController: ArktsLspControlSurface | undefined,
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
                    // ── Model management ─────────────────────────────────────
                    case 'getModels': {
                        const models = await this.settings.getModels();
                        const apiKeys = await this._collectModelApiKeys(models);
                        this._panel.webview.postMessage({ command: 'loadModels', models, apiKeys });
                        break;
                    }
                    case 'getArktsLspStatus': {
                        const status = this.arktsLspController?.getStatus() ?? {
                            enabled: false,
                            state: 'disabled',
                            message: 'ArkTS LSP controller unavailable',
                            devecoDetected: false,
                        };
                        this._panel.webview.postMessage({ command: 'loadArktsLspStatus', status });
                        break;
                    }
                    case 'setArktsLspEnabled': {
                        const enabled = message.enabled === true;
                        await this.settings.setArktsLspEnabled(enabled);
                        const status = this.arktsLspController
                            ? await this.arktsLspController.setEnabled(enabled)
                            : {
                                enabled: false,
                                state: 'disabled',
                                message: 'ArkTS LSP controller unavailable',
                                devecoDetected: false,
                            };
                        this._panel.webview.postMessage({ command: 'loadArktsLspStatus', status });
                        break;
                    }
                    case 'addModel': {
                        await this.settings.addModel(message.modelConfig);
                        if (message.apiKey) {
                            await this.settings.storeModelApiKey(message.modelConfig.id, message.apiKey);
                        }
                        await this._syncModelCatalogToFile();
                        await this._refreshModels();
                        break;
                    }
                    case 'removeModel': {
                        await this.settings.removeModel(message.id);
                        await this._syncModelCatalogToFile();
                        await this._refreshModels();
                        break;
                    }
                    case 'updateModel': {
                        await this.settings.updateModel(message.id, message.patch);
                        if (message.apiKey !== undefined) {
                            await this.settings.storeModelApiKey(message.id, message.apiKey);
                        }
                        await this._syncModelCatalogToFile();
                        await this._refreshModels();
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
                        const terminal = vscode.window.createTerminal('Antigravity Workflow Setup');
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
                            '## Antigravity Workflow 诊断报告',
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

                    // ── CLI Ecosystem Discovery (two-phase) ─────────────────
                    case 'getEcosystem': {
                        try {
                            const home = os.homedir();
                            // ── Built-in description registry ──
                            const DESC: Record<string, string> = {
                                // ── 文件 & 系统 ──
                                'filesystem': '文件系统操作 — 安全读写、搜索、目录遍历，智能限制大文件和深层目录',
                                'everything': '桌面文件搜索引擎集成（Everything / Spotlight）',
                                // ── 知识 & 文档 ──
                                'context7': '实时查询任意编程库的最新文档和代码示例',
                                'memory': '知识图谱持久化记忆 — 跨会话存储实体和关系',
                                'rag': '检索增强生成 — 向量数据库文档检索与问答',
                                // ── 浏览器 & 测试 ──
                                'playwright': '浏览器自动化 — Playwright 驱动的 Web 测试、截图、表单填写',
                                'chrome': 'Chrome DevTools 控制 — DOM 检查、网络监控、性能分析、控制台',
                                'puppeteer': 'Puppeteer 浏览器自动化 — 页面操控、截图、PDF 生成',
                                'browserbase': '云端浏览器基础设施 — 远程浏览器会话和自动化',
                                // ── 设计 ──
                                'pencil': '.pen 可视化设计文件编辑器 — UI 原型设计与组件管理',
                                'figma': 'Figma 设计文件读取 — 组件、样式、布局信息提取',
                                // ── 代码 & 开发 ──
                                'github': 'GitHub API — 仓库管理、Issue、PR、代码搜索、文件读写',
                                'gitlab': 'GitLab API — 仓库、合并请求、CI/CD 管道管理',
                                'git': 'Git 版本控制操作 — 提交、分支、日志、差异对比',
                                'code-review': 'AI 代码审查 — 通过外部 LLM 进行代码质量分析和缺陷检测',
                                'linear': 'Linear 项目管理 — Issue 跟踪、Sprint 规划、团队协作',
                                // ── 编排 & 推理 ──
                                'conductor': '多模型编排引擎 — Deno 沙盒中安全执行代码，可调用所有 MCP 工具',
                                'antigravity-swarm': '多 Agent 蜂群执行 — 并行任务分发与协调',
                                'criticalthink': '批判性思维与深度分析 — 结构化论证和反思',
                                'skill-porter': '技能迁移与移植 — 跨平台技能文件转换工具',
                                'sequential-thinking': '动态推理链 — 逐步思考，支持修正、分支和回溯',
                                'reasoning': '深度推理引擎 — 复杂问题分解与逻辑推理',
                                // ── 网络 & API ──
                                'fetch': 'HTTP 请求工具 — 网页抓取与 API 调用，兼容 robots.txt',
                                'brave-search': 'Brave 搜索引擎 — 网页搜索和本地搜索',
                                'tavily': 'Tavily AI 搜索 — 针对 AI 优化的实时网络搜索',
                                'exa': 'Exa 语义搜索 — 基于含义的网页和内容搜索',
                                // ── 数据库 ──
                                'postgres': 'PostgreSQL 数据库 — SQL 查询、Schema 检查、数据管理',
                                'sqlite': 'SQLite 数据库 — 轻量级本地数据库读写和查询',
                                'supabase': 'Supabase 后端服务 — 数据库、认证、存储管理',
                                'redis': 'Redis 缓存与数据结构 — 键值存储、发布订阅',
                                // ── 云服务 ──
                                'aws': 'AWS 云服务 — S3、Lambda、EC2 等 AWS 资源管理',
                                'cloudflare': 'Cloudflare 服务 — Workers、KV、D1、R2 资源管理',
                                'vercel': 'Vercel 部署平台 — 项目部署、环境变量、域名管理',
                                // ── 通讯 & 协作 ──
                                'slack': 'Slack 团队通讯 — 消息发送、频道管理、搜索',
                                'discord': 'Discord 社区管理 — 消息、频道、服务器操作',
                                'notion': 'Notion 知识库 — 页面、数据库、内容管理',
                                'google-drive': 'Google Drive 文件管理 — 搜索、读写、共享',
                                'google-maps': 'Google 地图 — 地理编码、路线规划、地点搜索',
                                // ── 其他工具 ──
                                'time': '时间工具 — 时区转换、时间计算',
                                'docker': 'Docker 容器管理 — 镜像、容器、网络操作',
                                'kubernetes': 'Kubernetes 集群管理 — Pod、Service、部署操作',
                                'sentry': 'Sentry 错误监控 — 异常追踪、性能监控',
                            };

                            type EcoItem = { name: string; description: string; source: 'builtin' | 'local' | 'npm' | 'pypi' | 'ai'; npmPkg?: string; pypiPkg?: string };

                            // ── Extract package name from command/args ──
                            const extractPkg = (cmd: string, args: string[]): { name: string; type: 'npm' | 'pypi' } | null => {
                                // npx -y @scope/pkg → @scope/pkg (npm)
                                if (cmd === 'npx' || cmd === 'npx.cmd') {
                                    for (const a of args) {
                                        if (a.startsWith('@') || (!a.startsWith('-') && !a.startsWith('/') && a.includes('-'))) {
                                            return { name: a, type: 'npm' };
                                        }
                                    }
                                }
                                // uvx mcp-server-xxx → mcp-server-xxx (PyPI)
                                if (cmd === 'uvx' || cmd === 'uv') {
                                    for (const a of args) {
                                        if (!a.startsWith('-') && a.includes('-')) return { name: a, type: 'pypi' };
                                    }
                                }
                                // python -m module_name → module_name (PyPI)
                                if (cmd === 'python' || cmd === 'python3') {
                                    const mIdx = args.indexOf('-m');
                                    if (mIdx >= 0 && args[mIdx + 1]) return { name: args[mIdx + 1], type: 'pypi' };
                                }
                                // .bin/context7-mcp → try the base name (npm)
                                if (cmd.includes('.bin/')) {
                                    const base = cmd.split('.bin/').pop();
                                    return base ? { name: base, type: 'npm' } : null;
                                }
                                // direct command like mcp-server-filesystem
                                if (!cmd.startsWith('/') && cmd.includes('-')) {
                                    return { name: cmd, type: 'npm' };
                                }
                                return null;
                            };

                            // ── Resolve package.json from command/args paths ──
                            const findLocalPkgJson = (cmd: string, args: string[]): { name?: string; description?: string } | null => {
                                try {
                                    const candidates: string[] = [];
                                    // Check args for .js/.mjs/.cjs file paths
                                    for (const a of args) {
                                        if (/\.[cm]?js$/.test(a) && (a.startsWith('/') || a.startsWith('.'))) {
                                            candidates.push(path.dirname(a));
                                        }
                                    }
                                    // Check command if it's a full path (not npx/node)
                                    if (cmd.startsWith('/') && !cmd.endsWith('/node') && !cmd.endsWith('/npx')) {
                                        candidates.push(path.dirname(cmd));
                                    }
                                    // Walk up max 3 levels from each candidate looking for package.json
                                    for (const start of candidates) {
                                        let dir = start;
                                        for (let i = 0; i < 3; i++) {
                                            const pj = path.join(dir, 'package.json');
                                            if (fs.existsSync(pj)) {
                                                return JSON.parse(fs.readFileSync(pj, 'utf8'));
                                            }
                                            const parent = path.dirname(dir);
                                            if (parent === dir) break;
                                            dir = parent;
                                        }
                                    }
                                } catch { /* ignore */ }
                                return null;
                            };

                            // ── Parse Codex config.toml ──
                            const codexMcp: EcoItem[] = [];
                            try {
                                const tomlPath = path.join(home, '.codex', 'config.toml');
                                if (fs.existsSync(tomlPath)) {
                                    const content = fs.readFileSync(tomlPath, 'utf8');
                                    const mcpSections = content.match(/\[mcp_servers\.([\s\S]*?)(?=\n\[|$)/g);
                                    if (mcpSections) {
                                        for (const section of mcpSections) {
                                            const nameMatch = section.match(/\[mcp_servers\.([^\]]+)\]/);
                                            if (!nameMatch) continue;
                                            const name = nameMatch[1];
                                            const cmdMatch = section.match(/command\s*=\s*"([^"]+)"/);
                                            const argsMatch = section.match(/args\s*=\s*\[(.*?)\]/s);
                                            const cmd = cmdMatch?.[1] || '';
                                            const args = argsMatch ? (argsMatch[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, '')) : [];
                                            let pkgInfo = extractPkg(cmd, args);
                                            let localDesc: string | undefined;
                                            // If no package name, try to find package.json locally
                                            if (!pkgInfo) {
                                                const pkgJson = findLocalPkgJson(cmd, args);
                                                if (pkgJson) {
                                                    pkgInfo = pkgJson.name ? { name: pkgJson.name, type: 'npm' as const } : null;
                                                    localDesc = pkgJson.description;
                                                }
                                            }
                                            codexMcp.push({
                                                name, description: DESC[name] || localDesc || '加载中…',
                                                source: DESC[name] ? 'builtin' : 'local',
                                                npmPkg: pkgInfo?.type === 'npm' ? pkgInfo.name : undefined,
                                                pypiPkg: pkgInfo?.type === 'pypi' ? pkgInfo.name : undefined,
                                            });
                                        }
                                    }
                                }
                            } catch { /* ignore */ }

                            // ── Parse Gemini settings.json ──
                            const geminiMcp: EcoItem[] = [];
                            const geminiExt: EcoItem[] = [];
                            try {
                                const settingsPath = path.join(home, '.gemini', 'settings.json');
                                if (fs.existsSync(settingsPath)) {
                                    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
                                    if (settings.mcpServers) {
                                        for (const [key, val] of Object.entries(settings.mcpServers) as [string, any][]) {
                                            const cmd = val.command || '';
                                            const args: string[] = val.args || [];
                                            let gPkgInfo = extractPkg(cmd, args);
                                            let localDesc: string | undefined;
                                            if (!gPkgInfo) {
                                                const pkgJson = findLocalPkgJson(cmd, args);
                                                if (pkgJson) {
                                                    gPkgInfo = pkgJson.name ? { name: pkgJson.name, type: 'npm' as const } : null;
                                                    localDesc = pkgJson.description;
                                                }
                                            }
                                            geminiMcp.push({
                                                name: key, description: DESC[key] || localDesc || '加载中…',
                                                source: DESC[key] ? 'builtin' : 'local',
                                                npmPkg: gPkgInfo?.type === 'npm' ? gPkgInfo.name : undefined,
                                                pypiPkg: gPkgInfo?.type === 'pypi' ? gPkgInfo.name : undefined,
                                            });
                                        }
                                    }
                                }
                                // Scan extensions directory — read package.json for npmPkg + description
                                const extDir = path.join(home, '.gemini', 'extensions');
                                if (fs.existsSync(extDir)) {
                                    for (const entry of fs.readdirSync(extDir)) {
                                        const entryPath = path.join(extDir, entry);
                                        if (fs.statSync(entryPath).isDirectory()) {
                                            let extNpmPkg: string | undefined;
                                            let extLocalDesc: string | undefined;
                                            // Read package.json from extension directory
                                            const extPkgJsonPath = path.join(entryPath, 'package.json');
                                            if (fs.existsSync(extPkgJsonPath)) {
                                                try {
                                                    const pkgJson = JSON.parse(fs.readFileSync(extPkgJsonPath, 'utf8'));
                                                    extNpmPkg = pkgJson.name || undefined;
                                                    extLocalDesc = pkgJson.description;
                                                } catch { /* ignore */ }
                                            }
                                            geminiExt.push({
                                                name: entry, description: DESC[entry] || extLocalDesc || '加载中…',
                                                source: DESC[entry] ? 'builtin' : 'local',
                                                npmPkg: extNpmPkg,
                                            });
                                        }
                                    }
                                }
                            } catch { /* ignore */ }

                            // 先回传本地发现结果，保证来源信息准确可见。
                            const localData = {
                                codex: { mcpServers: codexMcp.map(i => ({ name: i.name, description: i.description, source: i.source })) },
                                gemini: {
                                    mcpServers: geminiMcp.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                    extensions: geminiExt.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                },
                            };
                            this._panel.webview.postMessage({ command: 'ecosystemData', data: localData });

                            // 再补齐网络注册表描述，提升生态面板可读性。
                            const allItems = [...codexMcp, ...geminiMcp, ...geminiExt];
                            (async () => {
                                const descCache: Record<string, string> = {};

                                // Strategy 1: Exact npm registry lookup by package name
                                const fetchNpmExact = async (pkg: string): Promise<string | null> => {
                                    if (descCache[pkg]) return descCache[pkg];
                                    try {
                                        const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
                                            headers: { Accept: 'application/json' },
                                            signal: AbortSignal.timeout(5000),
                                        });
                                        if (res.ok) {
                                            const json = await res.json() as any;
                                            const desc = json.description || null;
                                            if (desc) descCache[pkg] = desc;
                                            return desc;
                                        }
                                    } catch { /* network error */ }
                                    return null;
                                };

                                // Strategy 2: PyPI exact lookup by package name
                                const fetchPypiExact = async (pkg: string): Promise<string | null> => {
                                    const cacheKey = `__pypi__${pkg}`;
                                    if (descCache[cacheKey]) return descCache[cacheKey];
                                    try {
                                        const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`, {
                                            headers: { Accept: 'application/json' },
                                            signal: AbortSignal.timeout(5000),
                                        });
                                        if (res.ok) {
                                            const json = await res.json() as any;
                                            const desc = json.info?.summary || null;
                                            if (desc) descCache[cacheKey] = desc;
                                            return desc;
                                        }
                                    } catch { /* network error */ }
                                    return null;
                                };

                                // Strategy 3: npm search API — fuzzy search by name keyword
                                const fetchNpmSearch = async (name: string): Promise<string | null> => {
                                    const cacheKey = `__search__${name}`;
                                    if (descCache[cacheKey]) return descCache[cacheKey];
                                    try {
                                        const query = encodeURIComponent(`mcp ${name}`);
                                        const res = await fetch(`https://registry.npmjs.org/-/v1/search?text=${query}&size=3`, {
                                            headers: { Accept: 'application/json' },
                                            signal: AbortSignal.timeout(5000),
                                        });
                                        if (res.ok) {
                                            const json = await res.json() as any;
                                            const results = json.objects || [];
                                            // Find the best match: package name contains the item name
                                            const nameLower = name.toLowerCase().replace(/-/g, '');
                                            for (const obj of results) {
                                                const pkg = obj.package;
                                                const pkgName = (pkg.name || '').toLowerCase().replace(/-/g, '').replace(/@[^/]+\//, '');
                                                if (pkgName.includes(nameLower) || nameLower.includes(pkgName)) {
                                                    const desc = pkg.description || null;
                                                    if (desc) descCache[cacheKey] = desc;
                                                    return desc;
                                                }
                                            }
                                            // No name match, but if there's exactly 1 result, use it
                                            if (results.length === 1 && results[0].package?.description) {
                                                const desc = results[0].package.description;
                                                descCache[cacheKey] = desc;
                                                return desc;
                                            }
                                        }
                                    } catch { /* network error */ }
                                    return null;
                                };

                                // Resolve description for each item: DESC dict → npm → pypi → search → keep local
                                await Promise.all(allItems.map(async (item) => {
                                    // Skip items already resolved by DESC dict (Chinese descriptions)
                                    if (item.description !== '加载中…') return;

                                    // Try exact npm lookup first
                                    if (item.npmPkg) {
                                        const desc = await fetchNpmExact(item.npmPkg);
                                        if (desc) {
                                            item.description = desc;
                                            item.source = 'npm';
                                            return;
                                        }
                                    }
                                    // Try PyPI lookup for Python packages
                                    if (item.pypiPkg) {
                                        const desc = await fetchPypiExact(item.pypiPkg);
                                        if (desc) {
                                            item.description = desc;
                                            item.source = 'pypi';
                                            return;
                                        }
                                    }
                                    // Fallback: npm search by name
                                    const desc = await fetchNpmSearch(item.name);
                                    if (desc) {
                                        item.description = desc;
                                        item.source = 'npm';
                                        return;
                                    }
                                    // Nothing found — generic fallback
                                    item.description = 'MCP server';
                                }));

                                // 回传注册表补全后的生态数据。
                                const phase2Data = {
                                    codex: { mcpServers: codexMcp.map(i => ({ name: i.name, description: i.description, source: i.source })) },
                                    gemini: {
                                        mcpServers: geminiMcp.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                        extensions: geminiExt.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                    },
                                };
                                this._panel.webview.postMessage({ command: 'ecosystemData', data: phase2Data });

                                // 如果编辑器可用模型存在，再补一轮中文描述。
                                try {
                                    // Collect items that still need descriptions (still '加载中…' or 'MCP server' or English text from registries)
                                    const needsAI = allItems.filter(i =>
                                        i.description === 'MCP server' ||
                                        i.description === '加载中…' ||
                                        ((i.source === 'npm' || i.source === 'pypi') && /^[a-zA-Z]/.test(i.description)) // English from registry
                                    );

                                    if (needsAI.length > 0) {
                                        // Try to get an AI model from the editor
                                        const models = await vscode.lm.selectChatModels({});
                                        if (models.length > 0) {
                                            const model = models[0]; // Use the first available model

                                            // Build prompt: include English descriptions as context for translation
                                            const lines = needsAI.map(i => {
                                                const hint = ((i.source === 'npm' || i.source === 'pypi') && i.description !== 'MCP server')
                                                    ? ` (English: ${i.description})`
                                                    : '';
                                                return `- ${i.name}${hint}`;
                                            }).join('\n');

                                            const prompt = `请用中文简短描述以下 MCP Server / Extension 的功能。每个不超过30字，格式为 "名称: 描述"。如果有英文描述则翻译为中文，如果没有则根据名称推断功能。\n\n${lines}`;

                                            const messages = [
                                                vscode.LanguageModelChatMessage.User(prompt),
                                            ];

                                            const response = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

                                            // Collect streamed response
                                            let fullText = '';
                                            for await (const chunk of response.text) {
                                                fullText += chunk;
                                            }

                                            // Parse response: each line should be "name: description"
                                            const descMap = new Map<string, string>();
                                            for (const line of fullText.split('\n')) {
                                                const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim();
                                                const colonIdx = cleaned.indexOf(':');
                                                const cnColonIdx = cleaned.indexOf('：');
                                                const idx = (colonIdx >= 0 && cnColonIdx >= 0)
                                                    ? Math.min(colonIdx, cnColonIdx)
                                                    : Math.max(colonIdx, cnColonIdx);
                                                if (idx > 0) {
                                                    const name = cleaned.substring(0, idx).trim().toLowerCase();
                                                    const desc = cleaned.substring(idx + 1).trim();
                                                    if (name && desc) descMap.set(name, desc);
                                                }
                                            }

                                            // Apply AI descriptions
                                            for (const item of needsAI) {
                                                const aiDesc = descMap.get(item.name.toLowerCase());
                                                if (aiDesc) {
                                                    item.description = aiDesc;
                                                    item.source = 'ai'; // Mark as AI-resolved (editor LM)
                                                }
                                            }

                                            // 回传 AI 补全文案后的生态数据。
                                            const phase3Data = {
                                                codex: { mcpServers: codexMcp.map(i => ({ name: i.name, description: i.description, source: i.source })) },
                                                gemini: {
                                                    mcpServers: geminiMcp.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                                    extensions: geminiExt.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                                },
                                            };
                                            this._panel.webview.postMessage({ command: 'ecosystemData', data: phase3Data });
                                        }
                                    }
                                } catch (e) {
                                    // AI not available (no model, user declined, etc.) — silently continue
                                    console.log('[Antigravity Workflow] vscode.lm AI lookup skipped:', (e as Error).message);
                                }

                                // 最后才使用用户配置模型作为补全文案的保底手段。
                                try {
                                    const stillNeeds = allItems.filter(i =>
                                        i.description === 'MCP server' ||
                                        i.description === '加载中…' ||
                                        ((i.source === 'npm' || i.source === 'pypi') && /^[a-zA-Z]/.test(i.description))
                                    );

                                    if (stillNeeds.length > 0) {
                                        // Pick the cheapest enabled model with an API key
                                        const cfgModels = await this.settings.getModels();
                                        const enabled = cfgModels.filter(m => m.enabled !== false && m.baseUrl);
                                        // Sort by priority (lower = higher priority)
                                        enabled.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

                                        let picked: { model: typeof enabled[0]; key: string } | null = null;
                                        for (const m of enabled) {
                                            const k = await this.settings.getModelApiKey(m.id);
                                            if (k) { picked = { model: m, key: k }; break; }
                                        }

                                        if (picked) {
                                            const lines = stillNeeds.map(i => {
                                                const hint = ((i.source === 'npm' || i.source === 'pypi') && i.description !== 'MCP server')
                                                    ? ` (English: ${i.description})`
                                                    : '';
                                                return `- ${i.name}${hint}`;
                                            }).join('\n');

                                            const prompt = `请用中文简短描述以下 MCP Server / Extension 的功能。每个不超过30字，格式为 "名称: 描述"。如果有英文描述则翻译为中文，如果没有则根据名称推断功能。\n\n${lines}`;

                                            const url = picked.model.baseUrl.replace(/\/$/, '') + '/chat/completions';
                                            const res = await fetch(url, {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json',
                                                    'Authorization': 'Bearer ' + picked.key,
                                                },
                                                body: JSON.stringify({
                                                    model: picked.model.modelId,
                                                    messages: [{ role: 'user', content: prompt }],
                                                    max_tokens: 500,
                                                    temperature: 0.3,
                                                }),
                                                signal: AbortSignal.timeout(15000),
                                            });

                                            if (res.ok) {
                                                const json = await res.json() as any;
                                                const text = json.choices?.[0]?.message?.content || '';

                                                // Parse "name: description" lines
                                                const descMap = new Map<string, string>();
                                                for (const line of text.split('\n')) {
                                                    const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim();
                                                    const colonIdx = cleaned.indexOf(':');
                                                    const cnColonIdx = cleaned.indexOf('：');
                                                    const idx = (colonIdx >= 0 && cnColonIdx >= 0)
                                                        ? Math.min(colonIdx, cnColonIdx)
                                                        : Math.max(colonIdx, cnColonIdx);
                                                    if (idx > 0) {
                                                        const name = cleaned.substring(0, idx).trim().toLowerCase();
                                                        const desc = cleaned.substring(idx + 1).trim();
                                                        if (name && desc) descMap.set(name, desc);
                                                    }
                                                }

                                                // Apply descriptions
                                                let updated = false;
                                                for (const item of stillNeeds) {
                                                    const aiDesc = descMap.get(item.name.toLowerCase());
                                                    if (aiDesc) {
                                                        item.description = aiDesc;
                                                        item.source = 'ai'; // Mark as AI-resolved (user API model)
                                                        updated = true;
                                                    }
                                                }

                                                if (updated) {
                                                    const phase4Data = {
                                                        codex: { mcpServers: codexMcp.map(i => ({ name: i.name, description: i.description, source: i.source })) },
                                                        gemini: {
                                                            mcpServers: geminiMcp.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                                            extensions: geminiExt.map(i => ({ name: i.name, description: i.description, source: i.source })),
                                                        },
                                                    };
                                                    this._panel.webview.postMessage({ command: 'ecosystemData', data: phase4Data });
                                                }
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.log('[Antigravity Workflow] Configured model lookup skipped:', (e as Error).message);
                                }
                            })();
                        } catch (e: any) {
                            this._panel.webview.postMessage({ command: 'ecosystemData', data: null, error: e.message });
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

                    // ── Antigravity Run Control Plane ───────────────────────
                    case 'getRunSnapshot': {
                        await this._publishRunSnapshot();
                        break;
                    }
                    case 'startRun': {
                        const goal = typeof message.goal === 'string' ? message.goal.trim() : '';
                        const mode = message.mode === 'write' ? 'write' : 'analysis';
                        if (!goal) {
                            this._panel.webview.postMessage({
                                command: 'runError',
                                message: 'Antigravity task goal must not be empty',
                            });
                            break;
                        }

                        this._panel.webview.postMessage({
                            command: 'runPending',
                            message: 'Antigravity task request received. Initializing antigravity-taskd...',
                        });

                        try {
                            const result = await this.workflowOrchestrator.startRun({
                                goal,
                                mode,
                            });
                            await this._ensureTaskStream(result.runId);
                            this._panel.webview.postMessage({
                                command: 'runStarted',
                                runId: result.runId,
                            });
                            await this._publishRunSnapshot();
                        } catch (error) {
                            const messageText = error instanceof Error ? error.message : String(error);
                            this._panel.webview.postMessage({
                                command: 'runError',
                                message: messageText,
                            });
                        }
                        break;
                    }
                    case 'cancelRun': {
                        try {
                            const result = await this.workflowOrchestrator.cancelRun();
                            this._panel.webview.postMessage({
                                command: 'runActionSuccess',
                                message: `Run cancelled: ${result.snapshot.runId}`,
                                runId: result.snapshot.runId,
                            });
                            await this._publishRunSnapshot();
                        } catch (error) {
                            const messageText = error instanceof Error ? error.message : String(error);
                            this._panel.webview.postMessage({
                                command: 'runActionError',
                                message: messageText,
                            });
                        }
                        break;
                    }
                    case 'listTaskJobs': {
                        try {
                            const jobs = await this.workflowOrchestrator.listJobs();
                            this._panel.webview.postMessage({
                                command: 'taskJobList',
                                jobs,
                            });
                        } catch (error) {
                            const messageText = error instanceof Error ? error.message : String(error);
                            this._panel.webview.postMessage({
                                command: 'runActionError',
                                message: messageText,
                            });
                        }
                        break;
                    }
                    case 'openTaskJob': {
                        try {
                            if (typeof message.jobId === 'string' && message.jobId.trim().length > 0) {
                                this.workflowOrchestrator.setActiveRunId(message.jobId.trim());
                                await this._ensureTaskStream(message.jobId.trim());
                                await this._publishRunSnapshot();
                            }
                        } catch (error) {
                            const messageText = error instanceof Error ? error.message : String(error);
                            this._panel.webview.postMessage({
                                command: 'runActionError',
                                message: messageText,
                            });
                        }
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
            const key = await this.settings.getModelApiKey(m.id);
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

        // Model family 颜色映射
        const MODEL_FAMILY_COLORS: Record<string, string> = {
            'DeepSeek': '#4A90D9', 'deepseek': '#4A90D9',
            'GLM': '#8B5CF6', 'glm': '#8B5CF6',
            'Qwen': '#F97316', 'qwen': '#F97316',
            'OpenAI': '#10A37F', 'gpt': '#10A37F', 'codex': '#10A37F',
            'Claude': '#D97706', 'claude': '#D97706',
            'Gemini': '#4285F4', 'gemini': '#4285F4',
            'Mistral': '#FF6F00', 'mistral': '#FF6F00',
        };
        const getModelFamilyColor = (model: string): string => {
            const lower = model.toLowerCase();
            for (const [key, color] of Object.entries(MODEL_FAMILY_COLORS)) {
                if (lower.includes(key.toLowerCase())) return color;
            }
            return '#6B7280';
        };
        const tokensByModelFamily = Array.from(tokenMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([model, tokens]) => ({
                family: model,
                label: model,
                tokens,
                color: getModelFamilyColor(model),
            }));

        // ── Codex CLI token 统计 (读取本地 SQLite) ─────────────────────────
        try {
            const codexDbPath = path.join(os.homedir(), '.codex', 'state_5.sqlite');
            if (fs.existsSync(codexDbPath)) {
                // 查询今日各模型来源的 token 总量
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
                            const family = parts[0] || 'unknown';
                            const tokens = parseInt(parts[1], 10) || 0;
                            if (tokens > 0) {
                                totalTokens += tokens;
                                tokensByModelFamily.push({
                                    family: `codex-cli:${family}`,
                                    label: `Codex CLI (${family === 'openai' ? 'OpenAI' : family})`,
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

                // 合并到 tokensByModelFamily
                for (const [model, tokens] of geminiTokenMap) {
                    totalTokens += tokens;
                    tokensByModelFamily.push({
                        family: `gemini-cli:${model}`,
                        label: `Gemini CLI (${model})`,
                        tokens,
                        color: '#4285F4', // Google 蓝
                    });
                }
            }
        } catch { /* Gemini CLI 数据不可用不影响核心功能 */ }

        // 按 token 量重新排序
        tokensByModelFamily.sort((a, b) => b.tokens - a.tokens);

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
        const arktsLsp = this.arktsLspController?.getStatus() ?? {
            enabled: false,
            state: 'disabled',
            message: 'ArkTS LSP controller unavailable',
            devecoDetected: false,
        } satisfies ArktsLspStatusPayload;

        this._panel.webview.postMessage({
            command: 'overviewStats',
            stats: {
                models: [...modelStatuses, ...cliStatuses],
                todayRequests, successRate, avgLatency, totalTokens, tokensByModelFamily, recentRequests, arktsLsp,
            },
        });
    }

    /** 工作流面板状态数据 */
    private async _publishRunSnapshot() {
        const snapshot = await this._readRunSnapshot();
        this._panel.webview.postMessage({ command: 'runSnapshot', data: snapshot });
    }

    private async _readRunSnapshot(): Promise<any | null> {
        return this._readRunSnapshotFromDaemon();
    }

    private async _readRunSnapshotFromDaemon(): Promise<any | null> {
        const status = this.workflowOrchestrator.getStatus();
        const jobs = await this.workflowOrchestrator.listJobs().catch(() => []);
        if (!status.runId && jobs.length > 0) {
            this.workflowOrchestrator.setActiveRunId(jobs[0]!.jobId);
        }
        const activeJobId = status.runId ?? jobs[0]?.jobId;
        if (!activeJobId) {
            return { jobs: [] };
        }

        await this._ensureTaskStream(activeJobId);
        const job = await this.workflowOrchestrator.getJob(activeJobId).catch(() => null);
        if (!job) {
            return { jobs };
        }
        return {
            jobId: job.jobId,
            runId: job.jobId,
            goal: job.goal,
            mode: job.mode,
            status: job.status,
            currentStageId: job.currentStageId,
            graph: job.graph,
            workers: job.workers,
            summary: job.summary,
            artifacts: job.artifacts,
            recentEvents: job.recentEvents,
            jobs,
            updatedAt: Date.parse(job.updatedAt) || Date.now(),
            createdAt: Date.parse(job.createdAt) || Date.now(),
            sourcePath: 'antigravity-taskd',
        };
    }

    private async _ensureTaskStream(jobId: string) {
        if (this._streamedTaskId === jobId && this._taskStreamDisposable) {
            return;
        }
        this._taskStreamDisposable?.dispose();
        this._streamedTaskId = jobId;
        this._taskStreamDisposable = await this.workflowOrchestrator.streamRun(jobId, (event) => {
            this._panel.webview.postMessage({
                command: 'taskEvent',
                event: {
                    snapshot: event.snapshot,
                    entries: event.entries,
                    nextCursor: event.nextCursor,
                },
            });
            void this._publishRunSnapshot();
        });
        this._disposables.push(this._taskStreamDisposable);
    }

    private _normalizeWorkflowNodes(rawNodes: Record<string, any>, phase?: string) {
        const orderedIds = ['ANALYZE', 'PARALLEL', 'DEBATE', 'VERIFY', 'SYNTHESIZE', 'PERSIST', 'HITL'];
        const phaseUpper = String(phase || '').toUpperCase();
        const nodes: Record<string, any> = {};

        for (const id of orderedIds) {
            const rawNode = rawNodes[id] || {};
            nodes[id] = {
                ...rawNode,
                status: this._normalizeWorkflowNodeStatus(rawNode.status, phaseUpper, id, rawNodes),
            };
        }

        for (const [id, rawNode] of Object.entries(rawNodes)) {
            if (nodes[id]) continue;
            nodes[id] = {
                ...rawNode,
                status: this._normalizeWorkflowNodeStatus((rawNode as any)?.status, phaseUpper, id, rawNodes),
            };
        }

        return nodes;
    }

    private _normalizeWorkflowNodeStatus(
        status: string | undefined,
        phaseUpper: string,
        nodeId: string,
        rawNodes: Record<string, any>,
    ): string {
        const normalized = String(status || '').toLowerCase();
        if (['pending', 'queued', 'running', 'completed', 'failed', 'skipped', 'paused', 'paused_for_human'].includes(normalized)) {
            return normalized === 'paused' || normalized === 'paused_for_human' ? 'running' : normalized;
        }

        if (phaseUpper === 'COMPLETED' && rawNodes[nodeId]) return 'completed';
        if (phaseUpper === 'FAILED' && nodeId === this._inferCurrentNode(rawNodes)) return 'failed';
        if (phaseUpper === 'PAUSED_FOR_HUMAN' && nodeId === 'HITL') return 'running';

        const currentNode = this._inferCurrentNode(rawNodes);
        if (nodeId === currentNode) return 'running';
        if (rawNodes[nodeId]) return 'completed';
        return 'pending';
    }

    private _inferCurrentNode(rawNodes: Record<string, any>): string | undefined {
        const order = ['ANALYZE', 'PARALLEL', 'DEBATE', 'VERIFY', 'SYNTHESIZE', 'PERSIST', 'HITL'];
        for (const id of order) {
            const status = String(rawNodes[id]?.status || '').toLowerCase();
            if (status === 'running' || status === 'queued' || status === 'paused' || status === 'paused_for_human') return id;
        }
        for (const id of order) {
            if (!rawNodes[id]) return id;
        }
        return undefined;
    }

    /** 批量测试所有启用模型 */
    private async _handleTestAllModels() {
        const models = await this.settings.getModels();
        const enabled = models.filter(m => m.enabled !== false);
        for (let i = 0; i < enabled.length; i++) {
            const m = enabled[i];
            if (i > 0) await new Promise(r => setTimeout(r, 1500));
            const key = await this.settings.getModelApiKey(m.id);
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
            const k = await this.settings.getModelApiKey(m.id);
            if (k) { apiKeys[m.id] = k; }
        }
        return apiKeys;
    }

    /** 刷新模型列表并通知 webview */
    private async _refreshModels() {
        const models = await this.settings.getModels();
        const apiKeys = await this._collectModelApiKeys(models);
        this._panel.webview.postMessage({ command: 'loadModels', models, apiKeys });
        this._onConfigChanged?.();
    }

    /** 同步模型目录到文件系统 (供 standalone mcp-server 读取) */
    private async _syncModelCatalogToFile() {
        const modelCatalogFile = path.join(os.homedir(), '.antigravity-model-catalog.json');
        try {
            const models = await this.settings.getModels();
            const enriched: any[] = [];
            for (const m of models) {
                const k = await this.settings.getModelApiKey(m.id);
                enriched.push({ ...m, apiKey: k || '' });
            }
            const dbPath = this.storage?.getDbPath() || '';
            fs.writeFileSync(modelCatalogFile, JSON.stringify({ version: 3, models: enriched, dbPath }, null, 2), 'utf8');
        } catch (e) {
            console.error('[Antigravity Workflow] Failed to sync models to file:', e);
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
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js');
        // Add cache busting query to bypass VS Code's aggressive webview caching
        const scriptUri = webview.asWebviewUri(vscode.Uri.parse(`${scriptPath.toString()}?t=${Date.now()}`));
        const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'images', 'logo.png'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline'; connect-src https: wss:;">
    <title>Antigravity Workflow</title>
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
