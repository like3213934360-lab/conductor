/**
 * Conductor Hub Core — 门面服务
 *
 * 统一暴露 Conductor Hub 全部能力的门面类，供外部消费者使用。
 * conductor-mcp-server / vscode-extension / conductor-hub-adapter 均通过此类消费。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { ConductorHubConfig, ProviderCallResultWithFallback, ConsensusResult, MultiAskResult } from '@anthropic/conductor-hub-shared';
import type { AgcAgentRuntime } from '@anthropic/conductor-core';
import { resolveRoute } from './routing.js';
import { callProvider, callProviderWithFallback } from './provider-client.js';
import { callCodex, callGemini } from './cli-runners.js';
import { buildFileContext } from './file-context.js';
import { multiAsk, formatMultiAskResults } from './multi-ask.js';
import { consensus } from './consensus.js';

const KEYS_FILE = path.join(os.homedir(), '.conductor-hub-keys.json');

// ── DI: ConfigLoader 接口 ─────────────────────────────────────────────────

/** 配置加载器接口 — 支持 DI 和测试 Mock */
export interface ConfigLoader {
    load(): ConductorHubConfig;
}

/** 默认实现: 从 JSON 文件读取 */
export class FileConfigLoader implements ConfigLoader {
    constructor(private filePath: string = KEYS_FILE) {}
    load(): ConductorHubConfig {
        try {
            if (fs.existsSync(this.filePath)) {
                return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ConductorHubConfig;
            }
        } catch { /* file missing or malformed */ }
        return {};
    }
}

/**
 * Conductor Hub 服务门面 — 无 VS Code 依赖的纯 Node 运行时
 */
export class ConductorHubService implements AgcAgentRuntime {
    private config: ConductorHubConfig;
    private configLoader: ConfigLoader;

    constructor(configOrLoader?: ConductorHubConfig | ConfigLoader) {
        if (configOrLoader && 'load' in configOrLoader) {
            this.configLoader = configOrLoader;
            this.config = configOrLoader.load();
        } else {
            this.configLoader = new FileConfigLoader();
            this.config = configOrLoader || this.configLoader.load();
        }
    }

    /** @deprecated 使用 new FileConfigLoader().load() 代替 */
    static readConfig(): ConductorHubConfig {
        return new FileConfigLoader().load();
    }

    /** 热重载配置 */
    reloadConfig(): void {
        this.config = this.configLoader.load();
    }

    /** 获取当前配置 */
    getConfig(): ConductorHubConfig {
        return this.config;
    }

    // ── ai_ask ────────────────────────────────────────────────────────────────

    /**
     * 单模型智能路由查询。
     *
     * 支持: 强制指定厂商 / 自动路由 / 自动降级 / 文件上下文注入
     */
    async ask(options: {
        message: string;
        provider?: string;
        systemPrompt?: string;
        filePaths?: string[];
        signal?: AbortSignal;
    }): Promise<ProviderCallResultWithFallback & { warningLines: string[] }> {
        let systemPrompt = options.systemPrompt;
        const warningLines: string[] = [];

        if (options.filePaths && options.filePaths.length > 0) {
            const { context, warnings } = buildFileContext(options.filePaths);
            warningLines.push(...warnings);
            if (context) {
                systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context;
            }
        }

        const route = resolveRoute(options.message, this.config, options.provider);
        if (!route) {
            throw new Error(`No configured model found${options.provider ? ` for provider "${options.provider}"` : ''}.`);
        }

        const result = await callProviderWithFallback(route, options.message, systemPrompt, this.config, options.signal);
        return { ...result, warningLines };
    }

    // ── ai_list_providers ─────────────────────────────────────────────────────

