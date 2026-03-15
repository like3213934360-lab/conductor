/**
 * Antigravity Workflow Core — CLI Agent 运行器
 *
 * V1.1.0 重构: 使用 ProcessManager + Cancellable Timer 架构
 *
 * 超时策略 (五层):
 * ① 不活跃超时 (3 分钟): 进程已死且无输出 → 立即终止
 * ② 进程心跳 (30 秒): kill(0) 探测存活性
 *    - 存活 → 抑制不活跃超时 + 重置无数据计时器 (Heartbeat-Aware)
 *    - 死亡 → 等待不活跃超时触发
 * ③ 无真实数据超时: 进程虽活但无任何 stdout/stderr
 *    - 进程存活 → 20 分钟 (Codex 思考阶段可能无输出)
 *    - 进程已死 → 10 分钟 (快速清理)
 * ④ 绝对上限 (30 分钟): 无条件终止 (安全网)
 * ⑤ 外层安全网: parallel-executor 的 resolveTimeout() 保护
 *
 * 关键改进 (V1.1.0):
 * - 所有 setTimeout/setInterval 通过 AbortSignal 联动清理
 * - 消除 callCodex/callGemini 95% 代码重复
 * - 通过 killProcessTree 实现进程组级别击杀
 */

import { spawn } from 'child_process';
import {
    killProcessTree,
    cancellableTimer,
    cancellableInterval,
} from '@anthropic/antigravity-shared';
import type { ProgressCallback } from './progress-reporter.js';

// ── 共享超时常量 ──────────────────────────────────────────────────

const INACTIVITY_MS      = 180_000;       // ① 3 分钟
const HEARTBEAT_MS       = 30_000;        // ② 每 30 秒
const NO_DATA_MS         = 600_000;       // ③ 10 分钟 (进程已死)
const NO_DATA_ALIVE_MS   = 1_200_000;     // ③' 20 分钟 (进程存活, 容纳 Codex 思考)
const ABSOLUTE_MAX_MS    = 1_800_000;     // ④ 30 分钟

// ── CLI Agent 配置 ───────────────────────────────────────────────

interface CliAgentConfig {
    /** CLI 工具名称 (如 'codex', 'gemini') */
    toolName: string;
    /** spawn 命令 */
    command: string;
    /** spawn 参数 */
    args: string[];
    /** 工作目录 */
    cwd: string;
    /** 外部取消信号 */
    signal?: AbortSignal;
    /** 进度回调 */
    onProgress?: ProgressCallback;
    /** 输出后处理函数 */
    postProcess?: (stdout: string) => string;
    /** ENOENT 时的安装提示 */
    installHint: string;
}

// ── 通用 CLI Agent 运行器 ────────────────────────────────────────

/**
 * 通用 CLI Agent 运行器。消除 callCodex/callGemini 的 95% 代码重复。
 * 所有定时器通过内部 AbortController 联动 — abort 信号触发时全部自动清理。
 */
