# ArkTS LSP 全面修复设计文档

> 日期：2026-02-26
> 状态：已批准
> 范围：arkts-lsp 服务端 + OMC 集成层 + VS Code 扩展

---

## 一、问题总览

通过对 arkts-lsp 的 8 项 LSP 功能逐项测试，发现以下问题：

| 失败项 | 根因 | 修复端 |
|--------|------|--------|
| Hover 超时 | `createArkTsLanguageService()` 同步加载 SDK + 模块图 + 所有 .ets 文件，阻塞 7-25s，超过 OMC 15s 超时 | 两端 |
| Workspace Symbols 超时 | 同上初始化问题 + `tsService.getNavigateToItems()` 在大项目上慢 | 两端 |
| Code Actions 超时 | 同上初始化 + server.ts 依赖 `params.context.diagnostics`，OMC 调用时可能为空 | arkts-lsp |
| Rename 超时 | 同上初始化 + `findRenameLocations` 需要完整 TS Program | 两端 |
| Hover 返回 null | `mapper.toGenerated()` 在装饰器/被转换区域返回 null | arkts-lsp |
| 装饰器 Goto Definition | 装饰器在 EtsTransformer 阶段被 strip，TS 看不到装饰器符号 | arkts-lsp |
| VS Code 无气泡/跳转/提示 | server.ts 未读取 initializationOptions.sdkPath，SDK 类型加载失败 | 两端 |

---

## 二、修复方案总览

### arkts-lsp 端（6 项）

1. 异步分阶段初始化（解决所有超时）
2. Worker Threads 并行文件 I/O（大项目加速）
3. 分层索引 + SDK 缓存（借鉴 clangd）
4. Hover source map 降级策略
5. 装饰器 Goto Definition（基于 SDK 真实路径）
6. Code Actions 独立化

### OMC 端（3 项，详见第九节）

1. arkts-lsp 专属超时配置（30 秒）
2. 启动后自动预热
3. 请求重试机制

### VS Code 扩展（5 项）

1. server.ts 读取 initializationOptions.sdkPath
2. 初始化进度通知（window/workDoneProgress）
3. 状态栏指示器
4. 跨模块跳转 URI 处理
5. SDK 路径自动检测增强

---

## 三、异步分阶段初始化

### 3.1 当前问题

`language-service.ts` 的 `createArkTsLanguageService()` 是同步函数，第 226-279 行一口气完成：
- 第 226 行：`sdkTypeLoader.loadAll()` — 同步读取 100+ 个 SDK .d.ts 文件
- 第 237 行：`generateBridgeFromSdkTypes()` — 同步生成 arkui 桥接层
- 第 251 行：`moduleGraph.scan()` — 同步递归遍历项目目录
- 第 257-264 行：循环 `fs.readFileSync` 加载所有 .ets 文件

总耗时 7-25 秒，阻塞 Node.js 主线程，导致所有 LSP 请求超时。

### 3.2 修复方案：三阶段初始化状态机

将 `createArkTsLanguageService` 拆为三个阶段：

```
阶段 1（同步，<100ms）：
  - 创建空 service
  - 注册 decoratorRegistry / componentRegistry
  - 设置 compilerOptions
  → document symbols / diagnostics 等轻量操作已可用

阶段 2（异步，1-3s）：
  - 加载 SDK 类型声明
  - 生成 arkui bridge
  - 扫描装饰器 SDK 位置
  → hover / completion / definition 可用

阶段 3（异步，2-10s）：
  - 扫描模块图
  - 加载跨模块 .ets 文件
  - 预热 TS Program
  → workspace symbols / references / rename 可用
```

### 3.3 关键代码改动

**文件：`packages/language-service/src/language-service.ts`**

新增接口：

```typescript
export interface ArkTsLanguageService {
  // ... 现有方法

  // 新增：异步初始化方法
  loadSdk(): Promise<void>
  loadModules(): Promise<void>

  // 新增：就绪状态查询
  isSdkReady(): boolean
  isModulesReady(): boolean
}
```

`createArkTsLanguageService()` 改为仅执行阶段 1：

