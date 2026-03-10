import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { AGCService, DagEngine } from '@anthropic/conductor-core'
import { AGCRunDriver, ConductorHubService } from '@anthropic/conductor-hub-core'
import { InMemoryEventStore, InMemoryCheckpointStore } from '@anthropic/conductor-mcp-server'
import type { EventStore, CheckpointStore } from '@anthropic/conductor-core'

type AgcLifecycleState = 'idle' | 'starting' | 'running' | 'completed' | 'failed'

export interface StartAgcRunOptions {
  goal: string
  files?: string[]
}

export interface StartAgcRunResult {
  runId: string
}

interface AgcRuntimeBundle {
  workspaceRoot: string
  dataDir: string
  walPath: string
  eventStore: EventStore
  checkpointStore: CheckpointStore
  agcService: AGCService
  hubService: ConductorHubService
}

export class AgcOrchestrator implements vscode.Disposable {
  private runtime?: AgcRuntimeBundle
  private activeRunId?: string
  private activeRunTask: Promise<void> | null = null
  private lifecycleState: AgcLifecycleState = 'idle'

  async startRun(options: StartAgcRunOptions): Promise<StartAgcRunResult> {
    const goal = options.goal.trim()
    if (!goal) {
      throw new Error('AGC goal must not be empty')
    }

    if (this.activeRunTask) {
      throw new Error('Another AGC run is already in progress')
    }

    const runtime = this.ensureRuntime()
    const files = this.collectFiles(options.files, runtime.workspaceRoot)
    this.lifecycleState = 'starting'

    const start = await runtime.agcService.startRun({
      graph: this.createGraph(),
      metadata: {
        goal,
        repoRoot: runtime.workspaceRoot,
        files,
        initiator: 'conductor-hub-vscode',
      },
      options: {
        debug: false,
        forceFullPath: true,
        plugins: [],
      },
    })

    this.activeRunId = start.runId
    await this.publishState(start.runId, { workflow: 'AGC Runtime Orchestration' })

    const driver = new AGCRunDriver({
      eventStore: runtime.eventStore,
      checkpointStore: runtime.checkpointStore,
      dagEngine: new DagEngine(),
      hub: runtime.hubService,
    })

    this.lifecycleState = 'running'
    this.activeRunTask = (async () => {
      try {
        await driver.drain(start.runId, {
          maxTicks: 20,
          onNodeStarted: async () => {
            await this.publishState(start.runId, { workflow: 'AGC Runtime Orchestration' })
          },
          onNodeComplete: async () => {
            await this.publishState(start.runId, { workflow: 'AGC Runtime Orchestration' })
          },
          onNodeFailed: async (_nodeId, error) => {
            await this.publishState(start.runId, {
              workflow: 'AGC Runtime Orchestration',
              verdict: error.message,
            })
          },
        })

        this.lifecycleState = 'completed'
        await this.publishState(start.runId, { workflow: 'AGC Runtime Orchestration' })
      } catch (error) {
        this.lifecycleState = 'failed'
        const message = error instanceof Error ? error.message : String(error)
        await this.publishState(start.runId, {
          status: 'failed',
          phase: 'FAILED',
          workflow: 'AGC Runtime Orchestration',
          verdict: message,
        })
        throw error
      } finally {
        this.activeRunTask = null
      }
    })()

    void this.activeRunTask.catch(() => {
      // Errors are surfaced to the caller via WAL + notifications.
    })

    return { runId: start.runId }
  }

  getStatus(): { state: AgcLifecycleState; runId?: string } {
    return { state: this.lifecycleState, runId: this.activeRunId }
  }

  dispose(): void {
    this.runtime = undefined
  }

  private ensureRuntime(): AgcRuntimeBundle {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      throw new Error('Open a workspace before starting AGC')
    }

    if (this.runtime?.workspaceRoot === workspaceRoot) {
      return this.runtime
    }

    const dataDir = path.join(workspaceRoot, 'data', 'conductor_agc')
    const walDir = path.join(workspaceRoot, 'data', 'agc_wal')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.mkdirSync(walDir, { recursive: true })
    const eventStore = new InMemoryEventStore()
    const checkpointStore = new InMemoryCheckpointStore()
    const hubService = new ConductorHubService()
    const agcService = new AGCService({ eventStore, checkpointStore })

    this.runtime = {
      workspaceRoot,
      dataDir,
      walPath: path.join(walDir, 'current_run.json'),
      eventStore,
      checkpointStore,
      agcService,
      hubService,
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

  private createGraph() {
    return {
      nodes: [
        { id: 'ANALYZE', name: 'ANALYZE', dependsOn: [] as string[], input: {}, skippable: false, priority: 0 },
        { id: 'PARALLEL', name: 'PARALLEL', dependsOn: ['ANALYZE'], input: {}, skippable: false, priority: 0 },
        { id: 'DEBATE', name: 'DEBATE', dependsOn: ['PARALLEL'], input: {}, skippable: false, priority: 0 },
        { id: 'VERIFY', name: 'VERIFY', dependsOn: ['DEBATE'], input: {}, skippable: false, priority: 0 },
        { id: 'SYNTHESIZE', name: 'SYNTHESIZE', dependsOn: ['VERIFY'], input: {}, skippable: false, priority: 0 },
        { id: 'PERSIST', name: 'PERSIST', dependsOn: ['SYNTHESIZE'], input: {}, skippable: false, priority: 0 },
        { id: 'HITL', name: 'HITL', dependsOn: ['PERSIST'], input: {}, skippable: false, priority: 0 },
      ],
      edges: [
        { from: 'ANALYZE', to: 'PARALLEL' },
        { from: 'PARALLEL', to: 'DEBATE' },
        { from: 'DEBATE', to: 'VERIFY' },
        { from: 'VERIFY', to: 'SYNTHESIZE' },
        { from: 'SYNTHESIZE', to: 'PERSIST' },
        { from: 'PERSIST', to: 'HITL' },
      ],
    }
  }

  private async publishState(
    runId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const runtime = this.ensureRuntime()
    const state = await runtime.agcService.getState(runId)
    const payload = {
      ...(state ?? { runId, version: 0, status: 'running', nodes: {} }),
      run_id: runId,
      phase: String(overrides.phase ?? state?.status ?? 'running').toUpperCase(),
      workflow: overrides.workflow ?? 'AGC Runtime Orchestration',
      verdict: overrides.verdict,
      updated_at: new Date().toISOString(),
      ...overrides,
    }

    fs.writeFileSync(runtime.walPath, JSON.stringify(payload, null, 2), 'utf8')
  }
}