async function runCliAgent(config: CliAgentConfig): Promise<string> {
    const { toolName, command, args, cwd, signal, onProgress, postProcess, installHint } = config;

    return new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        let processAlive = true;

        // 内部 AbortController — 统一管理所有定时器的生命周期
        const timerController = new AbortController();
        const timerSignal = timerController.signal;

        // ── settle: 确保只 resolve/reject 一次，并清理所有资源 ──
        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            // 中止所有定时器
            timerController.abort();
            fn();
        }

        // ── 外部 abort 信号联动 ──
        if (signal) {
            if (signal.aborted) {
                // 已经 abort
                killProcessTree(child);
                reject(new Error(`${toolName} CLI cancelled by user or timeout`));
                return;
            }
            signal.addEventListener('abort', () => {
                settle(() => {
                    killProcessTree(child);
                    reject(new Error(`${toolName} CLI cancelled by user or timeout`));
                });
            }, { once: true });
        }

        // ── ① 不活跃超时 (可重置) ──
        let cancelInactivity: (() => void) | undefined;

        function resetInactivityTimer() {
            cancelInactivity?.();
            if (!settled) {
                cancelInactivity = cancellableTimer(INACTIVITY_MS, onInactivityTimeout, timerSignal);
            }
        }

        function onInactivityTimeout() {
            if (settled) return;
            if (processAlive) {
                // 进程还活着 → 重置，不杀
                resetInactivityTimer();
                return;
            }
            settle(() => {
                killProcessTree(child);
                reject(new Error(`${toolName} CLI timed out: process dead and no output for ${INACTIVITY_MS / 1000}s`));
            });
        }

        resetInactivityTimer();

        // ── ② 进程心跳 (Heartbeat-Aware) ──
        cancellableInterval(HEARTBEAT_MS, () => {
            if (settled) return;
            try {
                child.kill(0);
                processAlive = true;
                resetNoDataTimer(NO_DATA_ALIVE_MS);
                onProgress?.({
                    taskId: toolName,
                    progress: -1,
                    message: `${toolName} thinking (process alive)`,
                    phase: 'thinking',
                    timestamp: Date.now(),
                });
            } catch {
                processAlive = false;
                resetNoDataTimer(NO_DATA_MS);
            }
        }, timerSignal);

        // ── ③ 无真实数据超时 (可重置) ──
        let cancelNoData: (() => void) | undefined;

        function resetNoDataTimer(timeoutMs?: number) {
            cancelNoData?.();
            if (!settled) {
                const ms = timeoutMs ?? (processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS);
                cancelNoData = cancellableTimer(ms, onNoDataTimeout, timerSignal);
            }
        }

        function onNoDataTimeout() {
            const effectiveMs = processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS;
            settle(() => {
                killProcessTree(child);
                reject(new Error(`${toolName} CLI timed out: no real output for ${effectiveMs / 60000}min (processAlive=${processAlive})`));
            });
        }

        resetNoDataTimer(NO_DATA_ALIVE_MS);

        // ── ④ 绝对上限 ──
        cancellableTimer(ABSOLUTE_MAX_MS, () => {
            settle(() => {
                killProcessTree(child);
                reject(new Error(`${toolName} CLI reached absolute time limit (${ABSOLUTE_MAX_MS / 60000}min)`));
            });
        }, timerSignal);

        // ── 数据事件：同时重置 ① 和 ③ ──
        child.stdout!.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
            onProgress?.({
                taskId: toolName,
                progress: -1,
                message: `${toolName} producing output`,
                phase: 'working',
                timestamp: Date.now(),
            });
        });
        child.stderr!.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
        });

        // ── 生命周期事件 ──
        child.on('error', (err: NodeJS.ErrnoException) => {
            settle(() => {
                if (err.code === 'ENOENT') {
                    reject(new Error(`${toolName} CLI not found. ${installHint}`));
                } else {
                    reject(new Error(`${toolName} CLI error: ${err.message}`));
                }
            });
        });

        child.on('close', (code: number | null) => {
            settle(() => {
                const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
                const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
                if (code !== 0 && !stdout) {
                    reject(new Error(stderr || `${toolName} exited with code ${code}`));
                    return;
                }
                const output = postProcess ? postProcess(stdout) : stdout;
                resolve(output || `(${toolName} completed with no output)`);
            });
        });
    });
}

// ── Codex CLI (薄封装) ───────────────────────────────────────────

/**
 * 异步调用 Codex CLI。使用 spawn 避免阻塞事件循环。
 * @param onProgress 可选进度回调
 */
export async function callCodex(
    task: string,
    workingDir?: string,
    signal?: AbortSignal,
    onProgress?: ProgressCallback,
): Promise<string> {
    return runCliAgent({
        toolName: 'Codex',
        command: 'codex',
        args: ['exec', '--skip-git-repo-check', '--full-auto', task],
        cwd: workingDir || process.cwd(),
        signal,
        onProgress,
        installHint: 'Install: npm install -g @openai/codex, then: codex login',
    });
}

// ── Gemini CLI (薄封装) ──────────────────────────────────────────

/**
 * 异步调用 Gemini CLI。自动去除 ANSI 转义码。
 * @param onProgress 可选进度回调
 */
export async function callGemini(
    prompt: string,
    model?: string,
    workingDir?: string,
    signal?: AbortSignal,
    onProgress?: ProgressCallback,
): Promise<string> {
    const cliArgs: string[] = ['-p', prompt, '--yolo'];
    if (model) { cliArgs.push('-m', model); }

    return runCliAgent({
        toolName: 'Gemini',
        command: 'gemini',
        args: cliArgs,
        cwd: workingDir || process.cwd(),
        signal,
        onProgress,
        installHint: 'Install: https://github.com/google-gemini/gemini-cli — then run `gemini` to log in.',
        // 去除 ANSI 转义码
        // eslint-disable-next-line no-control-regex
        postProcess: (stdout) => stdout.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B[@-_]/g, ''),
    });
}