```typescript
export function createArkTsLanguageService(options): ArkTsLanguageService {
  const decoratorRegistry = new DecoratorRegistry()
  const componentRegistry = new ComponentRegistry()
  // ... 轻量初始化

  let sdkReady = false
  let modulesReady = false

  const host = new ArkTsServiceHost({ files: options.files, ... })
  const tsService = ts.createLanguageService(host)

  return {
    async loadSdk() {
      const sdkTypeLoader = new SdkTypeLoader({ sdkPath: options.sdkPath })
      const sdkTypes = sdkTypeLoader.loadAll()
      // ... 注入 SDK 类型
      sdkReady = true
    },

    async loadModules() {
      const moduleGraph = new ModuleGraph({ projectRoot: options.projectRoot })
      moduleGraph.scan()
      // ... 加载模块文件
      modulesReady = true
    },

    isSdkReady() { return sdkReady },
    isModulesReady() { return modulesReady },

    // 各 handler 增加就绪检查
    getHover(file, position) {
      if (!sdkReady) return null  // 快速返回，不挂起
      // ... 正常逻辑
    },
    // ...
  }
}
```

**文件：`packages/lsp-server/src/server.ts`**

`rebuildService()` 改为异步：

```typescript
async function rebuildService(): Promise<void> {
  if (service) service.dispose()

  service = createArkTsLanguageService({
    files: fileContents,
    ruleDiagnosticsProvider,
    projectRoot,
    sdkPath: sdkPathFromClient,
  })
  // 阶段 1 完成，基础功能立即可用

  await service.loadSdk()     // 阶段 2
  await service.loadModules()  // 阶段 3

  // 预热
  const warmupFile = Object.keys(fileContents)[0]
  if (warmupFile) {
    try { service.getDocumentSymbols(warmupFile) } catch {}
  }
}
```

---

## 四、Worker Threads 并行文件 I/O

### 4.1 业界参考

| LSP 服务器 | 并发策略 |
|-----------|---------|
| clangd | 线程池 + BackgroundIndex 并行解析 |
| rust-analyzer | salsa 增量计算框架，细粒度依赖追踪 |
| tsserver | 单线程 + 按需加载，只诊断已打开文件 |

### 4.2 方案：Node.js worker_threads 并行读取

**新增文件：`packages/language-service/src/worker-file-loader.ts`**

```typescript
import { parentPort, workerData } from 'worker_threads'
import fs from 'fs'

const files: Record<string, string> = {}
for (const filePath of workerData.filePaths as string[]) {
  try {
    files[filePath] = fs.readFileSync(filePath, 'utf-8')
  } catch { /* skip */ }
}
parentPort?.postMessage(files)
```

**修改：`language-service.ts` 的 `loadModules()` 方法**

```typescript
import os from 'os'
import { Worker } from 'worker_threads'

async function parallelLoadFiles(filePaths: string[]): Promise<Record<string, string>> {
  const cpuCount = Math.max(2, os.cpus().length - 1)
  const chunkSize = Math.ceil(filePaths.length / cpuCount)
  const chunks: string[][] = []
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    chunks.push(filePaths.slice(i, i + chunkSize))
  }

  const results = await Promise.all(
    chunks.map(chunk => new Promise<Record<string, string>>((resolve, reject) => {
      const worker = new Worker('./worker-file-loader.js', {
        workerData: { filePaths: chunk }
      })
      worker.on('message', resolve)
      worker.on('error', reject)
    }))
  )
  return Object.assign({}, ...results)
}
```

### 4.3 性能预估

| 阶段 | 当前耗时 | 优化后 |
|------|---------|--------|
| SDK 加载（100+ .d.ts） | 2-5s | <50ms（缓存命中）/ 1-2s（并行） |
| 模块图扫描 | 2-5s | 1-2s（并行 readdir） |
| 文件内容加载（50+ .ets） | 3-10s | 0.5-2s（worker 并行） |
| TS Program 创建 | 2-5s | 2-5s（TS 单线程限制，无法优化） |
| **总计** | **7-25s** | **<50ms 首次响应 + 3-9s 后台完成** |

### 4.4 诚实说明

