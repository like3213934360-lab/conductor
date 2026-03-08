/**
 * Conductor Hub Core — CLI Agent 运行器
 *
 * Codex CLI + Gemini CLI 五层超时策略
 *
 * 超时策略:
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
 * 关键改进 (v2): Heartbeat-Aware No-Data Timeout
 * 当 kill(0) 确认进程存活时，自动重置无数据计时器。
 * 这解决了 Codex CLI 在大重构任务中「思考阶段 5-15 分钟无 stdout
 * 但进程活着」被误杀的问题。
 *
 * 参考: Temporal.io heartbeat timeout, LangGraph checkpointer
 */

import { spawn } from 'child_process';
import type { ProgressCallback } from './progress-reporter.js';

// ── 共享超时常量 ──────────────────────────────────────────────────────────────

const INACTIVITY_MS = 180_000;          // ① 3 分钟
const HEARTBEAT_MS = 30_000;            // ② 每 30 秒 (从 60s 加密到 30s, 更快探测)
const NO_DATA_MS = 600_000;             // ③ 10 分钟 (进程已死时使用)
const NO_DATA_ALIVE_MS = 1_200_000;     // ③' 20 分钟 (进程存活时使用, 容纳 Codex 思考)
const ABSOLUTE_MAX_MS = 1_800_000;      // ④ 30 分钟

// ── Codex CLI ─────────────────────────────────────────────────────────────────

/**
 * 异步调用 Codex CLI。使用 spawn 避免阻塞事件循环。
 * @param onProgress 可选进度回调，心跳时发射 thinking 事件，有输出时发射 working 事件
 */
