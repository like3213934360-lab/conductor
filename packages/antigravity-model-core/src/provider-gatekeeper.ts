/**
 * Antigravity — 预检门控 + 达尔文回退链
 *
 * 在多模型调度（parallel_tasks / multi_ask / consensus）执行前，
 * 预检 provider 可用性并自动回退到最近的可用替代。
 *
 * 消除"静默失败黑洞"漏洞：
 * - 未配置的 provider 绝不被静默跳过
 * - 回退链用尽时显式熔断（throw）
 * - 所有降级事件留下高亮日志
 */

import type { AntigravityModelConfig, ModelConfig } from '@anthropic/antigravity-model-shared';
import { spawnSync } from 'child_process';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface ProviderAvailability {
    /** 已配置的 API 模型 ID 列表 */
    apiModels: string[];
    /** Codex CLI 是否可用 */
    codexAvailable: boolean;
    /** Gemini CLI 是否可用 */
    geminiAvailable: boolean;
}

export interface GatekeeperResult {
    /** 最终使用的 provider（可能是原始或回退后的） */
    resolvedHint: string;
    /** 是否发生了降级 */
    degraded: boolean;
    /** 降级警告日志（如果有） */
    warning?: string;
}

// ── 回退链 ────────────────────────────────────────────────────────────────────

/**
 * 达尔文回退优先级：
 *   用户指定(缺失) → deepseek → codex → gemini → 配置列表中第一个
 */
const API_FALLBACK_CHAIN = ['deepseek', 'codex', 'gemini'];

// ── 可用性探针 ────────────────────────────────────────────────────────────────

let _availabilityCache: ProviderAvailability | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 缓存 1 分钟

/**
 * 探测当前可用的 providers（带缓存）
 */
export function probeAvailability(config: AntigravityModelConfig, forceRefresh = false): ProviderAvailability {
    const now = Date.now();
    if (!forceRefresh && _availabilityCache && (now - _cacheTimestamp) < CACHE_TTL_MS) {
        return _availabilityCache;
    }

    // API 模型：从配置中读取已启用且有 API Key 的
    const apiModels = (config.models || [])
        .filter(m => m.enabled && m.apiKey)
        .map(m => m.id.toLowerCase());

    // CLI 工具：通过 spawn 探测
    const codexAvailable = isCliInstalled('codex');
    const geminiAvailable = isCliInstalled('gemini');

    _availabilityCache = { apiModels, codexAvailable, geminiAvailable };
    _cacheTimestamp = now;
    return _availabilityCache;
}

function isCliInstalled(cmd: string): boolean {
    try {
        const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000 });
        return !r.error && r.status === 0;
    } catch {
        return false;
    }
}

// ── 预检门控 ──────────────────────────────────────────────────────────────────

/**
 * 检查单个 provider hint 是否在可用模型中匹配
 */
function isHintAvailable(hint: string, availability: ProviderAvailability, config: AntigravityModelConfig): boolean {
    const h = hint.toLowerCase().trim();

    // CLI 特殊类型
    if (h === 'codex') return availability.codexAvailable;
    if (h === 'gemini') return availability.geminiAvailable;

    // API 模型：模糊匹配（id / modelId / label / baseUrl）
    const enabledModels = (config.models || []).filter(m => m.enabled && m.apiKey);
    return enabledModels.some(m => {
        const candidates = [m.id, m.modelId, m.label, m.baseUrl].map(v => v.toLowerCase());
        return candidates.some(c => c.includes(h) || h.includes(c));
    });
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 预检 + 回退门控（核心入口）
 *
 * @param requestedHint - 用户指定的 provider 名称
 * @param config - 当前模型配置
 * @returns GatekeeperResult，包含最终 provider 和降级信息
 * @throws 如果回退链全部耗尽，显式熔断
 */
export function gatekeeperResolve(requestedHint: string, config: AntigravityModelConfig): GatekeeperResult {
    const availability = probeAvailability(config);

    // ① 预检：用户指定的 provider 是否可用？
    if (isHintAvailable(requestedHint, availability, config)) {
        return { resolvedHint: requestedHint, degraded: false };
    }

    // ② 降级：遍历回退链
    for (const fallback of API_FALLBACK_CHAIN) {
        if (fallback === requestedHint.toLowerCase()) continue; // 跳过自己
        if (isHintAvailable(fallback, availability, config)) {
            const warning = `[LSO Orchestrator] ⚠️ Provider '${requestedHint}' not configured. Gracefully falling back to '${fallback}'.`;
            console.warn(warning);
            return { resolvedHint: fallback, degraded: true, warning };
        }
    }

    // ③ 最后防线：配置列表中第一个可用模型
    if (availability.apiModels.length > 0) {
        const firstAvailable = availability.apiModels[0]!;
        const warning = `[LSO Orchestrator] ⚠️ Provider '${requestedHint}' not configured. Falling back to first available model '${firstAvailable}'.`;
        console.warn(warning);
        return { resolvedHint: firstAvailable, degraded: true, warning };
    }

    // ④ 熔断：全链不可用
    throw new Error(
        `[LSO Orchestrator] 🚨 CIRCUIT BREAK: Provider '${requestedHint}' not configured, ` +
        `and no fallback providers are available. ` +
        `Checked: [${API_FALLBACK_CHAIN.join(', ')}] + configured models [none]. ` +
        `Please check your AI settings (antigravity.models).`
    );
}

/**
 * 批量预检 + 回退：用于 multi_ask / consensus 的 modelHints 数组
 *
 * 对每个 hint 独立执行门控，收集所有降级警告。
 * 如果某个 hint 全链不可用，其错误会被收集而非立即抛出（部分执行语义）。
 */
export function gatekeeperResolveBatch(
    hints: string[],
    config: AntigravityModelConfig,
): { resolvedHints: string[]; warnings: string[]; errors: string[] } {
    const resolvedHints: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const hint of hints) {
        try {
            const result = gatekeeperResolve(hint, config);
            resolvedHints.push(result.resolvedHint);
            if (result.warning) warnings.push(result.warning);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(msg);
            // 仍然尝试使用原始 hint（让下游决定如何处理）
            resolvedHints.push(hint);
        }
    }

    return { resolvedHints, warnings, errors };
}

/**
 * 清除可用性缓存（用于测试或配置变更后）
 */
export function clearAvailabilityCache(): void {
    _availabilityCache = null;
    _cacheTimestamp = 0;
}
