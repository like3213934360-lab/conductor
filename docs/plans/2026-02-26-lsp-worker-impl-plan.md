# ArkTS LSP Worker Thread 架构重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 TS language service 的重操作移到 Worker Thread 中执行，彻底解决 hover/definition 超时、code_actions 为空、diagnostics_directory 漏报等问题。

**Architecture:** 主线程只负责 LSP 协议收发和文件缓存，所有 TS 操作通过 WorkerProxy 委托给 Worker Thread。Worker 内部实现请求级 CancellationToken、超时降级、渐进式预热。

**Tech Stack:** Node.js worker_threads, vscode-languageserver, TypeScript Language Service API

---

### Task 1: CancellationToken 基础设施

**Files:**
- Create: `packages/lsp-server/src/cancellation.ts`
- Test: `packages/lsp-server/src/__tests__/cancellation.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/lsp-server/src/__tests__/cancellation.test.ts
import { describe, it, expect, vi } from 'vitest'
import { CancellationManager, TimeoutConfig } from '../cancellation'

describe('CancellationManager', () => {
  it('创建请求并返回 requestId', () => {
    const manager = new CancellationManager()
    const id = manager.create('hover')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('取消请求后 isCancelled 返回 true', () => {
    const manager = new CancellationManager()
    const id = manager.create('hover')
    expect(manager.isCancelled(id)).toBe(false)
    manager.cancel(id)
    expect(manager.isCancelled(id)).toBe(true)
  })

  it('超时后自动取消并调用回调', async () => {
    const manager = new CancellationManager()
    const onTimeout = vi.fn()
    const id = manager.create('hover', { timeoutMs: 50, onTimeout })
    await new Promise(r => setTimeout(r, 80))
    expect(manager.isCancelled(id)).toBe(true)
    expect(onTimeout).toHaveBeenCalledWith(id)
  })

  it('resolve 后清理定时器', () => {
    const manager = new CancellationManager()
    const id = manager.create('hover', { timeoutMs: 5000 })
    manager.resolve(id)
    expect(manager.isCancelled(id)).toBe(false)
    // 不应再存在于 pending 中
    expect(manager.hasPending(id)).toBe(false)
  })

  it('getTimeoutMs 返回操作类型对应的超时', () => {
    expect(TimeoutConfig.hover).toBe(5000)
    expect(TimeoutConfig.definition).toBe(5000)
    expect(TimeoutConfig.references).toBe(8000)
    expect(TimeoutConfig.diagnosticsDirectory).toBe(30000)
    expect(TimeoutConfig.completion).toBe(3000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/lsp-server/src/__tests__/cancellation.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/lsp-server/src/cancellation.ts
import { randomUUID } from 'crypto'

export const TimeoutConfig: Record<string, number> = {
  hover: 5000,
  definition: 5000,
  references: 8000,
  workspaceSymbols: 8000,
  diagnostics: 10000,
  diagnosticsDirectory: 30000,
  codeActions: 5000,
  completion: 3000,
  documentSymbols: 5000,
  prepareRename: 5000,
  rename: 8000,
  semanticTokens: 10000,
}

interface PendingRequest {
  method: string
  cancelled: boolean
  timer: ReturnType<typeof setTimeout> | null
  onTimeout?: (id: string) => void
}

export interface CreateOptions {
  timeoutMs?: number
  onTimeout?: (id: string) => void
}

export class CancellationManager {
  private pending = new Map<string, PendingRequest>()

  create(method: string, options?: CreateOptions): string {
    const id = randomUUID()
    const timeoutMs = options?.timeoutMs ?? TimeoutConfig[method] ?? 10000
    const entry: PendingRequest = {
      method,
      cancelled: false,
      timer: null,
      onTimeout: options?.onTimeout,
    }

    entry.timer = setTimeout(() => {
      entry.cancelled = true
      entry.onTimeout?.(id)
    }, timeoutMs)

    this.pending.set(id, entry)
    return id
  }

  cancel(id: string): void {
    const entry = this.pending.get(id)
    if (entry) {
      entry.cancelled = true
      if (entry.timer) clearTimeout(entry.timer)
    }
  }

  resolve(id: string): void {
    const entry = this.pending.get(id)
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer)
      this.pending.delete(id)
    }
  }

  isCancelled(id: string): boolean {
    return this.pending.get(id)?.cancelled ?? false
  }

  hasPending(id: string): boolean {
    return this.pending.has(id)
  }

  dispose(): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this.pending.clear()
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/lsp-server/src/__tests__/cancellation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/lsp-server/src/cancellation.ts packages/lsp-server/src/__tests__/cancellation.test.ts
git commit -m "feat(lsp-server): 请求级 CancellationToken 管理器"
```

---

### Task 2: Worker 消息协议类型定义

**Files:**
- Create: `packages/lsp-server/src/worker-protocol.ts`

**Step 1: Write the type definitions**

