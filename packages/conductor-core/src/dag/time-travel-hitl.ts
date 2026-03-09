/**
 * Conductor AGC — Time-Travel HITL (Human-in-the-Loop)
 *
 * 基于 Event Sourcing 的状态回溯 + 人机交互节点:
 * - TimeTravel: rewind/fork DAG 到任意版本
 * - HITLGate: 暂停 DAG 执行, 等待人类输入, 恢复执行
 *
 * 参考:
 * - Event Sourcing (Martin Fowler) — 事件回放重建状态
 * - Temporal.io — Workflow replay & continue-as-new
 * - LangGraph 2.0 — Checkpoint / breakpoint / resumeability
 * - CrewAI v2 — Human approval gates
 *
 * 设计原则:
 * - 不修改任何历史事件 (append-only)
 * - 分支通过新 runId 实现 (fork)
 * - HITL 通过事件表达 (HITL_PAUSE / HITL_INPUT / HITL_RESUME)
 */
import type { AGCState, AGCEventEnvelope } from '@anthropic/conductor-shared'
import { createEventId, createISODateTime } from '@anthropic/conductor-shared'

// ── Time Travel 类型 ──────────────────────────────────────────────

/** 事件存储读取接口 */
export interface IEventReader {
  /** 读取指定 run 的所有事件 */
  getEvents(runId: string): Promise<AGCEventEnvelope[]>
  /** 读取版本范围内的事件 */
  getEventsByVersionRange(runId: string, fromVersion: number, toVersion: number): Promise<AGCEventEnvelope[]>
}

/** 状态投影器接口 */
export interface IStateProjector {
  /** 从事件列表投影出 AGCState */
  project(runId: string, events: AGCEventEnvelope[]): AGCState
}

/** 回溯快照 */
export interface TimeTravelSnapshot {
  /** 原始 runId */
  sourceRunId: string
  /** 回溯到的版本 */
  targetVersion: number
  /** 重建的状态 */
  state: AGCState
  /** 用于重建的事件数 */
  eventCount: number
  /** 回溯生成时间 */
  timestamp: string
}

/** Fork 结果 */
export interface ForkResult {
  /** 原始 runId */
  sourceRunId: string
  /** 分支 runId */
  forkedRunId: string
  /** 分支点版本 */
  forkAtVersion: number
  /** 继承的事件数 */
  inheritedEventCount: number
  /** 分支初始状态 */
  initialState: AGCState
}

// ── Time Travel 核心 ──────────────────────────────────────────────

/**
 * TimeTravel — DAG 状态时间旅行
 *
 * 功能:
 * 1. rewindToVersion: 回放事件到指定版本，重建状态
 * 2. forkFromVersion: 从历史版本创建新分支
 * 3. compareVersions: 比较两个版本的状态差异
 */
export class TimeTravel {
  constructor(
    private readonly eventReader: IEventReader,
    private readonly projector: IStateProjector,
  ) {}

