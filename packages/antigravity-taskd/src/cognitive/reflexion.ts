/**
 * reflexion.ts — LSP 反思状态机 & 内存 VFS + 原子落盘
 *
 * 核心能力：
 *  - InMemoryVirtualFileSystem：生成代码只写内存 Map；commit() 才触碰物理磁盘
 *  - ReflexionStateMachine：最多 MAX_STEPS=2 轮 LSP 驱动的修复闭环
 *
 * 防御红线：
 *  ① 物理隔离：vfs.write() 只操作内存，绝不碰磁盘
 *  ② SRE 级落盘：commit() 使用 openSync→writeSync→fsyncSync→closeSync→renameSync
 *  ③ 回滚安全：MAX_STEPS 耗尽 → rollback() 清空 Map + 抛出 ReflexionFailedError
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { unicodeSafeSlice } from '../prompts.js'

// ── CRLF 换行符规范化 ─────────────────────────────────────────────────────────────
//
// LSP 内部用 Offset (byte/char count) 定位请求。
// 如果磁盘文件用 CRLF，而 VFS 内容用 LF，每一个换行符偏移差 1 byte。
// 随着行数增加，偏移差累积，导致所有 Diagnostics 的行号 / 列号全部错位。
//
// 策略：
//  1. 展示磁盘区文件的探测其换行符式（1 个 \r\n = CRLF，否则 LF）
//  2. 将内容先全部强制转化为 LF（去掉出现的 \r）
//  3. 在是 CRLF 环境时再把 LF 一式掌压回 CRLF
//  结果：VFS 内容永远与磁盘文件多用同一的换行符

function sniffLineEnding(diskContent: string | undefined): '\r\n' | '\n' {
  if (!diskContent) return '\n'  // 新建文件：默认 LF
  // 只需找到一个 \r\n 即确定为 CRLF
  return diskContent.includes('\r\n') ? '\r\n' : '\n'
}

/**
 * 将 LLM 输出的内容强制转换为与磁盘文件一致的换行符样式。
 * 防止 LF (模型输出) vs CRLF (磁盘文件) 导致的 LSP Offset 雪崩。
 */
export function normalizeCRLF(content: string, diskContent: string | undefined): string {
  // Step 1: strip all \r — 得到纯 LF 内容
  const lf = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Step 2: 若磁盘应用 CRLF，将所有 \n 转回 CRLF
  return sniffLineEnding(diskContent) === '\r\n'
    ? lf.replace(/\n/g, '\r\n')
    : lf
}

// ── 错误类型 ──────────────────────────────────────────────────────────────────

export class ReflexionFailedError extends Error {
  constructor(
    public readonly steps: ReflexionStepRecord[],
    public readonly lastDiagnostics: LspDiagnostic[],
  ) {
    super(
      `Reflexion failed after ${steps.length} steps. ` +
      `Last diagnostics: ${lastDiagnostics.map(d => `[${d.file}:${d.line}] ${d.message}`).join('; ')}`,
    )
    this.name = 'ReflexionFailedError'
  }
}

/** commit() 检测到人类在 AI 处理期间修改了文件 */
export class ConcurrentModificationError extends Error {
  constructor(public readonly filePath: string, public readonly scoutMtime: number, public readonly currentMtime: number) {
    super(
      `TOCTOU conflict: file "${filePath}" was modified by another process during AI processing. ` +
      `SCOUT mtime=${new Date(scoutMtime).toISOString()}, current mtime=${new Date(currentMtime).toISOString()}. ` +
      `AI output has been discarded to prevent data loss.`,
    )
    this.name = 'ConcurrentModificationError'
  }
}

/** VFS write() 目标路径超出沙箱 */
export class PathTraversalError extends Error {
  constructor(public readonly requestedPath: string, public readonly jailRoot: string) {
    super(
      `Path traversal blocked: "${requestedPath}" escapes workspace sandbox "${jailRoot}". ` +
      `All VFS operations must target files within the workspace root.`,
    )
    this.name = 'PathTraversalError'
  }
}

