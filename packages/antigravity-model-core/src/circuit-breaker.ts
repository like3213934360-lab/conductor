/**
 * Circuit Breaker — 按模型的故障熔断器
 *
 * 业界标准 3-态模型:
 *   CLOSED  → 正常调用
 *   OPEN    → 熔断中, 直接跳过 (快速失败)
 *   HALF_OPEN → 试探性放行 1 次, 成功则恢复, 失败则继续熔断
 *
 * 每个 modelId 独立一个 breaker 实例, 互不干扰。
 */

// ── 类型 ─────────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
    /** 连续失败多少次触发 OPEN (默认 3) */
    failureThreshold: number;
    /** OPEN 持续多久后进入 HALF_OPEN, ms (默认 60_000) */
    resetTimeoutMs: number;
    /** HALF_OPEN 时最多允许放行几次试探 (默认 1) */
    halfOpenMax: number;
}

interface BreakerState {
    state: CircuitState;
    failures: number;
    lastFailureAt: number;
    halfOpenAttempts: number;
}

// ── 默认配置 ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 3,
    resetTimeoutMs: 60_000,
    halfOpenMax: 1,
};

// ── CircuitBreakerRegistry ───────────────────────────────────────────────────

/**
 * 全局 Circuit Breaker 注册表 — 按 modelId 管理独立 breaker
 *
 * 使用示例:
 * ```ts
 * const registry = new CircuitBreakerRegistry();
 * if (registry.canCall('deepseek-chat')) {
 *     try {
 *         const result = await callModel(route, msg);
 *         registry.onSuccess('deepseek-chat');
 *     } catch {
 *         registry.onFailure('deepseek-chat');
 *     }
 * } else {
 *     // 跳到下一个 fallback
 * }
 * ```
 */
export class CircuitBreakerRegistry {
    private breakers = new Map<string, BreakerState>();
    private config: CircuitBreakerConfig;

    constructor(config?: Partial<CircuitBreakerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /** 获取或创建 breaker */
    private getBreaker(modelId: string): BreakerState {
        let b = this.breakers.get(modelId);
        if (!b) {
            b = { state: 'CLOSED', failures: 0, lastFailureAt: 0, halfOpenAttempts: 0 };
            this.breakers.set(modelId, b);
        }
        return b;
    }

    /** 检查模型是否可调用 (自动处理 OPEN → HALF_OPEN 转换) */
    canCall(modelId: string): boolean {
        const b = this.getBreaker(modelId);

        switch (b.state) {
            case 'CLOSED':
                return true;

            case 'OPEN': {
                // 检查 reset timeout 是否到期
                if (Date.now() - b.lastFailureAt >= this.config.resetTimeoutMs) {
                    b.state = 'HALF_OPEN';
                    b.halfOpenAttempts = 0;
                    return true;
                }
                return false; // 仍在熔断中
            }

            case 'HALF_OPEN':
                if (b.halfOpenAttempts < this.config.halfOpenMax) {
                    b.halfOpenAttempts++;
                    return true;
                }
                return false;
        }
    }

    /** 调用成功 → 重置 breaker */
    onSuccess(modelId: string): void {
        const b = this.getBreaker(modelId);
        b.state = 'CLOSED';
        b.failures = 0;
        b.halfOpenAttempts = 0;
    }

    /** 调用失败 → 累计失败计数, 触发熔断 */
    onFailure(modelId: string): void {
        const b = this.getBreaker(modelId);

        if (b.state === 'HALF_OPEN') {
            // 试探失败 → 重新 OPEN
            b.state = 'OPEN';
            b.lastFailureAt = Date.now();
            return;
        }

        b.failures++;
        b.lastFailureAt = Date.now();

        if (b.failures >= this.config.failureThreshold) {
            b.state = 'OPEN';
        }
    }

    /** 获取模型当前状态 (诊断用) */
    getState(modelId: string): { state: CircuitState; failures: number } {
        const b = this.getBreaker(modelId);
        return { state: b.state, failures: b.failures };
    }

    /** 手动重置单个模型的 breaker */
    reset(modelId: string): void {
        this.breakers.delete(modelId);
    }

    /** 重置所有 breakers */
    resetAll(): void {
        this.breakers.clear();
    }
}
