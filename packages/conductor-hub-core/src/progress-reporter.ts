/**
 * Conductor Hub Core — 统一进度报告器
 *
 * 所有长任务通过 ProgressReporter 发送进度更新。
 * MCP 层监听事件并转发为 notifications/progress。
 *
 * 设计参考: Temporal.io Activity Heartbeat
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 进度阶段，对应任务生命周期 */
export type ProgressPhase = 'queued' | 'thinking' | 'working' | 'done' | 'error';

/** 单次进度事件 */
export interface ProgressEvent {
    /** 任务标识 */
    taskId: string;
    /** 当前进度 (0-1)，-1 表示不确定 */
    progress: number;
    /** 总量（可选）*/
    total?: number;
    /** 人类可读的状态消息 */
    message: string;
    /** 当前阶段 */
    phase: ProgressPhase;
    /** 事件时间戳 */
    timestamp: number;
}

/** 进度回调函数签名 */
export type ProgressCallback = (event: ProgressEvent) => void;

// ── ProgressReporter ────────────────────────────────────────────────────────

/**
 * 进度事件总线。
 *
 * 用法:
 * ```ts
 * const reporter = new ProgressReporter();
 *
 * // MCP 层监听
 * const unsub = reporter.on((event) => {
 *     server.sendNotification({ method: 'notifications/progress', params: ... });
 * });
 *
 * // CLI runner 层发射
 * reporter.emit({ taskId: 'codex-1', progress: 0.3, message: 'Analyzing...', phase: 'thinking' });
 *
 * // 清理
 * unsub();
 * ```
 */
export class ProgressReporter {
    private listeners = new Set<ProgressCallback>();

    /**
     * 注册进度监听器
     * @returns 取消订阅函数
     */
    on(callback: ProgressCallback): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    /**
     * 发射进度事件到所有监听器
     */
    emit(event: Omit<ProgressEvent, 'timestamp'>): void {
        const fullEvent: ProgressEvent = {
            ...event,
            timestamp: Date.now(),
        };
        for (const cb of this.listeners) {
            try {
                cb(fullEvent);
            } catch {
                // 监听器异常不影响其他监听器
            }
        }
    }

    /**
     * 创建一个绑定到特定 taskId 的子报告器
     * 简化调用方代码：不用每次都传 taskId
     */
    scoped(taskId: string): ScopedReporter {
        return new ScopedReporter(this, taskId);
    }

    /** 当前监听器数量（用于调试） */
    get listenerCount(): number {
        return this.listeners.size;
    }

    /** 清理所有监听器 */
    dispose(): void {
        this.listeners.clear();
    }
}

// ── ScopedReporter ──────────────────────────────────────────────────────────

/**
 * 绑定到特定 taskId 的子报告器。
 * CLI runner 和 parallel executor 使用它来简化进度报告。
 */
export class ScopedReporter {
    constructor(
        private parent: ProgressReporter,
        private taskId: string,
    ) {}

    /** 报告排队中 */
    queued(message = 'Queued'): void {
        this.parent.emit({ taskId: this.taskId, progress: 0, message, phase: 'queued' });
    }

    /** 报告思考中（AI 推理阶段，无输出） */
    thinking(message = 'Thinking...'): void {
        this.parent.emit({ taskId: this.taskId, progress: -1, message, phase: 'thinking' });
    }

    /** 报告工作中（有输出） */
    working(progress: number, message = 'Working...'): void {
        this.parent.emit({ taskId: this.taskId, progress, message, phase: 'working' });
    }

    /** 报告完成 */
    done(message = 'Done'): void {
        this.parent.emit({ taskId: this.taskId, progress: 1, message, phase: 'done' });
    }

    /** 报告错误 */
    error(message: string): void {
        this.parent.emit({ taskId: this.taskId, progress: -1, message, phase: 'error' });
    }
}
