import {
  workspace,
  ExtensionContext,
  window,
  ConfigurationTarget,
  StatusBarAlignment,
  languages,
  TextDocument,
  Position,
  CancellationToken,
  Hover,
  MarkdownString,
  Location,
  Uri,
  Range,
  CompletionItem,
  CompletionItemKind,
  CompletionList,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  CodeAction,
  CodeActionKind,
  WorkspaceEdit,
  TextEdit,
  DocumentLink,
  CompletionContext,
  DiagnosticCollection,
  Diagnostic as VSDiagnostic,
  DiagnosticSeverity,
} from 'vscode'
import {
  LanguageClient,
  LanguageClientOptions,
  StreamInfo,
} from 'vscode-languageclient/node'
import { detectDevEco } from '../../ace-bridge/src/deveco-detector'
import { parseProject } from '../../ace-bridge/src/project-parser'
import { buildInitializationOptions } from '../../ace-bridge/src/module-builder'
import { launchAceServer, LaunchResult } from '../../ace-bridge/src/ace-launcher'
import * as path from 'path'

let client: LanguageClient | undefined
let currentLaunch: LaunchResult | undefined

// ============================================================================
// ace-server 内部语言 ID 映射
// ace-server 使用 "deveco.apptool.*" 格式的语言 ID，而非标准的 "arkts"、"typescript" 等。
// isValidateFile() 守卫使用这些 ID 来验证文件类型，传入错误的 ID 会导致
// hover、definition 等功能被阻断。
// ============================================================================
const ACE_LANGUAGE_ID: Record<string, string> = {
  '.ets': 'deveco.apptool.ets',
  '.ts': 'deveco.apptool.ts',
  '.js': 'deveco.apptool.js',
  '.json': 'deveco.apptool.json',
  '.css': 'deveco.apptool.css',
  '.hml': 'deveco.apptool.hml',
}

/** 根据文件路径获取 ace-server 内部语言 ID */
function getAceLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return ACE_LANGUAGE_ID[ext] ?? 'deveco.apptool.unknown'
}

// ============================================================================
// ace-server 异步通知桥接层
// ace-server 不使用标准 LSP request/response，而是用自定义 notification 协议：
//   客户端发送 aceProject/onAsync* 通知 → 服务端处理后回发同名通知（含 result）
// ============================================================================

type PendingResolver = (value: any) => void

/** 通过 requestId 维护待处理的 Promise resolver */
const pendingRequests = new Map<string, PendingResolver>()

let requestIdCounter = 0
function nextRequestId(): string {
  return `req-${++requestIdCounter}-${Date.now()}`
}

/**
 * 发送 ace-server 自定义通知并等待响应。
 * ace-server 内部协议格式：{params: {...}, requestId: "..."}
 * 响应通过同名通知返回，包含 {requestId: "...", result: ...}
 */
function sendAceRequest(method: string, params: any, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve) => {
    const requestId = nextRequestId()
    log(`→ ${method} [${requestId}]`)

    pendingRequests.set(requestId, resolve)
    client!.sendNotification(method, {
      params,
      requestId,
    })

    setTimeout(() => {
      if (pendingRequests.get(requestId) === resolve) {
        pendingRequests.delete(requestId)
        log(`⏰ ${method} [${requestId}] 超时`)
        resolve(null)
      }
    }, timeoutMs)
  })
}

/**
 * 注册 ace-server 响应通知监听器。
 * ace-server worker 处理完后，main process 通过同名通知回发结果：
 *   sendNotification(method, {requestId, result, traceId})
 * 我们通过 requestId 匹配对应的 Promise resolver。
 */
function registerAceResponseListeners(): void {
  const methods = [
    'aceProject/onAsyncHover',
    'aceProject/onAsyncDefinition',
    'aceProject/onAsyncDocumentHighlight',
    'aceProject/onAsyncCompletion',
    'aceProject/onAsyncCompletionResolve',
    'aceProject/onAsyncSignatureHelp',
    'aceProject/onAsyncCodeAction',
    'aceProject/onAsyncDocumentLinks',
    'aceProject/onAsyncFindUsages',
    'aceProject/onAsyncImplementation',
    'aceProject/onAsyncPrepareRename',
    'aceProject/onAsyncRename',
  ]

  for (const method of methods) {
    client!.onNotification(method, (data: any) => {
      const reqId = data?.requestId
      log(`← ${method} [${reqId}] hasResult=${!!data?.result}`)
      if (reqId && pendingRequests.has(reqId)) {
        const resolver = pendingRequests.get(reqId)!
        pendingRequests.delete(reqId)
        resolver(data?.result ?? data)
      }
    })
  }
}

