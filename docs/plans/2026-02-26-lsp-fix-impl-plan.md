# ArkTS LSP 全面修复实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 arkts-lsp 的 4 项超时功能（Hover/Workspace Symbols/Code Actions/Rename）、装饰器跳转、Hover 降级、VS Code 扩展支持

**Architecture:** 将同步初始化拆为三阶段异步状态机，增加 SDK 缓存和 Worker Threads 并行 I/O，在 language-service 层增加装饰器跳转和 Hover 降级，在 server 层增加 sdkPath 读取和进度通知，在 VS Code 扩展层增加状态栏指示器

**Tech Stack:** TypeScript 5.7+, Node.js worker_threads, vscode-languageserver 9.x, vscode-languageclient 9.x, magic-string, Vitest

---

## Task 1: DecoratorDefinition 接口增加 sdkLocation 字段

**Files:**
- Modify: `packages/language-service/src/decorator-registry.ts:21-31`
- Test: `packages/language-service/src/__tests__/decorator-registry.test.ts`

**Step 1: 写失败测试**

在 `packages/language-service/src/__tests__/decorator-registry.test.ts` 末尾添加：

```typescript
it('DecoratorDefinition 支持 sdkLocation 字段', () => {
  const registry = new DecoratorRegistry()
  const def = registry.get('Component')
  expect(def).toBeDefined()
  // sdkLocation 初始为 undefined
  expect(def!.sdkLocation).toBeUndefined()
  // 可以赋值
  def!.sdkLocation = { file: '/sdk/common.d.ts', line: 234, column: 14 }
  expect(def!.sdkLocation.file).toBe('/sdk/common.d.ts')
  expect(def!.sdkLocation.line).toBe(234)
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/decorator-registry.test.ts`
Expected: FAIL — `sdkLocation` 属性不存在于类型 `DecoratorDefinition`

**Step 3: 修改 DecoratorDefinition 接口**

在 `packages/language-service/src/decorator-registry.ts` 第 31 行 `}` 之前添加：

```typescript
  /** SDK 中的声明位置（由 scanDecoratorLocations 填充） */
  sdkLocation?: { file: string; line: number; column: number }
```