TS Language Service 本身是单线程的（`ts.createLanguageService` 不支持多线程），TS Program 创建这一步无法并行化。但通过分层索引，这一步被推到后台，不阻塞用户的首次请求。

---

## 五、分层索引 + SDK 缓存

### 5.1 架构（借鉴 clangd）

```
┌─────────────────────────────────────────┐
│ MergedIndex（对外统一接口）               │
│ ├─ ActiveFileIndex  — 已打开文件（即时）  │
│ ├─ BackgroundIndex  — 全项目（后台构建）  │
│ └─ SdkIndex         — SDK 声明（缓存）   │
└─────────────────────────────────────────┘
```

- `ActiveFileIndex`：`onDidOpen` 时立即索引当前文件，hover/completion/definition 秒级可用
- `BackgroundIndex`：后台异步扫描全项目 .ets 文件，完成后 workspace symbols / cross-module references 可用
- `SdkIndex`：SDK 类型声明索引，首次加载后缓存到磁盘，下次启动直接读缓存

### 5.2 SDK 索引缓存

**缓存路径：** `{projectRoot}/.arkts-cache/sdk-index.json`

```typescript
interface SdkIndexCache {
  sdkPath: string
  sdkVersion: string           // SDK 目录的 mtime 作为版本号
  declarations: Record<string, string>  // 文件名 → 内容
  componentNames: string[]     // 提取的组件名列表
  decoratorLocations: Record<string, { file: string; line: number; column: number }>
  arkuiBridge: string          // 生成的桥接层内容
}
```

**加载逻辑：**

```typescript
async loadSdk() {
  const cacheFile = path.join(projectRoot, '.arkts-cache', 'sdk-index.json')
  const sdkMtime = fs.statSync(sdkPath).mtimeMs.toString()

  // 尝试读取缓存
  try {
    const cache: SdkIndexCache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
    if (cache.sdkPath === sdkPath && cache.sdkVersion === sdkMtime) {
      // 缓存命中，<50ms
      applyCache(cache)
      sdkReady = true
      return
    }
  } catch { /* 缓存不存在或无效 */ }

  // 缓存未命中，完整加载
  const sdkTypes = sdkTypeLoader.loadAll()
  // ... 正常加载逻辑

  // 写入缓存
  const cache: SdkIndexCache = { sdkPath, sdkVersion: sdkMtime, ... }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify(cache))
  sdkReady = true
}
```

---

## 六、Hover Source Map 降级策略

### 6.1 当前问题

`getHover()` 第 317 行 `mapper.toGenerated()` 在以下位置返回 null：
- 装饰器行（被 strip 后在虚拟文件中不存在）
- struct 关键字位置（被替换为 class）
- UI DSL 被预处理的区域

### 6.2 修复方案

**文件：`packages/language-service/src/language-service.ts` 的 `getHover()` 方法**

```typescript
getHover(file: string, position: Position): HoverResult | null {
  if (!sdkReady) return null

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
              def.description
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
}
```

---

## 七、装饰器 Goto Definition（基于 SDK 真实路径）

### 7.1 原理

装饰器在 EtsTransformer 阶段被 strip，TS 看不到它们，自然无法跳转。但 SDK 的 `ets/component/common.d.ts` 中有每个装饰器的 `declare const` 声明，例如：

```
第 234 行：declare const Component: ClassDecorator & ...
第 244 行：declare const ComponentV2: ClassDecorator & ...
第 344 行：declare const Entry: ClassDecorator & ...
第 524 行：declare const State: PropertyDecorator
第 960 行：declare const Monitor: MonitorDecorator
```

### 7.2 修改 DecoratorDefinition 接口

**文件：`packages/language-service/src/decorator-registry.ts`**

```typescript
export interface DecoratorDefinition {
  name: string
  version: StateVersion
  targets: DecoratorTarget[]
  hasArgs: boolean
  transform: DecoratorTransform
  description: string
  // 新增：SDK 中的声明位置
  sdkLocation?: { file: string; line: number; column: number }
}
```

### 7.3 自动扫描 SDK 装饰器位置

**新增方法：在 `loadSdk()` 阶段执行**