export async function callCodex(task: string, workingDir?: string, signal?: AbortSignal, onProgress?: ProgressCallback): Promise<string> {
    const cwd = workingDir || process.cwd();

    return new Promise<string>((resolve, reject) => {
        const child = spawn(
            'codex',
            ['exec', '--skip-git-repo-check', '--full-auto', task],
            { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } }
        );

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        let processAlive = true;

        if (signal) {
            signal.addEventListener('abort', () => {
                settle(() => {
                    child.kill('SIGTERM');
                    reject(new Error('Codex CLI cancelled by user or timeout'));
                });
            });
        }

        function cleanup() {
            clearTimeout(inactivityTimer);
            clearTimeout(noDataTimer);
            clearTimeout(absoluteTimer);
            clearInterval(heartbeat);
        }
        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        }

        // ① 不活跃超时
        let inactivityTimer = setTimeout(onInactivityTimeout, INACTIVITY_MS);
        function resetInactivityTimer() {
            clearTimeout(inactivityTimer);
            if (!settled) {
                inactivityTimer = setTimeout(onInactivityTimeout, INACTIVITY_MS);
            }
        }
        function onInactivityTimeout() {
            if (settled) return;
            if (processAlive) {
                resetInactivityTimer();
                return;
            }
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Codex CLI timed out: process dead and no output for ${INACTIVITY_MS / 1000}s`));
            });
        }

        // ② 进程心跳 (Heartbeat-Aware)
        const heartbeat = setInterval(() => {
            if (settled) { clearInterval(heartbeat); return; }
            try {
                child.kill(0);
                processAlive = true;
                // 进程存活 → 重置无数据计时器 + 发射 thinking 进度
                resetNoDataTimer(NO_DATA_ALIVE_MS);
                onProgress?.({ taskId: 'codex', progress: -1, message: 'Codex thinking (process alive)', phase: 'thinking', timestamp: Date.now() });
            } catch {
                processAlive = false;
                resetNoDataTimer(NO_DATA_MS);
                clearInterval(heartbeat);
            }
        }, HEARTBEAT_MS);

        // ③ 无真实数据超时 (初始使用存活超时, 心跳会动态调整)
        let noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_ALIVE_MS);
        function resetNoDataTimer(timeoutMs?: number) {
            clearTimeout(noDataTimer);
            if (!settled) {
                const ms = timeoutMs ?? (processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS);
                noDataTimer = setTimeout(onNoDataTimeout, ms);
            }
        }
        function onNoDataTimeout() {
            const effectiveMs = processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS;
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Codex CLI timed out: no real output for ${effectiveMs / 60000}min (processAlive=${processAlive})`));
            });
        }

        // ④ 绝对上限
        const absoluteTimer = setTimeout(() => {
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Codex CLI reached absolute time limit (${ABSOLUTE_MAX_MS / 60000}min)`));
            });
        }, ABSOLUTE_MAX_MS);

        // 数据事件：同时重置 ① 和 ③
        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
            onProgress?.({ taskId: 'codex', progress: -1, message: 'Codex producing output', phase: 'working', timestamp: Date.now() });
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            settle(() => {
                if (err.code === 'ENOENT') {
                    reject(new Error('Codex CLI not found. Install: npm install -g @openai/codex, then: codex login'));
                } else {
                    reject(new Error(`Codex CLI error: ${err.message}`));
                }
            });
        });

        child.on('close', (code: number | null) => {
            settle(() => {
                const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
                const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
                if (code !== 0 && !stdout) {
                    reject(new Error(stderr || `Codex exited with code ${code}`));
                } else {
                    resolve(stdout || '(Codex completed with no output)');
                }
            });
        });
    });
}

// ── Gemini CLI ────────────────────────────────────────────────────────────────

/**
 * 异步调用 Gemini CLI。自动去除 ANSI 转义码。
 * @param onProgress 可选进度回调，心跳时发射 thinking 事件，有输出时发射 working 事件
 */
export async function callGemini(prompt: string, model?: string, workingDir?: string, signal?: AbortSignal, onProgress?: ProgressCallback): Promise<string> {
    const cwd = workingDir || process.cwd();

    const cliArgs: string[] = ['-p', prompt, '--yolo'];
    if (model) { cliArgs.push('-m', model); }

    return new Promise<string>((resolve, reject) => {
        const child = spawn('gemini', cliArgs, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let settled = false;
        let processAlive = true;

        if (signal) {
            signal.addEventListener('abort', () => {
                settle(() => {
                    child.kill('SIGTERM');
                    reject(new Error('Gemini CLI cancelled by user or timeout'));
                });
            });
        }

        function cleanup() {
            clearTimeout(inactivityTimer);
            clearTimeout(noDataTimer);
            clearTimeout(absoluteTimer);
            clearInterval(heartbeat);
        }
        function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        }

        // ① 不活跃超时
        let inactivityTimer = setTimeout(onInactivityTimeout, INACTIVITY_MS);
        function resetInactivityTimer() {
            clearTimeout(inactivityTimer);
            if (!settled) {
                inactivityTimer = setTimeout(onInactivityTimeout, INACTIVITY_MS);
            }
        }
        function onInactivityTimeout() {
            if (settled) return;
            if (processAlive) {
                resetInactivityTimer();
                return;
            }
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Gemini CLI timed out: process dead and no output for ${INACTIVITY_MS / 1000}s`));
            });
        }

        // ② 进程心跳 (Heartbeat-Aware)
        const heartbeat = setInterval(() => {
            if (settled) { clearInterval(heartbeat); return; }
            try {
                child.kill(0);
                processAlive = true;
                // 进程存活 → 重置无数据计时器 + 发射 thinking 进度
                resetNoDataTimer(NO_DATA_ALIVE_MS);
                onProgress?.({ taskId: 'gemini', progress: -1, message: 'Gemini thinking (process alive)', phase: 'thinking', timestamp: Date.now() });
            } catch {
                processAlive = false;
                resetNoDataTimer(NO_DATA_MS);
                clearInterval(heartbeat);
            }
        }, HEARTBEAT_MS);

        // ③ 无真实数据超时 (初始使用存活超时)
        let noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_ALIVE_MS);
        function resetNoDataTimer(timeoutMs?: number) {
            clearTimeout(noDataTimer);
            if (!settled) {
                const ms = timeoutMs ?? (processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS);
                noDataTimer = setTimeout(onNoDataTimeout, ms);
            }
        }
        function onNoDataTimeout() {
            const effectiveMs = processAlive ? NO_DATA_ALIVE_MS : NO_DATA_MS;
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Gemini CLI timed out: no real output for ${effectiveMs / 60000}min (processAlive=${processAlive})`));
            });
        }

        // ④ 绝对上限
        const absoluteTimer = setTimeout(() => {
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Gemini CLI reached absolute time limit (${ABSOLUTE_MAX_MS / 60000}min)`));
            });
        }, ABSOLUTE_MAX_MS);

        // 数据事件
        child.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
            onProgress?.({ taskId: 'gemini', progress: -1, message: 'Gemini producing output', phase: 'working', timestamp: Date.now() });
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderrChunks.push(chunk);
            resetInactivityTimer();
            resetNoDataTimer();
        });

        child.on('error', (err: NodeJS.ErrnoException) => {
            settle(() => {
                if (err.code === 'ENOENT') {
                    reject(new Error('Gemini CLI not found. Install: https://github.com/google-gemini/gemini-cli — then run `gemini` to log in.'));
                } else {
                    reject(new Error(`Gemini CLI error: ${err.message}`));
                }
            });
        });

        child.on('close', (code: number | null) => {
            settle(() => {
                const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
                const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
                if (code !== 0 && !stdout) {
                    reject(new Error(stderr || `Gemini CLI exited with code ${code}`));
                    return;
                }
                // 去除 ANSI 转义码
                // eslint-disable-next-line no-control-regex
                const clean = stdout.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B[@-_]/g, '');
                resolve(clean || '(Gemini completed with no output)');
            });
        });
    });
}