```typescript
// packages/lsp-server/src/worker-protocol.ts
import type {
  HoverResult,
  DefinitionResult,
  CompletionResult,
  ReferenceResult,
  DocumentSymbol,
  DiagnosticResult,
  WorkspaceSymbolResult,
  SemanticToken,
  RenameInfo,
  RenameLocation,
  RuleDiagnosticItem,
} from '@anthropic/arkts-language-service'

// === 主线程 → Worker ===

export interface WorkerInitMessage {
  type: 'init'
  options: {
    files: Record<string, string>
    projectRoot?: string
    sdkPath?: string | string[]
  }
}

export interface WorkerRequestMessage {
  type: 'request'
  requestId: string
  method: WorkerMethod
  params: unknown
}

export interface WorkerCancelMessage {
  type: 'cancel'
  requestId: string
}

export interface WorkerFileUpdateMessage {
  type: 'file-update'
  file: string
  content: string
}

export interface WorkerFileRemoveMessage {
  type: 'file-remove'
  file: string
}

export type WorkerIncoming =
  | WorkerInitMessage
  | WorkerRequestMessage
  | WorkerCancelMessage
  | WorkerFileUpdateMessage
  | WorkerFileRemoveMessage

// === Worker → 主线程 ===

export interface WorkerInitDoneMessage {
  type: 'init-done'
}

export interface WorkerResponseMessage {
  type: 'response'
  requestId: string
  result: unknown
}

export interface WorkerErrorMessage {
  type: 'error'
  requestId: string
  error: string
}

export interface WorkerWarmupProgressMessage {
  type: 'warmup-progress'
  phase: number
  percentage: number
  message: string
}

export interface WorkerDiagnosticsPartialMessage {
  type: 'diagnostics-partial'
  requestId: string
  partialResults: DiagnosticResult[]
}

export type WorkerOutgoing =
  | WorkerInitDoneMessage
  | WorkerResponseMessage
  | WorkerErrorMessage
  | WorkerWarmupProgressMessage
  | WorkerDiagnosticsPartialMessage

// === 方法枚举 ===

export type WorkerMethod =
  | 'hover'
  | 'definition'
  | 'completion'
  | 'references'
  | 'documentSymbols'
  | 'workspaceSymbols'
  | 'diagnostics'
  | 'diagnosticsDirectory'
  | 'codeActions'
  | 'codeFixes'
  | 'prepareRename'
  | 'rename'
  | 'semanticTokens'
  | 'healthMetrics'

// === 参数/结果类型映射 ===

export interface PositionParam {
  file: string
  position: { line: number; column: number }
}

export interface CodeActionsParam {
  file: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  errorCodes: number[]
}

export interface RenameParam extends PositionParam {
  newName: string
}

export interface DirectoryParam {
  directory: string
}

export interface QueryParam {
  query: string
}

export interface FileParam {
  file: string
}

// 降级结果常量
export const FALLBACK_RESULTS: Record<string, unknown> = {
  hover: null,
  definition: null,
  completion: { items: [], isIncomplete: false },
  references: [],
  documentSymbols: [],
  workspaceSymbols: [],
  diagnostics: [],
  diagnosticsDirectory: [],
  codeActions: [],
  codeFixes: [],
  prepareRename: { canRename: false, reason: 'Request timed out' },
  rename: [],
  semanticTokens: [],
  healthMetrics: { healthLevel: 'unknown', summary: 'Worker not ready' },
}
```

