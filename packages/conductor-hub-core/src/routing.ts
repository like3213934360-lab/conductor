/**
 * Conductor Hub Core — 智能路由引擎
 *
 * 任务类型检测 + 路由解析 (v1/v2 双模式)
 * 从 Conductor Hub mcp-server.ts L120-222 提取
 */

import type { ConductorHubConfig, ModelConfig, RouteResult } from '@anthropic/conductor-hub-shared';
import { LEGACY_PROVIDERS, TASK_KEYWORDS } from '@anthropic/conductor-hub-shared';

// ── 任务类型检测 ──────────────────────────────────────────────────────────────

/**
 * 基于消息内容的任务类型检测 — 权重评分模型
 *
 * 策略:
 * 1. 长度规则 (最高优先级, 直接返回)
 * 2. 多关键字权重累加: 每个命中的关键字贡献权重分
 * 3. 取最高分的 taskType
 * 4. 无匹配时默认 code_gen
 */
export function detectTaskType(message: string): string {
    const msg = message.toLowerCase();

    // ── 长度感知路由 (最高优先级) ────────────────────────────────────────────
    if (message.length > 3000) {
        return 'long_context';
    }
    if (message.length < 100 && (msg.includes('code') || msg.includes('代码') || msg.includes('function') || msg.includes('函数'))) {
        return 'code_gen';
    }

    // ── 关键字权重评分 ──────────────────────────────────────────────────────
    const scores = new Map<string, number>();

    for (const [taskId, keywords] of Object.entries(TASK_KEYWORDS)) {
        let score = 0;
        for (const keyword of keywords) {
            if (msg.includes(keyword)) {
                // 长关键字权重更高 (更精确), 短关键字权重低
                score += keyword.length >= 4 ? 2 : 1;
            }
        }
        if (score > 0) {
            scores.set(taskId, score);
        }
    }

    if (scores.size === 0) return 'code_gen';

    // 取最高分的 taskType
    let bestTask = 'code_gen';
    let bestScore = 0;
    for (const [taskId, score] of scores) {
        if (score > bestScore) {
            bestScore = score;
            bestTask = taskId;
        }
    }
    return bestTask;
}

// ── 路由解析 ──────────────────────────────────────────────────────────────────

/**
 * 将消息路由到最佳模型。
 *
 * 策略:
 * 1. v2 模式: 使用用户配置的 ModelConfig[] → 基于任务类型 + 优先级排序
 * 2. v1 模式: 使用 legacy 固定厂商映射 (backward compat)
 *
 * @param message - 用户消息
 * @param config - Conductor Hub 配置
 * @param forcedProvider - 强制指定厂商 (可选)
 * @returns 路由结果，或 null (无可用模型)
 */
export function resolveRoute(message: string, config: ConductorHubConfig, forcedProvider?: string): RouteResult | null {
    const enabledModels = (config.models || []).filter(m => m.enabled && m.apiKey);

    if (enabledModels.length > 0) {
        // v2: 使用用户配置的模型
        let chosen: ModelConfig | undefined;

        if (forcedProvider) {
            const fp = forcedProvider.toLowerCase();
            chosen = enabledModels.find(m =>
                m.modelId.toLowerCase().includes(fp) ||
                m.label.toLowerCase().includes(fp)
            );
        }

        if (!chosen) {
            const taskType = detectTaskType(message);
            const matching = enabledModels
                .filter(m => m.tasks.includes(taskType))
                .sort((a, b) => a.priority - b.priority);
            chosen = matching[0] || enabledModels[0];
        }

        if (!chosen) { return null; }
        return {
            label: chosen.label,
            apiKey: chosen.apiKey!,
            baseUrl: chosen.baseUrl.replace(/\/$/, ''),
            modelId: chosen.modelId,
        };
    }

    // v1 legacy fallback
    const legacy: Record<string, string> = config.legacy || (config as Record<string, string>);
    let providerKey = forcedProvider || 'gpt';

    if (!forcedProvider) {
        const msg = message.toLowerCase();
        if (msg.includes('translate') || msg.includes('翻译') || msg.includes('中文') || msg.includes('documentation') || msg.includes('文档')) { providerKey = 'qwen'; }
        else if (msg.includes('terminal') || msg.includes('devops') || msg.includes('shell') || msg.includes('script')) { providerKey = 'gpt'; }
        else if (msg.includes('math') || msg.includes('数学') || msg.includes('algorithm') || msg.includes('reasoning') || msg.includes('推理')) { providerKey = 'gemini'; }
        else if (msg.includes('ui') || msg.includes('frontend') || msg.includes('design') || msg.includes('前端') || msg.includes('页面') || msg.includes('组件')) { providerKey = 'gemini'; }
        else { providerKey = 'gpt'; }
    }

    const legacyKey = legacy[providerKey];
    if (!legacyKey) { return null; }

    const prov = LEGACY_PROVIDERS[providerKey];
    if (!prov) { return null; }

    return {
        label: providerKey,
        apiKey: legacyKey,
        baseUrl: prov.url,
        modelId: prov.model,
    };
}
