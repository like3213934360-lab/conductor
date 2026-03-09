/**
 * Conductor AGC — 隔离沙箱 (Isolated Sandbox)
 *
 * 在现有 CapabilitySandbox (软件级权限检查) 之上，
 * 增加进程级和 API 级代码隔离执行。
 *
 * 三级隔离架构:
 * 1. InProcess — 同进程运行，仅做权限检查（现有 CapabilitySandbox）
 * 2. ProcessIsolation — Node.js child_process 隔离
 * 3. E2BIsolation — E2B 远程沙箱（硬件虚拟化）
 *
 * 参考:
 * - E2B v3 (2025) — MicroVM sandbox for AI agents
 * - AWS Firecracker — microVM technology
 * - Deno permissions — capability-based security
 * - Val Town — sandboxed serverless functions
 */
import { CapabilitySandbox } from './capability-sandbox.js'

// ── 沙箱类型 ──────────────────────────────────────────────────────

/** 代码执行请求 */
export interface CodeExecutionRequest {
  /** 要执行的代码 */
  code: string
  /** 语言 */
  language: 'typescript' | 'javascript' | 'python' | 'shell'
  /** 超时 ms */
  timeoutMs: number
  /** 环境变量 */
  env?: Record<string, string>
  /** 工作目录 */
  cwd?: string
  /** 内存限制 MB */
  memoryLimitMb?: number
}

/** 代码执行结果 */
export interface CodeExecutionResult {
  /** 执行状态 */
  status: 'success' | 'error' | 'timeout' | 'killed'
  /** 标准输出 */
  stdout: string
  /** 标准错误 */
  stderr: string
  /** 退出码 */
  exitCode: number
  /** 执行耗时 ms */
  durationMs: number
  /** 使用的隔离级别 */
  isolationLevel: IsolationLevel
}

/** 隔离级别 */
export type IsolationLevel = 'in_process' | 'process' | 'e2b'

/** 代码沙箱接口 */
export interface ICodeSandbox {
  /** 沙箱名称 */
  readonly name: string
  /** 隔离级别 */
  readonly level: IsolationLevel
  /** 是否可用 */
  isAvailable(): boolean
  /** 执行代码 */
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>
}

// ── Process Isolation 实现 ────────────────────────────────────────

/**
 * ProcessSandbox — Node.js child_process 隔离
 *
 * 通过 child_process.execFile 在独立进程中执行代码:
 * - 进程级内存隔离
 * - 超时强制 kill
 * - stdout/stderr 分离
 * - 不能读写主进程内存
 *
 * 限制:
 * - 仍在同一 OS 上运行（共享文件系统）
 * - 需配合 CapabilitySandbox 做路径限制
 */
export class ProcessSandbox implements ICodeSandbox {
  readonly name = 'ProcessSandbox'
  readonly level: IsolationLevel = 'process'

  isAvailable(): boolean {
    return true // Node.js 原生支持
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileAsync = promisify(execFile)

    const t0 = Date.now()

    // 根据语言选择执行器
    const { cmd, args } = this.getExecutor(request)

    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: request.timeoutMs,
        maxBuffer: (request.memoryLimitMb ?? 50) * 1024 * 1024,
        env: { ...process.env, ...request.env },
        cwd: request.cwd,
      })

      return {
        status: 'success',
        stdout: stdout.slice(0, 50000), // 限制输出大小
        stderr: stderr.slice(0, 10000),
        exitCode: 0,
        durationMs: Date.now() - t0,
        isolationLevel: 'process',
      }
    } catch (error: unknown) {
      const err = error as { killed?: boolean; code?: string; stdout?: string; stderr?: string; status?: number }
      const isTimeout = err.killed || err.code === 'ERR_CHILD_PROCESS_TIMEOUT'

      return {
        status: isTimeout ? 'timeout' : err.killed ? 'killed' : 'error',
        stdout: (err.stdout ?? '').slice(0, 50000),
        stderr: (err.stderr ?? (error instanceof Error ? error.message : String(error))).slice(0, 10000),
        exitCode: err.status ?? 1,
        durationMs: Date.now() - t0,
        isolationLevel: 'process',
      }
    }
  }

  private getExecutor(request: CodeExecutionRequest): { cmd: string; args: string[] } {
    switch (request.language) {
      case 'typescript':
        return { cmd: 'npx', args: ['tsx', '-e', request.code] }
      case 'javascript':
        return { cmd: 'node', args: ['-e', request.code] }
      case 'python':
        return { cmd: 'python3', args: ['-c', request.code] }
      case 'shell':
        return { cmd: 'sh', args: ['-c', request.code] }
    }
  }
}