```typescript
function scanDecoratorLocations(
  sdkPath: string,
  decoratorRegistry: DecoratorRegistry
): void {
  const commonDts = path.join(sdkPath, 'ets', 'component', 'common.d.ts')
  let content: string
  try {
    content = fs.readFileSync(commonDts, 'utf-8')
  } catch { return }

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
          line: i,       // 0-indexed
          column: lines[i].indexOf(name)
        }
      }
    }
  }
}
```

此方法在 `loadSdk()` 中 SDK 类型加载完成后调用。使用正则动态扫描行号，不硬编码，适配不同 SDK 版本。

### 7.4 修改 getDefinition()

**文件：`packages/language-service/src/language-service.ts`**

在 `getDefinition()` 方法最前面增加装饰器检测：

```typescript
getDefinition(file: string, position: Position): DefinitionResult[] | null {
  // === 新增：装饰器跳转 ===
  const originalContent = host.getOriginalContent(file)
  if (originalContent) {
    const lines = originalContent.split('\n')
    const line = lines[position.line] ?? ''
    // 匹配 @DecoratorName，检查光标是否在 @ 或名称上
    const decoratorPattern = /@([A-Z]\w*)/g
    let match: RegExpExecArray | null
    while ((match = decoratorPattern.exec(line)) !== null) {
      const atStart = match.index           // @ 的位置
      const nameStart = match.index + 1     // 名称开始
      const nameEnd = nameStart + match[1].length
      if (position.column >= atStart && position.column < nameEnd) {
        const def = decoratorRegistry.get(match[1])
        if (def?.sdkLocation) {
          return [{
            file: def.sdkLocation.file,
            position: { line: def.sdkLocation.line, column: def.sdkLocation.column }
          }]
        }
      }
    }
  }

  // === 现有逻辑不变 ===
  const virtualPath = toVirtualPath(file)
  const mapper = host.getSourceMapper(file)
  if (!mapper) return null
  // ...
}
```

---

## 八、Code Actions 独立化

### 8.1 当前问题

`server.ts` 第 392 行 `params.context.diagnostics` 依赖客户端先推送诊断。OMC 的 LSP 工具直接发 `textDocument/codeAction` 请求时，这个数组为空，导致返回空数组。

### 8.2 修复方案

**文件：`packages/lsp-server/src/server.ts` 的 `onCodeAction` handler**

当 `params.context.diagnostics` 为空时，主动调用 `service.getDiagnostics()` 获取诊断：

```typescript
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  if (!service || !isEtsFile(params.textDocument.uri)) return []

  try {
    const actions: CodeAction[] = []
    let diagnostics = params.context.diagnostics

    // 如果客户端没有推送诊断，主动获取
    if (diagnostics.length === 0) {
      const filePath = uriToPath(params.textDocument.uri)
      const allDiags = service.getDiagnostics(filePath)

      // 过滤出请求范围内的规则诊断
      diagnostics = allDiags
        .filter(d => d.message.startsWith('[arkts/'))
        .filter(d => {
          // 检查诊断范围是否与请求范围重叠
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
      // ... 各规则的 quick fix
    }

    return actions
  } catch (e) {
    connection.console.error(`[codeAction] ${e}`)
    return []
  }
})
```

---

## 九、OMC 端修复（精确修改指南）

> **重要**：以下内容将同步写入 arkts-lsp 项目的 README.md，确保其他 AI 或人看到后能准确无误地执行修改。

### 9.1 修改 1：arkts-lsp 专属超时配置（30 秒）

**文件：** `~/.claude/plugins/cache/omc/oh-my-claudecode/<version>/src/tools/lsp/servers.ts`

**当前代码（arkts 配置）：**

```typescript
arkts: {
  name: 'ArkTS Language Server',
  command: 'arkts-lsp',
  args: ['--stdio'],
  extensions: ['.ets'],
  installHint: 'cd /path/to/arkts-lsp && npm install && npm run build && npm link'
}
```

**修改为：**

```typescript
arkts: {
  name: 'ArkTS Language Server',
  command: 'arkts-lsp',
  args: ['--stdio'],
  extensions: ['.ets'],
  installHint: 'cd /path/to/arkts-lsp && npm install && npm run build && npm link',
  timeout: 30000  // ArkTS LSP 初始化需要加载 SDK + 扫描模块，需要更长超时
}
```

