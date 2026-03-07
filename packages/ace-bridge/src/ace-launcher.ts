import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { DevEcoEnvironment } from './deveco-detector'

export interface LaunchOptions {
  env: DevEcoEnvironment
  maxOldSpaceSize?: number
  logPath?: string
  logLevel?: string
}

export interface LaunchResult {
  process: ChildProcess
  kill: () => void
}

/**
 * 使用 DevEco 自带的 Node.js 启动 ace-server 子进程。
 * 返回 ChildProcess 供 VS Code LanguageClient 的 ServerOptions 使用。
 *
 * ace-server 解析 process.argv.slice(2).join("&") 提取 logger-level 和 logger-path，
 * 两者都必须存在才会正确初始化语言服务。
 */
export function launchAceServer(options: LaunchOptions): LaunchResult {
  const { env, maxOldSpaceSize = 4096 } = options

  if (!fs.existsSync(env.aceServerEntry)) {
    throw new Error(
      `ace-server 入口不存在: ${env.aceServerEntry}\n` +
      '请确认 DevEco Studio 已正确安装且版本支持 ace-server。'
    )
  }

  if (!fs.existsSync(env.nodeExecutable)) {
    throw new Error(
      `DevEco 自带的 Node.js 不存在: ${env.nodeExecutable}\n` +
      '请确认 DevEco Studio 安装完整。'
    )
  }

  // 日志目录：用户指定 或 临时目录
  const logPath = options.logPath || path.join(os.tmpdir(), 'ace-server-logs')
  if (!fs.existsSync(logPath)) {
    fs.mkdirSync(logPath, { recursive: true })
  }
  const logLevel = options.logLevel || 'INFO'

  // ace-server 解析 process.argv.slice(2).join("&") 来提取参数
  // 所以参数格式为：--stdio logger-level=INFO logger-path=/tmp/xxx
  const child = spawn(env.nodeExecutable, [
    `--max-old-space-size=${maxOldSpaceSize}`,
    env.aceServerEntry,
    '--stdio',
    `--logger-level=${logLevel}`,
    `--logger-path=${logPath}`,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: env.aceServerDir,
  })

  return {
    process: child,
    kill: () => {
      if (!child.killed) {
        child.kill()
      }
    },
  }
}
