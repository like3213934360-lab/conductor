import * as fs from 'node:fs'
import * as path from 'node:path'
import type { TaskJobEvent, TaskJobSnapshot } from './schema.js'

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

export class TaskPersistenceStore {
  constructor(private readonly jobsDir: string) {
    ensureDir(this.jobsDir)
  }

  private jobDir(jobId: string): string {
    return path.join(this.jobsDir, jobId)
  }

  snapshotPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'snapshot.json')
  }

  eventsPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'events.jsonl')
  }

  ensureJob(jobId: string): void {
    ensureDir(this.jobDir(jobId))
  }

  saveSnapshot(snapshot: TaskJobSnapshot): void {
    this.ensureJob(snapshot.jobId)
    writeJsonAtomic(this.snapshotPath(snapshot.jobId), snapshot)
  }

  appendEvent(jobId: string, event: TaskJobEvent): void {
    this.ensureJob(jobId)
    fs.appendFileSync(this.eventsPath(jobId), `${JSON.stringify(event)}\n`, 'utf8')
  }

  readSnapshot(jobId: string): TaskJobSnapshot | null {
    const filePath = this.snapshotPath(jobId)
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TaskJobSnapshot
  }

  readAllSnapshots(): TaskJobSnapshot[] {
    if (!fs.existsSync(this.jobsDir)) return []
    return fs.readdirSync(this.jobsDir)
      .map(jobId => this.readSnapshot(jobId))
      .filter((snapshot): snapshot is TaskJobSnapshot => snapshot != null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }
}
