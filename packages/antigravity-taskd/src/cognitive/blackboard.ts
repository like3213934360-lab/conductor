/**
 * blackboard.ts — MCP 语义黑板（Lazy-pull Context）
 *
 * 替代"暴力拼接"式的全量 Prompt 推送。Orchestrator 将 workspace 资源
 * 注册为 MCP Resources；Agent 通过 read(uri) 按需拉取，实现
 * Zero Context Pollution（零上下文污染）。
 *
 * 防御红线：
 *  - 单资源 > 5MB 抛出 ResourceTooLargeError，防止 V8 堆爆破
 *  - 缓存层避免同一资源重复 IO
 *  - dispose() 清理缓存防止内存泄漏
 */

import { Buffer } from 'node:buffer'

// ── 错误类型 ─────────────────────────────────────────────────────────────────

export class ResourceNotFoundError extends Error {
  constructor(uri: string) {
    super(`MCP resource not found: ${uri}`)
    this.name = 'ResourceNotFoundError'
  }
}

export class ResourceTooLargeError extends Error {
  constructor(uri: string, bytes: number, limitBytes: number) {
    super(
      `MCP resource ${uri} is too large (${bytes} bytes > ${limitBytes} bytes limit). ` +
      `Use chunked read or reduce file scope.`,
    )
    this.name = 'ResourceTooLargeError'
  }
}

// ── 接口契约 ──────────────────────────────────────────────────────────────────

/** 单个 MCP Resource 描述符 */
export interface McpResource {
  /** 资源唯一标识，例如 "file://src/foo.ts" 或 "symbol://FooClass" */
  uri: string
  /** MIME 类型，用于下游模型选择解析策略 */
  mimeType: string
  /** 按需加载：首次 read() 时调用，结果被缓存 */
  load(): Promise<string>
}

/** 黑板接口：由 Orchestrator 在 SCOUT 阶段建立 */
export interface McpBlackboard {
  register(resource: McpResource): void
  read(uri: string): Promise<string>
  list(): McpResourceDescriptor[]
  dispose(): void
}

/** read() 前返回给 Agent 的轻量元数据（不含内容） */
export interface McpResourceDescriptor {
  uri: string
  mimeType: string
}

// ── 实现 ─────────────────────────────────────────────────────────────────────

const MAX_RESOURCE_BYTES = 5 * 1024 * 1024  // 5 MB

interface CacheEntry {
  resource: McpResource
  /** 缓存后的内容，undefined 表示尚未加载 */
  content?: string
}

export class InMemoryMcpBlackboard implements McpBlackboard {
  private readonly store = new Map<string, CacheEntry>()
  private disposed = false

  register(resource: McpResource): void {
    this.assertAlive()
    this.store.set(resource.uri, { resource })
  }

  async read(uri: string): Promise<string> {
    this.assertAlive()
    const entry = this.store.get(uri)
    if (!entry) throw new ResourceNotFoundError(uri)

    // 缓存命中：直接返回
    if (entry.content !== undefined) return entry.content

    // 首次加载：懒求值
    const content = await entry.resource.load()

    // 防御红线：超大资源直接拒绝，防止 V8 堆爆破
    const byteLength = Buffer.byteLength(content, 'utf8')
    if (byteLength > MAX_RESOURCE_BYTES) {
      throw new ResourceTooLargeError(uri, byteLength, MAX_RESOURCE_BYTES)
    }

    // 写入缓存
    entry.content = content
    return content
  }

  list(): McpResourceDescriptor[] {
    this.assertAlive()
    return [...this.store.values()].map(({ resource }) => ({
      uri: resource.uri,
      mimeType: resource.mimeType,
    }))
  }

  dispose(): void {
    this.store.clear()
    this.disposed = true
  }

  private assertAlive(): void {
    if (this.disposed) throw new Error('McpBlackboard has been disposed')
  }
}
