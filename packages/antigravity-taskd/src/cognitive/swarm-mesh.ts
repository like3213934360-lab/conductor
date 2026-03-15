/**
 * swarm-mesh.ts — A2A MCP 互操作网格 (Agent-to-Agent Swarm Mesh)
 *
 * RFC-026 Phase 3: 去中心化液态脑网络
 *
 * 核心能力：
 *  - P2P 服务注册发现：Worker 子进程启动时注册 Peer 端点
 *  - 草稿交换：Worker 之间可通过 IPC 互访草稿（AST/代码片段）
 *  - 知识联邦：合并多 Worker 草稿到中枢 Blackboard
 *  - Token 熔断：所有 IPC 数据传输严格截断 maxTokens=2000 chars
 *  - Socket 安全：Unix 108 字符路径限制 + Windows Named Pipe 适配
 *
 * 防御红线：
 *  ① 100% 纯 JS — Unix Domain Socket / Named Pipe 均为 Node.js 内置
 *  ② Token 防 OOM — pullDraft 最大 2000 * 4 = ~8KB chars
 *  ③ IPC 超时 — 5 秒死线，防止相互死锁
 *  ④ Socket 清理 — dispose() 精准删除所有临时 Socket 文件
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as net from 'node:net'
import * as crypto from 'node:crypto'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 单个 Peer 节点描述符 */
export interface PeerDescriptor {
  peerId: string
  /** 正在处理的 Shard ID */
  shardId: string
  /** MicroMCP Socket 路径（Unix Socket 或 Windows Named Pipe） */
  socketPath: string
  /** 注册时间 */
  registeredAt: string
}

/** 草稿摘要（轻量，不含内容） */
export interface DraftDescriptor {
  draftId: string
  shardId: string
  filePaths: string[]
  /** 预估 Token 数 — 调用方用于 Token Budget 决策 */
  estimatedTokens: number
  updatedAt: string
}

/** 完整草稿 */
export interface Draft extends DraftDescriptor {
  content: string
}

/** Swarm 网格接口 */
export interface SwarmMesh {
  /** 注册一个 Worker Peer 端点 */
  register(peer: PeerDescriptor): void
  /** 解除注册（Worker 结束时） */
  unregister(peerId: string): void
  /** 查询其他存活 Peer */
  discoverPeers(excludePeerId: string): PeerDescriptor[]
  /** 获取所有已注册 Peer */
  listPeers(): PeerDescriptor[]
  /** 发布草稿到本地节点 */
  publishDraft(peerId: string, draft: Draft): void
  /** 获取某 Peer 的草稿列表（内存直接查询） */
  listDrafts(peerId: string): DraftDescriptor[]
  /** 拉取某 Peer 的特定草稿（带 Token 截断） */
  pullDraft(peerId: string, draftId: string, maxTokens?: number): string | undefined
  /** 知识联邦：合并所有 Peer 的草稿摘要 */
  federateSummaries(): string
  /** 清理所有 Socket 文件 */
  dispose(): void
}

// ── 常量 ─────────────────────────────────────────────────────────────────────

/** IPC 超时：5 秒死线 */
const IPC_TIMEOUT_MS = 5_000
/** 草稿内容最大 Token */
const MAX_DRAFT_TOKENS = 2_000
/** 每 Token 约 4 chars */
const CHARS_PER_TOKEN = 4
/** Unix Socket 路径最大长度（POSIX 标准：108 字节） */
const UNIX_SOCKET_MAX_PATH = 108

// ── Socket 路径生成（防溢出） ────────────────────────────────────────────────

/**
 * 生成安全的 Socket 路径。
 *
 * Unix 路径限制 108 字符。策略：
 *  1. 使用 os.tmpdir() 作为基础（通常是 /tmp，很短）
 *  2. 前缀 + 8 字符 UUID 哈希 = 确保唯一且巨短
 *  3. 如果仍超 108，使用 /tmp/ 硬编码前缀
 *
 * Windows：使用 Named Pipe 格式 `\\.\pipe\ag-swarm-{hash}`
 */
