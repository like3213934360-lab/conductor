import { spawn, type ChildProcess } from 'node:child_process'
import { AntigravityTaskdClient } from './client.js'
import { ANTIGRAVITY_TASKD_ENV, resolveAntigravityTaskdPaths, type TaskdPaths } from './runtime-contract.js'

export interface AntigravityTaskdProcessEnvOptions {
  workspaceRoot: string
  dataDir?: string
  socketPath?: string
  env?: NodeJS.ProcessEnv
}

export interface SpawnAntigravityTaskdProcessOptions extends AntigravityTaskdProcessEnvOptions {
  entryPath: string
  cwd?: string
  windowsHide?: boolean
  waitTimeoutMs?: number
}

export interface AntigravityTaskdProcessHandle {
  workspaceRoot: string
  paths: TaskdPaths
  client: AntigravityTaskdClient
  taskdProcess?: ChildProcess
}

export function createAntigravityTaskdProcessEnv(
  options: AntigravityTaskdProcessEnvOptions,
): { paths: TaskdPaths; env: NodeJS.ProcessEnv } {
  const resolvedPaths = resolveAntigravityTaskdPaths(options.workspaceRoot)
  const paths: TaskdPaths = {
    dataDir: options.dataDir ?? resolvedPaths.dataDir,
    jobsDir: resolvedPaths.jobsDir,
    socketPath: options.socketPath ?? resolvedPaths.socketPath,
  }
  return {
    paths,
    env: {
      ...process.env,
      ...options.env,
      [ANTIGRAVITY_TASKD_ENV.workspaceRoot]: options.workspaceRoot,
      [ANTIGRAVITY_TASKD_ENV.dataDir]: paths.dataDir,
      [ANTIGRAVITY_TASKD_ENV.socketPath]: paths.socketPath,
    },
  }
}

export async function spawnAntigravityTaskdProcess(
  options: SpawnAntigravityTaskdProcessOptions,
): Promise<AntigravityTaskdProcessHandle> {
  const { paths, env } = createAntigravityTaskdProcessEnv(options)
  const taskdProcess = spawn(process.execPath, [
    // 防止大型工程下 VFS + Blackboard + SQLite 堆内存触顶引发
    // V8 老生代 Stop-The-World GC 卡顿（默认 ~2GB 易频繁触发）
    '--max-old-space-size=4096',
    options.entryPath,
  ], {
    cwd: options.cwd ?? options.workspaceRoot,
    env,
    stdio: 'ignore',
    detached: true,
    windowsHide: options.windowsHide ?? true,
  })
  taskdProcess.unref()

  const client = new AntigravityTaskdClient(paths.socketPath)
  await client.waitForReady(options.waitTimeoutMs)
  return {
    workspaceRoot: options.workspaceRoot,
    paths,
    client,
    taskdProcess,
  }
}
