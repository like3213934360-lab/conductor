/**
 * Conductor AGC — Federation Bus (P2P Message Transport)
 *
 * SOTA 参考:
 * - Google A2A: Task lifecycle message types
 * - NATS/RabbitMQ: Pub/Sub + Request/Reply patterns
 * - Event Sourcing: All messages emit domain events
 *
 * 设计:
 * - IFederationTransport: 抽象通信层接口
 * - InProcessTransport: 进程内直连（测试/单机部署）
 * - FederationBus: 消息总线 (send/broadcast/subscribe)
 * - FederationMessage: 标准化消息格式
 */

// ─── Message Types ───────────────────────────────────────────────────

/** 联邦消息类型 */
export type FederationMessageType =
  | 'task.delegate'      // 委派任务给另一个 Agent
  | 'task.result'        // 返回任务结果
  | 'task.cancel'        // 取消委派的任务
  | 'heartbeat'          // Agent 心跳
  | 'heartbeat.ack'      // 心跳确认
  | 'handoff.request'    // Handoff 请求
  | 'handoff.accept'     // Handoff 接受
  | 'handoff.reject'     // Handoff 拒绝
  | 'discovery.query'    // Agent 发现查询
  | 'discovery.response' // Agent 发现响应

/** 联邦消息 */
export interface FederationMessage<T = unknown> {
  /** 消息唯一 ID */
  messageId: string
  /** 关联 ID (用于 Request/Reply 关联) */
  correlationId?: string
  /** 发送方 Agent ID */
  sender: string
  /** 接收方 Agent ID (* 表示广播) */
  receiver: string
  /** 消息类型 */
  type: FederationMessageType
  /** 消息载荷 */
  payload: T
  /** 发送时间 (ISO 8601) */
  timestamp: string
  /** TTL (ms), 超过后消息过期 */
  ttlMs?: number
  /** 消息优先级 (0=低, 10=最高) */
  priority?: number
}

/** 消息处理器 */
export type MessageHandler<T = unknown> = (message: FederationMessage<T>) => void | Promise<void>

/** 订阅器 */
export interface Subscription {
  id: string
  unsubscribe: () => void
}

// ─── Transport Interface ─────────────────────────────────────────────

/**
 * IFederationTransport — 抽象通信层
 *
 * 可实现为:
 * - InProcessTransport: 进程内 (EventEmitter)
 * - HttpTransport: HTTP REST API
 * - WebSocketTransport: WebSocket 双向通信
 * - GrpcTransport: gRPC streaming
 */
export interface IFederationTransport {
  /** 发送消息到指定 Agent */
  send(message: FederationMessage): Promise<boolean>
  /** 广播消息到所有 Agent */
  broadcast(message: FederationMessage): Promise<number>
  /** 订阅消息 */
  subscribe(agentId: string, handler: MessageHandler): Subscription
  /** 关闭传输 */
  close(): Promise<void>
}

// ─── InProcess Transport ─────────────────────────────────────────────

/**
 * InProcessTransport — 进程内直连
 *
 * 用于测试和单机部署场景，通过内存 Map 存储订阅
 */
export class InProcessTransport implements IFederationTransport {
  private readonly handlers = new Map<string, { id: string; handler: MessageHandler }[]>()
  private subCounter = 0

  async send(message: FederationMessage): Promise<boolean> {
    const subs = this.handlers.get(message.receiver) ?? []
    if (subs.length === 0) return false

    for (const sub of subs) {
      try {
        await sub.handler(message)
      } catch {
        // 吞掉错误，保证其他订阅不受影响
      }
    }
    return true
  }

  async broadcast(message: FederationMessage): Promise<number> {
    let delivered = 0
    for (const [agentId, subs] of this.handlers) {
      if (agentId === message.sender) continue // 不发给自己
      for (const sub of subs) {
        try {
          await sub.handler({ ...message, receiver: agentId })
          delivered++
        } catch {
          // swallow
        }
      }
    }
    return delivered
  }

  subscribe(agentId: string, handler: MessageHandler): Subscription {
    const id = `sub-${++this.subCounter}`
    const subs = this.handlers.get(agentId) ?? []
    subs.push({ id, handler })
    this.handlers.set(agentId, subs)

    return {
      id,
      unsubscribe: () => {
        const current = this.handlers.get(agentId) ?? []
        this.handlers.set(agentId, current.filter(s => s.id !== id))
      },
    }
  }

  async close(): Promise<void> {
    this.handlers.clear()
  }

  /** 获取已注册的 Agent 数量 */
  get agentCount(): number {
    return this.handlers.size
  }
}

// ─── Federation Bus ──────────────────────────────────────────────────

/** Federation Bus 配置 */
export interface FederationBusConfig {
  /** 本地 Agent ID */
  localAgentId: string
  /** 默认消息 TTL (ms) */
  defaultTtlMs: number
  /** 是否启用事件日志 */
  enableEventLog: boolean
  /** 事件日志最大条目 */
  maxEventLogSize: number
}

const DEFAULT_BUS_CONFIG: FederationBusConfig = {
  localAgentId: 'local',
  defaultTtlMs: 30_000,
  enableEventLog: true,
  maxEventLogSize: 1000,
}

/** 联邦事件 (Event Sourcing 集成) */
export interface FederationEvent {
  eventId: string
  type: `FEDERATION_${string}`
  message: FederationMessage
  timestamp: string
  direction: 'outgoing' | 'incoming'
}

