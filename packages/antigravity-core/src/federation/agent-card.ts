import * as crypto from 'node:crypto'
/**
 * Antigravity Workflow Runtime — Agent Card & Registry (A2A Federation)
 *
 * SOTA 参考:
 * - Google A2A Protocol: Agent Card 标准化描述
 * - OpenAI Swarm SDK: Agent 定义 + instructions + functions
 * - CrewAI v2: Role-based agent definition
 *
 * 设计:
 * - AgentCard: A2A 标准 Agent 描述（id, capabilities, endpoint, trust）
 * - AgentRegistry: Agent 注册中心（register/discover/heartbeat/evict）
 * - CapabilityMatcher: 按任务需求匹配最优 Agent
 */

// ─── Agent Card 定义 ─────────────────────────────────────────────────

/** Agent 能力声明 */
export interface AgentCapability {
  /** 能力 ID (如 "code_review", "translate", "summarize") */
  id: string
  /** 能力描述 */
  description: string
  /** 支持的输入类型 */
  inputTypes?: string[]
  /** 支持的输出类型 */
  outputTypes?: string[]
  /** 能力评分 (0-100) */
  proficiency?: number
}

/** Agent delivery mode */
export type AgentDeliveryMode = 'inline' | 'poll' | 'stream' | 'callback'

/** Callback auth advertisement */
export interface AgentCallbackAuthSurface {
  authSchemes: Array<'hmac-sha256'>
  signatureHeader?: string
  timestampHeader?: string
  signatureEncoding?: 'hex'
}

/** Agent card advertisement metadata */
export interface AgentCardAdvertisementSignature {
  scheme: 'hmac-sha256'
  keyId: string
  issuer?: string
  signedAt: string
  signature: string
}

/** Agent card advertisement metadata */
export interface AgentCardAdvertisement {
  schemaVersion: string
  publishedAt: string
  expiresAt?: string
  signature?: AgentCardAdvertisementSignature
}

/** Agent task protocol advertisement */
export interface AgentTaskProtocol {
  taskEndpoint?: string
  supportedResponseModes: AgentDeliveryMode[]
  preferredResponseMode?: AgentDeliveryMode
  statusEndpointTemplate?: string
  streamEndpointTemplate?: string
  callback?: AgentCallbackAuthSurface
}

/** Agent 通信端点 */
export interface AgentEndpoint {
  /** 通信协议 */
  protocol: 'in-process' | 'http' | 'websocket' | 'grpc' | 'mcp'
  /** 端点地址 */
  url: string
  /** 认证方式 */
  auth?: 'none' | 'api-key' | 'oauth2' | 'mtls'
}

/** Agent 健康状态 */
export type AgentHealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown'

/**
 * AgentCard — A2A 标准 Agent 描述
 *
 * 参考 Google A2A Agent Card specification:
 * https://google.github.io/A2A/#/documentation?id=agent-card
 */
export interface AgentCard {
  /** Agent 唯一 ID */
  id: string
  /** Agent 名称 */
  name: string
  /** 版本号 */
  version: string
  /** 描述 */
  description: string
  /** 能力列表 */
  capabilities: AgentCapability[]
  /** 通信端点 */
  endpoint: AgentEndpoint
  /** 任务协议面 */
  taskProtocol?: AgentTaskProtocol
  /** Agent card advertisement metadata */
  advertisement?: AgentCardAdvertisement
  /** 信任评分 (0-100, 由 GovernanceGateway 评定) */
  trustScore: number
  /** 运行中任务数 */
  activeTasks: number
  /** 最大并发任务数 */
  maxConcurrency: number
  /** 上次心跳时间 (ISO 8601) */
  lastHeartbeat: string
  /** 健康状态 */
  health: AgentHealthStatus
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableNormalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableNormalize(entry)]),
    )
  }
  return value
}

export function createAgentCardAdvertisementSurface(card: AgentCard): Record<string, unknown> {
  return stableNormalize({
    id: card.id,
    name: card.name,
    version: card.version,
    description: card.description,
    capabilities: card.capabilities,
    endpoint: card.endpoint,
    taskProtocol: card.taskProtocol,
    advertisement: card.advertisement ? {
      schemaVersion: card.advertisement.schemaVersion,
      publishedAt: card.advertisement.publishedAt,
      expiresAt: card.advertisement.expiresAt,
    } : undefined,
    trustScore: card.trustScore,
    maxConcurrency: card.maxConcurrency,
    metadata: card.metadata,
  }) as Record<string, unknown>
}

export function serializeAgentCardAdvertisementSurface(card: AgentCard): string {
  return JSON.stringify(createAgentCardAdvertisementSurface(card))
}

export function signAgentCardAdvertisementSurface(card: AgentCard, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(serializeAgentCardAdvertisementSurface(card))
    .digest('hex')
}

// ─── Agent Registry ──────────────────────────────────────────────────

export interface AgentRegistryConfig {
  /** 心跳超时 (ms)，超过此时间未心跳则标记为 unreachable */
  heartbeatTimeoutMs: number
  /** 自动淘汰 unreachable agent (ms) */
  evictionTimeoutMs: number
  /** 最大注册 Agent 数 */
  maxAgents: number
}

const DEFAULT_REGISTRY_CONFIG: AgentRegistryConfig = {
  heartbeatTimeoutMs: 30_000,
  evictionTimeoutMs: 120_000,
  maxAgents: 100,
}

