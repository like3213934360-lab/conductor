/**
 * Conductor Hub — 结构化日志
 *
 * 轻量级 JSON 结构化日志, 零外部依赖。
 *
 * 特性:
 * - 级别: DEBUG / INFO / WARN / ERROR
 * - JSON 格式 + ISO 时间戳 + 模块标签
 * - 输出到 stderr (不污染 MCP stdio 通道)
 * - 通过 CONDUCTOR_LOG_LEVEL 环境变量控制 (默认 INFO)
 * - API Key 自动脱敏
 */

// ── 类型 ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
    ts: string;
    level: LogLevel;
    module: string;
    msg: string;
    [key: string]: unknown;
}

// ── 级别排序 ──────────────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

function parseLevel(env: string | undefined): LogLevel {
    const upper = (env || 'INFO').toUpperCase();
    if (upper in LEVEL_PRIORITY) return upper as LogLevel;
    return 'INFO';
}

// ── 脱敏 ─────────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = ['apiKey', 'api_key', 'token', 'secret', 'password', 'authorization'];

function sanitize(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk))) {
            result[key] = typeof value === 'string' && value.length > 8
                ? `${value.slice(0, 4)}****${value.slice(-4)}`
                : '****';
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = sanitize(value as Record<string, unknown>);
        } else {
            result[key] = value;
        }
    }
    return result;
}

// ── Logger 类 ─────────────────────────────────────────────────────────────────

/**
 * 结构化 JSON 日志器 — 线程安全, 零外部依赖
 *
 * ```ts
 * const log = createLogger('routing');
 * log.info('Route resolved', { model: 'deepseek-chat', task: 'code_gen' });
 * log.warn('Fallback triggered', { from: 'gpt-4', to: 'deepseek' });
 * log.error('All models failed', { errors: ['timeout', '503'] });
 * ```
 */
export class Logger {
    private minLevel: number;
    private module: string;

    constructor(module: string, level?: LogLevel) {
        this.module = module;
        this.minLevel = LEVEL_PRIORITY[level ?? parseLevel(process.env.CONDUCTOR_LOG_LEVEL)];
    }

    private emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < this.minLevel) return;

        const entry: LogEntry = {
            ts: new Date().toISOString(),
            level,
            module: this.module,
            msg,
            ...(data ? sanitize(data) : {}),
        };

        // stderr 写入: 不干扰 MCP stdio JSON-RPC 通道
        process.stderr.write(JSON.stringify(entry) + '\n');
    }

    debug(msg: string, data?: Record<string, unknown>): void { this.emit('DEBUG', msg, data); }
    info(msg: string, data?: Record<string, unknown>): void { this.emit('INFO', msg, data); }
    warn(msg: string, data?: Record<string, unknown>): void { this.emit('WARN', msg, data); }
    error(msg: string, data?: Record<string, unknown>): void { this.emit('ERROR', msg, data); }

    /** 创建带子模块标签的 child logger */
    child(subModule: string): Logger {
        return new Logger(`${this.module}:${subModule}`, this.levelName());
    }

    private levelName(): LogLevel {
        const entries = Object.entries(LEVEL_PRIORITY) as [LogLevel, number][];
        return entries.find(([, v]) => v === this.minLevel)?.[0] ?? 'INFO';
    }
}

// ── 工厂函数 ──────────────────────────────────────────────────────────────────

/** 创建带模块名的 logger 实例 */
export function createLogger(module: string): Logger {
    return new Logger(module);
}