    /** 列出已配置模型及 CLI 工具状态 */
    listProviders(): string {
        const enabledModels = (this.config.models || []).filter(m => m.enabled && m.apiKey);

        const codexCheck = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 5000 });
        const codexStatus = codexCheck.error
            ? '❌ Not installed (run: npm install -g @openai/codex)'
            : `✅ Installed (${(codexCheck.stdout || '').trim() || 'uses ChatGPT login'})`;

        const geminiCheck = spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 5000 });
        const geminiStatus = (!geminiCheck.error && geminiCheck.status === 0)
            ? '✅ Installed (Auto local credentials)'
            : '❌ Not installed (npm i -g @google/gemini-cli)';

        if (enabledModels.length > 0) {
            const lines = enabledModels.map(m =>
                `✅ ${m.label} (${m.modelId}) — tasks: ${m.tasks.join(', ') || 'none'}`
            );
            return `Configured models:\n${lines.join('\n')}\n\n🤖 Codex CLI: ${codexStatus}\n🔷 Gemini CLI: ${geminiStatus}`;
        }

        return `No v2 models configured.\n🤖 Codex CLI: ${codexStatus}\n🔷 Gemini CLI: ${geminiStatus}`;
    }

    // ── ai_codex_task ─────────────────────────────────────────────────────────

    async codexTask(task: string, workingDir?: string, signal?: AbortSignal, filePaths?: string[]): Promise<string> {
        return callCodex(this._enrichWithFiles(task, filePaths), workingDir, signal);
    }

    // ── ai_gemini_task ────────────────────────────────────────────────────────

    async geminiTask(prompt: string, model?: string, workingDir?: string, signal?: AbortSignal, filePaths?: string[]): Promise<string> {
        return callGemini(this._enrichWithFiles(prompt, filePaths), model, workingDir, signal);
    }

    /** 文件上下文注入: 预读文件 → 拼入 prompt → 消除 CLI 串行 tool call */
    private _enrichWithFiles(prompt: string, filePaths?: string[]): string {
        if (!filePaths || filePaths.length === 0) return prompt;
        const { context, warnings } = buildFileContext(filePaths);
        if (!context) return prompt;
        const parts = [prompt, '\n\n' + context];
        if (warnings.length > 0) {
            parts.push(`\n\n> ⚠️ File context warnings: ${warnings.join('; ')}`);
        }
        return parts.join('');
    }

    // ── ai_multi_ask ──────────────────────────────────────────────────────────

    async multiAsk(options: {
        message: string;
        providers?: string[];
        systemPrompt?: string;
        filePaths?: string[];
        signal?: AbortSignal;
    }): Promise<{ results: MultiAskResult[]; totalMs: number; formatted: string }> {
        let systemPrompt = options.systemPrompt;
        const warningLines: string[] = [];

        if (options.filePaths && options.filePaths.length > 0) {
            const { context, warnings } = buildFileContext(options.filePaths);
            warningLines.push(...warnings);
            if (context) {
                systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context;
            }
        }

        const result = await multiAsk({
            message: options.message,
            config: this.config,
            providers: options.providers,
            systemPrompt,
            signal: options.signal,
        });

        let formatted = formatMultiAskResults(result.results, result.totalMs, options.providers?.length || result.results.length);
        if (warningLines.length > 0) {
            formatted = `> ⚠️ File context warnings: ${warningLines.join('; ')}\n\n${formatted}`;
        }

        return { ...result, formatted };
    }

    // ── ai_consensus ──────────────────────────────────────────────────────────

    async consensus(options: {
        message: string;
        criteria?: string;
        providers?: string[];
        judge?: string;
        systemPrompt?: string;
        filePaths?: string[];
    }): Promise<ConsensusResult> {
        let systemPrompt = options.systemPrompt;

        if (options.filePaths && options.filePaths.length > 0) {
            const { context } = buildFileContext(options.filePaths);
            if (context) {
                systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context;
            }
        }

        return consensus({
            message: options.message,
            config: this.config,
            criteria: options.criteria,
            providers: options.providers,
            judgeProvider: options.judge,
            systemPrompt,
        });
    }

    // ── 直接调用单模型 (供 conductor-hub-adapter 使用) ──────────────────────

    async callDirect(message: string, provider?: string, systemPrompt?: string) {
        const route = resolveRoute(message, this.config, provider);
        if (!route) {
            throw new Error(`No route for provider: ${provider || 'auto'}`);
        }
        return callProvider(route, message, systemPrompt);
    }
}
