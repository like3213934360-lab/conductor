# ArkTS LSP Worker Thread 架构重构设计

日期：2026-02-26

## 问题总览

通过对 myToolList 项目（592 个 .ets 文件）的全面 LSP 功能测试，发现以下问题：

| 问题 | 根因 |
|------|------|
| hover/goto_definition 稳定超时 | TS language service 首次类型检查需构建完整类型图，大项目阻塞主线程 |
| code_actions 始终为空 | 只过滤自定义规则诊断，未透传 TS 原生 code fixes |
| diagnostics_directory 扫描 0 文件/漏报 | 路径格式不一致 + 新文件加载后 TS program 未重建 |
| workspace_symbols 首次超时 | getNavigateToItems 首次调用需构建全量索引，无预热 |

## 架构设计

### 整体架构

```
┌─────────────────────────────────┐
│ 主线程 (LSP Server)              │
│ ├─ connection (LSP 协议收发)     │
│ ├─ WorkerProxy                  │
│ │   ├─ 请求队列 + 超时管理       │
│ │   ├─ CancellationToken 管理    │
│ │   └─ 降级策略（超时后返回缓存） │
│ └─ 文件内容缓存 (fileContents)   │
├─────────────────────────────────┤
│ Worker Thread                    │
│ ├─ ArkTsLanguageService         │
│ ├─ TS Language Service           │
│ ├─ 请求处理循环                  │
│ └─ 渐进式预热引擎               │
└─────────────────────────────────┘
```

### 新增文件

- `packages/lsp-server/src/worker-proxy.ts` — 主线程侧的 Worker 代理
- `packages/lsp-server/src/language-service-worker.ts` — Worker Thread 入口
- `packages/lsp-server/src/cancellation.ts` — 请求级取消令牌

### 修改文件

- `packages/lsp-server/src/server.ts` — 将直接调用 service 改为通过 WorkerProxy 调用
- `packages/language-service/src/language-service.ts` — diagnostics_directory 路径修复 + code fixes 支持

## 详细设计

### 1. 请求级 Cancellation + 超时管理

```typescript
// cancellation.ts
interface CancellableRequest<T> {
  requestId: string
  method: string
  resolve: (value: T) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
  cancelled: boolean
}
```

超时策略（按操作类型分级）：

| 操作 | 超时 | 降级行为 |
|------|------|---------|
| hover | 5s | 返回 null |
| goto_definition | 5s | 返回 null |
| find_references | 8s | 返回空数组 |
| workspace_symbols | 8s | 仅返回已缓存的符号 |
| diagnostics | 10s | 返回上次缓存结果 |
| diagnostics_directory | 30s | 返回已扫描部分的结果 |
| code_actions | 5s | 返回空数组 |
| completion | 3s | 返回空列表 |

取消机制：
- 主线程发送 `{ type: 'cancel', requestId }` 给 Worker
- Worker 在每个 TS API 调用前检查 `isCancelled(requestId)`
- TS language service 的 `getCancellationToken()` 接口对接自定义 token，让 TS 内部也能提前中断

### 2. Code Actions 透传

当前 `server.ts` 只从自定义规则诊断生成 quick fix，缺失 TS 原生 code fixes。

修复：
1. 在 Worker 中新增 `getCodeFixes(file, range)` 方法
2. 调用 TS 的 `getCodeFixesAtPosition()` 获取原生修复建议
3. 从当前范围内的诊断中提取 `errorCodes`
4. 将 TS code fixes 与自定义规则 code actions 合并返回

### 3. diagnostics_directory 修复

两个根因：
1. 路径不一致 — `host.getTrackedFiles()` 返回的路径未经 `path.resolve()`
2. 新文件加载后 TS program 未重建

修复：
- 所有路径统一经过 `path.resolve()` 规范化
- 新文件批量加载完成后，调用 `host.notifyFilesChanged()` 强制 TS 重建 program
- 在 Worker 中执行扫描，避免阻塞主线程
- 支持增量返回：每扫描完一个文件就通过 `postMessage` 发送部分结果