**文件：** `~/.claude/plugins/cache/omc/oh-my-claudecode/<version>/src/tools/lsp/client.ts`

**当前代码（第 285 行附近）：**

```typescript
private async request<T>(method: string, params: unknown, timeout = 15000): Promise<T> {
```

**修改为（支持 per-server timeout）：**

```typescript
private serverTimeout: number = 15000

// 在 connect() 或构造函数中，从 server config 读取 timeout
constructor(serverConfig: LspServerConfig) {
  this.serverTimeout = serverConfig.timeout ?? 15000
}

private async request<T>(method: string, params: unknown, timeout = this.serverTimeout): Promise<T> {
```

**同时修改 `LspServerConfig` 接口（同文件或 servers.ts 中）：**

```typescript
interface LspServerConfig {
  name: string
  command: string
  args: string[]
  extensions: string[]
  installHint: string
  timeout?: number  // 新增：每个服务器的自定义超时（毫秒），默认 15000
}
```

### 9.2 修改 2：启动后自动预热

**文件：** `~/.claude/plugins/cache/omc/oh-my-claudecode/<version>/src/tools/lsp/client.ts`

**在 `connect()` 方法中，LSP 初始化完成后添加预热逻辑：**

找到 `connection.onInitialized` 或初始化完成的回调位置，在其后添加：

```typescript
// 初始化完成后，发送预热请求
// 使用 documentSymbol 请求预热 TS Program（最轻量的触发方式）
if (serverConfig.name === 'ArkTS Language Server') {
  setTimeout(async () => {
    try {
      // 找到第一个已打开的 .ets 文件
      const openDocs = this.getOpenDocuments()
      const etsDoc = openDocs.find(d => d.endsWith('.ets'))
      if (etsDoc) {
        await this.request('textDocument/documentSymbol', {
          textDocument: { uri: pathToUri(etsDoc) }
        }, 30000)  // 预热用 30 秒超时
      }
    } catch {
      // 预热失败不影响正常功能
    }
  }, 100)
}
```

### 9.3 修改 3：请求重试机制（1 次重试）

**文件：** `~/.claude/plugins/cache/omc/oh-my-claudecode/<version>/src/tools/lsp/client.ts`

**在 `request()` 方法中添加重试逻辑：**

```typescript
private async request<T>(method: string, params: unknown, timeout = this.serverTimeout): Promise<T> {
  const maxRetries = 1

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.doRequest<T>(method, params, timeout)
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out')
      if (isTimeout && attempt < maxRetries) {
        // 超时重试一次（服务器可能刚完成初始化）
        continue
      }
      throw error
    }
  }

  // TypeScript 需要这行（实际不会执行到）
  throw new Error('Unreachable')
}

// 将原来的 request 逻辑移到 doRequest
private async doRequest<T>(method: string, params: unknown, timeout: number): Promise<T> {
  // ... 原来的 request 实现
}
```

### 9.4 构建与部署

修改完成后必须执行完整构建：

```bash
cd ~/.claude/plugins/cache/omc/oh-my-claudecode/<version>
npm install
npm run build
```

构建链：`tsc` → `build-mcp-server.mjs` → `bridge/mcp-server.cjs`

仅修改 `src/` 或 `dist/` 不会生效，必须重新打包 `bridge/mcp-server.cjs`。

然后重启 Claude Code 会话。

---

## 十、VS Code 扩展完整功能支持

### 10.1 问题分析

VS Code 扩展的 `LanguageClient` 架构正确，会自动根据 LSP 服务器的 capabilities 注册 hover、definition、completion 等功能。但以下问题导致功能不可用：

1. `server.ts` 未读取 `initializationOptions.sdkPath`
2. 初始化超时导致连接断开
3. 无进度反馈，用户以为功能不可用

### 10.2 修复 1：server.ts 读取 initializationOptions

**文件：`packages/lsp-server/src/server.ts`**

**当前代码（第 126-135 行）：**