// ============================================================================
// VS Code 语言功能提供者（桥接 ace-server 自定义协议）
// ============================================================================

function registerLanguageProviders(context: ExtensionContext): void {
  const selector = { language: 'arkts', scheme: 'file' }

  // Hover
  context.subscriptions.push(
    languages.registerHoverProvider(selector, {
      async provideHover(doc: TextDocument, pos: Position, _token: CancellationToken): Promise<Hover | null> {
        const result = await sendAceRequest('aceProject/onAsyncHover', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const contents = result.contents
        if (!contents) return null

        // ace-server 对 ETS 文件返回特殊格式：
        // { kind: 'plaintext', value: JSON.stringify({ code: { language, value }, data: [...] }) }
        // 需要解析内部 JSON 来提取实际的 hover 内容
        if (contents.kind === 'plaintext' && typeof contents.value === 'string') {
          try {
            const parsed = JSON.parse(contents.value)
            if (parsed.code) {
              const mdParts: MarkdownString[] = []
              // 代码签名
              const codeMd = new MarkdownString()
              codeMd.appendCodeblock(parsed.code.value, parsed.code.language || 'typescript')
              mdParts.push(codeMd)
              // 文档说明
              if (parsed.data && Array.isArray(parsed.data)) {
                for (const item of parsed.data) {
                  if (item.document) {
                    mdParts.push(new MarkdownString(item.document))
                  }
                }
              }
              const range = result.range
                ? new Range(result.range.start.line, result.range.start.character, result.range.end.line, result.range.end.character)
                : undefined
              return new Hover(mdParts, range)
            }
          } catch {
            // 不是 JSON，按普通文本处理
            return new Hover(new MarkdownString(contents.value))
          }
        }

        // 标准 MarkupContent
        if (contents.kind === 'markdown') {
          return new Hover(new MarkdownString(contents.value))
        }
        // 字符串
        if (typeof contents === 'string') {
          return new Hover(new MarkdownString(contents))
        }
        // MarkedString 数组
        if (Array.isArray(contents)) {
          return new Hover(contents.map((c: any) =>
            typeof c === 'string' ? new MarkdownString(c) : new MarkdownString(c.value),
          ))
        }
        return new Hover(new MarkdownString(String(contents.value || contents)))
      },
    }),
  )

  // Go to Definition
  context.subscriptions.push(
    languages.registerDefinitionProvider(selector, {
      async provideDefinition(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncDefinition', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const locations = Array.isArray(result) ? result : [result]
        return locations
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(
              loc.range.start.line, loc.range.start.character,
              loc.range.end.line, loc.range.end.character,
            ),
          ))
      },
    }),
  )

  // Document Highlight
  context.subscriptions.push(
    languages.registerDocumentHighlightProvider(selector, {
      async provideDocumentHighlights(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncDocumentHighlight', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((h: any) => ({
          range: new Range(
            h.range.start.line, h.range.start.character,
            h.range.end.line, h.range.end.character,
          ),
          kind: h.kind,
        }))
      },
    }),
  )

  // Find References
  context.subscriptions.push(
    languages.registerReferenceProvider(selector, {
      async provideReferences(doc: TextDocument, pos: Position, _ctx, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncFindUsages', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !Array.isArray(result)) return []
        return result
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(
              loc.range.start.line, loc.range.start.character,
              loc.range.end.line, loc.range.end.character,
            ),
          ))
      },
    }),
  )

  // Go to Implementation
  context.subscriptions.push(
    languages.registerImplementationProvider(selector, {
      async provideImplementation(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncImplementation', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const locations = Array.isArray(result) ? result : [result]
        return locations
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(
              loc.range.start.line, loc.range.start.character,
              loc.range.end.line, loc.range.end.character,
            ),
          ))
      },
    }),
  )

  // Completion（代码补全/属性提示）
  context.subscriptions.push(
    languages.registerCompletionItemProvider(selector, {
      async provideCompletionItems(doc: TextDocument, pos: Position, _token: CancellationToken, context: CompletionContext) {
        const result = await sendAceRequest('aceProject/onAsyncCompletion', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
          context: {
            // VS Code: Invoke=0, TriggerCharacter=1, TriggerIncomplete=2
            // LSP:     Invoked=1, TriggerCharacter=2, TriggerIncomplete=3
            triggerKind: context.triggerKind + 1,
            triggerCharacter: context.triggerCharacter,
          },
        })
        if (!result) return null
        const items = result.items || result
        if (!Array.isArray(items)) return null
        return new CompletionList(
          items.map((item: any) => {
            const ci = new CompletionItem(item.label, item.kind ?? CompletionItemKind.Text)
            if (item.detail) ci.detail = item.detail
            if (item.documentation) {
              ci.documentation = typeof item.documentation === 'string'
                ? new MarkdownString(item.documentation)
                : new MarkdownString(item.documentation?.value ?? '')
            }
            if (item.insertText) ci.insertText = item.insertText
            if (item.filterText) ci.filterText = item.filterText
            if (item.sortText) ci.sortText = item.sortText
            if (item.data) ci.command = { title: '', command: 'arkts.completionResolve', arguments: [item] }
            return ci
          }),
          result.isIncomplete ?? false,
        )
      },
    }, '.', ':', '<', '>', '"', "'", '/', '@', '*', '{'),
  )

  // Signature Help（函数签名提示）
  context.subscriptions.push(
    languages.registerSignatureHelpProvider(selector, {
      async provideSignatureHelp(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncSignatureHelp', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !result.signatures || result.signatures.length === 0) return null
        const help = new SignatureHelp()
        help.activeSignature = result.activeSignature ?? 0
        help.activeParameter = result.activeParameter ?? 0
        help.signatures = result.signatures.map((sig: any) => {
          const info = new SignatureInformation(sig.label, sig.documentation)
          info.parameters = (sig.parameters || []).map((p: any) =>
            new ParameterInformation(p.label, p.documentation),
          )
          return info
        })
        return help
      },
    }, '(', ','),
  )

  // Code Action（快速修复）
  context.subscriptions.push(
    languages.registerCodeActionsProvider(selector, {
      async provideCodeActions(doc: TextDocument, range: Range, _ctx, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncCodeAction', {
          textDocument: { uri: doc.uri.toString() },
          range: {
            start: { line: range.start.line, character: range.start.character },
            end: { line: range.end.line, character: range.end.character },
          },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((action: any) => {
          const ca = new CodeAction(action.title, action.kind ? CodeActionKind.QuickFix : undefined)
          if (action.edit && action.edit.changes) {
            const we = new WorkspaceEdit()
            for (const [uri, edits] of Object.entries(action.edit.changes as Record<string, any[]>)) {
              we.set(Uri.parse(uri), edits.map((e: any) => new TextEdit(
                new Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character),
                e.newText,
              )))
            }
            ca.edit = we
          }
          return ca
        })
      },
    }),
  )

  // Document Links
  context.subscriptions.push(
    languages.registerDocumentLinkProvider(selector, {
      async provideDocumentLinks(doc: TextDocument, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncDocumentLinks', {
          textDocument: { uri: doc.uri.toString() },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((link: any) => new DocumentLink(
          new Range(link.range.start.line, link.range.start.character, link.range.end.line, link.range.end.character),
          link.target ? Uri.parse(link.target) : undefined,
        ))
      },
    }),
  )

  // Rename（重命名）
  context.subscriptions.push(
    languages.registerRenameProvider(selector, {
      async prepareRename(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncPrepareRename', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !result.canRename) return null
        if (result.range) {
          return new Range(
            result.range.start.line, result.range.start.character,
            result.range.end.line, result.range.end.character,
          )
        }
        return null
      },
      async provideRenameEdits(doc: TextDocument, pos: Position, newName: string, _token: CancellationToken) {
        const result = await sendAceRequest('aceProject/onAsyncRename', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
          newName,
        })
        if (!result || !result.changes) return null
        const we = new WorkspaceEdit()
        for (const [uri, edits] of Object.entries(result.changes as Record<string, any[]>)) {
          we.set(Uri.parse(uri), edits.map((e: any) => new TextEdit(
            new Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character),
            e.newText,
          )))
        }
        return we
      },
    }),
  )
}