### 4. 渐进式预热引擎

Worker 启动后主动预热 TS 内部缓存：

```
阶段 0: 基础就绪（同步）
  └─ 创建 TS language service + 加载用户文件

阶段 1: SDK 加载（异步）
  └─ loadSdk() — 加载 SDK 声明 + arkui bridge

阶段 2: 模块加载（异步）
  └─ loadModules() — 扫描模块图 + 并行加载 .ets 文件

阶段 3: 类型检查预热（后台，可被请求中断）
  └─ 对前 5 个最大的 .ets 文件调用 getSemanticDiagnostics
  └─ 触发 TS 构建完整类型检查图
  └─ 每个文件之间检查是否有待处理的请求，有则暂停预热

阶段 4: 符号索引预热（后台，最低优先级）
  └─ 对所有已跟踪文件构建符号缓存
  └─ 让后续 workspace_symbols 直接命中缓存
```

关键设计：
- 预热可中断 — 真实请求到达时预热让出 CPU
- 通过 `postMessage({ type: 'warmup-progress', phase, percentage })` 报告进度
- 主线程通过 LSP `$/progress` 通知客户端
- 预热完成前的请求仍正常处理（有超时保护）

## WorkerProxy 接口设计

```typescript
// worker-proxy.ts
class WorkerProxy {
  // 生命周期
  async initialize(options: WorkerInitOptions): Promise<void>
  async shutdown(): Promise<void>

  // LSP 操作（全部异步 + 超时保护）
  async hover(file: string, position: Position): Promise<HoverResult | null>
  async definition(file: string, position: Position): Promise<DefinitionResult[] | null>
  async references(file: string, position: Position): Promise<ReferenceResult[]>
  async completion(file: string, position: Position): Promise<CompletionResult>
  async documentSymbols(file: string): Promise<DocumentSymbol[]>
  async workspaceSymbols(query: string): Promise<WorkspaceSymbolResult[]>
  async diagnostics(file: string): Promise<DiagnosticResult[]>
  async directoryDiagnostics(directory: string): Promise<DiagnosticResult[]>
  async codeActions(file: string, range: Range, diagnostics: Diagnostic[]): Promise<CodeAction[]>
  async prepareRename(file: string, position: Position): Promise<RenameInfo>
  async renameLocations(file: string, position: Position, newName: string): Promise<RenameLocation[]>
  async semanticTokens(file: string): Promise<SemanticToken[]>

  // 文件同步
  updateFile(file: string, content: string): void
  removeFile(file: string): void

  // 状态查询
  getWarmupStatus(): WarmupStatus
}
```

## Worker 消息协议

```typescript
// 主线程 → Worker
type WorkerRequest =
  | { type: 'init'; options: WorkerInitOptions }
  | { type: 'request'; requestId: string; method: string; params: unknown }
  | { type: 'cancel'; requestId: string }
  | { type: 'file-update'; file: string; content: string }
  | { type: 'file-remove'; file: string }

// Worker → 主线程
type WorkerResponse =
  | { type: 'init-done' }
  | { type: 'response'; requestId: string; result: unknown }
  | { type: 'error'; requestId: string; error: string }
  | { type: 'warmup-progress'; phase: number; percentage: number; message: string }
  | { type: 'diagnostics-partial'; requestId: string; partialResults: DiagnosticResult[] }
```

## 测试策略

1. 单元测试：WorkerProxy 的超时、取消、降级逻辑
2. 单元测试：cancellation token 与 TS getCancellationToken 的集成
3. 集成测试：Worker 启动 → 预热 → 处理请求的完整流程
4. 集成测试：code_actions 返回 TS 原生 code fixes
5. 集成测试：diagnostics_directory 路径规范化后正确扫描
6. 压力测试：并发请求 + 取消的正确性
