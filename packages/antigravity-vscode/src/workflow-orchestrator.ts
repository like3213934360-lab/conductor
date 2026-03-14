import * as vscode from 'vscode'
import {
  AntigravityTaskdClient,
  spawnAntigravityTaskdProcess,
  createAntigravityTaskdProcessEnv,
  type TaskJobMode,
  type TaskJobSnapshot,
  type TaskJobEvent,
} from '../../antigravity-taskd/dist/index.js'

type WorkflowLifecycleState = 'idle' | 'starting' | 'running' | 'completed' | 'failed'

export interface StartWorkflowRunOptions {
  goal: string
  files?: string[]
  workflowId?: 'antigravity.strict-full' | 'antigravity.adaptive'
  mode?: TaskJobMode
}

export interface StartWorkflowRunResult {
  runId: string
}

interface TaskdRuntimeBundle {
  workspaceRoot: string
  client: AntigravityTaskdClient
  socketPath: string
}

interface LegacyRunSnapshot {
  runId: string
  status: string
  phase: string
  workflowTemplate: string
  verdict?: string
  nodes: Record<string, any>
  runtimeState: {
    version: number
    status: string
    nodes: Record<string, any>
  }
  updatedAt: string
  authorityOwner: string
  authorityHost: string
  timelineCursor: number
}

function mapJobStatus(status: TaskJobSnapshot['status']): string {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'running'
  }
}

function mapJobToLegacySnapshot(job: TaskJobSnapshot): LegacyRunSnapshot {
  const nodes = Object.fromEntries(job.graph.map((stage: any) => [stage.id, {
    status: stage.status === 'pending' ? 'pending'
      : stage.status === 'running' ? 'running'
      : stage.status === 'completed' ? 'completed'
      : stage.status === 'failed' ? 'failed'
      : 'skipped',
    startedAt: stage.startedAt,
    completedAt: stage.completedAt,
    detail: stage.detail,
  }]))
  const version = job.recentEvents.at(-1)?.sequence ?? 0
  return {
    runId: job.jobId,
    status: mapJobStatus(job.status),
    phase: job.currentStageId ?? 'SCOUT',
    workflowTemplate: `antigravity-taskd.${job.mode}`,
    verdict: job.summary.verdict,
    nodes,
    runtimeState: {
      version,
      status: mapJobStatus(job.status),
      nodes,
    },
    updatedAt: job.updatedAt,
    authorityOwner: 'antigravity-taskd',
    authorityHost: 'antigravity-taskd',
    timelineCursor: version,
  }
}

export class WorkflowOrchestrator implements vscode.Disposable {
  private runtime?: TaskdRuntimeBundle
  private activeRunId?: string
  private lifecycleState: WorkflowLifecycleState = 'idle'

  constructor(private readonly extensionRoot: string) {}

  async startRun(options: StartWorkflowRunOptions): Promise<StartWorkflowRunResult> {
    const goal = options.goal.trim()
    if (!goal) {
      throw new Error('Task goal must not be empty')
    }
    const runtime = await this.ensureRuntime()
    const files = this.collectFiles(options.files, runtime.workspaceRoot)
    const mode = options.mode ?? 'analysis'
    this.lifecycleState = 'starting'
    const created = await runtime.client.createJob({
      goal,
      mode,
      workspaceRoot: runtime.workspaceRoot,
      fileHints: files,
    })
    this.activeRunId = created.jobId
    this.lifecycleState = 'running'
    return { runId: created.jobId }
  }

  setActiveRunId(runId: string | undefined): void {
    this.activeRunId = runId
  }

  getStatus(): { state: WorkflowLifecycleState; runId?: string } {
    return { state: this.lifecycleState, runId: this.activeRunId }
  }

  async listJobs(): Promise<TaskJobSnapshot[]> {
    const runtime = await this.ensureRuntime()
    const listing = await runtime.client.listJobs()
    if (!this.activeRunId && listing.jobs.length > 0) {
      this.activeRunId = listing.jobs[0]!.jobId
    }
    return listing.jobs
  }

