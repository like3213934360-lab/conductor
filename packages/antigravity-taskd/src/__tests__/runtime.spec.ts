import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AntigravityTaskdRuntime } from '../runtime.js'
import type { WorkerAdapter, WorkerBackend, WorkerEvent, WorkerRunRequest, WorkerRunResult } from '../schema.js'

class FakeCodexAdapter implements WorkerAdapter {
  readonly backend: WorkerBackend = 'codex'

  async run(request: WorkerRunRequest, onEvent: (event: WorkerEvent) => void): Promise<WorkerRunResult> {
    onEvent({ type: 'started', timestamp: Date.now(), phase: 'thinking', message: `${request.role} started`, progress: 0.05 })
    onEvent({ type: 'progress', timestamp: Date.now(), phase: 'working', message: `${request.role} working`, progress: 0.5 })
    if (request.role === 'scout') {
      return {
        backend: 'codex',
        workerId: request.workerId,
        text: JSON.stringify({
          goalSummary: 'scouted goal',
          relevantPaths: request.filePaths.length > 0 ? request.filePaths : ['src/index.ts'],
          shards: [{
            shardId: 'shard-1',
            filePaths: request.filePaths.length > 0 ? request.filePaths : ['src/index.ts'],
            sharedFiles: [],
          }],
          unknowns: [],
          riskFlags: [],
        }),
        changedFiles: [],
      }
    }
    if (request.role === 'analyzer') {
      return {
        backend: 'codex',
        workerId: request.workerId,
        text: JSON.stringify({
          summary: 'analyzed shard',
          evidence: ['src/index.ts:1'],
          symbols: ['main'],
          dependencies: ['dep-a'],
          openQuestions: [],
          confidence: 0.9,
        }),
        changedFiles: [],
      }
    }
    if (request.role === 'aggregator') {
      return {
        backend: 'codex',
        workerId: request.workerId,
        text: JSON.stringify({
          globalSummary: 'aggregated result',
          agreements: ['all shard results align'],
          conflicts: [],
          missingCoverage: [],
        }),
        changedFiles: [],
      }
    }
    if (request.role === 'reviewer') {
      return {
        backend: 'codex',
        workerId: request.workerId,
        text: JSON.stringify({
          verdict: 'pass',
          coverageGaps: [],
          riskFindings: [],
          followups: [],
        }),
        changedFiles: [],
      }
    }
    return {
      backend: 'codex',
      workerId: request.workerId,
      text: JSON.stringify({
        changePlan: 'write completed',
        targetFiles: ['src/index.ts'],
        executionLog: ['updated file'],
        diffSummary: 'changed implementation',
      }),
      diff: 'diff --git a/src/index.ts b/src/index.ts',
      changedFiles: ['src/index.ts'],
    }
  }
}

class FakeGeminiAdapter implements WorkerAdapter {
  readonly backend: WorkerBackend = 'gemini'

  async run(request: WorkerRunRequest, onEvent: (event: WorkerEvent) => void): Promise<WorkerRunResult> {
    onEvent({ type: 'started', timestamp: Date.now(), phase: 'thinking', message: `${request.role} started`, progress: 0.05 })
    return {
      backend: 'gemini',
      workerId: request.workerId,
      text: JSON.stringify({
        summary: 'gemini review',
        evidence: ['src/index.ts:1'],
        symbols: ['main'],
        dependencies: [],
        openQuestions: [],
        confidence: 0.8,
      }),
      changedFiles: [],
    }
  }
}

const tempDirs: string[] = []

function makeWorkspace(files: Record<string, string>) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-taskd-'))
  tempDirs.push(workspaceRoot)
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(workspaceRoot, relativePath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, content, 'utf8')
  }
  return workspaceRoot
}

async function waitForJob(runtime: AntigravityTaskdRuntime, jobId: string) {
  const started = Date.now()
  for (;;) {
    const snapshot = runtime.getJob(jobId)
    if (!snapshot) {
      throw new Error(`Missing job ${jobId}`)
    }
    if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      return snapshot
    }
    if (Date.now() - started > 5_000) {
      throw new Error(`Timed out waiting for job ${jobId}`)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

describe('AntigravityTaskdRuntime', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('completes an analysis job and records aggregate + verify output', async () => {
    const workspaceRoot = makeWorkspace({ 'src/index.ts': 'export const main = () => 1\n' })
    const runtime = new AntigravityTaskdRuntime({
      dataDir: path.join(workspaceRoot, 'data', 'antigravity_taskd'),
      jobsDir: path.join(workspaceRoot, 'data', 'antigravity_taskd', 'jobs'),
      socketPath: path.join(os.tmpdir(), `taskd-${Date.now()}.sock`),
    }, {
      codex: new FakeCodexAdapter(),
      gemini: new FakeGeminiAdapter(),
    })
    await runtime.initialize()

    const created = runtime.createJob({
      goal: 'Analyze the implementation',
      mode: 'analysis',
      workspaceRoot,
      fileHints: ['src/index.ts'],
    })
    const snapshot = await waitForJob(runtime, created.jobId)
    expect(snapshot.status).toBe('completed')
    expect(snapshot.summary.globalSummary).toContain('aggregated')
    expect(snapshot.summary.verdict).toBe('pass')
    expect(snapshot.recentEvents.some(event => event.type === 'aggregate.completed')).toBe(true)
    expect(snapshot.recentEvents.some(event => event.type === 'verify.completed')).toBe(true)
  })

  it('runs the single writer path for write jobs and captures diff artifacts', async () => {
    const workspaceRoot = makeWorkspace({ 'src/index.ts': 'export const main = () => 1\n' })
    const runtime = new AntigravityTaskdRuntime({
      dataDir: path.join(workspaceRoot, 'data', 'antigravity_taskd'),
      jobsDir: path.join(workspaceRoot, 'data', 'antigravity_taskd', 'jobs'),
      socketPath: path.join(os.tmpdir(), `taskd-${Date.now()}.sock`),
    }, {
      codex: new FakeCodexAdapter(),
      gemini: new FakeGeminiAdapter(),
    })
    await runtime.initialize()

    const created = runtime.createJob({
      goal: 'Update the implementation',
      mode: 'write',
      workspaceRoot,
      fileHints: ['src/index.ts'],
    })
    const snapshot = await waitForJob(runtime, created.jobId)
    expect(snapshot.status).toBe('completed')
    expect(snapshot.artifacts.changedFiles).toContain('src/index.ts')
    expect(snapshot.artifacts.latestDiff).toContain('diff --git')
    expect(snapshot.recentEvents.some(event => event.type === 'write.completed')).toBe(true)
  })
})
