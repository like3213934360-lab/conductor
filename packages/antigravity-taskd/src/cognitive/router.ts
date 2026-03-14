/**
 * router.ts — MoA 动态路由 & CQRS 工具隔离
 *
 * 职责：
 * 1. RouterPolicy — 根据 TaskIntent + 上下文大小选择最优 Backend
 * 2. ToolManifest — 静态 CQRS 隔离：分析节点禁止写工具，防止并发踩踏
 *
 * 防御红线：
 *  - 'scout' / 'analyze' 意图强制绑定 READ_ONLY_TOOLS
 *  - 工具检查函数 assertToolAllowed() 在 Worker 调用前验证
 */

import type { WorkerBackend } from '../schema.js'

// ── 任务意图枚举 ──────────────────────────────────────────────────────────────

export type TaskIntent = 'scout' | 'analyze' | 'generate' | 'verify'

// ── CQRS Tool Manifests ───────────────────────────────────────────────────────

/** 只读工具集：分析节点强制使用，严禁任何写操作 */
export const READ_ONLY_TOOLS = new Set([
  'read_resource',
  'list_resources',
  'search_symbol',
  'get_diagnostics',
  'read_file',
  'list_directory',
])

/** 读写工具集：仅 generate / write 节点可用 */
export const READ_WRITE_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'apply_edit',
  'create_file',
  'rename_file',
  'delete_file',
  'write_file',
])

export interface ToolManifest {
  readonly allowedTools: ReadonlySet<string>
  readonly mode: 'read-only' | 'read-write'
}

export const READ_ONLY_MANIFEST: ToolManifest = {
  allowedTools: READ_ONLY_TOOLS,
  mode: 'read-only',
}

export const READ_WRITE_MANIFEST: ToolManifest = {
  allowedTools: READ_WRITE_TOOLS,
  mode: 'read-write',
}

/** 工具调用前的 CQRS 检查 — 违规抛出，防止并发踩踏 */
export class ToolAccessViolationError extends Error {
  constructor(tool: string, manifest: ToolManifest) {
    super(
      `CQRS violation: tool "${tool}" is not allowed in ${manifest.mode} manifest. ` +
      `Allowed: [${[...manifest.allowedTools].join(', ')}]`,
    )
    this.name = 'ToolAccessViolationError'
  }
}

export function assertToolAllowed(tool: string, manifest: ToolManifest): void {
  if (!manifest.allowedTools.has(tool)) {
    throw new ToolAccessViolationError(tool, manifest)
  }
}

// ── RouterPolicy 接口 ─────────────────────────────────────────────────────────

export interface RouterDecision {
  backend: WorkerBackend
  /** 该 Backend 被强制绑定的工具集 */
  manifest: ToolManifest
}

export interface RouterPolicy {
  route(intent: TaskIntent, contextTokenEstimate?: number): RouterDecision
}

// ── 默认实现 ──────────────────────────────────────────────────────────────────

/**
 * DefaultRouterPolicy：
 *  - generate  → Codex（精准代码生成）+ 读写工具
 *  - scout     → Gemini（超长上下文扫描）+ 只读（强制）
 *  - analyze   → tokens > 32K → Gemini；否则 Codex —— 均为只读（强制）
 *  - verify    → Gemini（多维验证）+ 只读（强制）
 */
export class DefaultRouterPolicy implements RouterPolicy {
  /** 超过此 token 估计，优先使用长上下文 Gemini */
  private static readonly LONG_CONTEXT_THRESHOLD = 32_000

  route(intent: TaskIntent, contextTokenEstimate: number = 0): RouterDecision {
    switch (intent) {
      case 'generate':
        return { backend: 'codex', manifest: READ_WRITE_MANIFEST }

      case 'scout':
        // scout 永远使用超长上下文 Gemini，且强制只读
        return { backend: 'gemini', manifest: READ_ONLY_MANIFEST }

      case 'analyze':
        // 分析：按 token 量路由，CQRS 强制只读
        return {
          backend: contextTokenEstimate > DefaultRouterPolicy.LONG_CONTEXT_THRESHOLD
            ? 'gemini'
            : 'codex',
          manifest: READ_ONLY_MANIFEST,
        }

      case 'verify':
        // verify 需要全面推理，用 Gemini，只读
        return { backend: 'gemini', manifest: READ_ONLY_MANIFEST }

      default: {
        const _exhaustive: never = intent
        throw new Error(`Unknown TaskIntent: ${String(_exhaustive)}`)
      }
    }
  }
}
