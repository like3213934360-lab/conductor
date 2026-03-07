/**
 * Conductor Hub Core — 多模型并行查询
 *
 * 并行向多个 AI 模型发送相同问题，收集对比结果
 * 从 Conductor Hub mcp-server.ts L949-1036 提取
 */

import type { ConductorHubConfig, RouteResult, MultiAskResult } from '@anthropic/conductor-hub-shared';
import { resolveRoute } from './routing.js';
import { callProvider } from './provider-client.js';

export interface MultiAskOptions {
    message: string;
    config: ConductorHubConfig;
    providers?: string[];
    systemPrompt?: string;
    signal?: AbortSignal;
}

/**
 * 并行查询多个 AI 模型。
 *
 * 策略:
 * - 指定 providers: 使用指定的模型列表
 * - 未指定: 使用所有已启用模型 (最多 5 个)
 * - Legacy: 使用 deepseek/glm/qwen 默认列表
 */
export async function multiAsk(options: MultiAskOptions): Promise<{
    results: MultiAskResult[];
    totalMs: number;
}> {
    const { message, config, providers, systemPrompt, signal } = options;

    const enabledModels = (config.models || []).filter(m => m.enabled && m.apiKey);
    let providerList: string[];

    if (providers && providers.length > 0) {
        providerList = providers;
    } else if (enabledModels.length > 0) {
        providerList = enabledModels.slice(0, 5).map(m => m.id);
    } else {
        providerList = ['deepseek', 'glm', 'qwen'];
    }

    const t0 = Date.now();

    const tasks = providerList.map(async (provider): Promise<MultiAskResult> => {
        const route = resolveRoute(message, config, provider);
        if (!route) return { provider, error: `No config for "${provider}"` };

        const ts = Date.now();
        try {
            const result = await callProvider(route, message, systemPrompt, signal);
            return {
                provider: route.label,
                text: result.text,
                duration: Date.now() - ts,
                tokens: (result.inputTokens || 0) + (result.outputTokens || 0),
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { provider: route.label, error: msg };
        }
    });

    const settled = await Promise.allSettled(tasks);
    const results: MultiAskResult[] = [];

    for (const r of settled) {
        if (r.status === 'fulfilled') {
            results.push(r.value);
        } else {
            results.push({ provider: 'unknown', error: String(r.reason) });
        }
    }

    return { results, totalMs: Date.now() - t0 };
}

/**
 * 格式化 multiAsk 结果为 Markdown 对比输出。
 */
export function formatMultiAskResults(results: MultiAskResult[], totalMs: number, providerCount: number): string {
    const sections: string[] = [`🔀 **ai_multi_ask** — ${providerCount} models | ${totalMs}ms total\n`];

    for (const v of results) {
        if (v.error) {
            sections.push(`---\n### ❌ ${v.provider}\n${v.error}`);
        } else {
            sections.push(`---\n### ✅ ${v.provider} (${v.duration}ms | ${v.tokens} tokens)\n${v.text}`);
        }
    }

    return sections.join('\n');
}
