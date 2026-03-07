/**
 * Conductor AGC — CheckpointStore 接口
 */
import type { CheckpointDTO } from '@anthropic/conductor-shared'

/** 保存检查点输入 */
export interface SaveCheckpointInput {
  checkpoint: CheckpointDTO
}

/** 检查点查询 */
export interface LoadCheckpointQuery {
  runId: string
  version?: number
}

/**
 * CheckpointStore 接口 — 检查点持久化抽象
 */
export interface CheckpointStore {
  /** 保存检查点快照 */
  save(input: SaveCheckpointInput): Promise<void>
  /** 加载最新检查点 */
  loadLatest(runId: string): Promise<CheckpointDTO | null>
  /** 加载指定版本检查点 */
  loadByVersion(query: LoadCheckpointQuery): Promise<CheckpointDTO | null>
  /** 列出所有检查点 */
  list(runId: string): Promise<CheckpointDTO[]>
}