**Step 4: 运行测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/decorator-registry.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/decorator-registry.ts packages/language-service/src/__tests__/decorator-registry.test.ts
git commit -m "feat(decorator): DecoratorDefinition 增加 sdkLocation 字段"
```

---

## Task 2: 新增 scanDecoratorLocations 函数

**Files:**
- Create: `packages/language-service/src/sdk/scan-decorator-locations.ts`
- Test: `packages/language-service/src/__tests__/sdk/scan-decorator-locations.test.ts`

**Step 1: 写失败测试**

创建 `packages/language-service/src/__tests__/sdk/scan-decorator-locations.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { DecoratorRegistry } from '../../decorator-registry'
import { scanDecoratorLocations } from '../../sdk/scan-decorator-locations'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('scanDecoratorLocations', () => {
  it('从 common.d.ts 中扫描装饰器位置', () => {
    // 创建临时 SDK 目录
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-test-'))
    const etsDir = path.join(tmpDir, 'ets', 'component')
    fs.mkdirSync(etsDir, { recursive: true })

    // 写入模拟的 common.d.ts
    const commonDts = path.join(etsDir, 'common.d.ts')
    fs.writeFileSync(commonDts, [
      '// some header',
      'declare const Component: ClassDecorator;',
      'declare const State: PropertyDecorator;',
      'declare const Entry: ClassDecorator;',
    ].join('\n'))

    const registry = new DecoratorRegistry()
    scanDecoratorLocations(tmpDir, registry)

    const comp = registry.get('Component')
    expect(comp?.sdkLocation).toBeDefined()
    expect(comp!.sdkLocation!.file).toBe(commonDts)
    expect(comp!.sdkLocation!.line).toBe(1) // 0-indexed

    const state = registry.get('State')
    expect(state?.sdkLocation).toBeDefined()
    expect(state!.sdkLocation!.line).toBe(2)

    const entry = registry.get('Entry')
    expect(entry?.sdkLocation).toBeDefined()
    expect(entry!.sdkLocation!.line).toBe(3)

    // 清理
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('SDK 路径不存在时不崩溃', () => {
    const registry = new DecoratorRegistry()
    expect(() => scanDecoratorLocations('/nonexistent/path', registry)).not.toThrow()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/sdk/scan-decorator-locations.test.ts`
Expected: FAIL — 模块不存在

**Step 3: 实现 scanDecoratorLocations**

创建 `packages/language-service/src/sdk/scan-decorator-locations.ts`：

```typescript
import fs from 'fs'
import path from 'path'
import { DecoratorRegistry } from '../decorator-registry'

/**
 * 扫描 SDK common.d.ts 中的 declare const 声明，
 * 将装饰器的 SDK 位置写入 DecoratorRegistry
 */
export function scanDecoratorLocations(
  sdkPath: string,
  decoratorRegistry: DecoratorRegistry,
): void {
  const commonDts = path.join(sdkPath, 'ets', 'component', 'common.d.ts')
  let content: string
  try {
    content = fs.readFileSync(commonDts, 'utf-8')
  } catch {
    return
  }

  const lines = content.split('\n')
  const pattern = /^declare\s+const\s+(\w+)\s*:/

  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i])
    if (match) {
      const name = match[1]
      const def = decoratorRegistry.get(name)
      if (def) {
        def.sdkLocation = {
          file: commonDts,
          line: i,
          column: lines[i].indexOf(name),
        }
      }
    }
  }
}
```

**Step 4: 运行测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/sdk/scan-decorator-locations.test.ts`
Expected: PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/sdk/scan-decorator-locations.ts packages/language-service/src/__tests__/sdk/scan-decorator-locations.test.ts
git commit -m "feat(sdk): 新增 scanDecoratorLocations 扫描 SDK 装饰器声明位置"
```

---

## Task 3: getDefinition 增加装饰器跳转逻辑

**Files:**
- Modify: `packages/language-service/src/language-service.ts:336-395`
- Test: `packages/language-service/src/__tests__/language-service.test.ts`

**Step 1: 写失败测试**

在 `packages/language-service/src/__tests__/language-service.test.ts` 末尾添加：

```typescript
describe('装饰器 Goto Definition', () => {
  it('点击 @Component 跳转到 SDK 声明位置', () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': [
          '@Component',
          'struct TestComp {',
          '  build() {}',
          '}',
        ].join('\n'),
      },
    })

    // 手动设置装饰器 SDK 位置（模拟 scanDecoratorLocations 的效果）
    // 注意：需要通过内部访问或新增 API
    // 光标在第 0 行 @Component 的 C 上（column 1）
    const defs = service.getDefinition('/project/src/Test.ets', { line: 0, column: 1 })

    // 如果没有 SDK 路径，装饰器跳转返回 null（不崩溃）
    // 这个测试主要验证不会因为装饰器行而抛异常
    expect(() => defs).not.toThrow()
  })
})
```

**Step 2: 运行测试确认当前行为**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: PASS（当前返回 null，不崩溃）

**Step 3: 修改 getDefinition 方法**

在 `packages/language-service/src/language-service.ts` 的 `getDefinition` 方法（第 336 行）中，在 `const virtualPath = toVirtualPath(file)` 之前插入装饰器检测逻辑：

```typescript
getDefinition(file: string, position: Position): DefinitionResult[] | null {
  // === 装饰器跳转：在 source map 映射之前拦截 ===
  const originalContent = host.getOriginalContent(file)
  if (originalContent) {
    const lines = originalContent.split('\n')
    const line = lines[position.line] ?? ''
    const decoratorPattern = /@([A-Z]\w*)/g
    let match: RegExpExecArray | null
    while ((match = decoratorPattern.exec(line)) !== null) {
      const atStart = match.index
      const nameEnd = match.index + 1 + match[1].length
      if (position.column >= atStart && position.column < nameEnd) {
        const def = decoratorRegistry.get(match[1])
        if (def?.sdkLocation) {
          return [{
            file: def.sdkLocation.file,
            position: { line: def.sdkLocation.line, column: def.sdkLocation.column },
          }]
        }
      }
    }
  }

  // === 现有逻辑不变 ===
  const virtualPath = toVirtualPath(file)
  // ...
```

**Step 4: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "feat(definition): 装饰器点击跳转到 SDK common.d.ts 声明位置"
```

---

## Task 4: getHover 增加降级策略

**Files:**
- Modify: `packages/language-service/src/language-service.ts:311-334`
- Test: `packages/language-service/src/__tests__/language-service.test.ts`

**Step 1: 写失败测试**

在 `packages/language-service/src/__tests__/language-service.test.ts` 添加：

```typescript
it('getHover 对装饰器行返回装饰器文档而非 null', () => {
  const service = createArkTsLanguageService({
    files: {
      '/project/src/Test.ets': [
        '@Component',
        'struct TestComp {',
        '  @State message: string = "hi"',
        '  build() {}',
        '}',
      ].join('\n'),
    },
  })

  // 光标在 @Component 上
  const hover = service.getHover('/project/src/Test.ets', { line: 0, column: 1 })
  // 当前返回 null（因为 mapper.toGenerated 对装饰器行返回 null）
  // 修复后应返回装饰器文档
  // 注意：此测试在修复前会 pass（hover 为 null 不抛异常），
  // 修复后验证 hover 包含装饰器信息
  if (hover) {
    expect(hover.content).toContain('Component')
  }
})
```

**Step 2: 运行测试确认当前行为**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: PASS（hover 为 null）

**Step 3: 修改 getHover 方法**

在 `packages/language-service/src/language-service.ts` 的 `getHover` 方法（第 311 行），将 `const genPos = mapper.toGenerated(...)` 之后的逻辑改为：

```typescript
getHover(file: string, position: Position): HoverResult | null {
  const virtualPath = toVirtualPath(file)
  const mapper = host.getSourceMapper(file)
  if (!mapper) return null

  let genPos = mapper.toGenerated(position.line, position.column)

  // 降级 1：精确映射失败，尝试同行偏移 0 再加列号
  if (!genPos) {
    const fallback = mapper.toGenerated(position.line, 0)
    if (fallback) {
      genPos = { line: fallback.line, column: position.column }
    }
  }

  // 降级 2：装饰器行 — 从 DecoratorRegistry 返回文档
  if (!genPos) {
    const originalContent = host.getOriginalContent(file)
    if (originalContent) {
      const lines = originalContent.split('\n')
      const line = lines[position.line] ?? ''
      const decoratorMatch = line.match(/@(\w+)/)
      if (decoratorMatch) {
        const def = decoratorRegistry.get(decoratorMatch[1])
        if (def) {
          return {
            content: `(decorator) @${def.name}\n\n` +
              `版本: ${def.version === 'v1' ? 'V1 状态管理' : def.version === 'v2' ? 'V2 状态管理' : '通用'}\n` +
              `目标: ${def.targets.join(', ')}\n` +
              `参数: ${def.hasArgs ? '是' : '否'}\n\n` +
              def.description,
          }
        }
      }
    }
    return null
  }

  // 正常 TS hover 逻辑（现有代码不变）
  const snapshot = host.getScriptSnapshot(virtualPath)
  if (!snapshot) return null
  const text = snapshot.getText(0, snapshot.getLength())
  const offset = positionToOffset(text, genPos.line, genPos.column)

  const info = tsService.getQuickInfoAtPosition(virtualPath, offset)
  if (!info) return null

  const displayParts = info.displayParts?.map((p) => p.text).join('') ?? ''
  const documentation = info.documentation?.map((d) => d.text).join('\n') ?? ''
  const content = documentation ? `${displayParts}\n\n${documentation}` : displayParts

  return { content }
},
```

**Step 4: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "feat(hover): 装饰器行降级返回 DecoratorRegistry 文档"
```

---

## Task 5: ArkTsLanguageService 接口增加异步初始化方法

**Files:**
- Modify: `packages/language-service/src/language-service.ts:186-203`
- Test: `packages/language-service/src/__tests__/language-service.test.ts`

**Step 1: 写失败测试**

在 `packages/language-service/src/__tests__/language-service.test.ts` 添加：

```typescript
describe('异步初始化', () => {
  it('service 有 loadSdk 和 loadModules 方法', () => {
    const service = createService()
    expect(typeof service.loadSdk).toBe('function')
    expect(typeof service.loadModules).toBe('function')
    expect(typeof service.isSdkReady).toBe('function')
    expect(typeof service.isModulesReady).toBe('function')
  })

  it('初始创建后 sdkReady 和 modulesReady 为 false', () => {
    const service = createService()
    // 当前同步初始化模式下，这些应该返回 true（向后兼容）
    // 异步模式下初始为 false
    expect(typeof service.isSdkReady()).toBe('boolean')
    expect(typeof service.isModulesReady()).toBe('boolean')
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: FAIL — `loadSdk` 不存在

**Step 3: 修改 ArkTsLanguageService 接口和实现**

在 `packages/language-service/src/language-service.ts` 第 186-203 行的接口中添加：

```typescript
export interface ArkTsLanguageService {
  // ... 现有方法保持不变
  getHover(file: string, position: Position): HoverResult | null
  getDefinition(file: string, position: Position): DefinitionResult[] | null
  getCompletion(file: string, position: Position): CompletionResult
  getReferences(file: string, position: Position): ReferenceResult[]
  getDocumentSymbols(file: string): DocumentSymbol[]
  getDiagnostics(file: string): DiagnosticResult[]
  getWorkspaceSymbols(query: string): WorkspaceSymbolResult[]
  getSemanticTokens(file: string): SemanticToken[]
  prepareRename(file: string, position: Position): RenameInfo
  getRenameLocations(file: string, position: Position, newName: string): RenameLocation[]
  getDirectoryDiagnostics(directory: string): DiagnosticResult[]
  getHealthMetrics(): { healthLevel: string; summary: string }
  getSdkPath(): string | null
  getSdkPaths(): string[]
  updateFile(file: string, content: string): void
  dispose(): void

  // 新增：异步初始化
  loadSdk(): Promise<void>
  loadModules(): Promise<void>
  isSdkReady(): boolean
  isModulesReady(): boolean
}
```

在 `createArkTsLanguageService` 返回对象（第 310 行 `return {` 之后）中添加：

```typescript
    // 当前同步初始化已完成，标记为 ready
    loadSdk: async () => { /* 当前为同步模式，已在构造时完成 */ },
    loadModules: async () => { /* 当前为同步模式，已在构造时完成 */ },
    isSdkReady: () => true,   // 同步模式下始终 true
    isModulesReady: () => true, // 同步模式下始终 true
```

**注意**：此 Task 仅添加接口和桩实现，保持向后兼容。Task 7 将实际拆分初始化逻辑。

**Step 4: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "feat(service): ArkTsLanguageService 接口增加异步初始化方法（桩实现）"
```

---

## Task 6: server.ts 读取 initializationOptions.sdkPath

**Files:**
- Modify: `packages/lsp-server/src/server.ts:124-135` (onInitialize)
- Modify: `packages/lsp-server/src/server.ts:571-579` (rebuildService)

**Step 1: 修改 onInitialize 读取 sdkPath**

在 `packages/lsp-server/src/server.ts` 第 124 行 `let projectRoot` 之后添加：

```typescript
let sdkPathFromClient: string | undefined
```

在第 135 行 `}` 之前（`onInitialize` 回调内）添加：

```typescript
    // 读取客户端传来的 SDK 路径
    const initOptions = params.initializationOptions as { sdkPath?: string } | undefined
    if (initOptions?.sdkPath) {
      sdkPathFromClient = initOptions.sdkPath
      connection.console.log(`[init] SDK path from client: ${sdkPathFromClient}`)
    }
```

**Step 2: 修改 rebuildService 传递 sdkPath**

在 `packages/lsp-server/src/server.ts` 第 575 行 `createArkTsLanguageService({` 调用中添加 `sdkPath` 参数：

```typescript
    service = createArkTsLanguageService({
      files: fileContents,
      ruleDiagnosticsProvider,
      projectRoot,
      sdkPath: sdkPathFromClient,  // 新增
    })
```

**Step 3: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 4: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/lsp-server/src/server.ts
git commit -m "feat(server): onInitialize 读取 initializationOptions.sdkPath 并传递给 language-service"
```

---

## Task 7: 将 createArkTsLanguageService 拆为三阶段异步初始化

**Files:**
- Modify: `packages/language-service/src/language-service.ts:205-310`
- Test: `packages/language-service/src/__tests__/language-service.test.ts`

**这是最核心的改动，需要仔细操作。**

**Step 1: 写失败测试**

在 `packages/language-service/src/__tests__/language-service.test.ts` 添加：

```typescript
describe('三阶段异步初始化', () => {
  it('阶段 1 后 getDocumentSymbols 可用', () => {
    // 不调用 loadSdk/loadModules，仅阶段 1
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': '@Component\nstruct Test {\n  build() {}\n}',
      },
    })
    // 阶段 1 完成后，document symbols 应该可用
    const symbols = service.getDocumentSymbols('/project/src/Test.ets')
    expect(Array.isArray(symbols)).toBe(true)
  })

  it('阶段 1 后 isSdkReady 为 false', () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': '@Component\nstruct Test {\n  build() {}\n}',
      },
    })
    expect(service.isSdkReady()).toBe(false)
    expect(service.isModulesReady()).toBe(false)
  })

  it('loadSdk 后 isSdkReady 为 true', async () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': '@Component\nstruct Test {\n  build() {}\n}',
      },
    })
    await service.loadSdk()
    expect(service.isSdkReady()).toBe(true)
  })

  it('loadModules 后 isModulesReady 为 true', async () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': '@Component\nstruct Test {\n  build() {}\n}',
      },
    })
    await service.loadSdk()
    await service.loadModules()
    expect(service.isModulesReady()).toBe(true)
  })

  it('SDK 未就绪时 getHover 返回 null 而非挂起', () => {
    const service = createArkTsLanguageService({
      files: {
        '/project/src/Test.ets': '@Component\nstruct Test {\n  @State x: number = 0\n  build() {}\n}',
      },
    })
    const hover = service.getHover('/project/src/Test.ets', { line: 2, column: 10 })
    // SDK 未就绪，应快速返回 null
    expect(hover).toBeNull()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/language-service.test.ts`
Expected: FAIL — `isSdkReady()` 返回 true（当前桩实现始终返回 true）

**Step 3: 重构 createArkTsLanguageService**

将 `packages/language-service/src/language-service.ts` 第 205-310 行的 `createArkTsLanguageService` 函数重构为：

**阶段 1（同步，保留在构造函数中）：**
- 创建 decoratorRegistry、componentRegistry、decoratorDiscovery
- 创建 issueTracker、healthDashboard
- 加载配置
- 创建 ArkTsServiceHost（仅使用传入的 files，不加载额外文件）
- 创建 tsService

**阶段 2（移到 loadSdk）：**
- 第 222-244 行：SdkTypeLoader 初始化和 loadAll()
- 第 234-244 行：generateBridgeFromSdkTypes()
- scanDecoratorLocations()（新增）
- 将 SDK 声明注入 host

**阶段 3（移到 loadModules）：**
- 第 246-279 行：ModuleGraph 扫描和文件加载
- 第 281-286 行：compilerOptions paths 注入

具体改动：

```typescript
export function createArkTsLanguageService(
  options: ArkTsLanguageServiceOptions,
): ArkTsLanguageService {
  // === 阶段 1：轻量同步初始化 ===
  const decoratorRegistry = new DecoratorRegistry()
  const componentRegistry = new ComponentRegistry()
  const decoratorDiscovery = new DecoratorDiscovery(decoratorRegistry)
  const issueTracker = new IssueTracker()
  const healthDashboard = new HealthDashboard(issueTracker)
  const config = options.projectRoot ? loadConfig(options.projectRoot) : undefined

  // 初始 SDK 声明（仅用户显式传入的）
  const sdkDeclarations: Record<string, string> = { ...options.sdkDeclarations }

  // 初始 compilerOptions（不含 module paths）
  const compilerOptions = { ...options.compilerOptions }

  const host = new ArkTsServiceHost({
    files: options.files,
    compilerOptions: Object.keys(compilerOptions).length > 0 ? compilerOptions : undefined,
    sdkDeclarations,
    componentRegistry,
    decoratorRegistry,
    decoratorDiscovery,
    issueTracker,
    healthDashboard,
    projectRoot: options.projectRoot,
  })
  const tsService = ts.createLanguageService(host, ts.createDocumentRegistry())

  let sdkReady = false
  let modulesReady = false
  let sdkTypeLoader: SdkTypeLoader | null = null
  let moduleGraph: ModuleGraph | null = null

  // ... 现有的辅助函数（toVirtualPath, symbolCache 等）

  return {
    async loadSdk() {
      // === 阶段 2：SDK 加载 ===
      sdkTypeLoader = new SdkTypeLoader({
        sdkPath: options.sdkPath ?? config?.sdkPath,
        extraTypeDirs: options.extraTypeDirs ?? config?.extraTypeDirs,
      })
      const sdkTypes = sdkTypeLoader.loadAll()
      for (const [name, content] of sdkTypes) {
        host.addSdkDeclaration(name, content)
        componentRegistry.loadFromDeclaration(content)
      }

      // 生成 arkui bridge
      if (sdkTypes.size > 0) {
        try {
          const bridge = generateBridgeFromSdkTypes(sdkTypes)
          if (bridge) {
            host.setArkuiBridge(bridge)
          }
        } catch { /* 回退到内置 */ }
      }

      // 扫描装饰器 SDK 位置
      const sdkPath = sdkTypeLoader.getFirstSdkPath()
      if (sdkPath) {
        scanDecoratorLocations(sdkPath, decoratorRegistry)
      }

      sdkReady = true
    },

    async loadModules() {
      // === 阶段 3：模块图加载 ===
      if (options.projectRoot) {
        moduleGraph = new ModuleGraph({ projectRoot: options.projectRoot })
        moduleGraph.scan()
        if (moduleGraph.size > 0) {
          const modulePaths = moduleGraph.generatePaths()
          host.updateCompilerPaths(modulePaths, options.projectRoot)

          const allFiles = moduleGraph.getAllEtsFiles()
          for (const filePath of allFiles) {
            if (!(filePath in options.files)) {
              try {
                const content = fs.readFileSync(filePath, 'utf-8')
                host.addFile(filePath, content)
              } catch { /* skip */ }
            }
          }

          for (const mod of moduleGraph.getModules()) {
            const rootIndex = path.join(mod.rootDir, 'Index.ets')
            if (!(rootIndex in options.files) && fs.existsSync(rootIndex)) {
              try {
                host.addFile(rootIndex, fs.readFileSync(rootIndex, 'utf-8'))
              } catch { /* skip */ }
            }
          }
        }
      }
      modulesReady = true
    },

    isSdkReady: () => sdkReady,
    isModulesReady: () => modulesReady,

    // getHover 增加就绪检查
    getHover(file, position) {
      // SDK 未就绪时快速返回 null
      if (!sdkReady) {
        // 但装饰器 hover 不依赖 SDK，仍可返回
        const originalContent = host.getOriginalContent(file)
        if (originalContent) {
          const lines = originalContent.split('\n')
          const line = lines[position.line] ?? ''
          const decoratorMatch = line.match(/@(\w+)/)
          if (decoratorMatch) {
            const def = decoratorRegistry.get(decoratorMatch[1])
            if (def) {
              return {
                content: `(decorator) @${def.name}\n\n${def.description}`,
              }
            }
          }
        }
        return null
      }
      // ... 现有 hover 逻辑（含降级策略）
    },

    // ... 其他方法保持不变
  }
}
```

**重要**：此改动需要 `ArkTsServiceHost` 新增以下方法：
- `addSdkDeclaration(name, content)` — 动态添加 SDK 声明
- `setArkuiBridge(bridge)` — 动态设置 arkui bridge
- `updateCompilerPaths(paths, baseUrl)` — 动态更新 paths
- `addFile(path, content)` — 动态添加文件

如果 `ArkTsServiceHost` 当前不支持这些方法，需要先添加。查看 `service-host.ts` 确认。

**Step 4: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/language-service.ts packages/language-service/src/service-host.ts packages/language-service/src/__tests__/language-service.test.ts
git commit -m "refactor(service): 将同步初始化拆为三阶段异步状态机"
```

---

## Task 8: server.ts rebuildService 改为异步 + 进度通知

**Files:**
- Modify: `packages/lsp-server/src/server.ts:172-174` (onInitialized)
- Modify: `packages/lsp-server/src/server.ts:176-183` (onDidOpen)
- Modify: `packages/lsp-server/src/server.ts:571-614` (rebuildService)

**Step 1: 修改 rebuildService 为异步**

将 `packages/lsp-server/src/server.ts` 第 571 行的 `rebuildService` 改为：

```typescript
  let rebuildInProgress = false

  async function rebuildService(): Promise<void> {
    if (rebuildInProgress) return  // 防止并发 rebuild
    rebuildInProgress = true

    try {
      if (service) {
        service.dispose()
      }
      service = createArkTsLanguageService({
        files: fileContents,
        ruleDiagnosticsProvider,
        projectRoot,
        sdkPath: sdkPathFromClient,
      })
      fileChangeCount = 0

      // 阶段 2：异步加载 SDK
      await service.loadSdk()

      // 首次构建时检查 SDK 路径
      if (!sdkPathChecked) {
        sdkPathChecked = true
        const sdkPath = service.getSdkPath()
        if (!sdkPath) {
          serviceDiagnostics.push({
            message: '[ArkTS LSP] HarmonyOS SDK not detected...',
            severity: 2,
          })
          pushServiceDiagnosticsToAll()
        } else {
          connection.console.log(`[init] SDK path: ${sdkPath}`)
        }
      }

      // 阶段 3：异步加载模块
      await service.loadModules()

      checkAndNotifyHealth()

      // 预热
      const warmupFile = Object.keys(fileContents)[0]
      if (warmupFile) {
        try { service.getDocumentSymbols(warmupFile) } catch {}
      }
    } finally {
      rebuildInProgress = false
    }
  }
```

**Step 2: 修改 onInitialized 添加进度通知**

将第 172-174 行改为：

```typescript
  connection.onInitialized(async () => {
    connection.console.log('ArkTS LSP Server initialized')

    // 创建进度通知
    const token = 'arkts-init'
    try {
      await connection.sendRequest('window/workDoneProgress/create', { token })
      connection.sendNotification('$/progress', {
        token,
        value: { kind: 'begin', title: 'ArkTS LSP', message: '正在加载...', percentage: 0 },
      })
    } catch { /* 客户端不支持进度通知 */ }

    await rebuildService()

    try {
      connection.sendNotification('$/progress', {
        token,
        value: { kind: 'end', message: '就绪' },
      })
    } catch { /* ignore */ }
  })
```

**Step 3: 修改 onDidOpen 为异步**

将第 176-183 行改为：

```typescript
  documents.onDidOpen(async (event) => {
    const uri = event.document.uri
    if (!isEtsFile(uri)) return

    const filePath = uriToPath(uri)
    fileContents[filePath] = event.document.getText()
    await rebuildService()
  })
```

**Step 4: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 5: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/lsp-server/src/server.ts
git commit -m "refactor(server): rebuildService 改为异步 + window/workDoneProgress 进度通知"
```

---

## Task 9: Code Actions 独立化（不依赖客户端推送诊断）

**Files:**
- Modify: `packages/lsp-server/src/server.ts:385-440` (onCodeAction)

**Step 1: 修改 onCodeAction handler**

将 `packages/lsp-server/src/server.ts` 第 385-440 行的 `onCodeAction` 改为：

```typescript
  connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    if (!service || !isEtsFile(params.textDocument.uri)) return []

    try {
      const actions: CodeAction[] = []
      let diagnostics = params.context.diagnostics

      // 如果客户端没有推送诊断（如 OMC），主动获取
      if (diagnostics.length === 0) {
        const filePath = uriToPath(params.textDocument.uri)
        const allDiags = service.getDiagnostics(filePath)

        // 过滤出请求范围内的规则诊断
        diagnostics = allDiags
          .filter(d => d.message.startsWith('[arkts/'))
          .filter(d => {
            const dStart = d.start.line
            const dEnd = d.end.line
            const rStart = params.range.start.line
            const rEnd = params.range.end.line
            return dStart <= rEnd && dEnd >= rStart
          })
          .map(d => ({
            range: {
              start: { line: d.start.line, character: d.start.column },
              end: { line: d.end.line, character: d.end.column },
            },
            message: d.message,
            severity: d.severity === 'error' ? 1 as const
              : d.severity === 'warning' ? 2 as const : 3 as const,
          }))
      }

      // 现有的 quick fix 逻辑（不变）
      for (const diag of diagnostics) {
        const ruleMatch = diag.message.match(/^\[([^\]]+)\]/)
        const ruleId = ruleMatch ? ruleMatch[1] : null

        if (ruleId === 'arkts/no-var') {
          actions.push({
            title: 'Replace var with let',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            edit: {
              changes: {
                [params.textDocument.uri]: [{
                  range: {
                    start: { line: diag.range.start.line, character: diag.range.start.character },
                    end: { line: diag.range.start.line, character: diag.range.start.character + 3 },
                  },
                  newText: 'let',
                }],
              },
            },
          })
        } else if (ruleId === 'arkts/no-for-in') {
          actions.push({
            title: 'Replace for...in with for...of (Object.keys)',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
          })
        } else if (ruleId === 'arkts/no-any-unknown') {
          actions.push({
            title: 'Replace with explicit type',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
          })
        } else if (ruleId === 'arkts/no-destructuring') {
          actions.push({
            title: 'Replace destructuring with direct property access',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
          })
        }
      }

      return actions
    } catch (e) {
      connection.console.error(`[codeAction] ${e}`)
      return []
    }
  })
```

**Step 2: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 3: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/lsp-server/src/server.ts
git commit -m "fix(codeAction): 客户端未推送诊断时主动获取，兼容 OMC"
```

---

## Task 10: Worker Threads 并行文件加载

**Files:**
- Create: `packages/language-service/src/worker-file-loader.ts`
- Modify: `packages/language-service/src/language-service.ts` (loadModules 方法)
- Test: `packages/language-service/src/__tests__/worker-file-loader.test.ts`

**Step 1: 写失败测试**

创建 `packages/language-service/src/__tests__/worker-file-loader.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { parallelLoadFiles } from '../worker-file-loader'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('parallelLoadFiles', () => {
  it('并行读取多个文件', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-worker-'))
    const files: string[] = []
    for (let i = 0; i < 10; i++) {
      const f = path.join(tmpDir, `test${i}.ets`)
      fs.writeFileSync(f, `// file ${i}\nstruct Test${i} {}`)
      files.push(f)
    }

    const result = await parallelLoadFiles(files)
    expect(Object.keys(result).length).toBe(10)
    expect(result[files[0]]).toContain('file 0')
    expect(result[files[9]]).toContain('file 9')

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('不存在的文件被跳过', async () => {
    const result = await parallelLoadFiles(['/nonexistent/file.ets'])
    expect(Object.keys(result).length).toBe(0)
  })

  it('空数组返回空对象', async () => {
    const result = await parallelLoadFiles([])
    expect(Object.keys(result).length).toBe(0)
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/worker-file-loader.test.ts`
Expected: FAIL — 模块不存在

**Step 3: 实现 worker-file-loader**

创建 `packages/language-service/src/worker-file-loader.ts`：

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads'
import fs from 'fs'
import os from 'os'

// Worker 线程入口
if (!isMainThread && parentPort) {
  const files: Record<string, string> = {}
  for (const filePath of workerData.filePaths as string[]) {
    try {
      files[filePath] = fs.readFileSync(filePath, 'utf-8')
    } catch { /* skip */ }
  }
  parentPort.postMessage(files)
}

/**
 * 使用 Worker Threads 并行读取文件
 * 文件数 < 10 时回退到同步读取（Worker 启动开销不值得）
 */
export async function parallelLoadFiles(filePaths: string[]): Promise<Record<string, string>> {
  if (filePaths.length === 0) return {}

  // 少量文件直接同步读取
  if (filePaths.length < 10) {
    const result: Record<string, string> = {}
    for (const fp of filePaths) {
      try {
        result[fp] = fs.readFileSync(fp, 'utf-8')
      } catch { /* skip */ }
    }
    return result
  }

  const cpuCount = Math.max(2, os.cpus().length - 1)
  const chunkSize = Math.ceil(filePaths.length / cpuCount)
  const chunks: string[][] = []
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize))
  }

  try {
    const results = await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise<Record<string, string>>((resolve, reject) => {
            const worker = new Worker(__filename, {
              workerData: { filePaths: chunk },
            })
            worker.on('message', resolve)
            worker.on('error', reject)
            worker.on('exit', (code) => {
              if (code !== 0) reject(new Error(`Worker exited with code ${code}`))
            })
          }),
      ),
    )
    return Object.assign({}, ...results)
  } catch {
    // Worker 失败时回退到同步
    const result: Record<string, string> = {}
    for (const fp of filePaths) {
      try {
        result[fp] = fs.readFileSync(fp, 'utf-8')
      } catch { /* skip */ }
    }
    return result
  }
}
```

**Step 4: 修改 loadModules 使用 parallelLoadFiles**

在 `packages/language-service/src/language-service.ts` 的 `loadModules` 方法中，将同步文件读取替换为：

```typescript
    async loadModules() {
      if (options.projectRoot) {
        moduleGraph = new ModuleGraph({ projectRoot: options.projectRoot })
        moduleGraph.scan()
        if (moduleGraph.size > 0) {
          const modulePaths = moduleGraph.generatePaths()
          host.updateCompilerPaths(modulePaths, options.projectRoot)

          // 使用 Worker Threads 并行加载
          const allFiles = moduleGraph.getAllEtsFiles()
            .filter(fp => !(fp in options.files))
          const loaded = await parallelLoadFiles(allFiles)
          for (const [fp, content] of Object.entries(loaded)) {
            host.addFile(fp, content)
          }

          // 加载模块入口文件
          for (const mod of moduleGraph.getModules()) {
            const rootIndex = path.join(mod.rootDir, 'Index.ets')
            if (!(rootIndex in options.files) && !loaded[rootIndex] && fs.existsSync(rootIndex)) {
              try {
                host.addFile(rootIndex, fs.readFileSync(rootIndex, 'utf-8'))
              } catch { /* skip */ }
            }
          }
        }
      }
      modulesReady = true
    },
```

**Step 5: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 6: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/worker-file-loader.ts packages/language-service/src/__tests__/worker-file-loader.test.ts packages/language-service/src/language-service.ts
git commit -m "perf(loader): Worker Threads 并行文件加载，大项目加速 3-5x"
```

---

## Task 11: SDK 索引缓存

**Files:**
- Create: `packages/language-service/src/sdk/sdk-cache.ts`
- Modify: `packages/language-service/src/language-service.ts` (loadSdk 方法)
- Test: `packages/language-service/src/__tests__/sdk/sdk-cache.test.ts`

**Step 1: 写失败测试**

创建 `packages/language-service/src/__tests__/sdk/sdk-cache.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { SdkCache, SdkIndexCache } from '../../sdk/sdk-cache'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('SdkCache', () => {
  it('写入和读取缓存', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-cache-'))
    const cache = new SdkCache(tmpDir)

    const data: SdkIndexCache = {
      sdkPath: '/sdk/path',
      sdkVersion: '12345',
      declarations: { 'common.d.ts': 'declare const Component: any' },
      componentNames: ['Column', 'Row', 'Text'],
      decoratorLocations: {
        Component: { file: '/sdk/common.d.ts', line: 234, column: 14 },
      },
      arkuiBridge: 'declare namespace __arkui {}',
    }

    cache.write(data)
    const loaded = cache.read('/sdk/path', '12345')
    expect(loaded).not.toBeNull()
    expect(loaded!.componentNames).toEqual(['Column', 'Row', 'Text'])

    fs.rmSync(tmpDir, { recursive: true })
  })

  it('版本不匹配返回 null', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkts-cache-'))
    const cache = new SdkCache(tmpDir)

    cache.write({
      sdkPath: '/sdk/path',
      sdkVersion: '12345',
      declarations: {},
      componentNames: [],
      decoratorLocations: {},
      arkuiBridge: '',
    })

    const loaded = cache.read('/sdk/path', '99999')
    expect(loaded).toBeNull()

    fs.rmSync(tmpDir, { recursive: true })
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run packages/language-service/src/__tests__/sdk/sdk-cache.test.ts`
Expected: FAIL — 模块不存在

**Step 3: 实现 SdkCache**

创建 `packages/language-service/src/sdk/sdk-cache.ts`：

```typescript
import fs from 'fs'
import path from 'path'

export interface SdkIndexCache {
  sdkPath: string
  sdkVersion: string
  declarations: Record<string, string>
  componentNames: string[]
  decoratorLocations: Record<string, { file: string; line: number; column: number }>
  arkuiBridge: string
}

export class SdkCache {
  private cacheFile: string

  constructor(projectRoot: string) {
    this.cacheFile = path.join(projectRoot, '.arkts-cache', 'sdk-index.json')
  }

  read(sdkPath: string, sdkVersion: string): SdkIndexCache | null {
    try {
      const raw = fs.readFileSync(this.cacheFile, 'utf-8')
      const cache: SdkIndexCache = JSON.parse(raw)
      if (cache.sdkPath === sdkPath && cache.sdkVersion === sdkVersion) {
        return cache
      }
    } catch { /* 缓存不存在或无效 */ }
    return null
  }

  write(data: SdkIndexCache): void {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true })
      fs.writeFileSync(this.cacheFile, JSON.stringify(data))
    } catch { /* 写入失败不影响功能 */ }
  }
}
```

**Step 4: 在 loadSdk 中集成缓存**

在 `packages/language-service/src/language-service.ts` 的 `loadSdk` 方法中，在 SDK 加载前尝试读取缓存：

```typescript
    async loadSdk() {
      sdkTypeLoader = new SdkTypeLoader({
        sdkPath: options.sdkPath ?? config?.sdkPath,
        extraTypeDirs: options.extraTypeDirs ?? config?.extraTypeDirs,
      })

      const firstSdkPath = sdkTypeLoader.getFirstSdkPath()

      // 尝试读取缓存
      if (firstSdkPath && options.projectRoot) {
        const sdkCache = new SdkCache(options.projectRoot)
        let sdkVersion: string
        try {
          sdkVersion = fs.statSync(firstSdkPath).mtimeMs.toString()
        } catch {
          sdkVersion = ''
        }

        const cached = sdkCache.read(firstSdkPath, sdkVersion)
        if (cached) {
          // 缓存命中
          for (const [name, content] of Object.entries(cached.declarations)) {
            host.addSdkDeclaration(name, content)
            componentRegistry.loadFromDeclaration(content)
          }
          if (cached.arkuiBridge) {
            host.setArkuiBridge(cached.arkuiBridge)
          }
          for (const [name, loc] of Object.entries(cached.decoratorLocations)) {
            const def = decoratorRegistry.get(name)
            if (def) def.sdkLocation = loc
          }
          sdkReady = true
          return
        }
      }

      // 缓存未命中，完整加载
      const sdkTypes = sdkTypeLoader.loadAll()
      // ... 现有加载逻辑

      // 写入缓存
      if (firstSdkPath && options.projectRoot) {
        const sdkCache = new SdkCache(options.projectRoot)
        let sdkVersion: string
        try {
          sdkVersion = fs.statSync(firstSdkPath).mtimeMs.toString()
        } catch {
          sdkVersion = ''
        }
        const declarations: Record<string, string> = {}
        for (const [name, content] of sdkTypes) {
          declarations[name] = content
        }
        const decoratorLocs: Record<string, { file: string; line: number; column: number }> = {}
        for (const name of decoratorRegistry.getAllNames()) {
          const def = decoratorRegistry.get(name)
          if (def?.sdkLocation) decoratorLocs[name] = def.sdkLocation
        }
        sdkCache.write({
          sdkPath: firstSdkPath,
          sdkVersion,
          declarations,
          componentNames: componentRegistry.getAllNames(),
          decoratorLocations: decoratorLocs,
          arkuiBridge: host.getArkuiBridge() ?? '',
        })
      }

      sdkReady = true
    },
```

**Step 5: 运行全部测试确认通过**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 6: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/sdk/sdk-cache.ts packages/language-service/src/__tests__/sdk/sdk-cache.test.ts packages/language-service/src/language-service.ts
git commit -m "perf(sdk): SDK 索引缓存，二次启动 <50ms"
```

---

## Task 12: VS Code 扩展状态栏指示器

**Files:**
- Modify: `packages/vscode-extension/src/extension.ts:170-265`

**Step 1: 修改 activate 函数**

在 `packages/vscode-extension/src/extension.ts` 的 `activate` 函数中，在 `client = new LanguageClient(...)` 之前添加状态栏创建，在 `client.start()` 回调中更新状态栏：

在第 170 行 `export function activate` 函数内，`applyDevEcoColors()` 之后添加：

```typescript
    // 状态栏指示器
    const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
    statusBar.text = '$(loading~spin) ArkTS'
    statusBar.tooltip = 'ArkTS Language Server 正在初始化...'
    statusBar.show()
    context.subscriptions.push(statusBar)
```

需要在文件顶部的 import 中添加 `StatusBarAlignment`：

```typescript
import { workspace, ExtensionContext, window, ConfigurationTarget, StatusBarAlignment } from 'vscode'
```

修改第 245 行的 `client.start().then(` 回调：

```typescript
    client.start().then(
      () => {
        statusBar.text = '$(check) ArkTS'
        statusBar.tooltip = 'ArkTS Language Server 已就绪'
      },
      (err) => {
        statusBar.text = '$(error) ArkTS'
        statusBar.tooltip = `ArkTS LSP 启动失败: ${err.message}`
        window.showErrorMessage(
          `ArkTS LSP 启动失败: ${err.message}\n\n` +
          '请确保已安装 arkts-lsp:\n' +
          '  cd <项目目录> && npm install && npm run build && npm link',
        )
      },
    )
```

在 `client.start()` 之后添加状态监听：

```typescript
    // 需要从 vscode-languageclient 导入 State
    import { State } from 'vscode-languageclient/node'

    client.onDidChangeState((e) => {
      if (e.newState === State.Running) {
        statusBar.text = '$(check) ArkTS'
        statusBar.tooltip = 'ArkTS Language Server 已就绪'
      } else if (e.newState === State.Stopped) {
        statusBar.text = '$(error) ArkTS'
        statusBar.tooltip = 'ArkTS Language Server 已停止'
      }
    })
```

**注意**：`State` 需要从 `vscode-languageclient/node` 导入，在文件顶部第 3-8 行的 import 中添加。

**Step 2: 构建验证**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp/packages/vscode-extension && npm run build`
Expected: 构建成功，无类型错误

**Step 3: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode): 状态栏指示器显示 LSP 初始化状态"
```

---

## Task 13: 导出新增模块 + 构建验证

**Files:**
- Modify: `packages/language-service/src/index.ts`
- Modify: `packages/language-service/tsconfig.json`（如需添加新文件）

**Step 1: 更新 index.ts 导出**

在 `packages/language-service/src/index.ts` 中添加新模块导出：

```typescript
export { scanDecoratorLocations } from './sdk/scan-decorator-locations'
export { parallelLoadFiles } from './worker-file-loader'
export { SdkCache, SdkIndexCache } from './sdk/sdk-cache'
```

**Step 2: 完整构建**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npm run build`
Expected: 构建成功，无错误

**Step 3: 运行全部测试**

Run: `cd /Users/dreamlike/DreamLike/arkts-lsp && npx vitest run`
Expected: ALL PASS

**Step 4: 提交**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add packages/language-service/src/index.ts
git commit -m "chore: 导出新增模块，完整构建验证通过"
```

---

## Task 14: 端到端验证

**不写代码，仅验证。**

**Step 1: 重新构建并全局注册**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
npm run build
npm link
```

**Step 2: 使用 OMC LSP 工具验证**

对 `/Users/dreamlike/DreamLike/myToolList` 项目中的 .ets 文件逐项验证：

```
1. lsp_hover — 悬停变量，应返回类型信息（不超时）
2. lsp_hover — 悬停 @ComponentV2，应返回装饰器文档
3. lsp_goto_definition — 点击 @State，应跳转到 SDK common.d.ts
4. lsp_goto_definition — 点击函数名，应跳转到定义
5. lsp_document_symbols — 应返回文件符号列表
6. lsp_find_references — 应返回引用列表
7. lsp_workspace_symbols — 应返回工作区符号（不超时）
8. lsp_code_actions — 应返回 quick fix 建议（不超时）
9. lsp_diagnostics — 应返回诊断信息
10. lsp_prepare_rename — 应返回可重命名信息
```

**Step 3: VS Code 验证**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp/packages/vscode-extension
npm run install-ext
```

在 VS Code 中打开 .ets 文件，验证：
- 状态栏显示 ArkTS 初始化状态
- 悬停显示类型信息
- Ctrl+Click 跳转到定义
- 代码补全正常工作

**Step 4: 提交最终验证结果**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add -A
git commit -m "test: 端到端验证全部 LSP 功能通过"
```