// ── E2B Sandbox 适配层 ──────────────────────────────────────────

/**
 * E2BSandbox — E2B 远程沙箱适配器
 *
 * 通过 E2B API 在远程 microVM 中执行代码:
 * - 硬件级虚拟化隔离
 * - 完全隔离的文件系统
 * - 网络隔离
 * - 独立内核
 *
 * 需要配置:
 * - E2B_API_KEY 环境变量
 * - 网络可达 E2B 服务
 */
export class E2BSandbox implements ICodeSandbox {
  readonly name = 'E2BSandbox'
  readonly level: IsolationLevel = 'e2b'

  private readonly apiKey: string | undefined

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env['E2B_API_KEY']
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    if (!this.apiKey) {
      throw new Error('E2B_API_KEY not configured')
    }

    const t0 = Date.now()

    try {
      // E2B REST API 调用
      const response = await fetch('https://api.e2b.dev/v1/sandboxes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template: this.getTemplate(request.language),
          code: request.code,
          timeout: Math.ceil(request.timeoutMs / 1000),
          env: request.env,
        }),
        signal: AbortSignal.timeout(request.timeoutMs + 5000),
      })

      if (!response.ok) {
        const errText = await response.text()
        return {
          status: 'error',
          stdout: '',
          stderr: `E2B API error: ${response.status} ${errText}`,
          exitCode: 1,
          durationMs: Date.now() - t0,
          isolationLevel: 'e2b',
        }
      }

      const result = await response.json() as { stdout: string; stderr: string; exit_code: number }

      return {
        status: result.exit_code === 0 ? 'success' : 'error',
        stdout: (result.stdout ?? '').slice(0, 50000),
        stderr: (result.stderr ?? '').slice(0, 10000),
        exitCode: result.exit_code,
        durationMs: Date.now() - t0,
        isolationLevel: 'e2b',
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      return {
        status: isTimeout ? 'timeout' : 'error',
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        durationMs: Date.now() - t0,
        isolationLevel: 'e2b',
      }
    }
  }

  private getTemplate(language: string): string {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return 'node-20'
      case 'python':
        return 'python-3.11'
      default:
        return 'base'
    }
  }
}

// ── Sandbox Manager ──────────────────────────────────────────────

/**
 * SandboxManager — 智能沙箱选择器
 *
 * 根据风险级别和可用性自动选择最佳隔离级别:
 * - low risk → ProcessSandbox
 * - high/critical risk → E2BSandbox (如可用) → ProcessSandbox (降级)
 */
export class SandboxManager {
  private readonly processSandbox: ProcessSandbox
  private readonly e2bSandbox: E2BSandbox

  constructor(e2bApiKey?: string) {
    this.processSandbox = new ProcessSandbox()
    this.e2bSandbox = new E2BSandbox(e2bApiKey)
  }

  /**
   * 根据风险级别选择沙箱
   */
  selectSandbox(riskLevel: 'low' | 'medium' | 'high' | 'critical'): ICodeSandbox {
    if ((riskLevel === 'high' || riskLevel === 'critical') && this.e2bSandbox.isAvailable()) {
      return this.e2bSandbox
    }
    return this.processSandbox
  }

  /**
   * 执行代码（自动选择隔离级别）
   */
  async execute(
    request: CodeExecutionRequest,
    riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  ): Promise<CodeExecutionResult> {
    const sandbox = this.selectSandbox(riskLevel)
    return sandbox.execute(request)
  }

  /** 获取所有可用的沙箱 */
  getAvailableSandboxes(): Array<{ name: string; level: IsolationLevel; available: boolean }> {
    return [
      { name: this.processSandbox.name, level: this.processSandbox.level, available: this.processSandbox.isAvailable() },
      { name: this.e2bSandbox.name, level: this.e2bSandbox.level, available: this.e2bSandbox.isAvailable() },
    ]
  }
}
