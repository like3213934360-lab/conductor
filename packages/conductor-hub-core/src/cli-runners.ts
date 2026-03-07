/**
 * Conductor Hub Core — CLI Agent 运行器
 *
 * Codex CLI + Gemini CLI 4 层超时策略
 * 从 Conductor Hub mcp-server.ts L394-678 直接复制
 *
 * 四层超时策略:
 * ① 不活跃超时 (3 分钟): 进程已死且无输出 → 立即终止
 * ② 进程心跳 (60 秒): kill(0) 探测存活性，存活则抑制不活跃超时
 * ③ 无真实数据超时 (10 分钟): 进程虽活但无任何 stdout/stderr → 判定卡死
 * ④ 绝对上限 (30 分钟): 无条件终止 (安全网)
 */

import { spawn } from 'child_process';

// ── 共享超时常量 ──────────────────────────────────────────────────────────────

const INACTIVITY_MS = 180_000;      // ① 3 分钟
const HEARTBEAT_MS = 60_000;        // ② 每 60 秒
const NO_DATA_MS = 600_000;         // ③ 10 分钟
const ABSOLUTE_MAX_MS = 1_800_000;  // ④ 30 分钟

// ── Codex CLI ─────────────────────────────────────────────────────────────────

/**
 * 异步调用 Codex CLI。使用 spawn 避免阻塞事件循环。
 */
export async function callCodex(task: string, workingDir?: string, signal?: AbortSignal): Promise<string> {
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

        // ② 进程心跳
        const heartbeat = setInterval(() => {
            if (settled) { clearInterval(heartbeat); return; }
            try {
                child.kill(0);
                processAlive = true;
            } catch {
                processAlive = false;
                clearInterval(heartbeat);
            }
        }, HEARTBEAT_MS);

        // ③ 无真实数据超时
        let noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_MS);
        function resetNoDataTimer() {
            clearTimeout(noDataTimer);
            if (!settled) {
                noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_MS);
            }
        }
        function onNoDataTimeout() {
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Codex CLI timed out: no real output for ${NO_DATA_MS / 60000}min (process may be stuck despite being alive)`));
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
 */
export async function callGemini(prompt: string, model?: string, workingDir?: string, signal?: AbortSignal): Promise<string> {
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

        // ② 进程心跳
        const heartbeat = setInterval(() => {
            if (settled) { clearInterval(heartbeat); return; }
            try {
                child.kill(0);
                processAlive = true;
            } catch {
                processAlive = false;
                clearInterval(heartbeat);
            }
        }, HEARTBEAT_MS);

        // ③ 无真实数据超时
        let noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_MS);
        function resetNoDataTimer() {
            clearTimeout(noDataTimer);
            if (!settled) {
                noDataTimer = setTimeout(onNoDataTimeout, NO_DATA_MS);
            }
        }
        function onNoDataTimeout() {
            settle(() => {
                child.kill('SIGTERM');
                reject(new Error(`Gemini CLI timed out: no real output for ${NO_DATA_MS / 60000}min (process may be stuck despite being alive)`));
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