// ── LSP Diagnostic 类型 ───────────────────────────────────────────────────────

export interface LspDiagnostic {
  file: string
  line: number
  column?: number
  message: string
  severity: 'error' | 'warning'
  /** 精准的代码片段上下文（3 行前后），注入到 patch prompt */
  context?: string
}

/** LSP 诊断提供者接口 — 可以是真实 tsserver/ArkTS-LSP，或测试 mock */
export interface LspDiagnosticsProvider {
  /**
   * 对 VFS 中的文件内容进行静态诊断。
   * @param files 文件路径 → 内容的映射（来自 VFS）
   */
  diagnose(files: ReadonlyMap<string, string>): Promise<LspDiagnostic[]>
}

/** No-op 实现：用于非 LSP 场景（纯文本分析）或测试 */
export class NoopLspDiagnosticsProvider implements LspDiagnosticsProvider {
  async diagnose(_files: ReadonlyMap<string, string>): Promise<LspDiagnostic[]> {
    return []
  }
}

// ── VirtualFileSystem ──────────────────────────────────────────────────────────

export interface FileDiff {
  path: string
  /** 原始内容（undefined 表示新建文件） */
  original: string | undefined
  /** VFS 中的新内容 */
  updated: string
}

export interface VirtualFileSystem {
  /** 写入内存（绝不碰物理磁盘） */
  write(filePath: string, content: string): void
  read(filePath: string): string | undefined
  /** 所有已修改文件的内存快照 */
  snapshot(): ReadonlyMap<string, string>
  /** 与磁盘状态的 diff */
  diff(): FileDiff[]
  /**
   * 原子提交：将 VFS 内容 flush 到物理磁盘。
   * 使用 openSync→writeSync→fsyncSync→closeSync→renameSync 保证断电安全。
   */
  commit(): Promise<void>
  /** 丢弃所有 VFS 修改，恢复到初始磁盘快照状态 */
  rollback(): void
}

export class InMemoryVirtualFileSystem implements VirtualFileSystem {
  /** 内存中的文件状态 */
  private readonly memory = new Map<string, string>()
  /** 初始磁盘快照（只读，仅用于 rollback 和 diff） */
  private readonly diskSnapshot = new Map<string, string | undefined>()
  /** SCOUT 时刻的文件 mtime（用于 TOCTOU 乐观锁） */
  private readonly scoutMtimes = new Map<string, number>()
  /** 已解析且验证安全的 workspaceRoot 绝对路径 */
  private readonly jailRoot: string

  constructor(private readonly workspaceRoot: string) {
    // 使用 realpathSync 解析软链接，确保 jail 判定不被 symlink 绕过
    try {
      this.jailRoot = fs.realpathSync.native(workspaceRoot)
    } catch {
      // workspaceRoot 尚不存在时，退回到 path.resolve
      this.jailRoot = path.resolve(workspaceRoot)
    }
  }

  write(filePath: string, content: string): void {
    const absPath = this.resolve(filePath)
    // 首次写入：记录磁盘原始状态（用于 diff、rollback 和 TOCTOU 检测）
    let diskContent: string | undefined
    if (!this.diskSnapshot.has(absPath)) {
      try {
        diskContent = fs.readFileSync(absPath, 'utf8')
        this.diskSnapshot.set(absPath, diskContent)
        // ── TOCTOU 乐观锁基线：记录 SCOUT 时刻的 mtime ──────────
        const stat = fs.statSync(absPath)
        this.scoutMtimes.set(absPath, stat.mtimeMs)
      } catch {
        // 文件原本不存在（新建文件）
        diskContent = undefined
        this.diskSnapshot.set(absPath, undefined)
        // 新建文件无 mtime，不需要 TOCTOU 检测
      }
    } else {
      diskContent = this.diskSnapshot.get(absPath)
    }
    // CRLF 规范化：将 LLM 输出的换行符强制对齐到磁盘文件的样式
    // 防止 LF vs CRLF 导致 LSP Offset 全错位
    const normalized = normalizeCRLF(content, diskContent)
    this.memory.set(absPath, normalized)
  }