// ============================================================================
// DevEco Studio (IntelliJ Darcula) color scheme
// ============================================================================

const DEVECO_TEXTMATE_RULES = [
  { scope: 'keyword.control.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.operator.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.control.import.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.struct.ets', settings: { foreground: '#CC7832' } },
  { scope: 'string.quoted.single.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.quoted.double.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.template.ets', settings: { foreground: '#6A8759' } },
  { scope: 'comment.line.double-slash.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.documentation.ets', settings: { foreground: '#629755' } },
  { scope: 'keyword.other.documentation.ets', settings: { foreground: '#629755', fontStyle: 'bold' } },
  { scope: 'constant.numeric.ets', settings: { foreground: '#6897BB' } },
  { scope: 'constant.language.ets', settings: { foreground: '#CC7832' } },
  { scope: 'constant.character.escape.ets', settings: { foreground: '#CC7832' } },
  { scope: 'entity.name.function.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.method.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.component.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.type.class.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'variable.other.property.ets', settings: { foreground: '#9876AA' } },
  { scope: 'variable.language.this.ets', settings: { foreground: '#CC7832' } },
  { scope: 'meta.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'punctuation.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'entity.name.tag.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'support.type.primitive.ets', settings: { foreground: '#CC7832' } },
  { scope: 'support.type.arkts.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'punctuation.definition.template-expression.begin.ets', settings: { foreground: '#CC7832' } },
  { scope: 'punctuation.definition.template-expression.end.ets', settings: { foreground: '#CC7832' } },
]

const TEXTMATE_SENTINEL_SCOPE = 'keyword.control.ets'

const DEVECO_SEMANTIC_RULES: Record<string, string | { foreground: string; fontStyle: string }> = {
  'namespace:arkts': '#A9B7C6',
  'type:arkts': '#A9B7C6',
  'class:arkts': '#A9B7C6',
  'enum:arkts': '#A9B7C6',
  'interface:arkts': '#A9B7C6',
  'struct:arkts': '#A9B7C6',
  'typeParameter:arkts': '#A9B7C6',
  'parameter:arkts': '#A9B7C6',
  'variable:arkts': '#A9B7C6',
  'property:arkts': '#9876AA',
  'enumMember:arkts': '#9876AA',
  'function:arkts': '#FFC66D',
  'method:arkts': '#FFC66D',
  'keyword:arkts': '#CC7832',
  'string:arkts': '#6A8759',
  'number:arkts': '#6897BB',
  'comment:arkts': '#808080',
  'operator:arkts': '#A9B7C6',
  'decorator:arkts': '#BBB529',
  'variable.readonly:arkts': '#A9B7C6',
  'property.static:arkts': { foreground: '#9876AA', fontStyle: 'italic' },
  'method.static:arkts': { foreground: '#FFC66D', fontStyle: 'italic' },
}

function applyDevEcoColors(): void {
  const config = workspace.getConfiguration('editor')
  applyTextMateColors(config)
  applySemanticColors(config)
}

function applyTextMateColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('tokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const existingRules = (userGlobal?.textMateRules || []) as Array<{ scope: string; settings: Record<string, string> }>

  const hasSentinel = existingRules.some(
    (r) => r.scope === TEXTMATE_SENTINEL_SCOPE && r.settings?.foreground === '#CC7832',
  )
  if (hasSentinel) return

  const filteredRules = existingRules.filter(
    (r) => typeof r.scope !== 'string' || !r.scope.endsWith('.ets'),
  )
  const mergedRules = [...filteredRules, ...DEVECO_TEXTMATE_RULES]

  config.update(
    'tokenColorCustomizations',
    { ...(userGlobal || {}), textMateRules: mergedRules },
    ConfigurationTarget.Global,
  ).then(undefined, () => { })
}

function applySemanticColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const currentRules = (userGlobal?.rules || {}) as Record<string, unknown>

  const hasEnabled = userGlobal?.enabled === true
  const allPresent = hasEnabled && Object.keys(DEVECO_SEMANTIC_RULES).every((key) => key in currentRules)
  if (allPresent) return

  const mergedRules = { ...currentRules, ...DEVECO_SEMANTIC_RULES }

  config.update(
    'semanticTokenColorCustomizations',
    { ...(userGlobal || {}), enabled: true, rules: mergedRules },
    ConfigurationTarget.Global,
  ).then(
    () => { config.update('semanticHighlighting.enabled', true, ConfigurationTarget.Global) },
    () => { },
  )
}

// ============================================================================
// 调试日志输出通道
// ============================================================================

let debugChannel: any

function log(msg: string): void {
  if (!debugChannel) {
    debugChannel = window.createOutputChannel('ArkTS Bridge Debug')
  }
  debugChannel.appendLine(`[${new Date().toISOString()}] ${msg}`)
}

// ============================================================================
// 插件激活
// ============================================================================

export function activate(context: ExtensionContext): void {
  log('ArkTS 插件激活开始')
  applyDevEcoColors()

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workbench.colorTheme')) {
        applyDevEcoColors()
      }
    }),
  )

  // 状态栏
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.text = '$(loading~spin) ArkTS'
  statusBar.tooltip = 'ArkTS Language Server 正在初始化...'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // 检测 DevEco
  const config = workspace.getConfiguration('arkts')
  const customDevEcoPath = config.get<string>('deveco.path', '')
  const env = detectDevEco(customDevEcoPath || undefined)

  if (!env) {
    statusBar.text = '$(error) ArkTS'
    statusBar.tooltip = '未找到 DevEco Studio'
    window.showErrorMessage(
      '未找到 DevEco Studio 安装。\n\n' +
      '请安装 DevEco Studio 或在设置中配置 arkts.deveco.path。',
    )
    return
  }

  // 解析项目
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
    statusBar.text = '$(warning) ArkTS'
    statusBar.tooltip = '未打开工作区'
    return
  }

  let initOptions: ReturnType<typeof buildInitializationOptions>
  try {
    const project = parseProject(workspaceRoot)
    initOptions = buildInitializationOptions(project, env)
  } catch (err: any) {
    statusBar.text = '$(error) ArkTS'
    statusBar.tooltip = `项目解析失败: ${err.message}`
    window.showErrorMessage(`ArkTS 项目解析失败: ${err.message}`)
    return
  }

  // 启动 ace-server
  const launch = launchAceServer({ env })
  currentLaunch = launch
  const serverProcess = launch.process

  const serverOptions = (): Promise<StreamInfo> => {
    return Promise.resolve({
      reader: serverProcess.stdout!,
      writer: serverProcess.stdin!,
    })
  }

  function getEditorFiles(): string[] {
    // ace-server worker 的 getFileUriPath() 会把路径转换为 file:// URI
    // 如果传入已经是 file:// URI 的字符串，会被二次编码为 file:///file%3A///path
    // 必须使用文件系统路径（不含 file:// 协议前缀）
    return workspace.textDocuments
      .filter((d) => d.languageId === 'arkts' || d.fileName.endsWith('.ets'))
      .map((d) => d.uri.fsPath)
  }

  // ============================================================================
  // 诊断累积器
  // ace-server 分多个验证波次发送 publishDiagnostics（Resource/Ets/Ts），
  // 每波会替换该 URI 的全部诊断。后续空波会覆盖前面的有效诊断。
  // 解决方案：拦截 publishDiagnostics，累积所有波次的诊断，
  // 用防抖延迟合并后推送给 VS Code。
  // ============================================================================
  const diagCollection: DiagnosticCollection = languages.createDiagnosticCollection('arkts')
  const diagAccumulator = new Map<string, Map<string, any[]>>() // uri → (wave-key → diagnostics)
  const diagTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function accumulateDiagnostics(uri: string, diagnostics: any[]) {
    // 使用诊断内容的签名作为波次 key 来区分不同验证器
    const waveKey = `wave-${Date.now()}-${Math.random()}`

    if (!diagAccumulator.has(uri)) {
      diagAccumulator.set(uri, new Map())
    }
    const uriMap = diagAccumulator.get(uri)!

    if (diagnostics.length > 0) {
      // 有诊断的波次，保存
      uriMap.set(waveKey, diagnostics)
    }
    // 空诊断波次不保存（不覆盖之前的有效诊断）

    // 防抖：所有波次完成后合并推送
    if (diagTimers.has(uri)) {
      clearTimeout(diagTimers.get(uri)!)
    }
    diagTimers.set(uri, setTimeout(() => {
      pushMergedDiagnostics(uri)
      diagTimers.delete(uri)
    }, 500))
  }

  function pushMergedDiagnostics(uri: string) {
    const uriMap = diagAccumulator.get(uri)
    if (!uriMap) return

    // 合并所有波次的诊断
    const merged: any[] = []
    for (const diags of uriMap.values()) {
      merged.push(...diags)
    }

    // 去重（基于行号+消息）
    const seen = new Set<string>()
    const unique = merged.filter(d => {
      // handleDiagnostics 收到的是 VS Code Diagnostic 对象
      // range 是 VS Code Range 对象，有 start.line/start.character 属性
      const startLine = d.range?.start?.line ?? 0
      const startChar = d.range?.start?.character ?? 0
      const key = `${startLine}:${startChar}:${d.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // handleDiagnostics middleware 收到的已经是 VS Code Diagnostic 对象，直接使用
    diagCollection.set(Uri.parse(uri), unique)
    log(`诊断推送: ${uri.split('/').pop()} → ${unique.length} 条`)
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'arkts' },
      { scheme: 'file', pattern: '**/*.ets' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.ets'),
    },
    initializationOptions: initOptions,
    outputChannelName: 'ArkTS Language Server (ace-server)',
    // ace-server 用自定义通知协议，禁用标准 LSP 中我们用 custom provider 覆盖的功能
    // 同时放行标准 LSP 中 ace-server 原生支持的功能（folding、diagnostics、formatting 等）
    middleware: {
      // didOpen: 先走标准 LSP（ace-server 的标准 handler 用于 folding/diagnostics），
      // 再发自定义 ace 通知（worker 用于 hover/completion/definition）
      didOpen: async (doc, next) => {
        // 标准 LSP didOpen
        await next(doc)
        // 自定义 ace didOpen（发送正确的 languageId 让 worker 正确处理）
        const uri = doc.uri.toString()
        client!.sendNotification('aceProject/onAsyncDidOpen', {
          params: {
            textDocument: {
              uri,
              languageId: getAceLanguageId(uri),
              version: doc.version,
              text: doc.getText(),
            },
          },
          requestId: nextRequestId(),
          editorFiles: getEditorFiles(),
        })
      },
      // didChange: 同理，标准 LSP + 自定义 ace
      didChange: async (e, next) => {
        // 标准 LSP didChange
        await next(e)
        // 自定义 ace didChange
        // 清除该文件的旧诊断波次 — 让新一轮验证重新累积
        const changeUri = e.document.uri.toString()
        diagAccumulator.delete(changeUri)
        // 自定义 ace didChange
        client!.sendNotification('aceProject/onAsyncDidChange', {
          params: {
            textDocument: { uri: e.document.uri.toString(), version: e.document.version },
            contentChanges: e.contentChanges.map((c) => ({
              range: {
                start: { line: c.range.start.line, character: c.range.start.character },
                end: { line: c.range.end.line, character: c.range.end.character },
              },
              rangeLength: c.rangeLength,
              text: c.text,
            })),
          },
          requestId: nextRequestId(),
          editorFiles: getEditorFiles(),
        })
      },
      // 以下功能用自定义 ace provider 覆盖，阻止标准 LSP 处理
      provideHover: () => Promise.resolve(null),
      provideDefinition: () => Promise.resolve(null),
      provideCodeActions: () => Promise.resolve(null),
      provideDocumentHighlights: () => Promise.resolve([]),
      provideDocumentLinks: () => Promise.resolve([]),
      provideReferences: () => Promise.resolve([]),
      provideImplementation: () => Promise.resolve(null),
      provideRenameEdits: () => Promise.resolve(null),
      provideSignatureHelp: () => Promise.resolve(null),
      provideCompletionItem: () => Promise.resolve(null),
      // ace-server 声明 foldingRangeProvider:true 但未实现 handler（返回 Unhandled method）
      // 返回 undefined 让 VS Code 使用内置的基于缩进/括号的代码折叠
      provideFoldingRanges: () => Promise.resolve(undefined as any),
      // ace-server 声明 colorProvider:true 但未实现 handler（返回 Unhandled method）
      provideDocumentColors: () => Promise.resolve([]),
      // 拦截 publishDiagnostics — LanguageClient 内部处理此通知
      // handleDiagnostics middleware 是拦截诊断的唯一正确方式
      // 不调用 next()，完全自行管理诊断（通过 DiagnosticCollection）
      handleDiagnostics: (uri, diagnostics, _next) => {
        const uriStr = uri.toString()
        log(`handleDiagnostics: ${uriStr.split('/').pop()} → ${diagnostics.length} 条`)
        // diagnostics 已经是 VS Code Diagnostic 对象，直接累积
        accumulateDiagnostics(uriStr, diagnostics as any[])
      },
      // 以下标准 LSP 功能不阻止，让 ace-server 原生处理：
      // - documentFormatting（格式化）
    },
  }

  client = new LanguageClient(
    'arkts-lsp',
    'ArkTS Language Server',
    serverOptions,
    clientOptions,
  )

  client.start().then(
    () => {
      statusBar.text = '$(check) ArkTS'
      statusBar.tooltip = 'ArkTS Language Server 已就绪'
      log('LanguageClient 已启动')

      // ace-server 的 initialized handler 需要 editors 数组，
      // 否则 worker 的 initializeOpenedFiles.editors 为 undefined 导致 didOpen 崩溃。
      // LanguageClient 自动发送的 initialized 只有空 params {}，需要补发一次。
      client!.sendNotification('initialized', { editors: [] })

      // 注册 ace-server 响应通知监听器
      registerAceResponseListeners()

      // 注册 VS Code 语言功能提供者
      registerLanguageProviders(context)

      // 监听 ace-server 索引进度
      client!.onNotification('aceProject/onIndexingProgressUpdate', (params: any) => {
        if (params && typeof params.progress === 'number') {
          const pct = Math.round(params.progress * 100)
          statusBar.text = `$(sync~spin) ArkTS ${pct}%`
          statusBar.tooltip = `ArkTS 索引中... ${pct}%`
          if (pct >= 100) {
            statusBar.text = '$(check) ArkTS'
            statusBar.tooltip = 'ArkTS Language Server 已就绪'
          }
        }
      })

      // 监听 ace 自定义诊断通知
      // 注意：client.onNotification 不能拦截 textDocument/publishDiagnostics
      // 因为 LanguageClient 内部已注册该通知处理器。只能通过 handleDiagnostics middleware。
      client!.onNotification('aceProject/doValidateDocument', (data: any) => {
        log(`ace 诊断通知: ${JSON.stringify(data).substring(0, 200)}`)
        // ace 自定义诊断是 raw LSP 格式，需要转换为 VS Code Diagnostic
        if (data?.result?.uri && data?.result?.diagnostics?.length > 0) {
          const vsDiags = data.result.diagnostics.map((d: any) => {
            const range = new Range(
              d.range?.start?.line ?? 0, d.range?.start?.character ?? 0,
              d.range?.end?.line ?? 0, d.range?.end?.character ?? 0,
            )
            // LSP severity: 1=Error, 2=Warning, 3=Info, 4=Hint
            const severity = d.severity === 1 ? DiagnosticSeverity.Error
              : d.severity === 2 ? DiagnosticSeverity.Warning
                : d.severity === 3 ? DiagnosticSeverity.Information
                  : DiagnosticSeverity.Hint
            const diag = new VSDiagnostic(range, d.message || '', severity)
            if (d.source) diag.source = d.source
            if (d.code !== undefined) diag.code = d.code
            return diag
          })
          accumulateDiagnostics(data.result.uri, vsDiags)
        }
      })
    },
    (err) => {
      statusBar.text = '$(error) ArkTS'
      statusBar.tooltip = `ArkTS LSP 启动失败: ${err.message}`
      window.showErrorMessage(
        `ArkTS LSP 启动失败: ${err.message}\n\n` +
        '请确认 DevEco Studio 已正确安装。',
      )
    },
  )

  // ace-server 崩溃自动重启一次
  let hasRestarted = false
  serverProcess.on('exit', (code) => {
    if (code !== 0 && !hasRestarted) {
      hasRestarted = true
      statusBar.text = '$(sync~spin) ArkTS'
      statusBar.tooltip = 'ace-server 崩溃，正在重启...'
      if (client) {
        client.stop().then(() => {
          activate(context)
        })
      }
    }
  })

  context.subscriptions.push({
    dispose: () => {
      if (currentLaunch) {
        currentLaunch.kill()
      }
      if (client) {
        client.stop()
      }
    },
  })
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined
  return client.stop()
}