```typescript
let projectRoot: string | undefined

connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    projectRoot = uriToPath(params.workspaceFolders[0].uri)
  } else if (params.rootUri) {
    projectRoot = uriToPath(params.rootUri)
  }
  // ...
})
```

**修改为：**

```typescript
let projectRoot: string | undefined
let sdkPathFromClient: string | undefined

connection.onInitialize((params: InitializeParams): InitializeResult => {
  if (params.workspaceFolders && params.workspaceFolders.length > 0) {
    projectRoot = uriToPath(params.workspaceFolders[0].uri)
  } else if (params.rootUri) {
    projectRoot = uriToPath(params.rootUri)
  }

  // 新增：读取客户端传来的 SDK 路径
  const initOptions = params.initializationOptions as { sdkPath?: string } | undefined
  if (initOptions?.sdkPath) {
    sdkPathFromClient = initOptions.sdkPath
    connection.console.log(`[init] SDK path from client: ${sdkPathFromClient}`)
  }

  // ...
})
```

**同时修改 `rebuildService()`（第 571-579 行）：**

```typescript
async function rebuildService(): Promise<void> {
  if (service) service.dispose()

  service = createArkTsLanguageService({
    files: fileContents,
    ruleDiagnosticsProvider,
    projectRoot,
    sdkPath: sdkPathFromClient,  // 新增：传递 SDK 路径
  })

  await service.loadSdk()
  await service.loadModules()
}
```

**说明：** 当使用项目路径（projectRoot）时，`SdkTypeLoader` 通常能自动检测到 SDK 路径。`sdkPathFromClient` 作为显式覆盖，优先级更高。

### 10.3 修复 2：初始化进度通知

**文件：`packages/lsp-server/src/server.ts`**

利用 LSP 标准的 `window/workDoneProgress` 协议：

```typescript
connection.onInitialized(async () => {
  connection.console.log('ArkTS LSP Server initialized')

  // 创建进度通知
  const token = 'arkts-init'
  try {
    await connection.sendRequest('window/workDoneProgress/create', { token })
  } catch {
    // 客户端不支持进度通知，静默跳过
  }

  const report = (message: string, percentage: number) => {
    try {
      connection.sendProgress(
        { method: 'window/workDoneProgress', jsonrpc: '2.0' } as any,
        token,
        percentage === 0
          ? { kind: 'begin', title: 'ArkTS LSP', message, percentage }
          : percentage === 100
            ? { kind: 'end', message }
            : { kind: 'report', message, percentage }
      )
    } catch { /* ignore */ }
  }

  report('正在加载 SDK 类型...', 0)
  await rebuildService()  // 内部分阶段执行

  report('就绪', 100)
})
```

### 10.4 修复 3：extension.ts 状态栏指示器

**文件：`packages/vscode-extension/src/extension.ts`**

在 `activate()` 函数中添加：

```typescript
import { window, StatusBarAlignment, LanguageClient, State } from 'vscode'

export function activate(context: ExtensionContext): void {
  applyDevEcoColors()

  // 新增：状态栏指示器
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.text = '$(loading~spin) ArkTS'
  statusBar.tooltip = 'ArkTS Language Server 正在初始化...'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // ... 现有的 serverOptions / clientOptions 配置 ...

  client = new LanguageClient(...)

  client.start().then(
    () => {
      statusBar.text = '$(check) ArkTS'
      statusBar.tooltip = 'ArkTS Language Server 已就绪'
    },
    (err) => {
      statusBar.text = '$(error) ArkTS'
      statusBar.tooltip = `ArkTS LSP 启动失败: ${err.message}`
      window.showErrorMessage(...)
    },
  )

  // 监听状态变化
  client.onDidChangeState((e) => {
    if (e.newState === State.Running) {
      statusBar.text = '$(check) ArkTS'
      statusBar.tooltip = 'ArkTS Language Server 已就绪'
    } else if (e.newState === State.Stopped) {
      statusBar.text = '$(error) ArkTS'
      statusBar.tooltip = 'ArkTS Language Server 已停止'
    }
  })
}
```

### 10.5 修复 4：SDK 路径自动检测增强

