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

// ── 常量 ─────────────────────────────────────────────────────────────────────

const MAX_TASKS = 8;
const MAX_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 50_000;

// ── 核心函数 ─────────────────────────────────────────────────────────────────

/**
 * 并行执行多个子任务 (worker-pool 模式)
 */
export async function runParallelTasks(
    tasks: SubTask[],
    service: ConductorHubService,
    maxConcurrency?: number,
): Promise<ParallelExecutionSummary> {
    if (tasks.length === 0) throw new Error('tasks 不能为空');
    if (tasks.length > MAX_TASKS) throw new Error(`最多 ${MAX_TASKS} 个任务, 当前 ${tasks.length}`);

    const concurrency = Math.min(
        Math.max(maxConcurrency ?? 2, 1),
        MAX_CONCURRENCY,
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

async function executeOneSafely(
    task: SubTask,
    index: number,
    service: ConductorHubService,
): Promise<SubTaskResult> {
    const id = task.id?.trim() || `task-${index + 1}`;
    const timeoutMs = task.timeout_ms ?? DEFAULT_TIMEOUT_MS;
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

async function dispatchTask(task: SubTask, service: ConductorHubService, signal?: AbortSignal): Promise<string> {
    switch (task.type) {
        case 'codex':
            return service.codexTask(task.prompt, task.working_dir, signal);
        case 'gemini':
            return service.geminiTask(task.prompt, task.model, task.working_dir, signal);
        case 'ask': {
            const r = await service.ask({ message: task.prompt, provider: task.provider, systemPrompt: task.system_prompt, signal });
            return r.text;
        }
        case 'multi_ask': {
            const r = await service.multiAsk({ message: task.prompt, systemPrompt: task.system_prompt, signal });
            return r.formatted;
        }
        case 'consensus': {
            const r = await service.consensus({ message: task.prompt, systemPrompt: task.system_prompt });
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