  async getJob(runId = this.activeRunId): Promise<TaskJobSnapshot> {
    if (!runId) {
      throw new Error('No task job has been started yet')
    }
    const runtime = await this.ensureRuntime()
    const job = await runtime.client.getJob(runId)
    this.activeRunId = job.jobId
    this.syncLifecycle(job)
    return job
  }

  async getRun(runId = this.activeRunId): Promise<{ snapshot: LegacyRunSnapshot }> {
    const job = await this.getJob(runId)
    return { snapshot: mapJobToLegacySnapshot(job) }
  }

  async cancelRun(runId = this.activeRunId): Promise<{ snapshot: LegacyRunSnapshot }> {
    if (!runId) {
      throw new Error('No task job has been started yet')
    }
    const runtime = await this.ensureRuntime()
    await runtime.client.cancelJob(runId)
    return this.getRun(runId)
  }

  async streamRun(
    runId: string,
    onUpdate: (event: { snapshot: LegacyRunSnapshot; entries: Array<{ sequence: number; createdAt: string; kind: string; nodeId?: string }>; nextCursor: number }) => void,
  ): Promise<vscode.Disposable> {
    const runtime = await this.ensureRuntime()
    const handle = await runtime.client.streamJob(runId, async (event: TaskJobEvent | { type: 'snapshot'; snapshot: TaskJobSnapshot }) => {
      if (event.type === 'snapshot') {
        onUpdate({
          snapshot: mapJobToLegacySnapshot(event.snapshot),
          entries: [],
          nextCursor: event.snapshot.recentEvents.at(-1)?.sequence ?? 0,
        })
        return
      }
      const snapshot = await this.getJob(runId)
      onUpdate({
        snapshot: mapJobToLegacySnapshot(snapshot),
        entries: [{
          sequence: event.sequence,
          createdAt: event.timestamp,
          kind: event.type,
          nodeId: typeof event.data.workerId === 'string'
            ? event.data.workerId
            : typeof event.data.shardId === 'string'
              ? event.data.shardId
              : undefined,
        }],
        nextCursor: event.sequence,
      })
    })
    return new vscode.Disposable(() => handle.dispose())
  }

  dispose(): void {
    this.runtime = undefined
  }

  private async ensureRuntime(): Promise<TaskdRuntimeBundle> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      throw new Error('Open a workspace before starting a task job')
    }

    if (this.runtime?.workspaceRoot === workspaceRoot && await this.runtime.client.ping()) {
      return this.runtime
    }

    const { paths } = createAntigravityTaskdProcessEnv({ workspaceRoot })
    const existingClient = new AntigravityTaskdClient(paths.socketPath)
    if (await existingClient.ping()) {
      this.runtime = {
        workspaceRoot,
        client: existingClient,
        socketPath: paths.socketPath,
      }
      return this.runtime
    }

    const entryPath = vscode.Uri.joinPath(
      vscode.Uri.file(this.extensionRoot),
      'dist',
      'antigravity-taskd.js',
    ).fsPath
    const spawned = await spawnAntigravityTaskdProcess({
      workspaceRoot,
      entryPath,
    })
    this.runtime = {
      workspaceRoot,
      client: spawned.client,
      socketPath: spawned.paths.socketPath,
    }
    return this.runtime
  }

  private collectFiles(explicitFiles: string[] | undefined, workspaceRoot: string): string[] {
    if (explicitFiles && explicitFiles.length > 0) {
      return explicitFiles
    }
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath
    if (activeFile && activeFile.startsWith(workspaceRoot)) {
      return [activeFile]
    }
    return []
  }

  private syncLifecycle(job: TaskJobSnapshot): void {
    switch (job.status) {
      case 'completed':
        this.lifecycleState = 'completed'
        break
      case 'failed':
      case 'cancelled':
        this.lifecycleState = 'failed'
        break
      default:
        this.lifecycleState = 'running'
        break
    }
  }
}
