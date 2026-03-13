import { AntigravityDaemonClient, resolveAntigravityDaemonPaths, type DaemonPaths } from './client.js'
import { AntigravityDaemonRuntime } from './runtime.js'
import { startAntigravityDaemonServer, type DaemonServerHandle } from './server.js'

export interface LaunchAntigravityDaemonHostOptions {
  workspaceRoot: string
  dataDir?: string
  projectionPath?: string
  socketPath?: string
  callbackHost?: string
  callbackPort?: number
  callbackBaseUrl?: string
  /** P1-A: strict trust mode — only verified workers can be delegated (default: false) */
  strictTrustMode?: boolean
  /** P1-A: remote worker failure policy — 'fallback' (default) or 'fail-closed' */
  federationFailPolicy?: 'fallback' | 'fail-closed'
}

export interface AntigravityDaemonHost {
  paths: DaemonPaths
  runtime: AntigravityDaemonRuntime
  server: DaemonServerHandle
  client: AntigravityDaemonClient
  callbackIngressBaseUrl: string
  close(): Promise<void>
}

export async function launchAntigravityDaemonHost(
  options: LaunchAntigravityDaemonHostOptions,
): Promise<AntigravityDaemonHost> {
  const resolvedPaths = resolveAntigravityDaemonPaths(options.workspaceRoot)
  const paths: DaemonPaths = {
    dataDir: options.dataDir ?? resolvedPaths.dataDir,
    projectionPath: options.projectionPath ?? resolvedPaths.projectionPath,
    socketPath: options.socketPath ?? resolvedPaths.socketPath,
  }

  const runtime = new AntigravityDaemonRuntime({
    workspaceRoot: options.workspaceRoot,
    dataDir: paths.dataDir,
    projectionPath: paths.projectionPath,
    socketPath: paths.socketPath,
    // P1-A fix: pass security config through to daemon runtime
    strictTrustMode: options.strictTrustMode,
    federationFailPolicy: options.federationFailPolicy,
  })
  await runtime.initialize()

  const server = await startAntigravityDaemonServer(runtime, {
    socketPath: paths.socketPath,
    callbackHost: options.callbackHost,
    callbackPort: options.callbackPort,
    callbackBaseUrl: options.callbackBaseUrl,
  })

  return {
    paths,
    runtime,
    server,
    client: new AntigravityDaemonClient(paths.socketPath),
    callbackIngressBaseUrl: server.callbackIngressBaseUrl,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.close(() => {
          runtime.close()
          resolve()
        })
      })
    },
  }
}
