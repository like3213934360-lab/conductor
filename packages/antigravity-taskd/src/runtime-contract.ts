import * as crypto from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'

export const ANTIGRAVITY_TASKD_ENV = {
  workspaceRoot: 'ANTIGRAVITY_TASKD_WORKSPACE_ROOT',
  dataDir: 'ANTIGRAVITY_TASKD_DATA_DIR',
  socketPath: 'ANTIGRAVITY_TASKD_SOCKET_PATH',
} as const

export interface TaskdPaths {
  dataDir: string
  jobsDir: string
  socketPath: string
}

/**
 * Unix socket 路径在 Linux/macOS 上有严格的 104-108 字节限制
 * （struct sockaddr_un.sun_path）。深层工作区根目录如
 * `/Users/xxx/very/nested/deep/project` 替换后可达 60+ 字符，
 * 加上 tmpdir 前缀极易超限导致 `ENAMETOOLONG`。
 *
 * 策略：
 * 1. Windows → 使用 Named Pipes（无路径长度限制）
 * 2. macOS/Linux → 优先使用可读的 safeRoot 名称；
 *    若总长度 > 100 字节，回退到 SHA256 短哈希（12 字符）
 */
export function resolveAntigravityTaskdPaths(workspaceRoot: string): TaskdPaths {
  const safeRoot = workspaceRoot.replace(/[/\\:]/g, '_')
  const dataDir = path.join(workspaceRoot, 'data', 'antigravity_taskd')
  const jobsDir = path.join(dataDir, 'jobs')

  let socketPath: string
  if (process.platform === 'win32') {
    // Windows Named Pipes — 无长度限制，无需文件系统路径
    socketPath = `\\\\.\\pipe\\antigravity-taskd-${safeRoot}`
  } else {
    // Unix socket — 受 108 字节路径限制
    const candidate = path.join(os.tmpdir(), `antigravity-taskd-${safeRoot}.sock`)
    if (Buffer.byteLength(candidate, 'utf8') > 100) {
      // 路径过长：回退到 SHA256 短哈希保证唯一性
      const hash = crypto.createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12)
      socketPath = path.join(os.tmpdir(), `ag-taskd-${hash}.sock`)
    } else {
      socketPath = candidate
    }
  }

  return { dataDir, jobsDir, socketPath }
}
