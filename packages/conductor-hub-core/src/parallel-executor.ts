/**
 * Conductor Hub — 并行任务执行器
 *
 * 在单个 MCP stdio 请求内并行执行多个 CLI/API 任务。
 * 核心特性:
 * - Worker-pool 并发模型 (可配置 maxConcurrency)
 * - 故障隔离 — 一个失败不影响其他
 * - 超时取消 + 结构化输出
 */

import { ConductorHubService } from './conductor-hub-service.js';
import { buildFileContext } from './file-context.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type SubTaskType = 'codex' | 'gemini' | 'ask' | 'multi_ask' | 'consensus';

export interface SubTask {
    id?: string;
    type: SubTaskType;
    /** codex 的 task / gemini 的 prompt / ask 的 message */
    prompt: string;
    /** Gemini 模型名 */
    model?: string;
    /** 工作目录 (codex/gemini) */
    working_dir?: string;
    /** 强制 provider (ask) */
    provider?: string;
    /** system prompt (ask/multi_ask/consensus) */
    system_prompt?: string;
    /** 超时毫秒数, 默认 300000 = 5 分钟 */
    timeout_ms?: number;
    /** 文件路径, 注入为上下文 (ask/multi_ask/consensus) */
    file_paths?: string[];
}

/** 执行器可配置参数 (均有合理默认值) */
export interface ExecutorConfig {
    maxTasks?: number;
    maxConcurrency?: number;
    cliDefaultTimeoutMs?: number;
    apiDefaultTimeoutMs?: number;
}

export interface SubTaskResult {
    id: string;
    type: SubTaskType;
    status: 'success' | 'error' | 'timeout';
    output: string;
    error?: string;
    durationMs: number;
}

export interface ParallelExecutionSummary {
    totalMs: number;
    concurrency: number;
    succeeded: number;
    failed: number;
    timedOut: number;
    results: SubTaskResult[];
}

// ── 常量 (默认值, 可通过 ExecutorConfig 覆盖) ──────────────────────────────

const DEFAULT_MAX_TASKS = 8;
const DEFAULT_MAX_CONCURRENCY = 4;
const MAX_OUTPUT_CHARS = 50_000;

/**
 * 四层超时策略常量 (与 cli-runners.ts 对齐)
 *
 * ① 不活跃超时: 进程已死且无输出 → 立即终止
 * ② 进程心跳: 由 cli-runners 内部处理 (kill(0) 探测)
 * ③ 无真实数据超时: 进程虽活但无新输出 → 判定卡死
 * ④ 绝对上限: 无条件终止 (安全网)
 *
 * CLI 任务 (codex/gemini):
 *   - 内层 cli-runners.ts 已有完整四层策略 (3min/60s/10min/30min)
 *   - 外层仅保留「绝对上限」作为安全网, 不提前干预
 *   - 用户可通过 timeout_ms 覆盖绝对上限, 但不得低于 CLI_MIN_TIMEOUT_MS
 *
 * API 任务 (ask/multi_ask/consensus):
 *   - 无 CLI 进程, 仅 HTTP 调用
 *   - 使用简单 setTimeout + AbortSignal
 */
const CLI_MIN_TIMEOUT_MS = 300_000;         // CLI 任务最小超时: 5 分钟
const CLI_DEFAULT_TIMEOUT_MS = 1_800_000;   // CLI 任务默认超时: 30 分钟 (= 绝对上限, 与 cli-runners.ts 对齐)
const API_DEFAULT_TIMEOUT_MS = 300_000;     // API 任务默认超时: 5 分钟

// ── 核心函数 ─────────────────────────────────────────────────────────────────

/**
 * 并行执行多个子任务 (worker-pool 模式)
 */
export async function runParallelTasks(
    tasks: SubTask[],
    service: ConductorHubService,
    maxConcurrency?: number,
    config?: ExecutorConfig,
): Promise<ParallelExecutionSummary> {
    const maxTasks = config?.maxTasks ?? DEFAULT_MAX_TASKS;
    const maxConc = config?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

    if (tasks.length === 0) throw new Error('tasks 不能为空');
    if (tasks.length > maxTasks) throw new Error(`最多 ${maxTasks} 个任务, 当前 ${tasks.length}`);

    const concurrency = Math.min(
        Math.max(maxConcurrency ?? 2, 1),
        maxConc,
        tasks.length,
    );
    const startedAt = Date.now();
    const results: SubTaskResult[] = new Array(tasks.length);

    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < tasks.length) {
            const index = cursor++;
            const task = tasks[index];
            if (!task) return;
            results[index] = await executeOneSafely(task, index, service);
        }
    });

    await Promise.all(workers);

    const succeeded = results.filter(r => r.status === 'success').length;
    const timedOut = results.filter(r => r.status === 'timeout').length;

    return {
        totalMs: Date.now() - startedAt,
        concurrency,
        succeeded,
        failed: results.length - succeeded - timedOut,
        timedOut,
        results,
    };
}

// ── 内部实现 ─────────────────────────────────────────────────────────────────

class TimeoutError extends Error {
    constructor(taskId: string, ms: number) {
        super(`任务 ${taskId} 超时 (${ms}ms)`);
        this.name = 'TimeoutError';
    }
}

