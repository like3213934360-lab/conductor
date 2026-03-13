import { spawn, type ChildProcess } from 'node:child_process'
import { AntigravityDaemonClient, resolveAntigravityDaemonPaths, type DaemonPaths } from './client.js'
import {
  ANTIGRAVITY_DAEMON_CALLBACK_HOST_DEFAULT,
  ANTIGRAVITY_DAEMON_CALLBACK_PORT_DEFAULT,
  ANTIGRAVITY_DAEMON_ENV,
} from './runtime-contract.js'

export interface AntigravityDaemonProcessEnvOptions {
  workspaceRoot: string
  dataDir?: string
  projectionPath?: string
  socketPath?: string
  callbackHost?: string
  callbackPort?: number
  callbackBaseUrl?: string
  strictTrustMode?: boolean
  federationFailPolicy?: 'fallback' | 'fail-closed'
  env?: NodeJS.ProcessEnv
}

export interface SpawnAntigravityDaemonProcessOptions extends AntigravityDaemonProcessEnvOptions {
  entryPath: string
  cwd?: string
  windowsHide?: boolean
  waitTimeoutMs?: number
  onStdout?(text: string): void
  onStderr?(text: string): void
}

export interface AntigravityDaemonProcessHandle {
  workspaceRoot: string
  paths: DaemonPaths
  client: AntigravityDaemonClient
  daemonProcess: ChildProcess
}

export function createAntigravityDaemonProcessEnv(
  options: AntigravityDaemonProcessEnvOptions,
): { paths: DaemonPaths; env: NodeJS.ProcessEnv } {
  const resolvedPaths = resolveAntigravityDaemonPaths(options.workspaceRoot)
  const paths: DaemonPaths = {
    dataDir: options.dataDir ?? resolvedPaths.dataDir,
    projectionPath: options.projectionPath ?? resolvedPaths.projectionPath,
    socketPath: options.socketPath ?? resolvedPaths.socketPath,
  }

  return {
    paths,
    env: {
      ...process.env,
      ...options.env,
      [ANTIGRAVITY_DAEMON_ENV.workspaceRoot]: options.workspaceRoot,
      [ANTIGRAVITY_DAEMON_ENV.dataDir]: paths.dataDir,
      [ANTIGRAVITY_DAEMON_ENV.projectionPath]: paths.projectionPath,
      [ANTIGRAVITY_DAEMON_ENV.socketPath]: paths.socketPath,
      [ANTIGRAVITY_DAEMON_ENV.callbackHost]: options.callbackHost ?? ANTIGRAVITY_DAEMON_CALLBACK_HOST_DEFAULT,
      [ANTIGRAVITY_DAEMON_ENV.callbackPort]: String(options.callbackPort ?? ANTIGRAVITY_DAEMON_CALLBACK_PORT_DEFAULT),
      ...(options.callbackBaseUrl ? { [ANTIGRAVITY_DAEMON_ENV.callbackBaseUrl]: options.callbackBaseUrl } : {}),
      ...(options.strictTrustMode != null ? { [ANTIGRAVITY_DAEMON_ENV.strictTrustMode]: String(options.strictTrustMode) } : {}),
      ...(options.federationFailPolicy ? { [ANTIGRAVITY_DAEMON_ENV.federationFailPolicy]: options.federationFailPolicy } : {}),
    },
  }
}

export async function spawnAntigravityDaemonProcess(
  options: SpawnAntigravityDaemonProcessOptions,
): Promise<AntigravityDaemonProcessHandle> {
  const { paths, env } = createAntigravityDaemonProcessEnv(options)
  const daemonProcess = spawn(process.execPath, [options.entryPath], {
    cwd: options.cwd ?? options.workspaceRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: options.windowsHide ?? true,
  })

  daemonProcess.stdout?.on('data', (chunk) => {
    options.onStdout?.(String(chunk).trim())
  })
  daemonProcess.stderr?.on('data', (chunk) => {
    options.onStderr?.(String(chunk).trim())
  })

  const client = new AntigravityDaemonClient(paths.socketPath)
  await client.waitForReady(options.waitTimeoutMs)

  return {
    workspaceRoot: options.workspaceRoot,
    paths,
    client,
    daemonProcess,
  }
}