  read(filePath: string): string | undefined {
    return this.memory.get(this.resolve(filePath))
  }

  snapshot(): ReadonlyMap<string, string> {
    return this.memory
  }

  diff(): FileDiff[] {
    return [...this.memory.entries()].map(([absPath, updated]) => ({
      path: absPath,
      original: this.diskSnapshot.get(absPath),
      updated,
    }))
  }

  /**
   * SRE 级原子落盘 + TOCTOU 乐观锁：
   * 1. 重新读取物理文件 mtime，与 SCOUT 时刻记录的 mtime 比对
   *    → 不一致说明人类在 AI 处理期间修改了文件 → 拒绝覆盖，抛出 ConcurrentModificationError
   * 2. openSync(.tmp) → writeSync → fsyncSync(fd) → closeSync → renameSync
   */
  async commit(): Promise<void> {
    // ── Phase 1: TOCTOU 乐观锁检测 ─────────────────────────────────
    for (const [absPath] of this.memory) {
      const scoutMtime = this.scoutMtimes.get(absPath)
      if (scoutMtime === undefined) continue  // 新建文件，无需检测

      try {
        const currentMtime = fs.statSync(absPath).mtimeMs
        if (currentMtime !== scoutMtime) {
          // 人类在 AI 处理期间修改了文件 → 拒绝覆盖，保护人类数据
          throw new ConcurrentModificationError(absPath, scoutMtime, currentMtime)
        }
      } catch (err) {
        if (err instanceof ConcurrentModificationError) throw err
        // 文件被删除也属于外部修改 → 保守起见，继续写入（新建）
      }
    }

    // ── Phase 2: 原子落盘 ─────────────────────────────────────────
    for (const [absPath, content] of this.memory) {
      const dir = path.dirname(absPath)
      // 确保目录存在
      fs.mkdirSync(dir, { recursive: true })

      const tmpPath = `${absPath}.vfs.tmp`
      try {
        const fd = fs.openSync(tmpPath, 'w')
        try {
          fs.writeSync(fd, content, 0, 'utf8')
          fs.fsyncSync(fd)        // ← SRE 防线：数据物理落盘
        } finally {
          fs.closeSync(fd)
        }
        fs.renameSync(tmpPath, absPath)  // ← 原子交换
      } catch (error) {
        // 清理 .tmp 防止残留
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        throw error
      }
    }
    // commit 成功后清空 VFS（本次写入已持久化）
    this.memory.clear()
    this.diskSnapshot.clear()
    this.scoutMtimes.clear()
  }

  rollback(): void {
    // 丢弃所有内存修改，不触碰磁盘 — 磁盘状态保持原样
    this.memory.clear()
    this.diskSnapshot.clear()
    this.scoutMtimes.clear()
  }

  /**
   * 路径沙箱禁锢（Path Jailing）：
   * 1. path.resolve() 规范化 `../` 穿越
   * 2. 判断 resolved path 是否以 jailRoot 开头
   * 3. realpathSync 在构造时已解析软链接，防止 symlink 逃逸
   *
   * 如果 LLM 被 Prompt Injection 诱导请求 `/etc/passwd`，
   * 此处立即抛出 PathTraversalError，绝不碰磁盘。
   */
  private resolve(filePath: string): string {
    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.jailRoot, filePath)

    // ── 沙箱校验：resolved 必须以 jailRoot + path.sep 开头（或等于 jailRoot） ──
    if (resolved !== this.jailRoot && !resolved.startsWith(this.jailRoot + path.sep)) {
      throw new PathTraversalError(filePath, this.jailRoot)
    }

