/**
 * Conductor AGC — 模型执行器端口接口
 *
 * conductor-core 通过此接口消费多模型能力，
 * 不直接依赖 conductor-hub-* 包（依赖倒置原则）。
 *
 * 实现者: conductor-hub-adapter (将 ConductorHubService 适配到此接口)
 */

/** 模型响应 */
export interface ModelResponse {
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
}

/** 并行查询请求 */
export interface ParallelRequest {
    prompt: string;
    provider?: string;
    systemPrompt?: string;
}

/** 共识结果 */
export interface ConsensusResult {
    /** 裁判的完整评估文本 */
    judgeText: string;
    /** 裁判使用的模型 */
    judgeModel: string;
    /** 获胜候选项的文本 */
    winnerText: string;
    /** 所有候选项 */
    candidates: Array<{ label: string; text: string; score?: number }>;
    /** 总耗时 */
    totalMs: number;
}

/**
 * 模型执行器端口 — conductor-core 消费多模型能力的唯一入口
 *
 * AGC 工作流节点映射:
 * - PARALLEL: parallelAsk() → 双模型并行思考
 * - DEBATE: 循环调用 ask() + 不同 systemPrompt → 交叉辩论
 * - VERIFY: ask() + 指定第三方模型 → 独立验证
 * - SYNTHESIZE: consensus() → 加权集成
 */
export interface IModelExecutor {
    /** 单模型查询 (支持智能路由) */
    ask(prompt: string, options?: {
        provider?: string;
        systemPrompt?: string;
    }): Promise<ModelResponse>;

    /** 并行查询多个模型 */
    parallelAsk(requests: ParallelRequest[]): Promise<ModelResponse[]>;

    /** 投票引擎: 多模型生成 → 裁判评分 → 最佳答案 */
    consensus(prompt: string, options?: {
        criteria?: string;
        providers?: string[];
        judgeProvider?: string;
    }): Promise<ConsensusResult>;
}