**Step 2: Commit**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/lsp-server/src/worker-protocol.ts
git commit -m "feat(lsp-server): Worker 消息协议类型定义"
```

---

### Task 3: Language Service 增加 getCodeFixes 方法

**Files:**
- Modify: `packages/language-service/src/language-service.ts`
- Test: `packages/language-service/src/__tests__/language-service.test.ts`

**Step 1: Write the failing test**

在 `language-service.test.ts` 末尾追加：

```typescript
describe('getCodeFixes', () => {
  it('返回数组', () => {
    const service = createService()
    const fixes = service.getCodeFixes(
      '/project/src/MyComponent.ets',
      { line: 0, column: 0 },
      { line: 0, column: 40 },
      [2307], // Cannot find module
    )
    expect(Array.isArray(fixes)).toBe(true)
    service.dispose()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: FAIL — getCodeFixes is not a function

**Step 3: Add interface + implementation**

在 `ArkTsLanguageService` 接口中添加：

```typescript
export interface CodeFixResult {
  description: string
  changes: Array<{
    file: string
    textChanges: Array<{
      start: Position
      end: Position
      newText: string
    }>
  }>
}

// 接口中添加
getCodeFixes(file: string, start: Position, end: Position, errorCodes: number[]): CodeFixResult[]
```

在 `createArkTsLanguageService` 返回对象中添加实现：

```typescript
getCodeFixes(file: string, start: Position, end: Position, errorCodes: number[]): CodeFixResult[] {
  const virtualPath = toVirtualPath(file)
  const mapper = host.getSourceMapper(file)
  if (!mapper) return []

  const genStart = mapper.toGenerated(start.line, start.column)
  const genEnd = mapper.toGenerated(end.line, end.column)
  if (!genStart || !genEnd) return []

  const snapshot = host.getScriptSnapshot(virtualPath)
  if (!snapshot) return []
  const text = snapshot.getText(0, snapshot.getLength())

  const startOffset = positionToOffset(text, genStart.line, genStart.column)
  const endOffset = positionToOffset(text, genEnd.line, genEnd.column)

  try {
    const fixes = tsService.getCodeFixesAtPosition(
      virtualPath, startOffset, endOffset,
      errorCodes, {}, {},
    )

    return fixes.map(fix => ({
      description: fix.description,
      changes: fix.changes.map(change => {
        let changeFile = change.fileName.endsWith('.ets.ts')
          ? change.fileName.slice(0, -3)
          : change.fileName
        const changeMapper = host.getSourceMapper(changeFile)

        return {
          file: changeFile,
          textChanges: change.textChanges.map(tc => {
            const tcStart = offsetToPosition(text, tc.span.start)
            const tcEnd = offsetToPosition(text, tc.span.start + tc.span.length)
            let origStart = tcStart
            let origEnd = tcEnd
            if (changeMapper) {
              const ms = changeMapper.toOriginal(tcStart.line, tcStart.column)
              const me = changeMapper.toOriginal(tcEnd.line, tcEnd.column)
              if (ms) origStart = ms
              if (me) origEnd = me
            }
            return { start: origStart, end: origEnd, newText: tc.newText }
          }),
        }
      }),
    }))
  } catch {
    return []
  }
},
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "feat(language-service): 增加 getCodeFixes 方法，透传 TS 原生 code fixes"
```

---

### Task 4: diagnostics_directory 路径规范化修复

**Files:**
- Modify: `packages/language-service/src/language-service.ts` (getDirectoryDiagnostics 方法)
- Modify: `packages/language-service/src/service-host.ts` (getTrackedFiles 路径规范化)

**Step 1: Write the failing test**

在 `language-service.test.ts` 追加：

```typescript
describe('getDirectoryDiagnostics', () => {
  it('对内存中的文件返回诊断结果', () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/A.ets': '@Component\nstruct A {\n  build() {}\n}',
        '/project/src/B.ets': '@Component\nstruct B {\n  build() {}\n}',
      },
    })
    // 即使目录不存在于磁盘，内存中的文件也应该被扫描
    const diags = service.getDirectoryDiagnostics('/project/src')
    expect(Array.isArray(diags)).toBe(true)
    service.dispose()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: FAIL 或返回空数组（路径不匹配）

**Step 3: Fix path normalization**

在 `service-host.ts` 的 `getTrackedFiles()` 中：

```typescript
getTrackedFiles(): string[] {
  return Array.from(this.files.keys()).map(p => path.resolve(p))
}
```

在 `language-service.ts` 的 `getDirectoryDiagnostics` 中，修复路径比较逻辑：

```typescript
getDirectoryDiagnostics(directory: string): DiagnosticResult[] {
  const results: DiagnosticResult[] = []
  const resolvedDir = path.resolve(directory)

  // 1. 先扫描内存中已跟踪的文件
  const trackedFiles = host.getTrackedFiles()
  const processedSet = new Set<string>()

  for (const tracked of trackedFiles) {
    if (tracked.startsWith(resolvedDir + path.sep) || tracked.startsWith(resolvedDir + '/')) {
      processedSet.add(tracked)
      try {
        const diags = this.getDiagnostics(tracked)
        results.push(...diags)
      } catch { /* skip */ }
    }
  }

  // 2. 再扫描磁盘上的文件（跳过已处理的）
  function collectEtsFiles(dir: string): string[] {
    const files: string[] = []
    try {
      const entries = fs.readdirSync(dir)
      for (const entry of entries) {
        const fullPath = path.join(dir, entry)
        try {
          const stat = fs.statSync(fullPath)
          if (stat.isDirectory() && entry !== 'node_modules' && entry !== '.preview') {
            files.push(...collectEtsFiles(fullPath))
          } else if (stat.isFile() && entry.endsWith('.ets')) {
            files.push(path.resolve(fullPath))
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return files
  }

  const diskFiles = collectEtsFiles(resolvedDir)
  for (const diskFile of diskFiles) {
    if (processedSet.has(diskFile)) continue
    try {
      const content = fs.readFileSync(diskFile, 'utf-8')
      host.updateFile(diskFile, content)
      processedSet.add(diskFile)
      const diags = this.getDiagnostics(diskFile)
      results.push(...diags)
    } catch { /* skip */ }
  }

  return results
},
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/service-host.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "fix(language-service): diagnostics_directory 路径规范化，修复扫描 0 文件问题"
```
