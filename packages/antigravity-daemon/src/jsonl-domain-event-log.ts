/**
 * PR-07E: JSONL Durable Daemon Domain Event Log.
 *
 * Replaces InMemoryDaemonDomainEventLog with a durable, append-only JSONL
 * file-per-run implementation. Each run's domain events are stored in:
 *   {dataDir}/domain-events/{runId}.jsonl
 *
 * Features:
 * - Append-only JSONL format (one JSON envelope per line)
 * - Per-run file isolation
 * - OCC via sequence conflict detection
 * - Crash-safe: each append is a single fs.appendFileSync call
 * - Backward compatible: missing files for legacy runs = empty log
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  DaemonDomainEventEnvelope,
  DaemonDomainEventLog,
  DaemonDomainEventAppendInput,
  DaemonDomainEventAppendResult,
} from './daemon-domain-events.js'

const DOMAIN_EVENTS_DIR = 'domain-events'

export class JsonlDaemonDomainEventLog implements DaemonDomainEventLog {
  private readonly baseDir: string

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, DOMAIN_EVENTS_DIR)
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  private runFilePath(runId: string): string {
    // Sanitize runId to prevent path traversal
    const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.baseDir, `${safeRunId}.jsonl`)
  }

  async append(input: DaemonDomainEventAppendInput): Promise<DaemonDomainEventAppendResult> {
    if (input.events.length === 0) {
      const currentSeq = await this.getLatestSequence(input.runId)
      return { committedSequence: currentSeq, count: 0 }
    }

    const filePath = this.runFilePath(input.runId)
    const currentSeq = await this.getLatestSequence(input.runId)

    // OCC: check expected sequence matches current state
    if (input.expectedSequence !== currentSeq) {
      throw new Error(
        `SEQUENCE_CONFLICT: expected sequence ${input.expectedSequence} but current is ${currentSeq} for run ${input.runId}`,
      )
    }

    // Build JSONL payload — one line per event
    const lines = input.events.map(event => JSON.stringify(event)).join('\n') + '\n'

    // Atomic-ish append (single syscall for JSONL append)
    fs.appendFileSync(filePath, lines, 'utf8')

    const lastEvent = input.events[input.events.length - 1]!
    return {
      committedSequence: lastEvent.sequence,
      count: input.events.length,
    }
  }

  async load(runId: string, fromSequence?: number): Promise<DaemonDomainEventEnvelope[]> {
    const filePath = this.runFilePath(runId)

    if (!fs.existsSync(filePath)) {
      return []
    }

    const content = fs.readFileSync(filePath, 'utf8').trim()
    if (!content) {
      return []
    }

    const lines = content.split('\n')
    const events: DaemonDomainEventEnvelope[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as DaemonDomainEventEnvelope
        if (fromSequence !== undefined && event.sequence < fromSequence) {
          continue
        }
        events.push(event)
      } catch {
        // Skip malformed lines — defensive parsing
      }
    }

    return events
  }

  async getLatestSequence(runId: string): Promise<number> {
    const filePath = this.runFilePath(runId)

    if (!fs.existsSync(filePath)) {
      return -1
    }

    const content = fs.readFileSync(filePath, 'utf8').trim()
    if (!content) {
      return -1
    }

    // Read last non-empty line
    const lines = content.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i]!.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as DaemonDomainEventEnvelope
        return event.sequence
      } catch {
        continue
      }
    }

    return -1
  }
}