export function generateSocketPath(peerId: string): string {
  const hash = crypto.createHash('sha256')
    .update(peerId)
    .digest('hex')
    .slice(0, 12)

  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\ag-swarm-${hash}`
  }

  // Unix：尝试 os.tmpdir()
  const candidate = path.join(os.tmpdir(), `ag-swarm-${hash}.sock`)
  if (candidate.length <= UNIX_SOCKET_MAX_PATH) {
    return candidate
  }

  // 路径过长 → 退化到 /tmp/ 硬编码
  return `/tmp/ag-swarm-${hash}.sock`
}

// ── NoopSwarmMesh（单兵模式 / 兜底） ─────────────────────────────────────────

export class NoopSwarmMesh implements SwarmMesh {
  register(_peer: PeerDescriptor): void { /* noop */ }
  unregister(_peerId: string): void { /* noop */ }
  discoverPeers(_excludePeerId: string): PeerDescriptor[] { return [] }
  listPeers(): PeerDescriptor[] { return [] }
  publishDraft(_peerId: string, _draft: Draft): void { /* noop */ }
  listDrafts(_peerId: string): DraftDescriptor[] { return [] }
  pullDraft(_peerId: string, _draftId: string, _maxTokens?: number): string | undefined { return undefined }
  federateSummaries(): string { return '' }
  dispose(): void { /* noop */ }
}

// ── InMemorySwarmMesh（真实实现） ────────────────────────────────────────────

export class InMemorySwarmMesh implements SwarmMesh {
  private readonly peers = new Map<string, PeerDescriptor>()
  private readonly drafts = new Map<string, Map<string, Draft>>() // peerId → (draftId → Draft)
  private readonly socketPaths = new Set<string>()

  register(peer: PeerDescriptor): void {
    this.peers.set(peer.peerId, peer)
    this.socketPaths.add(peer.socketPath)
    if (!this.drafts.has(peer.peerId)) {
      this.drafts.set(peer.peerId, new Map())
    }
    console.info(`[swarm] Peer registered: ${peer.peerId} (shard=${peer.shardId}, socket=${peer.socketPath})`)
  }

  unregister(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (peer) {
      this.socketPaths.delete(peer.socketPath)
      // 清理 Socket 文件
      this.cleanupSocket(peer.socketPath)
    }
    this.peers.delete(peerId)
    this.drafts.delete(peerId)
    console.info(`[swarm] Peer unregistered: ${peerId}`)
  }

  discoverPeers(excludePeerId: string): PeerDescriptor[] {
    return [...this.peers.values()].filter(p => p.peerId !== excludePeerId)
  }

  listPeers(): PeerDescriptor[] {
    return [...this.peers.values()]
  }

  publishDraft(peerId: string, draft: Draft): void {
    let peerDrafts = this.drafts.get(peerId)
    if (!peerDrafts) {
      peerDrafts = new Map()
      this.drafts.set(peerId, peerDrafts)
    }

    // Token 截断：草稿内容严格限制
    const maxChars = MAX_DRAFT_TOKENS * CHARS_PER_TOKEN
    if (draft.content.length > maxChars) {
      draft.content = draft.content.slice(0, maxChars) + '\n…[TRUNCATED at 2000 tokens]'
    }

    peerDrafts.set(draft.draftId, draft)
  }

  listDrafts(peerId: string): DraftDescriptor[] {
    const peerDrafts = this.drafts.get(peerId)
    if (!peerDrafts) return []
    return [...peerDrafts.values()].map(({ content: _, ...desc }) => desc)
  }

  /**
   * 拉取草稿内容（带 Token 熔断防线）。
   *
   * maxTokens 默认 2000 → ~8000 chars。
   * 绝对不允许超过此限制，防止双向 OOM。
   */
  pullDraft(peerId: string, draftId: string, maxTokens: number = MAX_DRAFT_TOKENS): string | undefined {
    const peerDrafts = this.drafts.get(peerId)
    if (!peerDrafts) return undefined
    const draft = peerDrafts.get(draftId)
    if (!draft) return undefined

    const maxChars = maxTokens * CHARS_PER_TOKEN
    if (draft.content.length > maxChars) {
      return draft.content.slice(0, maxChars) + '\n…[TRUNCATED]'
    }
    return draft.content
  }

  /**
   * 知识联邦：合并所有 Peer 的草稿摘要为一段文本。
   * 用于 AGGREGATE 阶段注入到 Prompt 中。
   */
  federateSummaries(): string {
    const sections: string[] = []
    for (const [peerId, peerDrafts] of this.drafts) {
      if (peerDrafts.size === 0) continue
      const peer = this.peers.get(peerId)
      const draftSummaries = [...peerDrafts.values()]
        .map(d => `  - [${d.draftId}] ${d.filePaths.join(', ')} (~${d.estimatedTokens} tokens)`)
        .join('\n')
      sections.push(
        `Peer ${peerId} (shard=${peer?.shardId ?? '?'}):\n${draftSummaries}`,
      )
    }
    return sections.length > 0
      ? `<swarm_knowledge>\n${sections.join('\n\n')}\n</swarm_knowledge>`
      : ''
  }

  /**
   * 销毁：清理所有 Socket 文件，防止僵尸残留。
   */
  dispose(): void {
    for (const socketPath of this.socketPaths) {
      this.cleanupSocket(socketPath)
    }
    this.peers.clear()
    this.drafts.clear()
    this.socketPaths.clear()
    console.info('[swarm] Mesh disposed, all sockets cleaned')
  }

  private cleanupSocket(socketPath: string): void {
    if (process.platform === 'win32') return // Named Pipes 自动清理
    try {
      fs.unlinkSync(socketPath)
    } catch {
      // Socket 已不存在 — 静默忽略
    }
  }
}

// ── MicroMcpServer（Worker 侧微型 MCP 服务） ────────────────────────────────

/**
 * 微型 MCP Server — 基于 Unix Socket / Named Pipe。
 * 暴露两个工具：list_drafts、read_draft。
 *
 * 每个 Worker 子进程启动时在 Node.js 主进程侧创建此 Server，
 * 其他 Worker 可通过 Socket 连接过来查询草稿。
 *
 * 协议：极简 JSON-Line（每行一个 JSON 请求/响应）。
 * 非标准 MCP，但保持了 MCP 的 Tool 语义。
 */
export class MicroMcpServer {
  private server: net.Server | null = null
  private readonly socketPath: string
  /** 🛡️ 连接追踪：防止 stop() 时孤兒连接泄漏 */
  private readonly activeConnections = new Set<net.Socket>()

  constructor(
    socketPath: string,
    private readonly mesh: SwarmMesh,
    private readonly peerId: string,
  ) {
    this.socketPath = socketPath
  }

  /** 启动监听 */
  async start(): Promise<void> {
    // 清理旧 Socket（防止 EADDRINUSE）
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(this.socketPath) } catch { /* noop */ }
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((conn) => {
        // 连接追踪
        this.activeConnections.add(conn)
        conn.on('close', () => this.activeConnections.delete(conn))

        conn.setEncoding('utf8')
        let buffer = ''
        conn.on('data', (chunk) => {
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? '' // 保留未完成的行
          for (const line of lines) {
            if (!line.trim()) continue
            this.handleRequest(conn, line)
          }
        })
        conn.on('error', () => {
          this.activeConnections.delete(conn)
        })
      })

      this.server.on('error', reject)
      this.server.listen(this.socketPath, () => {
        console.info(`[swarm] MicroMCP listening on ${this.socketPath}`)
        resolve()
      })
    })
  }

  /** 停止服务、销毁所有连接、清理 Socket */
  stop(): void {
    // 🛡️ 强制销毁所有活跃连接（防止孤兒异步泄漏）
    for (const conn of this.activeConnections) {
      try { conn.destroy() } catch { /* noop */ }
    }
    this.activeConnections.clear()

    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(this.socketPath) } catch { /* noop */ }
    }
  }

  private handleRequest(conn: net.Socket, line: string): void {
    try {
      const req = JSON.parse(line) as { tool: string; args?: Record<string, unknown> }
      let result: unknown

      switch (req.tool) {
        case 'list_drafts':
          result = this.mesh.listDrafts(this.peerId)
          break
        case 'read_draft': {
          const draftId = String(req.args?.draftId ?? '')
          const maxTokens = typeof req.args?.maxTokens === 'number'
            ? Math.min(req.args.maxTokens, MAX_DRAFT_TOKENS)
            : MAX_DRAFT_TOKENS
          result = this.mesh.pullDraft(this.peerId, draftId, maxTokens)
          break
        }
        default:
          result = { error: `Unknown tool: ${req.tool}` }
      }

      conn.write(JSON.stringify({ ok: true, result }) + '\n')
    } catch (err) {
      conn.write(JSON.stringify({ ok: false, error: String(err) }) + '\n')
    }
  }
}

// ── MicroMcpClient（其他 Worker / Orchestrator 调用） ─────────────────────────

/**
 * 微型 MCP Client — 连接到某个 Peer 的 MicroMcpServer。
 *
 * 安全防线：
 *  - 5 秒 IPC 超时（防死锁）
 *  - Token 截断（防 OOM）
 */
export class MicroMcpClient {
  constructor(private readonly socketPath: string) {}

  /** 调用远程 Peer 的工具（带 5 秒超时） */
  async callTool(tool: string, args?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          conn.destroy()
          reject(new Error(`[swarm] IPC timeout (${IPC_TIMEOUT_MS}ms) calling ${tool} on ${this.socketPath}`))
        },
        IPC_TIMEOUT_MS,
      )

      const conn = net.createConnection(this.socketPath, () => {
        conn.write(JSON.stringify({ tool, args }) + '\n')
      })

      conn.setEncoding('utf8')
      let buffer = ''
      conn.on('data', (chunk) => {
        buffer += chunk
        const idx = buffer.indexOf('\n')
        if (idx >= 0) {
          clearTimeout(timer)
          try {
            const resp = JSON.parse(buffer.slice(0, idx))
            resolve(resp?.result)
          } catch (err) {
            reject(err)
          }
          conn.destroy()
        }
      })

      conn.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /** 列出远程 Peer 的草稿 */
  async listDrafts(): Promise<DraftDescriptor[]> {
    const result = await this.callTool('list_drafts')
    return Array.isArray(result) ? result : []
  }

  /** 读取远程 Peer 的草稿（Token 截断） */
  async readDraft(draftId: string, maxTokens: number = MAX_DRAFT_TOKENS): Promise<string | undefined> {
    const result = await this.callTool('read_draft', { draftId, maxTokens })
    return typeof result === 'string' ? result : undefined
  }
}

// ── P2P Prompt 注入工具 ─────────────────────────────────────────────────────

/**
 * 生成注入到 Worker System Prompt 中的 Peer 信息。
 * 让大模型知道有哪些同伴在工作，可通过 call_tool 主动拉取草稿。
 */
export function buildPeerDiscoveryPrompt(peers: PeerDescriptor[]): string {
  if (peers.length === 0) return ''

  const peerList = peers.map(p =>
    `  - Peer "${p.peerId}" working on shard="${p.shardId}" at socket="${p.socketPath}"`,
  ).join('\n')

  return [
    '<swarm_peers>',
    'The following peer workers are concurrently working on related shards.',
    'You may call their MCP tools to read their drafts if relevant to your shard:',
    '  Tool: list_drafts — returns available draft descriptors',
    '  Tool: read_draft(draftId, maxTokens=2000) — returns draft content (truncated)',
    peerList,
    '</swarm_peers>',
  ].join('\n')
}