/**
 * FederationBus — P2P 消息总线
 *
 * 在 IFederationTransport 之上提供:
 * 1. 消息 ID 自动生成
 * 2. TTL 过期检查
 * 3. Event Sourcing 事件日志
 * 4. 便捷的 delegate/reply/heartbeat 方法
 */
export class FederationBus {
  private readonly transport: IFederationTransport
  private readonly config: FederationBusConfig
  private readonly eventLog: FederationEvent[] = []
  private msgCounter = 0

  constructor(transport: IFederationTransport, config?: Partial<FederationBusConfig>) {
    this.transport = transport
    this.config = { ...DEFAULT_BUS_CONFIG, ...config }
  }

  /** 发送消息 */
  async send<T>(
    receiver: string,
    type: FederationMessageType,
    payload: T,
    options?: { correlationId?: string; ttlMs?: number; priority?: number },
  ): Promise<FederationMessage<T>> {
    const message: FederationMessage<T> = {
      messageId: this.nextMessageId(),
      correlationId: options?.correlationId,
      sender: this.config.localAgentId,
      receiver,
      type,
      payload,
      timestamp: new Date().toISOString(),
      ttlMs: options?.ttlMs ?? this.config.defaultTtlMs,
      priority: options?.priority,
    }

    await this.transport.send(message as FederationMessage)
    this.logEvent(message as FederationMessage, 'outgoing')
    return message
  }

  /** 广播消息 */
  async broadcast<T>(
    type: FederationMessageType,
    payload: T,
    options?: { ttlMs?: number; priority?: number },
  ): Promise<{ message: FederationMessage<T>; deliveredCount: number }> {
    const message: FederationMessage<T> = {
      messageId: this.nextMessageId(),
      sender: this.config.localAgentId,
      receiver: '*',
      type,
      payload,
      timestamp: new Date().toISOString(),
      ttlMs: options?.ttlMs ?? this.config.defaultTtlMs,
      priority: options?.priority,
    }

    const deliveredCount = await this.transport.broadcast(message as FederationMessage)
    this.logEvent(message as FederationMessage, 'outgoing')
    return { message, deliveredCount }
  }

  /** 订阅入站消息 */
  subscribe(handler: MessageHandler, filter?: { types?: FederationMessageType[] }): Subscription {
    const wrappedHandler: MessageHandler = async (msg) => {
      // TTL 检查
      if (msg.ttlMs) {
        const age = Date.now() - new Date(msg.timestamp).getTime()
        if (age > msg.ttlMs) return // 过期消息，丢弃
      }

      // 类型过滤
      if (filter?.types && !filter.types.includes(msg.type)) return

      this.logEvent(msg, 'incoming')
      await handler(msg)
    }

    return this.transport.subscribe(this.config.localAgentId, wrappedHandler)
  }

  // ── 便捷方法 ──────────────────────────────────────────────────────

  /** 委派任务 */
  async delegate(targetAgentId: string, task: {
    taskId: string
    description: string
    requiredCapabilities: string[]
    context?: Record<string, unknown>
  }): Promise<FederationMessage> {
    return this.send(targetAgentId, 'task.delegate', task, { priority: 5 })
  }

  /** 返回任务结果 */
  async reply(originalMessage: FederationMessage, result: {
    taskId: string
    success: boolean
    output: unknown
    error?: string
  }): Promise<FederationMessage> {
    return this.send(originalMessage.sender, 'task.result', result, {
      correlationId: originalMessage.messageId,
    })
  }

  /** 发送心跳 */
  async sendHeartbeat(targetAgentId: string, status: {
    activeTasks: number
    health: string
  }): Promise<FederationMessage> {
    return this.send(targetAgentId, 'heartbeat', status, { ttlMs: 5000 })
  }

  // ── Event Sourcing ────────────────────────────────────────────────

  /** 获取事件日志 */
  getEventLog(limit?: number): FederationEvent[] {
    const log = [...this.eventLog]
    return limit ? log.slice(-limit) : log
  }

  /** 获取统计 */
  stats(): {
    totalMessages: number
    outgoing: number
    incoming: number
    byType: Record<string, number>
  } {
    const outgoing = this.eventLog.filter(e => e.direction === 'outgoing').length
    const incoming = this.eventLog.filter(e => e.direction === 'incoming').length
    const byType: Record<string, number> = {}
    for (const e of this.eventLog) {
      byType[e.message.type] = (byType[e.message.type] ?? 0) + 1
    }
    return { totalMessages: this.eventLog.length, outgoing, incoming, byType }
  }

  /** 关闭总线 */
  async close(): Promise<void> {
    await this.transport.close()
  }

  // ── 私有方法 ──────────────────────────────────────────────────────

  private nextMessageId(): string {
    return `fed-${Date.now()}-${++this.msgCounter}`
  }

  private logEvent(message: FederationMessage, direction: 'outgoing' | 'incoming'): void {
    if (!this.config.enableEventLog) return

    this.eventLog.push({
      eventId: `evt-${Date.now()}-${this.eventLog.length}`,
      type: `FEDERATION_${message.type.toUpperCase().replace('.', '_')}` as `FEDERATION_${string}`,
      message,
      timestamp: new Date().toISOString(),
      direction,
    })

    // 超过容量时裁剪
    while (this.eventLog.length > this.config.maxEventLogSize) {
      this.eventLog.shift()
    }
  }
}
