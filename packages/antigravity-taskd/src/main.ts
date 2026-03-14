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

  const { server } = await startTaskdHttpServer(socketPath, runtime)

  // ── K8s Graceful Shutdown ──────────────────────────────────────
  // K8s 发送 SIGTERM 后给予 30s 宽限期（terminationGracePeriodSeconds），
  // 在此期间我们必须：
  //   1. 停止接受新请求（关闭 HTTP 服务器）
  //   2. 通知所有运行中的 Job 终止（触发全局 AbortController）
  //   3. 利用剩余时间将内存中已完成的 Shard 抢救写入 Journal
  //   4. 以 exit(0) 退出，防止 K8s 等 30s 后发 SIGKILL
  let shuttingDown = false
  const gracefulShutdown = (signal: string) => {
    if (shuttingDown) return  // 防止重复触发
    shuttingDown = true
    console.log(`[taskd] Received ${signal}, starting graceful shutdown...`)

    // 1. 停止接受新连接
    server.close(() => {
      console.log('[taskd] HTTP server closed')
    })

    // 2. 通知 runtime 取消所有运行中的 Job
    //    runtime.shutdown() 内部应触发所有 Job 的 AbortController
    //    并将已完成的 Shard 结果 flush 到 Journal
    runtime.shutdown().then(() => {
      console.log('[taskd] All jobs drained, exiting cleanly')
      process.exit(0)
    }).catch((err: unknown) => {
      console.error('[taskd] Shutdown error:', err)
      process.exit(1)
    })

    // 3. 安全阀：如果 shutdown 在 25s 内还没完成，强制退出
    //    （留 5s 给 K8s 的 SIGKILL）
    setTimeout(() => {
      console.warn('[taskd] Graceful shutdown timed out after 25s, forcing exit')
      process.exit(1)
    }, 25_000).unref()  // unref 防止 timer 本身阻止进程退出
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

void main().catch((error) => {
  console.error('[antigravity-taskd]', error)
  process.exitCode = 1
})
