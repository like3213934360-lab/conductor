import {
  workspace,
  ExtensionContext,
  window,
  StatusBarAlignment,
  OutputChannel,
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
import { getAceLanguageId, nextRequestId, sendAceRequest, registerAceResponseListeners } from './ace-protocol'
import { registerLanguageProviders } from './language-providers'
import { applyDevEcoColors } from './deveco-theme'
import { DiagnosticsAccumulator } from './diagnostics'

let client: LanguageClient | undefined
let currentLaunch: LaunchResult | undefined

// ── 调试日志 ────────────────────────────────────────────────────────────────

let debugChannel: OutputChannel | undefined

function log(msg: string): void {
  if (!debugChannel) {
    debugChannel = window.createOutputChannel('ArkTS Bridge Debug')
  }
  debugChannel.appendLine(`[${new Date().toISOString()}] ${msg}`)
}

// ── 插件激活 ────────────────────────────────────────────────────────────────

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
    return workspace.textDocuments
      .filter((d) => d.languageId === 'arkts' || d.fileName.endsWith('.ets'))
      .map((d) => d.uri.fsPath)
  }

  // 诊断累积器
  const diagAccumulator = new DiagnosticsAccumulator(log)
  context.subscriptions.push(diagAccumulator)

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
    middleware: {
      didOpen: async (doc, next) => {
        await next(doc)
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
      didChange: async (e, next) => {
        await next(e)
        const changeUri = e.document.uri.toString()
        diagAccumulator.clear(changeUri)
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
      provideFoldingRanges: () => Promise.resolve(undefined as any),
      provideDocumentColors: () => Promise.resolve([]),
      handleDiagnostics: (uri, diagnostics, _next) => {
        const uriStr = uri.toString()
        log(`handleDiagnostics: ${uriStr.split('/').pop()} → ${diagnostics.length} 条`)
        diagAccumulator.accumulate(uriStr, diagnostics as any[])
      },
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

      client!.sendNotification('initialized', { editors: [] })

      // 注册 ace-server 响应监听
      registerAceResponseListeners(client!, log)

      // 注册语言提供者（通过闭包绑定 client + log）
      const boundSendRequest = (method: string, params: any, timeoutMs?: number) =>
        sendAceRequest(client!, method, params, log, timeoutMs)
      registerLanguageProviders(context, boundSendRequest)

      // 索引进度
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

      // ace 自定义诊断
      client!.onNotification('aceProject/doValidateDocument', (data: any) => {
        log(`ace 诊断通知: ${JSON.stringify(data).substring(0, 200)}`)
        diagAccumulator.handleAceDiagnostic(data)
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
