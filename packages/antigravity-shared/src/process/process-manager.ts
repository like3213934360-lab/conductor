/**
 * ProcessManager — 全局强约束进程管理器
 *
 * V1.1.0 第一战役核心基建：
 * - 封装 spawn/exec，强制要求 AbortSignal
 * - 进程树级别击杀（POSIX 进程组 + Windows 降级）
 * - AbortSignal 联动的可取消定时器
 * - 全局进程注册表 + 一键 shutdown
 *
 * 设计原则: 没有 AbortSignal 就不能 spawn。
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

// ── 进程树击杀 ──────────────────────────────────────────────────

/** SIGTERM → 等待 gracePeriodMs → SIGKILL 的梯度击杀延迟 */
const GRACE_KILL_DELAY_MS = 3_000

/**
 * 杀死进程及其整个进程组（子进程 + 孙子进程），防止僵尸进程泄漏。
 *
 * 在 POSIX 系统中，`process.kill(-pid)` 发送信号到整个进程组。
 * 如果进程组 kill 失败（例如权限不足或 Windows），退化为单进程 kill。
 */
export function killProcessTree(
  child: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  if (child.killed || child.exitCode !== null) return
  try {
    if (child.pid != null) {
      // 杀死整个进程组（pid 取负 = 进程组）
      process.kill(-child.pid, signal)
    }
  } catch {
    // 进程组 kill 失败（Windows 或已退出）→ 降级为直接 kill
    try {
      child.kill(signal)
    } catch {
      // 进程已退出 — 静默忽略
    }
  }
}

/**
 * 梯度击杀：先 SIGTERM，等待 gracePeriodMs 后若仍存活则 SIGKILL。
 */
export function gracefulKill(child: ChildProcess, gracePeriodMs: number = GRACE_KILL_DELAY_MS): void {
  killProcessTree(child, 'SIGTERM')

  // 如果已退出，无需 force kill
  if (child.killed || child.exitCode !== null) return

  const forceKillTimer = setTimeout(() => {
    if (!child.killed && child.exitCode === null) {
      killProcessTree(child, 'SIGKILL')
    }
  }, gracePeriodMs)

  // 如果进程在 grace period 内退出，取消 SIGKILL
  child.once('exit', () => clearTimeout(forceKillTimer))
  // 防止 timer 阻止 Node.js 进程退出
  if (forceKillTimer.unref) forceKillTimer.unref()
}

// ── 可取消定时器 ────────────────────────────────────────────────

/**
 * 返回一个在 `ms` 毫秒后 resolve 的 Promise。
 * 当 signal 被 abort 时，Promise 立即 reject。
 * 内部 timer 绝对不会泄漏。
 */
export function cancellableTimeout(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Aborted'))
      return
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('Aborted'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 绑定 AbortSignal 的 setInterval 替代品。
 * 当 signal abort 时自动 clearInterval，绝无泄漏。
 * 返回手动 stop 函数（用于提前结束）。
 */
export function cancellableInterval(
  ms: number,
  callback: () => void,
  signal: AbortSignal,
): () => void {
  if (signal.aborted) return () => {}

  const timer = setInterval(() => {
    if (signal.aborted) {
      clearInterval(timer)
      return
    }
    callback()
  }, ms)

  function stop() {
    clearInterval(timer)
    signal.removeEventListener('abort', stop)
  }

  signal.addEventListener('abort', stop, { once: true })
  return stop
}

/**
 * 绑定 AbortSignal 的 setTimeout 替代品（fire-once）。
 * 当 signal abort 时自动 clearTimeout。
 * 返回手动 cancel 函数。
 */
export function cancellableTimer(
  ms: number,
  callback: () => void,
  signal: AbortSignal,
): () => void {
  if (signal.aborted) return () => {}

  const timer = setTimeout(() => {
    signal.removeEventListener('abort', cancel)
    callback()
  }, ms)

  function cancel() {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }

  signal.addEventListener('abort', cancel, { once: true })
  return cancel
}

// ── ManagedProcess — spawn 封装 ─────────────────────────────────

export interface ManagedSpawnOptions extends SpawnOptions {
  /** 绝对超时（毫秒）。超时后自动 graceful kill。 */
  timeoutMs?: number
}

export interface ManagedProcessHandle {
  /** 底层 ChildProcess */
  child: ChildProcess
  /** 进程退出的 Promise（resolve: exit code, reject: error/abort） */
  exitPromise: Promise<number | null>
  /** 手动 kill（触发 graceful shutdown） */
  kill: (signal?: NodeJS.Signals) => void
}

/**
 * 强制绑定 AbortSignal 的 spawn 封装。
 *
 * - abort 信号 → gracefulKill（SIGTERM → 3s → SIGKILL）
 * - 超时 → 自动 abort
 * - 自动注册到全局 ProcessRegistry
 */
export function managedSpawn(
  command: string,
  args: readonly string[],
  signal: AbortSignal,
  options: ManagedSpawnOptions = {},
): ManagedProcessHandle {
  const { timeoutMs, ...spawnOpts } = options

  if (signal.aborted) {
    // 已经 abort，不 spawn
    const dummyHandle: ManagedProcessHandle = {
      child: null as unknown as ChildProcess,
      exitPromise: Promise.reject(signal.reason ?? new Error('Aborted before spawn')),
      kill: () => {},
    }
    // 防止 unhandled rejection
    dummyHandle.exitPromise.catch(() => {})
    return dummyHandle
  }

  const child = spawn(command, args as string[], {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOpts,
  })

  // 注册到全局注册表
  ProcessRegistry.register(child)

  // 超时自动击杀
  let timeoutCleanup: (() => void) | undefined
  if (timeoutMs != null && timeoutMs > 0) {
    timeoutCleanup = cancellableTimer(timeoutMs, () => {
      gracefulKill(child)
    }, signal)
  }

  // abort 信号 → graceful kill
  function onAbort() {
    gracefulKill(child)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.on('error', (err) => {
      cleanup()
      reject(err)
    })
    child.on('exit', (code) => {
      cleanup()
      resolve(code)
    })

    function cleanup() {
      signal.removeEventListener('abort', onAbort)
      timeoutCleanup?.()
      ProcessRegistry.unregister(child)
    }
  })

  return {
    child,
    exitPromise,
    kill: (sig?: NodeJS.Signals) => gracefulKill(child, sig === 'SIGKILL' ? 0 : undefined),
  }
}

// ── 全局进程注册表 ──────────────────────────────────────────────

/**
 * 全局进程注册表。
 * 所有通过 managedSpawn 创建的进程自动注册。
 * VS Code deactivate 时调用 shutdown() 批量清理。
 */
export class ProcessRegistry {
  private static readonly _processes = new Set<ChildProcess>()

  static register(child: ChildProcess): void {
    ProcessRegistry._processes.add(child)
    child.once('exit', () => ProcessRegistry._processes.delete(child))
  }

  static unregister(child: ChildProcess): void {
    ProcessRegistry._processes.delete(child)
  }

  /** 当前存活进程数 */
  static get size(): number {
    return ProcessRegistry._processes.size
  }

  /**
   * 一键关闭所有注册的进程。
   * 用于 VS Code extension deactivate 或测试清理。
   */
  static shutdown(): void {
    for (const child of ProcessRegistry._processes) {
      gracefulKill(child)
    }
    ProcessRegistry._processes.clear()
  }
}