/**
 * 判断是否为 CLI 类型任务
 * CLI 任务由 cli-runners.ts 内部管理四层超时, 外层仅做安全网
 */
function isCliTask(type: SubTaskType): boolean {
    return type === 'codex' || type === 'gemini';
}

/**
 * 计算任务的实际超时毫秒数
 *
 * CLI 任务: max(用户配置, CLI_MIN_TIMEOUT_MS), 默认 CLI_DEFAULT_TIMEOUT_MS
 * API 任务: 用户配置 || API_DEFAULT_TIMEOUT_MS
 */
function resolveTimeout(task: SubTask, config?: ExecutorConfig): number {
    if (isCliTask(task.type)) {
        const userTimeout = task.timeout_ms;
        if (userTimeout != null) {
            return Math.max(userTimeout, CLI_MIN_TIMEOUT_MS);
        }
        return config?.cliDefaultTimeoutMs ?? CLI_DEFAULT_TIMEOUT_MS;
    }
    return task.timeout_ms ?? config?.apiDefaultTimeoutMs ?? API_DEFAULT_TIMEOUT_MS;
}

async function executeOneSafely(
    task: SubTask,
    index: number,
    service: ConductorHubService,
): Promise<SubTaskResult> {
    const id = task.id?.trim() || `task-${index + 1}`;
    const timeoutMs = resolveTimeout(task);
    const startedAt = Date.now();
    const controller = new AbortController();

    try {
        const output = await withTimeout(
            () => dispatchTask(task, service, controller.signal),
            timeoutMs,
            id,
            controller,
        );
        return { id, type: task.type, status: 'success', output, durationMs: Date.now() - startedAt };
    } catch (e: unknown) {
        controller.abort();
        const msg = e instanceof Error ? e.message : String(e);
        const isTimeout = e instanceof TimeoutError;
        return { id, type: task.type, status: isTimeout ? 'timeout' : 'error', output: '', error: msg, durationMs: Date.now() - startedAt };
    }
}

/**
 * CLI 任务上下文注入: 预读 file_paths → 拼入 prompt → 消除 Codex 串行 tool call
 *
 * 当调用方提供 file_paths 时，在 dispatch 前将文件内容注入 prompt，
 * 使 Codex/Gemini 无需自行通过 tool call 逐文件读取，显著降低延迟。
 */
function enrichPromptWithFiles(task: SubTask): string {
    if (!task.file_paths || task.file_paths.length === 0 || !isCliTask(task.type)) {
        return task.prompt;
    }
    const { context, warnings } = buildFileContext(task.file_paths);
    if (!context) return task.prompt;

    const parts = [task.prompt, '\n\n' + context];
    if (warnings.length > 0) {
        parts.push(`\n\n> ⚠️ File context warnings: ${warnings.join('; ')}`);
    }
    return parts.join('');
}

async function dispatchTask(task: SubTask, service: ConductorHubService, signal?: AbortSignal): Promise<string> {
    // CLI 任务: 预注入文件上下文, 避免 Codex/Gemini 自行读文件
    const prompt = enrichPromptWithFiles(task);
    switch (task.type) {
        case 'codex':
            return service.codexTask(prompt, task.working_dir, signal);
        case 'gemini':
            return service.geminiTask(prompt, task.model, task.working_dir, signal);
        case 'ask': {
            const r = await service.ask({ message: task.prompt, provider: task.provider, systemPrompt: task.system_prompt, filePaths: task.file_paths, signal });
            return r.text;
        }
        case 'multi_ask': {
            const r = await service.multiAsk({ message: task.prompt, systemPrompt: task.system_prompt, filePaths: task.file_paths, signal });
            return r.formatted;
        }
        case 'consensus': {
            const r = await service.consensus({ message: task.prompt, systemPrompt: task.system_prompt, filePaths: task.file_paths });
            return r.judgeText;
        }
        default:
            throw new Error(`未知任务类型: ${task.type}`);
    }
}

async function withTimeout<T>(
    fn: () => Promise<T>,
    ms: number,
    taskId: string,
    controller: AbortController,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new TimeoutError(taskId, ms));
        }, ms);
    });
    try {
        return await Promise.race([fn(), timeoutPromise]);
    } finally {
        clearTimeout(timer!);
    }
}

// ── 结果格式化 ───────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
    return str.length > max ? str.substring(0, max) + '\n... (截断, 原始长度: ' + str.length + ')' : str;
}

export function formatParallelResults(summary: ParallelExecutionSummary): string {
    const header = [
        `⚡ **ai_parallel_tasks** 并行执行完成`,
        `📊 ${summary.results.length} 任务 | ✅ ${summary.succeeded} 成功 | ❌ ${summary.failed} 失败 | ⏱ ${summary.timedOut} 超时`,
        `🔀 并发: ${summary.concurrency} | 总耗时: ${summary.totalMs}ms`,
    ].join('\n');

    const body = summary.results.map((r) => {
        const icon = r.status === 'success' ? '✅' : r.status === 'timeout' ? '⏱' : '❌';
        const content = r.status === 'success' ? truncate(r.output, MAX_OUTPUT_CHARS) : `**错误**: ${r.error || '未知'}`;
        return `\n═══ ${icon} ${r.id} [${r.type}] — ${r.durationMs}ms ═══\n${content}`;
    }).join('\n');

    return `${header}\n${body}`;
}
