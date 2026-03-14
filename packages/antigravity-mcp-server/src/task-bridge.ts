import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  AntigravityTaskdClient,
  createAntigravityTaskdProcessEnv,
  spawnAntigravityTaskdProcess,
  type CreateTaskJobRequest,
  type CreateTaskJobResponse,
  type TaskJobSnapshot,
  type TaskJobEvent,
} from '../../antigravity-taskd/dist/index.js'

interface TaskdRuntimeHandle {
  workspaceRoot: string
  client: AntigravityTaskdClient
  socketPath: string
  taskdProcess?: ChildProcess
}

function resolveWorkspaceRoot(explicitWorkspaceRoot?: string): string {
  return explicitWorkspaceRoot?.trim() ||
    process.env['ANTIGRAVITY_WORKSPACE_ROOT']?.trim() ||
    process.cwd()
}

function resolveTaskdEntry(): string {
  const envEntry = process.env['ANTIGRAVITY_TASKD_ENTRY']
  if (envEntry && fs.existsSync(envEntry)) {
    return envEntry
  }

  const require = createRequire(__filename)
  const packageEntry = require.resolve('@anthropic/antigravity-taskd')
  const packagedMain = path.join(path.dirname(packageEntry), 'main.js')
  if (fs.existsSync(packagedMain)) {
    return packagedMain
  }

  const bundledMain = path.resolve(process.cwd(), 'dist', 'antigravity-taskd.js')
  if (fs.existsSync(bundledMain)) {
    return bundledMain
  }

  throw new Error('Unable to resolve antigravity-taskd entrypoint. Set ANTIGRAVITY_TASKD_ENTRY explicitly.')
}

export class AntigravityTaskBridge {
  private runtime?: TaskdRuntimeHandle

  async createJob(request: CreateTaskJobRequest, workspaceRoot?: string): Promise<CreateTaskJobResponse> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.createJob(request)
  }

  async getJob(jobId: string, workspaceRoot?: string): Promise<TaskJobSnapshot> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.getJob(jobId)
  }

  async listJobs(workspaceRoot?: string): Promise<{ jobs: TaskJobSnapshot[] }> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.listJobs()
  }

  async cancelJob(jobId: string, workspaceRoot?: string): Promise<{ jobId: string; cancelled: boolean }> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.cancelJob(jobId)
  }

  async streamJob(
    jobId: string,
    onEvent: (event: TaskJobEvent | { type: 'snapshot'; snapshot: TaskJobSnapshot }) => void,
    workspaceRoot?: string,
  ): Promise<{ dispose(): void }> {
    const runtime = await this.ensureRuntime(workspaceRoot)
    return runtime.client.streamJob(jobId, onEvent)
  }

  dispose(): void {
    this.runtime = undefined
  }

  private async ensureRuntime(explicitWorkspaceRoot?: string): Promise<TaskdRuntimeHandle> {
    const workspaceRoot = resolveWorkspaceRoot(explicitWorkspaceRoot)

    if (this.runtime?.workspaceRoot === workspaceRoot && await this.runtime.client.ping()) {
      return this.runtime
    }

    const { paths } = createAntigravityTaskdProcessEnv({ workspaceRoot })
    const client = new AntigravityTaskdClient(paths.socketPath)
    if (await client.ping()) {
      this.runtime = {
        workspaceRoot,
        client,
        socketPath: paths.socketPath,
      }
      return this.runtime
    }

    const spawned = await spawnAntigravityTaskdProcess({
      workspaceRoot,
      entryPath: resolveTaskdEntry(),
    })
    this.runtime = {
      workspaceRoot,
      client: spawned.client,
      socketPath: spawned.paths.socketPath,
      taskdProcess: spawned.taskdProcess,
    }
    return this.runtime
  }
}
