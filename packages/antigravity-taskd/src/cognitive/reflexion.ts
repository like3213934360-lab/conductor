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

  constructor(private readonly workspaceRoot: string) {}

  write(filePath: string, content: string): void {
    const absPath = this.resolve(filePath)
    // 首次写入：记录磁盘原始状态（用于 diff 和 rollback）
    if (!this.diskSnapshot.has(absPath)) {
      try {
        this.diskSnapshot.set(absPath, fs.readFileSync(absPath, 'utf8'))
      } catch {
        // 文件原本不存在（新建文件）
        this.diskSnapshot.set(absPath, undefined)
      }
    }
    this.memory.set(absPath, content)
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
   * SRE 级原子落盘：
   * openSync(.tmp) → writeSync → fsyncSync(fd) → closeSync → renameSync
   *
   * 这与 journal.ts / persistence.ts 已审计过的 writeJsonAtomic 逻辑一致。
   * fsyncSync 保证数据物理落盘，renameSync 的元数据原子性由文件系统保证。
   */
  async commit(): Promise<void> {
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
  }

  rollback(): void {
    // 丢弃所有内存修改，不触碰磁盘 — 磁盘状态保持原样
    this.memory.clear()
    this.diskSnapshot.clear()
  }

  private resolve(filePath: string): string {
    return path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath)
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
    .map(([f, content]) => `### ${f}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``)
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
