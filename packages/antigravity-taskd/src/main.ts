import * as fs from 'node:fs'
import { AntigravityTaskdRuntime } from './runtime.js'
import { startTaskdHttpServer } from './server.js'
import { ANTIGRAVITY_TASKD_ENV, resolveAntigravityTaskdPaths } from './runtime-contract.js'

async function main(): Promise<void> {
  const workspaceRoot = process.env[ANTIGRAVITY_TASKD_ENV.workspaceRoot]
  if (!workspaceRoot) {
    throw new Error(`Missing ${ANTIGRAVITY_TASKD_ENV.workspaceRoot}`)
  }
  const resolvedPaths = resolveAntigravityTaskdPaths(workspaceRoot)
  const dataDir = process.env[ANTIGRAVITY_TASKD_ENV.dataDir] ?? resolvedPaths.dataDir
  const socketPath = process.env[ANTIGRAVITY_TASKD_ENV.socketPath] ?? resolvedPaths.socketPath

  fs.mkdirSync(dataDir, { recursive: true })
  const runtime = new AntigravityTaskdRuntime({
    dataDir,
    jobsDir: resolvedPaths.jobsDir,
    socketPath,
  })
  await runtime.initialize()
  await startTaskdHttpServer(socketPath, runtime)
}

void main().catch((error) => {
  console.error('[antigravity-taskd]', error)
  process.exitCode = 1
})
