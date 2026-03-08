/**
 * Conductor Hub Core — 异步作业管理器
 *
 * 超长任务 (>5 分钟) 不阻塞 MCP 工具调用。
 * 改为 start_job → poll_status 两步模式。
 *
 * Temporal.io 三层超时实现:
 * ① Schedule-to-Start: 排队超 60s → 自动失败
 * ② Start-to-Close: 按任务类型使用 resolveTimeout()
 * ③ Heartbeat: 由 cli-runners.ts 内部管理
 *
 * 内存安全:
 * - 最多 50 个活跃作业
 * - 完成的作业 1 小时后自动清理
 */

import { ConductorHubService } from './conductor-hub-service.js';
import type { ProgressReporter } from './progress-reporter.js';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
export type JobType = 'codex' | 'gemini';

export interface AsyncJob {
    jobId: string;
    type: JobType;
    status: JobStatus;
    prompt: string;
    result?: string;
    error?: string;
    createdAt: number;
    startedAt?: number;
    updatedAt: number;
    progress: number;
    message: string;
}

export interface StartJobOptions {
    type: JobType;
    prompt: string;
    model?: string;
    workingDir?: string;
}

// ── 常量 ─────────────────────────────────────────────────────────────────────

const MAX_JOBS = 50;
const SCHEDULE_TO_START_MS = 60_000;     // ① 排队超时: 60 秒
const COMPLETED_JOB_TTL_MS = 3_600_000; // 完成作业保留: 1 小时
const CLEANUP_INTERVAL_MS = 300_000;     // 清理周期: 5 分钟

// ── AsyncJobManager ──────────────────────────────────────────────────────────

export class AsyncJobManager {
    private jobs = new Map<string, AsyncJob>();
    private cleanupTimer: ReturnType<typeof setInterval> | undefined;
    private abortControllers = new Map<string, AbortController>();

    constructor(
        private service: ConductorHubService,
        private reporter?: ProgressReporter,
    ) {
        // 自动清理过期作业
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }

    /**
     * 启动一个异步作业，立即返回 jobId
     */
    start(options: StartJobOptions): string {
        // 容量检查
        if (this.jobs.size >= MAX_JOBS) {
            this.cleanup(); // 强制清理一次
            if (this.jobs.size >= MAX_JOBS) {
                throw new Error(`作业数达到上限 (${MAX_JOBS})，请等待现有作业完成`);
            }
        }

        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const now = Date.now();

        const job: AsyncJob = {
            jobId,
            type: options.type,
            status: 'queued',
            prompt: options.prompt,
            createdAt: now,
            updatedAt: now,
            progress: 0,
            message: '排队中...',
        };

        this.jobs.set(jobId, job);

        // 报告进度
        this.reporter?.scoped(jobId).queued();

        // 异步执行（不阻塞）
        this.executeAsync(jobId, options).catch((err) => {
            const existingJob = this.jobs.get(jobId);
            if (existingJob && existingJob.status !== 'cancelled') {
                existingJob.status = 'failed';
                existingJob.error = err instanceof Error ? err.message : String(err);
                existingJob.updatedAt = Date.now();
                this.reporter?.scoped(jobId).error(existingJob.error);
            }
        });

        return jobId;
    }

    /**
     * 查询作业状态
     */
    poll(jobId: string): AsyncJob | undefined {
        return this.jobs.get(jobId);
    }

    /**
     * 取消作业
     */
    cancel(jobId: string): boolean {
        const job = this.jobs.get(jobId);
        if (!job) return false;

        if (job.status === 'queued' || job.status === 'running') {
            job.status = 'cancelled';
            job.updatedAt = Date.now();
            job.message = '已取消';

            // 触发 AbortController
            const controller = this.abortControllers.get(jobId);
            if (controller) {
                controller.abort();
                this.abortControllers.delete(jobId);
            }

            this.reporter?.scoped(jobId).error('Cancelled by user');
            return true;
        }

        return false;
    }

