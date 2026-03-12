/**
 * Antigravity Workflow Core — 智能路由引擎
 *
 * 任务类型检测 + 基于模型目录的路由解析
 */

import type { AntigravityModelConfig, ModelConfig, RouteResult } from '@anthropic/antigravity-model-shared';
import { TASK_KEYWORDS } from '@anthropic/antigravity-model-shared';

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
 * 1. 只使用已配置的 ModelConfig[] 作为路由真源
 * 2. 如指定 model hint，则在已启用模型中按 id/modelId/label/baseUrl 匹配
 * 3. 否则按任务类型 + 优先级选择
 *
 * @param message - 用户消息
 * @param config - Antigravity Workflow 配置
 * @param modelHint - 强制指定的模型 hint (可选)
 * @returns 路由结果，或 null (无可用模型)
 */
export function resolveRoute(message: string, config: AntigravityModelConfig, modelHint?: string): RouteResult | null {
    const enabledModels = (config.models || [])
        .filter(m => m.enabled && m.apiKey)
        .sort((a, b) => a.priority - b.priority);

    if (enabledModels.length === 0) {
        return null;
    }

    let chosen: ModelConfig | undefined;

    if (modelHint) {
        const hint = modelHint.trim().toLowerCase();
        chosen = enabledModels.find(model => {
            const candidates = [model.id, model.modelId, model.label, model.baseUrl]
                .map(value => value.toLowerCase());
            return candidates.some(candidate => candidate.includes(hint) || hint.includes(candidate));
        });
    }

    if (!chosen) {
        const taskType = detectTaskType(message);
        const matching = enabledModels.filter(model => model.tasks.includes(taskType));
        chosen = matching[0] || enabledModels[0];
    }

    if (!chosen) {
        return null;
    }

    return {
        label: chosen.label,
        apiKey: chosen.apiKey!,
        baseUrl: chosen.baseUrl.replace(/\/$/, ''),
        modelId: chosen.modelId,
    };
}