    return resolved
  }
}

// ── ReflexionStateMachine ─────────────────────────────────────────────────────

export type ReflexionVerdict = 'pass' | 'retry' | 'rollback'

export interface ReflexionStepRecord {
  attempt: number
  diagnostics: LspDiagnostic[]
  verdict: ReflexionVerdict
  /** 注入给 Codex 的精准修复提示（retry 时有值） */
  patchPrompt?: string
}

/** 根据 LSP 诊断生成精准的修复 Prompt */
function buildPatchPrompt(
  diagnostics: LspDiagnostic[],
  generatedFiles: Record<string, string>,
  originalGoal: string,
): string {
  const errorSummary = diagnostics
    .filter(d => d.severity === 'error')
    .slice(0, 10)  // 最多 10 条，防止 prompt 膨胀
    .map(d => `  [${d.file}:${d.line}] ${d.message}${d.context ? `\n    Context: ${d.context}` : ''}`)
    .join('\n')

  const fileList = Object.entries(generatedFiles)
    .map(([f, content]) => `### ${f}\n\`\`\`\n${unicodeSafeSlice(content, 2000)}\n\`\`\``)
    .join('\n\n')

  return [
    `Original goal: ${originalGoal}`,
    '',
    'The following LSP errors were detected in your generated code. Fix ONLY the errors below.',
    'Do NOT change any logic unrelated to these errors. Return the complete corrected file(s).',
    '',
    'LSP Errors:',
    errorSummary,
    '',
    'Generated files (for context):',
    fileList,
  ].join('\n')
}

export class DefaultReflexionStateMachine {
  readonly MAX_STEPS = 2

  private steps: ReflexionStepRecord[] = []

  get currentAttempt(): number { return this.steps.length }
  get exhausted(): boolean { return this.steps.length >= this.MAX_STEPS }

  /**
   * 执行一轮反思：
   *  1. 将 generatedFiles 热注入到 VFS
   *  2. LSP 诊断
   *  3. 决策并记录 step
   *
   * 返回 verdict：
   *  - 'pass'     → 调用方调用 vfs.commit() 然后进入 WRITE
   *  - 'retry'    → 调用方用 patchPrompt 再次调 Codex，再次调 step()
   *  - 'rollback' → 调用方调用 vfs.rollback()，抛出 ReflexionFailedError
   */
  async step(
    vfs: VirtualFileSystem,
    generatedFiles: Record<string, string>,
    goal: string,
    lsp: LspDiagnosticsProvider,
  ): Promise<ReflexionStepRecord> {
    // Step 1：热注入到 VFS（仅内存，不碰磁盘）
    for (const [filePath, content] of Object.entries(generatedFiles)) {
      vfs.write(filePath, content)
    }

    // Step 2：LSP 诊断
    const diagnostics = await lsp.diagnose(vfs.snapshot())
    const errors = diagnostics.filter(d => d.severity === 'error')

    let verdict: ReflexionVerdict
    let patchPrompt: string | undefined

    if (errors.length === 0) {
      // 零错误 → 通过
      verdict = 'pass'
    } else if (this.steps.length >= this.MAX_STEPS - 1) {
      // 已达最大重试 → 回滚
      verdict = 'rollback'
    } else {
      // 有错误且还有重试机会 → 生成修复 Prompt
      verdict = 'retry'
      patchPrompt = buildPatchPrompt(errors, generatedFiles, goal)
    }

    const record: ReflexionStepRecord = {
      attempt: this.steps.length + 1,
      diagnostics,
      verdict,
      patchPrompt,
    }
    this.steps.push(record)

    if (verdict === 'rollback') {
      vfs.rollback()
      throw new ReflexionFailedError(this.steps, errors)
    }

    return record
  }

  /** 重置状态机（复用实例时） */
  reset(): void {
    this.steps = []
  }
}
