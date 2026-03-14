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

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
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
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
        const unsubscribe = runtime.subscribe(jobId, (event) => {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
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
