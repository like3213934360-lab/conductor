/**
 * Conductor ↔ Conductor Hub 适配器
 *
 * 将 ConductorHubService 适配到 conductor-core 的 IModelExecutor 接口，
 * 让 AGC 引擎通过依赖倒置消费多模型能力。
 */

import type { IModelExecutor, ModelResponse, ParallelRequest, ConsensusResult } from '@anthropic/conductor-core';
import { ConductorHubService } from '@anthropic/conductor-hub-core';
import type { ConductorHubConfig } from '@anthropic/conductor-hub-shared';

export class ConductorHubModelExecutor implements IModelExecutor {
    private service: ConductorHubService;

    constructor(config?: ConductorHubConfig) {
        this.service = new ConductorHubService(config);
    }

    /** 单次 AI 查询 — 智能路由到最佳模型 */
    async ask(prompt: string, options?: {
        provider?: string;
        systemPrompt?: string;
    }): Promise<ModelResponse> {
        const result = await this.service.ask({
            message: prompt,
            provider: options?.provider,
            systemPrompt: options?.systemPrompt,
        });
        return {
            text: result.text,
            model: result.usedModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: 0, // ProviderCallResultWithFallback 无延时字段，运行时计算
        };
    }

    /** 多模型并行查询 */
    async parallelAsk(requests: ParallelRequest[]): Promise<ModelResponse[]> {
        // 对每个请求独立调用 service.ask()，并行执行
        const promises = requests.map(async (req) => {
            const result = await this.service.ask({
                message: req.prompt,
                provider: req.provider,
                systemPrompt: req.systemPrompt,
            });
            return {
                text: result.text,
                model: result.usedModel,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                durationMs: 0,
            } satisfies ModelResponse;
        });
        return Promise.all(promises);
    }

    /** 多模型投票 + 裁判评分 */
    async consensus(prompt: string, options?: {
        criteria?: string;
        providers?: string[];
        judgeProvider?: string;
    }): Promise<ConsensusResult> {
        const result = await this.service.consensus({
            message: prompt,
            criteria: options?.criteria,
            providers: options?.providers,
            judge: options?.judgeProvider,
        });
        return {
            judgeText: result.judgeText,
            judgeModel: result.judgeModel,
            winnerText: result.candidates[0]?.text ?? '',
            candidates: result.candidates.map(c => ({
                label: c.label,
                text: c.text,
            })),
            totalMs: result.totalMs,
        };
    }

    /** 列出可用模型 (额外便利方法) */
    listProviders(): string {
        return this.service.listProviders();
    }
}
