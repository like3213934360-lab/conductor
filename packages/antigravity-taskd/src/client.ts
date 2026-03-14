import * as http from 'node:http'
import type { CreateTaskJobRequest, CreateTaskJobResponse, TaskJobEvent, TaskJobSnapshot } from './schema.js'
import { resolveAntigravityTaskdPaths, type TaskdPaths } from './runtime-contract.js'

interface RequestOptions {
  method: 'GET' | 'POST'
  requestPath: string
  body?: unknown
}

export class AntigravityTaskdClient {
  constructor(private readonly socketPath: string) {}

  async ping(): Promise<boolean> {
    try {
      const response = await this.request<{ ok: boolean }>({ method: 'GET', requestPath: '/health' })
      return response.ok === true
    } catch {
      return false
    }
  }

  async waitForReady(timeoutMs = 10_000): Promise<void> {
    const started = Date.now()
    while (!(await this.ping())) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Timed out waiting for antigravity-taskd on ${this.socketPath}`)
      }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }

  createJob(request: CreateTaskJobRequest): Promise<CreateTaskJobResponse> {
    return this.request({
      method: 'POST',
      requestPath: '/jobs',
      body: request,
    })
  }

  getJob(jobId: string): Promise<TaskJobSnapshot> {
    return this.request({
      method: 'GET',
      requestPath: `/jobs/${encodeURIComponent(jobId)}`,
    })
  }

  listJobs(): Promise<{ jobs: TaskJobSnapshot[] }> {
    return this.request({
      method: 'GET',
      requestPath: '/jobs',
    })
  }

  cancelJob(jobId: string): Promise<{ jobId: string; cancelled: boolean }> {
    return this.request({
      method: 'POST',
      requestPath: `/jobs/${encodeURIComponent(jobId)}/cancel`,
      body: {},
    })
  }

  async streamJob(jobId: string, onEvent: (event: TaskJobEvent | { type: 'snapshot'; snapshot: TaskJobSnapshot }) => void): Promise<{ dispose(): void }> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        socketPath: this.socketPath,
        method: 'GET',
        path: `/jobs/${encodeURIComponent(jobId)}/stream`,
      })

      req.on('response', (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          const chunks: Buffer[] = []
          res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            reject(new Error(raw || `Stream failed (${res.statusCode})`))
          })
          return
        }

        let buffer = ''
        const parseFrame = (frame: string) => {
          const lines = frame.split('\n').filter(Boolean)
          let eventName = 'message'
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
            if (line.startsWith('data:')) data += line.slice('data:'.length).trim()
          }
          if (!data) return
          if (eventName === 'snapshot') {
            onEvent({ type: 'snapshot', snapshot: JSON.parse(data) as TaskJobSnapshot })
            return
          }
          onEvent(JSON.parse(data) as TaskJobEvent)
        }

        res.on('data', chunk => {
          buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
          for (;;) {
            const splitIndex = buffer.indexOf('\n\n')
            if (splitIndex === -1) break
            const frame = buffer.slice(0, splitIndex)
            buffer = buffer.slice(splitIndex + 2)
            parseFrame(frame)
          }
        })

        resolve({
          dispose() {
            req.destroy()
            res.destroy()
          },
        })
      })

      req.on('error', reject)
      req.end()
    })
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
      const req = http.request({
        socketPath: this.socketPath,
        method: options.method,
        path: options.requestPath,
        headers: payload ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        } : undefined,
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const data = raw ? JSON.parse(raw) as Record<string, unknown> : {}
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(typeof data.error === 'string' ? data.error : `Taskd request failed (${res.statusCode})`))
            return
          }
          resolve(data as T)
        })
      })

      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }
}

export { resolveAntigravityTaskdPaths, type TaskdPaths }
