import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { glass, radius, s } from '../theme'
import type { Lang } from './Dashboard'
import { vscode } from '../vscode-api'

type TaskMode = 'analysis' | 'write'

interface StageState {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  detail?: string
  shardIds?: string[]
  startedAt?: string
  completedAt?: string
}

interface WorkerState {
  workerId: string
  backend: 'codex' | 'gemini'
  role: 'scout' | 'analyzer' | 'reviewer' | 'aggregator' | 'writer'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  phase: 'queued' | 'thinking' | 'working' | 'tool_use' | 'finalizing' | 'done' | 'error'
  message: string
  progress: number
  currentShardId?: string
  lastEventAt: string
  targetFiles: string[]
}

interface JobEvent {
  eventId: string
  sequence: number
  type: string
  timestamp: string
  data: Record<string, unknown>
}

interface JobSummary {
  goalSummary?: string
  globalSummary?: string
  verdict?: string
  finalAnswer?: string
  coverageGaps?: string[]
  riskFindings?: string[]
  openQuestions?: string[]
}

interface JobArtifacts {
  latestDiff?: string
  changedFiles?: string[]
  shardCount?: number
}

interface JobListEntry {
  jobId: string
  goal: string
  mode: TaskMode
  status: string
  updatedAt: string
}

interface JobSnapshot {
  jobId?: string
  runId?: string
  goal?: string
  mode?: TaskMode
  status?: string
  currentStageId?: string
  graph?: StageState[]
  workers?: WorkerState[]
  summary?: JobSummary
  artifacts?: JobArtifacts
  recentEvents?: JobEvent[]
  jobs?: JobListEntry[]
  updatedAt?: number
  createdAt?: number
}

const copy = {
  en: {
    title: 'Task Kernel',
    subtitle: 'Long-running Antigravity jobs with semantic progress and shard orchestration',
    goal: 'Goal',
    goalPlaceholder: 'Describe the task you want antigravity-taskd to execute',
    mode: 'Mode',
    analysis: 'Analysis',
    write: 'Write',
    start: 'Start Job',
    cancel: 'Cancel Active',
    refresh: 'Refresh',
    active: 'Active Job',
    none: 'No task job yet',
    noneHint: 'Start a job to see live stages, workers, shard progress, and final output.',
    status: 'Status',
    stage: 'Stage',
    stages: 'Task Graph',
    workers: 'Workers',
    timeline: 'Recent Events',
    summary: 'Summary',
    artifacts: 'Artifacts',
    recentJobs: 'Recent Jobs',
    changedFiles: 'Changed Files',
    verdict: 'Verdict',
    gaps: 'Coverage Gaps',
    risks: 'Risks',
    answer: 'Final Answer',
    pending: 'Task request received. Initializing antigravity-taskd...',
  },
  zh: {
    title: '任务内核',
    subtitle: '基于语义进度和分片编排的长任务执行',
    goal: '任务目标',
    goalPlaceholder: '描述你希望 antigravity-taskd 执行的任务',
    mode: '模式',
    analysis: '分析',
    write: '写入',
    start: '启动任务',
    cancel: '取消当前任务',
    refresh: '刷新',
    active: '当前任务',
    none: '暂无任务',
    noneHint: '启动任务后可查看实时阶段、worker、分片进度和最终输出。',
    status: '状态',
    stage: '阶段',
    stages: '任务图',
    workers: 'Workers',
    timeline: '最近事件',
    summary: '总结',
    artifacts: '产物',
    recentJobs: '最近任务',
    changedFiles: '变更文件',
    verdict: '结论',
    gaps: '覆盖缺口',
    risks: '风险',
    answer: '最终答复',
    pending: '已收到任务请求，正在初始化 antigravity-taskd...',
  },
} as const

