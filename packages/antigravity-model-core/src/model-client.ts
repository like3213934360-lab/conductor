/**
 * Antigravity Workflow Core — 模型调用客户端
 *
 * OpenAI 兼容 API 调用 + 自动降级链。
 * 负责把模型目录路由结果转成真实 API 调用。
 */

import type { AntigravityModelConfig, ModelCallResult, ModelCallResultWithFallback, RouteResult } from '@anthropic/antigravity-model-shared';
import { CircuitBreakerRegistry } from './circuit-breaker.js';
import { createLogger } from './logger.js';

const log = createLogger('model-client');

// 全局 Circuit Breaker 注册表 (按 modelId 独立管理)
const circuitBreakers = new CircuitBreakerRegistry();

// ── 单模型调用 ────────────────────────────────────────────────────────────────

/**
 * 调用单个模型目录路由结果。
 *
 * 自动补全 /chat/completions 路径。
 */
export async function callModel(
    route: RouteResult,
    message: string,
    systemPrompt?: string,
    signal?: AbortSignal
): Promise<ModelCallResult> {
    const url = route.baseUrl.endsWith('/chat/completions')
        ? route.baseUrl
        : `${route.baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) { messages.push({ role: 'system', content: systemPrompt }); }
    messages.push({ role: 'user', content: message });

    const start = Date.now();
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
        log.warn('API error', { model: route.modelId, status: res.status, ms: Date.now() - start });
        throw new Error(`${route.label} API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | undefined;
    const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;

    log.info('API success', { model: route.modelId, ms: Date.now() - start, tokens: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0) });

    return {
        text: choices?.[0]?.message?.content || 'No response',
        inputTokens: usage?.prompt_tokens || 0,
        outputTokens: usage?.completion_tokens || 0,
    };
}

// ── 可重试错误判断 ────────────────────────────────────────────────────────────

/**
 * 判断错误是否可重试 (网络问题、限流、服务器错误)。
 * 不可重试: 认证错误 (401/403)、请求错误 (400)、未知模型路由。
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
export async function callModelWithFallback(
    primaryRoute: RouteResult,
    message: string,
    systemPrompt: string | undefined,
    config: AntigravityModelConfig,
    signal?: AbortSignal
): Promise<ModelCallResultWithFallback> {
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

        // Circuit Breaker: OPEN 状态直接跳过, 参考 Netflix Hystrix
        if (!circuitBreakers.canCall(route.modelId)) {
            const state = circuitBreakers.getState(route.modelId);
            log.info('Circuit OPEN, skipping', { model: route.modelId, failures: state.failures });
            errors.push(`[${route.label}] Circuit breaker OPEN (${state.failures} failures)`);
            continue;
        }

        try {
            const result = await callModel(route, message, systemPrompt, signal);
            circuitBreakers.onSuccess(route.modelId);
            return {
                ...result,
                usedModel: route.modelId,
                didFallback: i > 0,
            };
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(`[${route.label}] ${msg}`);
            circuitBreakers.onFailure(route.modelId);

            if (!isRetryableError(msg)) {
                throw new Error(msg);
            }
            log.warn('Fallback triggered', { from: route.modelId, attempt: i + 1, total: attemptQueue.length });
        }
    }

    throw new Error(`All models failed:\n${errors.join('\n')}`);
}

/** 获取 Circuit Breaker 注册表 (供测试/诊断用) */
export function getCircuitBreakers(): CircuitBreakerRegistry {
    return circuitBreakers;
}
