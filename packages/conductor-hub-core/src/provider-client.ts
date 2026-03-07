/**
 * Conductor Hub Core — AI 厂商调用客户端
 *
 * OpenAI 兼容 API 调用 + 自动降级链
 * 从 Conductor Hub mcp-server.ts L224-327 提取
 */

import type { RouteResult, ProviderCallResult, ProviderCallResultWithFallback, ConductorHubConfig } from '@anthropic/conductor-hub-shared';

// ── 单厂商调用 ────────────────────────────────────────────────────────────────

/**
 * 调用单个 AI 厂商 (OpenAI 兼容接口)。
 *
 * 自动补全 /chat/completions 路径。
 */
export async function callProvider(
    route: RouteResult,
    message: string,
    systemPrompt?: string,
    signal?: AbortSignal
): Promise<ProviderCallResult> {
    const url = route.baseUrl.endsWith('/chat/completions')
        ? route.baseUrl
        : `${route.baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) { messages.push({ role: 'system', content: systemPrompt }); }
    messages.push({ role: 'user', content: message });

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${route.apiKey}`,
        },
        body: JSON.stringify({ model: route.modelId, messages, temperature: 0.7 }),
        signal,
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${route.label} API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

    return {
        text: choices?.[0]?.message?.content || 'No response',
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
    };
}

// ── 可重试错误判断 ────────────────────────────────────────────────────────────

/**
 * 判断错误是否可重试 (网络问题、限流、服务器错误)。
 * 不可重试: 认证错误 (401/403)、请求错误 (400)、未知厂商。
 */
export function isRetryableError(msg: string): boolean {
    return (
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504')
    );
}

// ── 自动降级链 ────────────────────────────────────────────────────────────────

/**
 * 调用主模型，失败时自动降级到其他已配置模型。
 *
 * 降级队列: 主模型 → 其他已启用模型 (按优先级排序，最多 3 个备选)
 * 仅可重试错误触发降级，认证错误等立即抛出。
 */
export async function callProviderWithFallback(
    primaryRoute: RouteResult,
    message: string,
    systemPrompt: string | undefined,
    config: ConductorHubConfig,
    signal?: AbortSignal
): Promise<ProviderCallResultWithFallback> {
    const enabledModels = (config.models || [])
        .filter(m => m.enabled && m.apiKey && m.modelId !== primaryRoute.modelId)
        .sort((a, b) => a.priority - b.priority);

    const fallbackRoutes: RouteResult[] = enabledModels.slice(0, 3).map(m => ({
        label: m.label,
        apiKey: m.apiKey!,
        baseUrl: m.baseUrl.replace(/\/$/, ''),
        modelId: m.modelId,
    }));

    const attemptQueue = [primaryRoute, ...fallbackRoutes];
    const errors: string[] = [];

    for (let i = 0; i < attemptQueue.length; i++) {
        const route = attemptQueue[i]!;
        try {
            const result = await callProvider(route, message, systemPrompt, signal);
            return {
                ...result,
                usedModel: route.modelId,
                didFallback: i > 0,
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`[${route.label}] ${msg}`);

            if (!isRetryableError(msg)) {
                throw new Error(msg);
            }
        }
    }

    throw new Error(`All models failed:\n${errors.join('\n')}`);
}