const WorkflowPanel: React.FC<{ lang: Lang }> = ({ lang }) => {
  const l = copy[lang]
  const [goal, setGoal] = useState('')
  const [mode, setMode] = useState<TaskMode>('analysis')
  const [snapshot, setSnapshot] = useState<JobSnapshot | null>(null)
  const [jobs, setJobs] = useState<JobListEntry[]>([])
  const [banner, setBanner] = useState<string>('')

  // ── 防抖：高频 taskEvent 时批量合并为一次 snapshot 拉取 ─────────────────
  const snapshotDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedFetchSnapshot = useCallback(() => {
    if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current)
    snapshotDebounceRef.current = setTimeout(() => {
      vscode.postMessage({ command: 'getRunSnapshot' })
      snapshotDebounceRef.current = null
    }, 300)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent<any>) => {
      const message = event.data
      switch (message.command) {
        case 'runSnapshot':
          setSnapshot(message.data || null)
          if (Array.isArray(message.data?.jobs)) {
            setJobs(message.data.jobs)
          }
          break
        case 'taskJobList':
          setJobs(Array.isArray(message.jobs) ? message.jobs : [])
          break
        case 'runPending':
          setBanner(message.message || l.pending)
          break
        case 'runStarted':
          setBanner(`Job ${message.runId} started`)
          vscode.postMessage({ command: 'getRunSnapshot' })
          break
        case 'runError':
        case 'runActionError':
          setBanner(message.message || 'Unknown error')
          break
        case 'runActionSuccess':
          setBanner(message.message || 'Success')
          vscode.postMessage({ command: 'getRunSnapshot' })
          break
        case 'taskEvent':
          // 防抖：高频 SSE 事件（50+/s）合并为 300ms 一次 snapshot 拉取
          debouncedFetchSnapshot()
          break
        default:
          break
      }
    }
    window.addEventListener('message', onMessage)
    vscode.postMessage({ command: 'getRunSnapshot' })
    vscode.postMessage({ command: 'listTaskJobs' })
    return () => {
      window.removeEventListener('message', onMessage)
      if (snapshotDebounceRef.current) clearTimeout(snapshotDebounceRef.current)
    }
  }, [l.pending, debouncedFetchSnapshot])

  const activeStages = snapshot?.graph ?? []
  const activeWorkers = snapshot?.workers ?? []
  const activeEvents = useMemo(() => [...(snapshot?.recentEvents ?? [])].reverse(), [snapshot?.recentEvents])

  const startJob = () => {
    if (!goal.trim()) {
      setBanner('Goal is required')
      return
    }
    vscode.postMessage({ command: 'startRun', goal, mode })
  }

  const cancelJob = () => {
    vscode.postMessage({ command: 'cancelRun' })
  }

  const refresh = () => {
    vscode.postMessage({ command: 'getRunSnapshot' })
    vscode.postMessage({ command: 'listTaskJobs' })
  }

  const openJob = (jobId: string) => {
    vscode.postMessage({ command: 'openTaskJob', jobId })
  }

  const cardStyle: React.CSSProperties = {
    ...glass.panel,
    padding: '18px',
    borderRadius: radius.xl,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={cardStyle}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 700 }}>{l.title}</div>
          <div style={s.hint}>{l.subtitle}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '12px' }}>
          <div>
            <div style={s.label}>{l.goal}</div>
            <textarea
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder={l.goalPlaceholder}
              style={{
                width: '100%',
                minHeight: '88px',
                resize: 'vertical',
                padding: '12px',
                borderRadius: radius.lg,
                border: '1px solid var(--vscode-input-border)',
                background: 'var(--vscode-input-background)',
                color: 'var(--vscode-input-foreground)',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <div style={s.label}>{l.mode}</div>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as TaskMode)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: radius.lg,
                  border: '1px solid var(--vscode-input-border)',
                  background: 'var(--vscode-dropdown-background)',
                  color: 'var(--vscode-dropdown-foreground)',
                }}
              >
                <option value="analysis">{l.analysis}</option>
                <option value="write">{l.write}</option>
              </select>
            </div>
            <button style={s.btnPrimary} onClick={startJob}>{l.start}</button>
            <button style={s.btnSecondary} onClick={refresh}>{l.refresh}</button>
            <button style={s.btnSecondary} onClick={cancelJob}>{l.cancel}</button>
          </div>
        </div>
        {banner && (
          <div style={{
            padding: '10px 12px',
            borderRadius: radius.lg,
            background: 'rgba(6,182,212,0.10)',
            color: 'var(--vscode-foreground)',
          }}>
            {banner}
          </div>
        )}
      </div>

      {!snapshot?.jobId ? (
        <div style={cardStyle}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.none}</div>
          <div style={s.hint}>{l.noneHint}</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.active}</div>
              <div style={s.hint}>{snapshot.goal}</div>
              <div><strong>{l.status}:</strong> {snapshot.status}</div>
              <div><strong>{l.mode}:</strong> {snapshot.mode}</div>
              <div><strong>{l.stage}:</strong> {snapshot.currentStageId || '—'}</div>
              <div><strong>ID:</strong> {snapshot.jobId}</div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.summary}</div>
              <div><strong>{l.verdict}:</strong> {snapshot.summary?.verdict || '—'}</div>
              <div><strong>{l.gaps}:</strong> {(snapshot.summary?.coverageGaps ?? []).join(' | ') || '—'}</div>
              <div><strong>{l.risks}:</strong> {(snapshot.summary?.riskFindings ?? []).join(' | ') || '—'}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{snapshot.summary?.globalSummary || snapshot.summary?.goalSummary || '—'}</div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.stages}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
              {activeStages.map(stage => (
                <div key={stage.id} style={{
                  padding: '12px',
                  borderRadius: radius.lg,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ fontWeight: 700 }}>{stage.id}</div>
                  <div style={s.hint}>{stage.status}</div>
                  {stage.detail && <div style={{ marginTop: '8px', whiteSpace: 'pre-wrap' }}>{stage.detail}</div>}
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.workers}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
              {activeWorkers.map(worker => (
                <div key={worker.workerId} style={{
                  padding: '12px',
                  borderRadius: radius.lg,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{ fontWeight: 700 }}>{worker.workerId}</div>
                  <div style={s.hint}>{worker.backend} · {worker.role}</div>
                  <div>{worker.status} · {worker.phase}</div>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>{worker.message}</div>
                  <div style={{ marginTop: '8px' }}>Progress: {Math.round((worker.progress ?? 0) * 100)}%</div>
                  {worker.currentShardId && <div style={s.hint}>Shard: {worker.currentShardId}</div>}
                  {worker.targetFiles.length > 0 && (
                    <div style={s.hint}>Files: {worker.targetFiles.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.artifacts}</div>
              <div><strong>{l.changedFiles}:</strong> {(snapshot.artifacts?.changedFiles ?? []).join(', ') || '—'}</div>
              {snapshot.artifacts?.latestDiff && (
                <pre style={{
                  margin: 0,
                  padding: '12px',
                  borderRadius: radius.lg,
                  overflowX: 'auto',
                  background: 'rgba(0,0,0,0.18)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {snapshot.artifacts.latestDiff}
                </pre>
              )}
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.answer}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>
                {snapshot.summary?.finalAnswer || '—'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.timeline}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
                {activeEvents.map(event => (
                  <div key={event.eventId} style={{
                    padding: '10px 12px',
                    borderRadius: radius.lg,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontWeight: 700 }}>{event.type}</div>
                    <div style={s.hint}>{event.timestamp}</div>
                    <div style={{ whiteSpace: 'pre-wrap', marginTop: '6px' }}>
                      {Object.keys(event.data || {}).length > 0 ? JSON.stringify(event.data) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '16px', fontWeight: 600 }}>{l.recentJobs}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {jobs.map(job => (
                  <button
                    key={job.jobId}
                    style={{
                      ...s.btnSecondary,
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                    }}
                    onClick={() => openJob(job.jobId)}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{job.goal}</div>
                      <div style={s.hint}>{job.jobId} · {job.mode} · {job.status}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default WorkflowPanel