/**
 * AgentRegistry — Agent 注册中心
 *
 * 管理 Agent 生命周期：注册 → 心跳 → 发现 → 淘汰
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentCard>()
  private readonly config: AgentRegistryConfig

  constructor(config?: Partial<AgentRegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config }
  }

  /** 注册 Agent */
  register(card: AgentCard): void {
    if (this.agents.size >= this.config.maxAgents && !this.agents.has(card.id)) {
      throw new Error(`Registry full: max ${this.config.maxAgents} agents`)
    }
    this.agents.set(card.id, {
      ...card,
      lastHeartbeat: new Date().toISOString(),
      health: 'healthy',
    })
  }

  /** 注销 Agent */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId)
  }

  /** 心跳更新 */
  heartbeat(agentId: string, status?: Partial<Pick<AgentCard, 'activeTasks' | 'health'>>): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false
    agent.lastHeartbeat = new Date().toISOString()
    agent.health = status?.health ?? 'healthy'
    if (status?.activeTasks !== undefined) agent.activeTasks = status.activeTasks
    return true
  }

  /** 获取 Agent */
  get(agentId: string): AgentCard | undefined {
    return this.agents.get(agentId)
  }

  /** 发现 — 按能力过滤 */
  discover(filter?: {
    capability?: string
    health?: AgentHealthStatus
    minTrust?: number
    availableOnly?: boolean
  }): AgentCard[] {
    let results = Array.from(this.agents.values())

    if (filter?.capability) {
      const cap = filter.capability
      results = results.filter(a => a.capabilities.some(c => c.id === cap))
    }
    if (filter?.health) {
      results = results.filter(a => a.health === filter.health)
    }
    if (filter?.minTrust !== undefined) {
      results = results.filter(a => a.trustScore >= filter.minTrust!)
    }
    if (filter?.availableOnly) {
      results = results.filter(a => a.activeTasks < a.maxConcurrency && a.health === 'healthy')
    }

    return results
  }

  /** 检查心跳超时，标记不健康 Agent */
  checkHealth(): { degraded: string[]; evicted: string[] } {
    const now = Date.now()
    const degraded: string[] = []
    const evicted: string[] = []

    for (const [id, agent] of this.agents) {
      const elapsed = now - new Date(agent.lastHeartbeat).getTime()

      if (elapsed > this.config.evictionTimeoutMs) {
        this.agents.delete(id)
        evicted.push(id)
      } else if (elapsed > this.config.heartbeatTimeoutMs) {
        agent.health = 'unreachable'
        degraded.push(id)
      }
    }

    return { degraded, evicted }
  }

  /** 获取所有注册的 Agent */
  listAll(): AgentCard[] {
    return Array.from(this.agents.values())
  }

  /** 获取统计信息 */
  stats(): { total: number; healthy: number; degraded: number; unreachable: number } {
    const all = this.listAll()
    return {
      total: all.length,
      healthy: all.filter(a => a.health === 'healthy').length,
      degraded: all.filter(a => a.health === 'degraded').length,
      unreachable: all.filter(a => a.health === 'unreachable').length,
    }
  }
}

// ─── Capability Matcher ──────────────────────────────────────────────

/** 匹配请求 */
export interface MatchRequest {
  /** 需要的能力 ID 列表 */
  requiredCapabilities: string[]
  /** 优选的输入类型 */
  preferredInputTypes?: string[]
  /** 最低信任分 */
  minTrustScore?: number
  /** 是否要求全部能力匹配 */
  requireAll?: boolean
}

/** 匹配结果 */
export interface MatchResult {
  agent: AgentCard
  /** 匹配分数 (0-1) */
  score: number
  /** 匹配到的能力 */
  matchedCapabilities: string[]
  /** 缺失的能力 */
  missingCapabilities: string[]
}

/**
 * CapabilityMatcher — 按任务需求匹配 Agent
 *
 * 综合评分 = capability_coverage × 0.4 + proficiency × 0.3 + trust × 0.2 + availability × 0.1
 */
export class CapabilityMatcher {
  constructor(private readonly registry: AgentRegistry) {}

  /**
   * 匹配最优 Agent
   * @returns 按分数降序排列的匹配结果
   */
  match(request: MatchRequest): MatchResult[] {
    const agents = this.registry.discover({
      health: 'healthy',
      minTrust: request.minTrustScore,
      availableOnly: true,
    })

    const results: MatchResult[] = []

    for (const agent of agents) {
      const agentCapIds = new Set(agent.capabilities.map(c => c.id))
      const matched = request.requiredCapabilities.filter(r => agentCapIds.has(r))
      const missing = request.requiredCapabilities.filter(r => !agentCapIds.has(r))

      // 如果要求全部匹配但有缺失，跳过
      if (request.requireAll && missing.length > 0) continue

      // 能力覆盖率
      const coverage = request.requiredCapabilities.length > 0
        ? matched.length / request.requiredCapabilities.length
        : 0

      // 平均熟练度 (匹配到的能力)
      const proficiencies = matched.map(capId => {
        const cap = agent.capabilities.find(c => c.id === capId)
        return (cap?.proficiency ?? 50) / 100
      })
      const avgProficiency = proficiencies.length > 0
        ? proficiencies.reduce((a, b) => a + b, 0) / proficiencies.length
        : 0

      // 信任分归一化
      const trustNorm = agent.trustScore / 100

      // 可用度 (剩余容量)
      const availability = agent.maxConcurrency > 0
        ? (agent.maxConcurrency - agent.activeTasks) / agent.maxConcurrency
        : 0

      // 综合评分
      const score = coverage * 0.4 + avgProficiency * 0.3 + trustNorm * 0.2 + availability * 0.1

      if (score > 0) {
        results.push({ agent, score, matchedCapabilities: matched, missingCapabilities: missing })
      }
    }

    return results.sort((a, b) => b.score - a.score)
  }

  /** 查找单个最优 Agent */
  findBest(request: MatchRequest): MatchResult | null {
    const results = this.match(request)
    return results[0] ?? null
  }
}