**文件：`packages/vscode-extension/src/extension.ts`**

当用户未配置 `arkts.sdk.path` 时，使用项目路径让 LSP 服务器自动检测：

```typescript
const config = workspace.getConfiguration('arkts')
const sdkPath = config.get<string>('sdk.path', '')

const clientOptions: LanguageClientOptions = {
  // ... 现有配置
  initializationOptions: {
    sdkPath: sdkPath || undefined,
    // 项目路径通过 workspaceFolders 自动传递，
    // SdkTypeLoader 会基于项目路径自动检测 SDK
  },
}
```

**说明：** `SdkTypeLoader` 内部已有 SDK 自动检测逻辑，会搜索常见路径（如 `~/Library/OpenHarmony/Sdk/`）。当使用项目路径（通过 `workspaceFolders` 传递）时，通常能自动找到 SDK。`sdkPath` 配置项作为手动覆盖，仅在自动检测失败时需要。

### 10.6 VS Code 功能验证清单

修复完成后，在 VS Code 中验证以下功能：

| 功能 | 验证方法 | 预期结果 |
|------|---------|---------|
| 状态栏 | 打开 .ets 文件 | 底部显示 "$(loading~spin) ArkTS" → "$(check) ArkTS" |
| Hover | 鼠标悬停变量/函数 | 显示类型信息气泡 |
| Hover 装饰器 | 鼠标悬停 @ComponentV2 | 显示装饰器文档 |
| Goto Definition | Ctrl+Click 函数名 | 跳转到定义位置 |
| Goto Definition 跨模块 | Ctrl+Click import 的符号 | 跳转到其他模块的源文件 |
| Goto Definition SDK | Ctrl+Click SDK API | 跳转到 SDK .d.ts 文件 |
| Goto Definition 装饰器 | Ctrl+Click @State | 跳转到 common.d.ts 对应行 |
| Completion | 输入 `.` 后 | 显示属性/方法补全列表 |
| Diagnostics | 写错误代码 | 红色波浪线 + 错误信息 |
| References | 右键 → Find All References | 列出所有引用位置 |
| Rename | F2 重命名符号 | 所有引用同步更新 |
| Code Actions | 点击灯泡图标 | 显示 quick fix 建议 |

---

## 十一、实施优先级

| 优先级 | 修复项 | 影响范围 | 复杂度 |
|--------|--------|---------|--------|
| P0 | 异步分阶段初始化 | 解决所有超时 | 高 |
| P0 | server.ts 读取 sdkPath | VS Code 功能前提 | 低 |
| P1 | 装饰器 Goto Definition | 高频使用 | 中 |
| P1 | Hover 降级策略 | 高频使用 | 中 |
| P1 | VS Code 进度通知 + 状态栏 | 用户体验 | 低 |
| P2 | Worker Threads 并行 I/O | 大项目加速 | 中 |
| P2 | SDK 索引缓存 | 启动加速 | 中 |
| P2 | Code Actions 独立化 | OMC 兼容 | 低 |
| P3 | OMC 超时/预热/重试 | 兜底保障 | 低 |

---

## 十二、风险与测试建议

### 风险

1. **异步初始化竞态**：`rebuildService()` 改为异步后，如果用户快速连续打开多个文件，可能触发多次 rebuild。需要加锁或取消机制
2. **Worker Threads 兼容性**：某些 Node.js 环境可能不支持 worker_threads，需要降级到同步加载
3. **SDK 缓存失效**：如果用户更新 SDK 但 mtime 未变（极少见），缓存可能过期。可增加文件数量校验

### 测试用例

1. 冷启动测试：重启 LSP 后立即发送 hover 请求，应返回 null 而非超时
2. 预热完成测试：等待 5 秒后发送 hover 请求，应返回类型信息
3. 装饰器跳转测试：点击 @ComponentV2，应跳转到 SDK common.d.ts 第 244 行
4. 大项目测试：在 50+ 文件的项目中测试 workspace symbols，应在 30 秒内返回
5. 缓存测试：第二次启动应在 <1 秒内完成 SDK 加载
6. VS Code 测试：安装扩展后打开 .ets 文件，验证所有功能清单
