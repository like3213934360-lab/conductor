/**
 * Antigravity Workflow Runtime — Event Snapshot Store
 *
 * 快照机制: 定期将 WorkflowState 快照序列化，
 * 避免长运行任务的全量事件回放性能退化。
 *
 * 设计:
 * - 泛型 SnapshotStore<T> 接口
 * - InMemorySnapshotStore 实现
 * - SnapshotManager 编排 (快照创建 + 增量回放)
 *
 * 参考:
 * - Greg Young CQRS/ES Snapshotting (2010)
 * - Temporal.io Checkpoint 机制
 * - VLDB 2025 "Event Sourcing with Causal Consistency"
 */

// ── 快照类型 ──────────────────────────────────────────────────────

/** 快照记录 */
export interface Snapshot<T> {
  /** 快照 ID */
  id: string
  /** 聚合根 ID (runId) */
  aggregateId: string
  /** 对应的事件版本号 */
  version: number
  /** 创建时间 */
  timestamp: string
  /** 序列化的状态 */
  state: T
  /** 元数据 */
  metadata?: Record<string, unknown>
}

/** 快照存储接口 */
export interface ISnapshotStore<T> {
  /** 保存快照 */
  save(snapshot: Snapshot<T>): Promise<void>
  /** 查找最新快照 */
  findLatest(aggregateId: string): Promise<Snapshot<T> | null>
  /** 根据版本查找最近的快照 (版本 ≤ version 的最大快照) */
  findNearestBefore(aggregateId: string, version: number): Promise<Snapshot<T> | null>
  /** 删除旧快照 (保留指定数量) */
  pruneOlderSnapshots(aggregateId: string, keepCount: number): Promise<number>
}

/** 快照策略 */
export interface SnapshotPolicy {
  /** 每 N 个事件触发快照 */
  eventInterval: number
  /** 每个聚合根保留的最大快照数 */
  maxSnapshotsPerAggregate: number
}

/** 默认策略 */
export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  eventInterval: 20,
  maxSnapshotsPerAggregate: 5,
}

// ── InMemory 实现 ──────────────────────────────────────────────────

/**
 * InMemorySnapshotStore — 内存快照存储
 *
 * 适用于单进程 / 测试场景。
 * 生产环境应替换为 SQLite / Redis 实现。
 */
export class InMemorySnapshotStore<T> implements ISnapshotStore<T> {
  private readonly store = new Map<string, Snapshot<T>[]>()

  async save(snapshot: Snapshot<T>): Promise<void> {
    const existing = this.store.get(snapshot.aggregateId) ?? []
    // 防止重复版本
    const filtered = existing.filter(s => s.version !== snapshot.version)
    filtered.push(snapshot)
    // 按版本升序排列
    filtered.sort((a, b) => a.version - b.version)
    this.store.set(snapshot.aggregateId, filtered)
  }

  async findLatest(aggregateId: string): Promise<Snapshot<T> | null> {
    const snapshots = this.store.get(aggregateId)
    if (!snapshots || snapshots.length === 0) return null
    return snapshots[snapshots.length - 1]!
  }

  async findNearestBefore(aggregateId: string, version: number): Promise<Snapshot<T> | null> {
    const snapshots = this.store.get(aggregateId)
    if (!snapshots || snapshots.length === 0) return null

    // 反向查找第一个 version ≤ 目标版本的快照
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i]!.version <= version) {
        return snapshots[i]!
      }
    }
    return null
  }

  async pruneOlderSnapshots(aggregateId: string, keepCount: number): Promise<number> {
    const snapshots = this.store.get(aggregateId)
    if (!snapshots || snapshots.length <= keepCount) return 0

    const toRemove = snapshots.length - keepCount
    const pruned = snapshots.splice(0, toRemove)
    return pruned.length
  }

  /** 测试辅助: 获取快照数量 */
  count(aggregateId: string): number {
    return this.store.get(aggregateId)?.length ?? 0
  }

  /** 测试辅助: 清空所有快照 */
  clear(): void {
    this.store.clear()
  }
}

// ── 快照管理器 ──────────────────────────────────────────────────────

/** 事件存储接口 (仅需读取能力) */
export interface IEventStoreReader<E> {
  /** 获取指定版本之后的事件 */
  getEventsAfterVersion(aggregateId: string, version: number): Promise<E[]>
  /** 获取所有事件 */
  getAllEvents(aggregateId: string): Promise<E[]>
}

/** 投影器接口 */
export interface IProjector<T, E> {
  /** 从空状态开始投影所有事件 */
  projectAll(events: E[]): T
  /** 在现有状态上投影单个事件 */
  applyEvent(state: T, event: E): T
  /** 获取空状态 */
  getInitialState(): T
}

/**
 * SnapshotManager — 快照编排器
 *
 * 集成 EventStore + SnapshotStore + Projector:
 * 1. restoreState: 快照 + 增量事件 → 完整状态
 * 2. shouldSnapshot: 判断是否应创建快照
 * 3. createSnapshot: 创建并保存快照
 */
export class SnapshotManager<T, E> {
  constructor(
    private readonly eventStore: IEventStoreReader<E>,
    private readonly snapshotStore: ISnapshotStore<T>,
    private readonly projector: IProjector<T, E>,
    private readonly policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY,
  ) {}

  /**
   * 恢复状态: 快照 + 增量回放
   *
   * 性能: O(Δevents) 而非 O(all events)
   */
  async restoreState(aggregateId: string): Promise<{ state: T; version: number }> {
    const snapshot = await this.snapshotStore.findLatest(aggregateId)

    if (!snapshot) {
      // 无快照: 全量回放
      const events = await this.eventStore.getAllEvents(aggregateId)
      if (events.length === 0) {
        return { state: this.projector.getInitialState(), version: 0 }
      }
      return { state: this.projector.projectAll(events), version: events.length }
    }

    // 有快照: 增量回放
    const incrementalEvents = await this.eventStore.getEventsAfterVersion(
      aggregateId,
      snapshot.version,
    )

    let state = snapshot.state
    for (const event of incrementalEvents) {
      state = this.projector.applyEvent(state, event)
    }

    return {
      state,
      version: snapshot.version + incrementalEvents.length,
    }
  }

  /** 判断是否应创建快照 */
  shouldSnapshot(currentVersion: number): boolean {
    return currentVersion > 0 && currentVersion % this.policy.eventInterval === 0
  }

  /** 创建快照 + 清理旧快照 */
  async createSnapshot(aggregateId: string, version: number, state: T): Promise<void> {
    const snapshot: Snapshot<T> = {
      id: `${aggregateId}-snap-v${version}`,
      aggregateId,
      version,
      timestamp: new Date().toISOString(),
      state,
      metadata: {
        policy: this.policy,
      },
    }

    await this.snapshotStore.save(snapshot)
    await this.snapshotStore.pruneOlderSnapshots(
      aggregateId,
      this.policy.maxSnapshotsPerAggregate,
    )
  }

  /** 一站式: 恢复 → 操作 → 可能创建快照 */
  async withSnapshotAwareness(
    aggregateId: string,
    newVersion: number,
    newState: T,
  ): Promise<void> {
    if (this.shouldSnapshot(newVersion)) {
      await this.createSnapshot(aggregateId, newVersion, newState)
    }
  }
}
