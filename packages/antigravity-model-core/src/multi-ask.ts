/**
 * Antigravity Workflow Core — 多模型并行查询
 *
 * 并行向多个 AI 模型发送相同问题，收集对比结果。
 */

import type { AntigravityModelConfig, MultiAskResult } from '@anthropic/antigravity-model-shared';
import { resolveRoute } from './routing.js';
import { callModel } from './model-client.js';

export interface MultiAskOptions {
    message: string;
    config: AntigravityModelConfig;
    modelHints?: string[];
    systemPrompt?: string;
    signal?: AbortSignal;
}

/**
 * 并行查询多个 AI 模型。
 *
 * 策略:
 * - 指定 modelHints: 使用指定的模型列表
 * - 未指定: 使用所有已启用模型 (最多 5 个)
 */
export async function multiAsk(options: MultiAskOptions): Promise<{
    results: MultiAskResult[];
    totalMs: number;
}> {
    const { message, config, modelHints, systemPrompt, signal } = options;

    const enabledModels = (config.models || []).filter(m => m.enabled && m.apiKey);
    let modelSelection: string[];

    if (modelHints && modelHints.length > 0) {
        modelSelection = modelHints;
    } else {
        modelSelection = enabledModels.slice(0, 5).map(m => m.id);
    }

    if (modelSelection.length === 0) {
        throw new Error('No enabled models configured.');
    }

    const t0 = Date.now();

    const tasks = modelSelection.map(async (requestedModel): Promise<MultiAskResult> => {
        const route = resolveRoute(message, config, requestedModel);
        if (!route) return { modelLabel: requestedModel, error: `No config for "${requestedModel}"` };

        const ts = Date.now();
        try {
            const result = await callModel(route, message, systemPrompt, signal);
            return {
                modelLabel: route.label,
                text: result.text,
                duration: Date.now() - ts,
                tokens: (result.inputTokens || 0) + (result.outputTokens || 0),
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { modelLabel: route.label, error: msg };
        }
    });

    const settled = await Promise.allSettled(tasks);
    const results: MultiAskResult[] = [];

    for (const r of settled) {
        if (r.status === 'fulfilled') {
            results.push(r.value);
        } else {
            results.push({ modelLabel: 'unknown', error: String(r.reason) });
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
            sections.push(`---\n### ❌ ${v.modelLabel}\n${v.error}`);
        } else {
            sections.push(`---\n### ✅ ${v.modelLabel} (${v.duration}ms | ${v.tokens} tokens)\n${v.text}`);
        }
    }

    return sections.join('\n');
}
