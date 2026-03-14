/**
 * provenance.ts — SLSA V1.0 供应链溯源
 *
 * 把 Map-Reduce 流水线视为一次构建：
 *  - SCOUT 阶段收集输入文件哈希
 *  - SHARD/WRITE 阶段记录使用的 AI 后端版本
 *  - WRITE 阶段收集输出文件哈希
 *  - FINALIZE 阶段组装 SLSA Provenance 并用 Ed25519 签名
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import type { TaskJobMode, TaskJobSnapshot, WorkerBackend } from './schema.js'
import type { CryptoIdentity, SignedPayload } from './crypto-identity.js'

// ── SLSA V1.0 Provenance 类型 ──────────────────────────────────

export interface SLSAProvenance {
  _type: 'https://in-toto.io/Statement/v1'
  subject: Array<{
    name: string
    digest: { sha256: string }
  }>
  predicateType: 'https://slsa.dev/provenance/v1'
  predicate: {
    buildDefinition: {
      buildType: 'antigravity-taskd/map-reduce/v1'
      externalParameters: {
        goal: string
        mode: TaskJobMode
        workspaceRoot: string
      }
      resolvedDependencies: Array<{
        uri: string
        digest: { sha256: string }
      }>
    }
    runDetails: {
      builder: {
        id: string
        version: string
      }
      metadata: {
        invocationID: string
        startedOn: string
        finishedOn: string
      }
      byproducts: Array<{
        name: string
        mediaType: 'application/vnd.antigravity.worker-version'
        content: string
      }>
    }
  }
}

// ── ProvenanceCollector 接口 ────────────────────────────────────

export interface ProvenanceCollector {
  recordInputs(files: Array<{ path: string; hash: string }>): void
  recordWorkerVersion(backend: WorkerBackend, version: string): void
  recordOutputs(files: Array<{ path: string; hash: string }>): void
  assemble(snapshot: TaskJobSnapshot): SignedPayload<SLSAProvenance>
}

// ── 实现 ────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  } catch {
    return 'unreadable'
  }
}

const TASKD_VERSION = '0.2.0'

export class DefaultProvenanceCollector implements ProvenanceCollector {
  private inputs: Array<{ path: string; hash: string }> = []
  private outputs: Array<{ path: string; hash: string }> = []
  private workerVersions: Array<{ backend: WorkerBackend; version: string }> = []

  constructor(
    private readonly identity: CryptoIdentity,
    private readonly instanceId: string,
  ) {}

  recordInputs(files: Array<{ path: string; hash: string }>): void {
    this.inputs.push(...files)
  }

  /** 便捷方法：直接从文件路径列表采集哈希 */
  recordInputFiles(filePaths: string[]): void {
    this.inputs.push(...filePaths.map(p => ({ path: p, hash: hashFile(p) })))
  }

  recordWorkerVersion(backend: WorkerBackend, version: string): void {
    this.workerVersions.push({ backend, version })
  }

  recordOutputs(files: Array<{ path: string; hash: string }>): void {
    this.outputs.push(...files)
  }

  recordOutputFiles(filePaths: string[]): void {
    this.outputs.push(...filePaths.map(p => ({ path: p, hash: hashFile(p) })))
  }

  assemble(snapshot: TaskJobSnapshot): SignedPayload<SLSAProvenance> {
    const provenance: SLSAProvenance = {
      _type: 'https://in-toto.io/Statement/v1',
      subject: this.outputs.map(f => ({
        name: f.path,
        digest: { sha256: f.hash },
      })),
      predicateType: 'https://slsa.dev/provenance/v1',
      predicate: {
        buildDefinition: {
          buildType: 'antigravity-taskd/map-reduce/v1',
          externalParameters: {
            goal: snapshot.goal,
            mode: snapshot.mode,
            workspaceRoot: snapshot.workspaceRoot,
          },
          resolvedDependencies: this.inputs.map(f => ({
            uri: `file://${f.path}`,
            digest: { sha256: f.hash },
          })),
        },
        runDetails: {
          builder: {
            id: this.instanceId,
            version: TASKD_VERSION,
          },
          metadata: {
            invocationID: snapshot.jobId,
            startedOn: snapshot.createdAt,
            finishedOn: snapshot.updatedAt,
          },
          byproducts: this.workerVersions.map(w => ({
            name: w.backend,
            mediaType: 'application/vnd.antigravity.worker-version' as const,
            content: w.version,
          })),
        },
      },
    }

    return this.identity.signPayload(provenance)
  }
}
