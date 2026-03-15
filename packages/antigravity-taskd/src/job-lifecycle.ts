/**
 * JobLifecycleService — 作业生命周期管理
 *
 * V1.1.0 第二战役・战区 1：从 runtime.ts 上帝模块中剥离
 *
 * 职责：
 * - Job CRUD（create / list / get / cancel）
 * - AbortController 字典管理
 * - EventEmitter 事件广播
 * - Job 事件序号追踪
 * - K8s Graceful Shutdown
 * - 全局 Job 超时安全网
 */

import * as crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { z } from 'zod'
import {
  CancelTaskJobResponseSchema,
  CreateTaskJobRequestSchema,
  type TaskJobEvent,
  type TaskJobEventType,
  type TaskJobSnapshot,
  type TaskJobStatus,
  type TaskStageId,
} from './schema.js'
import { TaskPersistenceStore } from './persistence.js'
import type { TaskdPaths } from './runtime-contract.js'

// ── 全局 Job 超时 ───────────────────────────────────────────────
const GLOBAL_JOB_TIMEOUT_MS = 60 * 60 * 1000  // 60 min

function nowIso(): string {
  return new Date().toISOString()
}

function isTerminalStatus(status: TaskJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function createGraph(): import('./schema.js').TaskGraphStage[] {
  const STAGE_BUDGETS: Record<TaskStageId, { softBudgetMs: number; hardBudgetMs: number }> = {
    SCOUT: { softBudgetMs: 60_000, hardBudgetMs: 120_000 },
    SHARD_ANALYZE: { softBudgetMs: 1_800_000, hardBudgetMs: 2_100_000 },
    AGGREGATE: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
    VERIFY: { softBudgetMs: 480_000, hardBudgetMs: 600_000 },
    WRITE: { softBudgetMs: 900_000, hardBudgetMs: 1_200_000 },
    FINALIZE: { softBudgetMs: 240_000, hardBudgetMs: 300_000 },
  }
  return (Object.keys(STAGE_BUDGETS) as TaskStageId[]).map((id) => ({
    id,
    status: id === 'WRITE' ? 'skipped' : 'pending',
    softBudgetMs: STAGE_BUDGETS[id].softBudgetMs,
    hardBudgetMs: STAGE_BUDGETS[id].hardBudgetMs,
    shardIds: [],
  }))
}

/** 回调签名：runtime 注册执行器，lifecycle 负责触发 */
export type ExecuteJobFn = (jobId: string, signal: AbortSignal) => Promise<void>

export class JobLifecycleService {
  readonly persistence: TaskPersistenceStore
  readonly jobs = new Map<string, TaskJobSnapshot>()
  private readonly listeners = new EventEmitter()
  private readonly controllers = new Map<string, AbortController>()
  private readonly sequenceByJob = new Map<string, number>()

  constructor(paths: TaskdPaths) {
    this.persistence = new TaskPersistenceStore(paths.jobsDir)
  }

  // ── 初始化：恢复历史快照 ────────────────────────────────────────

  initialize(): void {
    for (const snapshot of this.persistence.readAllSnapshots()) {
      if (!isTerminalStatus(snapshot.status)) {
        snapshot.status = 'failed'
        snapshot.summary.riskFindings = unique([
          ...snapshot.summary.riskFindings,
          'taskd restarted before the job reached a terminal state',
        ])
        snapshot.updatedAt = nowIso()
        this.persistence.saveSnapshot(snapshot)
      }
      const lastSequence = snapshot.recentEvents.at(-1)?.sequence ?? 0
      this.sequenceByJob.set(snapshot.jobId, lastSequence)
      this.jobs.set(snapshot.jobId, snapshot)
    }
  }

  // ── Job CRUD ──────────────────────────────────────────────────

  createJob(
    input: z.input<typeof CreateTaskJobRequestSchema>,
    executeJob: ExecuteJobFn,
  ): TaskJobSnapshot {
    const request = CreateTaskJobRequestSchema.parse(input)
    const createdAt = nowIso()
    const jobId = crypto.randomUUID()
    const snapshot: TaskJobSnapshot = {
      jobId,
      status: 'queued',
      mode: request.mode,
      workspaceRoot: request.workspaceRoot,
      goal: request.goal,
      currentStageId: 'SCOUT',
      graph: createGraph(),
      workers: [],
      totalTokensUsed: 0,
      summary: {
        goalSummary: request.goal,
        globalSummary: '',
        verdict: '',
        finalAnswer: '',
        coverageGaps: [],
        riskFindings: [],
        openQuestions: [],
      },
      artifacts: {
        snapshotPath: this.persistence.snapshotPath(jobId),
        eventsPath: this.persistence.eventsPath(jobId),
        latestDiff: undefined,
        changedFiles: [],
        shardCount: 0,
      },
      recentEvents: [],
      fileHints: request.fileHints ?? [],
      enableMoA: request.enableMoA ?? false,
      createdAt,
      updatedAt: createdAt,
    }
    this.sequenceByJob.set(jobId, 0)
    this.jobs.set(jobId, snapshot)
    this.persistence.saveSnapshot(snapshot)
    this.emitJobEvent(jobId, 'job.created', {
      goal: request.goal,
      mode: request.mode,
    })

    const controller = new AbortController()
    this.controllers.set(jobId, controller)

    // ── 全局 Job 超时安全网 ─────────────────────────────────────
    const globalTimeout = setTimeout(() => {
      console.warn(`[taskd] GLOBAL JOB TIMEOUT reached (${GLOBAL_JOB_TIMEOUT_MS}ms) for job ${jobId} — force aborting`)
      controller.abort()
    }, GLOBAL_JOB_TIMEOUT_MS)

    void executeJob(jobId, controller.signal).catch((error) => {
      const current = this.jobs.get(jobId)
      if (!current || current.status === 'cancelled') return
      current.status = 'failed'
      current.updatedAt = nowIso()
      current.summary.riskFindings = unique([
        ...current.summary.riskFindings,
        error instanceof Error ? error.message : String(error),
      ])
      this.emitJobEvent(jobId, 'job.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      clearTimeout(globalTimeout)
      this.controllers.delete(jobId)
      // 🛡️ 内存闭环：排空并释放该 job 的写入队列条目
      // 如果不 delete，_writeQueues Map 会随 job 数量无限膨胀
      void this.persistence.flush(jobId)
    })
    return snapshot
  }

  listJobs(): TaskJobSnapshot[] {
    return [...this.jobs.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  getJob(jobId: string): TaskJobSnapshot | null {
    return this.jobs.get(jobId) ?? this.persistence.readSnapshot(jobId)
  }

  cancelJob(jobId: string): { jobId: string; cancelled: boolean } {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot || isTerminalStatus(snapshot.status)) {
      return CancelTaskJobResponseSchema.parse({ jobId, cancelled: false })
    }
    snapshot.status = 'cancelled'
    snapshot.updatedAt = nowIso()
    this.controllers.get(jobId)?.abort()
    this.emitJobEvent(jobId, 'job.cancelled', {
      reason: 'Cancelled by user',
    })
    return CancelTaskJobResponseSchema.parse({ jobId, cancelled: true })
  }

  subscribe(jobId: string, listener: (event: TaskJobEvent) => void): () => void {
    this.listeners.on(jobId, listener)
    return () => {
      this.listeners.off(jobId, listener)
    }
  }

  // ── K8s Graceful Shutdown ─────────────────────────────────────

  async shutdown(): Promise<void> {
    console.log(`[taskd] Shutting down ${this.controllers.size} active job(s)...`)
    for (const [jobId, controller] of this.controllers) {
      console.log(`[taskd] Aborting job ${jobId}`)
      controller.abort()
    }
    await Promise.race([
      Promise.allSettled(
        [...this.controllers.keys()].map(
          jobId => new Promise<void>(resolve => {
            const check = () => {
              const snap = this.jobs.get(jobId)
              if (!snap || isTerminalStatus(snap.status)) {
                resolve()
              } else {
                setTimeout(check, 200)
              }
            }
            check()
          })
        )
      ),
      new Promise(resolve => setTimeout(resolve, 20_000)),
    ])
    this.controllers.clear()
    // 🛡️ 排空所有残留写入队列 + 释放内存
    await this.persistence.flushAll()
    console.log('[taskd] Shutdown complete')
  }

  // ── 事件基础设施 ──────────────────────────────────────────────

  emitJobEvent(jobId: string, type: TaskJobEventType, data: Record<string, unknown>): void {
    const snapshot = this.jobs.get(jobId)
    if (!snapshot) return
    const sequence = (this.sequenceByJob.get(jobId) ?? 0) + 1
    this.sequenceByJob.set(jobId, sequence)
    const event: TaskJobEvent = {
      eventId: crypto.randomUUID(),
      jobId,
      type,
      sequence,
      timestamp: nowIso(),
      data,
    }
    snapshot.recentEvents = [...snapshot.recentEvents, event].slice(-100)
    snapshot.updatedAt = event.timestamp
    this.persistence.appendEvent(jobId, event)
    this.persistence.saveSnapshot(snapshot)
    // 🛡️ 防御性 emit：try-catch 兜底
    // 在 VS Code 插件宿主中，如果 listener 是 async 且抛出异常，
    // 会导致 Unhandled Promise Rejection → 宿主进程崩溃。
    try {
      this.listeners.emit(jobId, event)
    } catch (emitErr) {
      console.error(`[taskd] EventEmitter listener threw (swallowed to protect host):`, emitErr)
    }
  }

  // ── 辅助访问器 ────────────────────────────────────────────────

  /** 获取指定 Job 的 AbortController（供 runtime 内部使用） */
  getController(jobId: string): AbortController | undefined {
    return this.controllers.get(jobId)
  }

  /** 临时替换 Job 的 AbortController（赛马模式需要） */
  setController(jobId: string, controller: AbortController): void {
    this.controllers.set(jobId, controller)
  }
}
