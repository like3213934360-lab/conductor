/**
 * Conductor Hub Core — 投票引擎 (Consensus)
 *
 * 多模型并行生成候选答案 → 裁判模型评分 → 选出最佳答案
 * 从 Conductor Hub mcp-server.ts L1038-1161 提取
 */

import type { ConductorHubConfig, ConsensusCandidate, ConsensusResult } from '@anthropic/conductor-hub-shared';
import { resolveRoute } from './routing.js';
import { callProvider } from './provider-client.js';

export interface ConsensusOptions {
    message: string;
    config: ConductorHubConfig;
    criteria?: string;
    providers?: string[];
    judgeProvider?: string;
    systemPrompt?: string;
}

/**
 * 投票引擎: 多模型生成 → 裁判评分 → 最佳答案
 *
 * 流程:
 * 1. 并行查询候选模型 (最多 5 个)
 * 2. 裁判模型对比评分 (1-10 + 推理说明)
 * 3. 返回评分结果 + 获胜答案
 */
export async function consensus(options: ConsensusOptions): Promise<ConsensusResult> {
    const { message, config, criteria = 'accuracy', providers, judgeProvider, systemPrompt } = options;

    // Step 1: 收集候选响应
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

    const tasks = providerList.map(async (provider) => {
        const route = resolveRoute(message, config, provider);
        if (!route) return { provider, label: provider, error: `No config for "${provider}"` };
        try {
            const result = await callProvider(route, message, systemPrompt);
            return { provider, label: route.label, text: result.text };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { provider, label: route.label, error: msg };
        }
    });

    const rawResults = await Promise.allSettled(tasks);
    const candidates: ConsensusCandidate[] = [];

    for (const r of rawResults) {
        if (r.status === 'fulfilled' && r.value.text) {
            candidates.push({ label: r.value.label, text: r.value.text });
        }
    }

    if (candidates.length === 0) {
        throw new Error('All candidate models failed to respond.');
    }

    if (candidates.length === 1) {
        return {
            judgeText: `Only 1 candidate responded.\n\n**Winner: ${candidates[0]!.label}**\n\n${candidates[0]!.text}`,
            judgeModel: 'N/A',
            candidates,
            totalMs: Date.now() - t0,
        };
    }

    // Step 2: 裁判评分
    const judgeProviderKey = judgeProvider || providerList[0]!;
    const judgeRoute = resolveRoute('', config, judgeProviderKey);

    if (!judgeRoute) {
        const fallback = candidates.map((c, i) => `### Candidate ${i + 1}: ${c.label}\n${c.text}`).join('\n\n---\n\n');
        return {
            judgeText: `Judge unavailable, showing all candidates\n\n${fallback}`,
            judgeModel: 'N/A',
            candidates,
            totalMs: Date.now() - t0,
        };
    }

    const candidateBlock = candidates.map((c, i) => `=== Candidate ${i + 1} (${c.label}) ===\n${c.text}`).join('\n\n');

    const judgePrompt = `You are an expert judge. Evaluate the following ${candidates.length} candidate answers to the user's question.

User's Question: ${message}

Judging Criteria: ${criteria}

${candidateBlock}

=== Your Task ===
1. Score each candidate from 1-10 based on the criteria "${criteria}"
2. Explain your reasoning for each score in 1-2 sentences
3. Declare the winner
4. Output the winning answer in full

Format your response as:
SCORES:
- Candidate 1 (name): X/10 — reason
- Candidate 2 (name): X/10 — reason
...

WINNER: Candidate N (name)

BEST ANSWER:
[full winning answer here]`;

    try {
        const judgeResult = await callProvider(judgeRoute, judgePrompt);

        return {
            judgeText: judgeResult.text,
            judgeModel: judgeRoute.label,
            candidates,
            totalMs: Date.now() - t0,
        };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const fallback = candidates.map((c, i) => `### Candidate ${i + 1}: ${c.label}\n${c.text}`).join('\n\n---\n\n');
        return {
            judgeText: `Judge failed (${msg}), showing all candidates\n\n${fallback}`,
            judgeModel: judgeRoute.label,
            candidates,
            totalMs: Date.now() - t0,
        };
    }
}