    /**
     * 列出所有作业（按创建时间倒序）
     */
    list(): AsyncJob[] {
        return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * 清理过期的已完成作业
     */
    cleanup(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [jobId, job] of this.jobs.entries()) {
            const isTerminal = job.status === 'completed' || job.status === 'failed'
                || job.status === 'timeout' || job.status === 'cancelled';

            if (isTerminal && (now - job.updatedAt) > COMPLETED_JOB_TTL_MS) {
                this.jobs.delete(jobId);
                this.abortControllers.delete(jobId);
                cleaned++;
            }
        }

        return cleaned;
    }

    /**
     * 销毁管理器，清理所有资源
     */
    dispose(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        // 取消所有运行中的作业
        for (const controller of this.abortControllers.values()) {
            controller.abort();
        }
        this.abortControllers.clear();
        this.jobs.clear();
    }

    // ── 内部实现 ─────────────────────────────────────────────────────────────

    private async executeAsync(jobId: string, options: StartJobOptions): Promise<void> {
        const job = this.jobs.get(jobId);
        if (!job) return;

        // ① Schedule-to-Start: 检查排队时间
        const queueTime = Date.now() - job.createdAt;
        if (queueTime > SCHEDULE_TO_START_MS) {
            job.status = 'timeout';
            job.error = `排队超时: ${queueTime}ms > ${SCHEDULE_TO_START_MS}ms`;
            job.updatedAt = Date.now();
            this.reporter?.scoped(jobId).error(job.error);
            return;
        }

        // 状态转换: queued → running
        job.status = 'running';
        job.startedAt = Date.now();
        job.updatedAt = Date.now();
        job.message = '执行中...';

        const scoped = this.reporter?.scoped(jobId);
        scoped?.working(0.1, `${options.type} 任务启动`);

        // 创建 AbortController
        const controller = new AbortController();
        this.abortControllers.set(jobId, controller);

        try {
            let result: string;

            // ② Start-to-Close: 由 cli-runners.ts 内部的四层超时策略管理
            switch (options.type) {
                case 'codex':
                    result = await this.service.codexTask(
                        options.prompt,
                        options.workingDir,
                        controller.signal,
                    );
                    break;
                case 'gemini':
                    result = await this.service.geminiTask(
                        options.prompt,
                        options.model,
                        options.workingDir,
                        controller.signal,
                    );
                    break;
                default:
                    throw new Error(`不支持的作业类型: ${options.type}`);
            }

            // 成功完成
            job.status = 'completed';
            job.result = result;
            job.progress = 1;
            job.message = '完成';
            job.updatedAt = Date.now();
            scoped?.done();

        } catch (err) {
            // 从 Map 重新读取: cancel() 可能从另一个异步上下文修改了 status
            const currentJob = this.jobs.get(jobId);
            if (!currentJob || currentJob.status === 'cancelled') return;

            const msg = err instanceof Error ? err.message : String(err);
            const isTimeout = msg.includes('timed out') || msg.includes('time limit');

            job.status = isTimeout ? 'timeout' : 'failed';
            job.error = msg;
            job.message = isTimeout ? '执行超时' : '执行失败';
            job.updatedAt = Date.now();
            scoped?.error(msg);

        } finally {
            this.abortControllers.delete(jobId);
        }
    }
}

// ── 格式化工具 ──────────────────────────────────────────────────────────────

/**
 * 格式化作业状态为人类可读文本
 */
export function formatJobStatus(job: AsyncJob): string {
    const statusIcons: Record<JobStatus, string> = {
        queued: '⏳',
        running: '🔄',
        completed: '✅',
        failed: '❌',
        timeout: '⏱',
        cancelled: '🚫',
    };

    const icon = statusIcons[job.status];
    const elapsed = job.startedAt
        ? `${((job.updatedAt - job.startedAt) / 1000).toFixed(1)}s`
        : 'pending';

    const lines = [
        `${icon} **Job ${job.jobId}** [${job.type}]`,
        `状态: ${job.status} | 耗时: ${elapsed}`,
        `消息: ${job.message}`,
    ];

    if (job.result) {
        const truncated = job.result.length > 500
            ? job.result.substring(0, 500) + `\n... (截断, 原始长度: ${job.result.length})`
            : job.result;
        lines.push(`\n---\n${truncated}`);
    }

    if (job.error) {
        lines.push(`错误: ${job.error}`);
    }

    return lines.join('\n');
}