  /**
   * 回溯到指定版本
   *
   * 通过只回放 [0, version] 范围内的事件来重建状态。
   */
  async rewindToVersion(runId: string, version: number): Promise<TimeTravelSnapshot> {
    const events = await this.eventReader.getEventsByVersionRange(runId, 0, version)

    if (events.length === 0) {
      throw new Error(`No events found for runId=${runId} up to version=${version}`)
    }

    const state = this.projector.project(runId, events)

    return {
      sourceRunId: runId,
      targetVersion: version,
      state,
      eventCount: events.length,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * 从历史版本创建分支
   *
   * 步骤:
   * 1. 回溯到指定版本
   * 2. 生成新 runId
   * 3. 返回分支初始状态（可用于启动新的 DAG 执行）
   */
  async forkFromVersion(runId: string, version: number): Promise<ForkResult> {
    const snapshot = await this.rewindToVersion(runId, version)

    const forkedRunId = `${runId}-fork-${Date.now()}`

    return {
      sourceRunId: runId,
      forkedRunId,
      forkAtVersion: version,
      inheritedEventCount: snapshot.eventCount,
      initialState: {
        ...snapshot.state,
        runId: forkedRunId,
      },
    }
  }

  /**
   * 比较两个版本的状态差异
   */
  async compareVersions(
    runId: string,
    versionA: number,
    versionB: number,
  ): Promise<VersionDiff> {
    const [snapshotA, snapshotB] = await Promise.all([
      this.rewindToVersion(runId, versionA),
      this.rewindToVersion(runId, versionB),
    ])

    const changedNodes: NodeDiff[] = []
    const allNodeIds = new Set([
      ...Object.keys(snapshotA.state.nodes),
      ...Object.keys(snapshotB.state.nodes),
    ])

    for (const nodeId of allNodeIds) {
      const a = snapshotA.state.nodes[nodeId]
      const b = snapshotB.state.nodes[nodeId]

      if (!a && b) {
        changedNodes.push({ nodeId, type: 'added', before: undefined, after: b.status })
      } else if (a && !b) {
        changedNodes.push({ nodeId, type: 'removed', before: a.status, after: undefined })
      } else if (a && b && a.status !== b.status) {
        changedNodes.push({ nodeId, type: 'changed', before: a.status, after: b.status })
      }
    }

    return {
      runId,
      versionA,
      versionB,
      changedNodes,
      eventsBetween: snapshotB.eventCount - snapshotA.eventCount,
    }
  }
}

/** 版本差异 */
export interface VersionDiff {
  runId: string
  versionA: number
  versionB: number
  changedNodes: NodeDiff[]
  eventsBetween: number
}

/** 节点差异 */
export interface NodeDiff {
  nodeId: string
  type: 'added' | 'removed' | 'changed'
  before: string | undefined
  after: string | undefined
}

// ── HITL Gate ──────────────────────────────────────────────────────

/** HITL 暂停原因 */
export type HITLPauseReason =
  | 'risk_escalation'    // 风险升级需要人工确认
  | 'compliance_review'  // 合规问题需要人工审查
  | 'manual_approval'    // 手动审批
  | 'custom'             // 自定义原因

/** HITL 输入 */
export interface HITLInput {
  /** 操作: 批准/拒绝/修改 */
  action: 'approve' | 'reject' | 'modify'
  /** 附加说明 */
  comment?: string
  /** 修改内容 (action=modify 时使用) */
  modifications?: Record<string, unknown>
  /** 操作者 */
  operator: string
}

/** HITL Gate 状态 */
export interface HITLGateState {
  /** 是否正在等待输入 */
  isPaused: boolean
  /** 暂停原因 */
  pauseReason?: HITLPauseReason
  /** 暂停节点 */
  pausedAtNode?: string
  /** 暂停时间 */
  pausedAt?: string
  /** 已接收的输入 */
  input?: HITLInput
}

/**
 * HITLGate — 人机交互节点
 *
 * 在 DAG 执行中插入人类审批/输入节点:
 * 1. pause() — 暂停 DAG，等待人类输入
 * 2. receiveInput() — 接收人类输入
 * 3. resume() — 根据输入恢复执行
 *
 * 所有操作通过事件表达，与 Event Sourcing 完全集成。
 */
export class HITLGate {
  private state: HITLGateState = { isPaused: false }

  /** 获取当前 HITL 状态 */
  getState(): Readonly<HITLGateState> {
    return { ...this.state }
  }

  /**
   * 暂停 DAG 执行，等待人类输入
   *
   * 产出 HITL_PAUSE_REQUESTED 事件
   */
  pause(
    runId: string,
    nodeId: string,
    reason: HITLPauseReason,
    version: number,
    detail?: string,
  ): AGCEventEnvelope {
    this.state = {
      isPaused: true,
      pauseReason: reason,
      pausedAtNode: nodeId,
      pausedAt: new Date().toISOString(),
    }

    return {
      eventId: createEventId(),
      runId,
      type: 'HITL_PAUSE_REQUESTED',
      payload: {
        nodeId,
        reason,
        detail: detail ?? '',
      },
      timestamp: createISODateTime(),
      version: version + 1,
    }
  }

  /**
   * 接收人类输入
   *
   * 产出 HITL_INPUT_RECEIVED 事件
   */
  receiveInput(
    runId: string,
    input: HITLInput,
    version: number,
  ): AGCEventEnvelope {
    if (!this.state.isPaused) {
      throw new Error('HITL gate is not paused — cannot receive input')
    }

    this.state.input = input

    return {
      eventId: createEventId(),
      runId,
      type: 'HITL_INPUT_RECEIVED',
      payload: {
        action: input.action,
        operator: input.operator,
        comment: input.comment,
        nodeId: this.state.pausedAtNode,
      },
      timestamp: createISODateTime(),
      version: version + 1,
    }
  }

  /**
   * 恢复 DAG 执行
   *
   * 产出 HITL_RESUMED 事件
   * 如果 action=reject，DAG 将不会恢复。
   */
  resume(
    runId: string,
    version: number,
  ): { event: AGCEventEnvelope; shouldResume: boolean } {
    if (!this.state.isPaused) {
      throw new Error('HITL gate is not paused — cannot resume')
    }
    if (!this.state.input) {
      throw new Error('HITL gate has not received input — cannot resume')
    }

    const shouldResume = this.state.input.action !== 'reject'

    const event: AGCEventEnvelope = {
      eventId: createEventId(),
      runId,
      type: 'HITL_RESUMED',
      payload: {
        action: this.state.input.action,
        operator: this.state.input.operator,
        nodeId: this.state.pausedAtNode,
        shouldResume,
        resumedAt: new Date().toISOString(),
      },
      timestamp: createISODateTime(),
      version: version + 1,
    }

    // 重置状态
    this.state = { isPaused: false }

    return { event, shouldResume }
  }

  /**
   * 便捷方法: 完整的暂停-接收-恢复流程
   *
   * 返回产出的全部事件
   */
  static createHITLFlow(
    runId: string,
    nodeId: string,
    reason: HITLPauseReason,
    input: HITLInput,
    startVersion: number,
    detail?: string,
  ): { events: AGCEventEnvelope[]; shouldResume: boolean } {
    const gate = new HITLGate()
    const events: AGCEventEnvelope[] = []

    events.push(gate.pause(runId, nodeId, reason, startVersion, detail))
    events.push(gate.receiveInput(runId, input, startVersion + 1))

    const resumeResult = gate.resume(runId, startVersion + 2)
    events.push(resumeResult.event)

    return { events, shouldResume: resumeResult.shouldResume }
  }
}
