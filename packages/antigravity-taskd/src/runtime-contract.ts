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

export function resolveAntigravityTaskdPaths(workspaceRoot: string): TaskdPaths {
  const safeRoot = workspaceRoot.replace(/[/\\:]/g, '_')
  const dataDir = path.join(workspaceRoot, 'data', 'antigravity_taskd')
  const jobsDir = path.join(dataDir, 'jobs')
  const socketPath = path.join(os.tmpdir(), `antigravity-taskd-${safeRoot}.sock`)
  return { dataDir, jobsDir, socketPath }
}
