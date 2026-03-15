import * as http from 'node:http'
import * as fs from 'node:fs'
import { URL } from 'node:url'
import type { AntigravityTaskdRuntime } from './runtime.js'
import { CreateTaskJobRequestSchema } from './schema.js'

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  const raw = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(raw),
  })
  res.end(raw)
}

const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024  // 5MB

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buf.length
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        req.destroy(new Error(`Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`))
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

export async function startTaskdHttpServer(socketPath: string, runtime: AntigravityTaskdRuntime): Promise<{ server: http.Server }> {
  if (fs.existsSync(socketPath)) {
    fs.rmSync(socketPath, { force: true })
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url || !req.method) {
      sendJson(res, 400, { error: 'Missing request metadata' })
      return
    }

    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'GET' && url.pathname === '/jobs') {
        sendJson(res, 200, { jobs: runtime.listJobs() })
        return
      }

      if (req.method === 'POST' && url.pathname === '/jobs') {
        const body = await readBody(req)
        const created = runtime.createJob(CreateTaskJobRequestSchema.parse(body))
        sendJson(res, 200, { jobId: created.jobId })
        return
      }

      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] !== 'jobs' || !parts[1]) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }

      const jobId = decodeURIComponent(parts[1])
      if (req.method === 'GET' && parts.length === 2) {
        const snapshot = runtime.getJob(jobId)
        if (!snapshot) {
          sendJson(res, 404, { error: `Job not found: ${jobId}` })
          return
        }
        sendJson(res, 200, snapshot)
        return
      }

      if (req.method === 'POST' && parts.length === 3 && parts[2] === 'cancel') {
        sendJson(res, 200, runtime.cancelJob(jobId))
        return
      }

      if (req.method === 'GET' && parts.length === 3 && parts[2] === 'stream') {
        const snapshot = runtime.getJob(jobId)
        if (!snapshot) {
          sendJson(res, 404, { error: `Job not found: ${jobId}` })
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })

        // ── SSE 反压防御 (Backpressure OOM Prevention) ──────────────
        // 如果客户端停止读取（TCP Window Zero），res.write() 返回 false 表示
        // 内核发送缓冲区已满。此时 Node.js 会将后续数据缓存在 V8 堆中，
        // 如果不限制，几秒钟内就会 OOM。
        //
        // 防御策略：
        //  1. 检查 res.write() 返回值
        //  2. 返回 false 时暂停写入，等待 'drain' 事件
        //  3. 设置 MAX_PENDING_WRITES 硬上限，超过则断开客户端
        const MAX_PENDING_WRITES = 128  // 防 OOM 安全阀
        let pendingWrites = 0
        let draining = false

        const safeSseWrite = (eventType: string, data: unknown): void => {
          if (res.destroyed) return
          // 硬上限：积压消息太多 → 断开连接，保护主进程
          if (pendingWrites > MAX_PENDING_WRITES) {
            console.warn(`[taskd] SSE client backpressure exceeded ${MAX_PENDING_WRITES} pending writes, disconnecting`)
            unsubscribe()
            res.end()
            return
          }
          const ok = res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`)
          if (!ok) {
            pendingWrites++
            draining = true
          }
        }

        res.on('drain', () => {
          pendingWrites = 0
          draining = false
        })

        safeSseWrite('snapshot', snapshot)
        const unsubscribe = runtime.subscribe(jobId, (event) => {
          safeSseWrite(event.type, event)
        })
        req.on('close', () => {
          unsubscribe()
          res.end()
        })
        return
      }

      sendJson(res, 404, { error: 'Not found' })
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return { server }
}
