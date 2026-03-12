import * as vscode from 'vscode'
import {
  LanguageClient,
  type LanguageClientOptions,
  type StreamInfo,
} from 'vscode-languageclient/node'
import {
  detectDevEco,
  parseProject,
  buildInitializationOptions,
  launchAceServer,
  type LaunchResult,
} from '@anthropic/ace-bridge'
import { getAceLanguageId, nextRequestId, sendAceRequest, registerAceResponseListeners } from './ace-protocol.js'
import { DiagnosticsAccumulator } from './diagnostics.js'
import { syncDevEcoColors } from './deveco-theme.js'
import { registerLanguageProviders } from './language-providers.js'
import type { ArktsLspControlSurface, ArktsLspStatusSnapshot } from '../arkts-lsp-surface.js'

export class ArktsLspController implements ArktsLspControlSurface, vscode.Disposable {
  private client: LanguageClient | undefined
  private currentLaunch: LaunchResult | undefined
  private diagnostics: DiagnosticsAccumulator | undefined
  private providerDisposables: vscode.Disposable[] = []
  private debugChannel: vscode.OutputChannel | undefined
  private readonly statusBar: vscode.StatusBarItem
  private enabled = false
  private state: ArktsLspStatusSnapshot['state'] = 'disabled'
  private message = 'ArkTS LSP is disabled'
  private workspaceRoot?: string
  private devecoDetected = false
  private restartAttempted = false

  constructor(private readonly context: vscode.ExtensionContext) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90)
    this.statusBar.hide()
    context.subscriptions.push(this.statusBar)
  }

  getStatus(): ArktsLspStatusSnapshot {
    return {
      enabled: this.enabled,
      state: this.state,
      message: this.message,
      workspaceRoot: this.workspaceRoot,
      devecoDetected: this.devecoDetected,
    }
  }

  async setEnabled(enabled: boolean): Promise<ArktsLspStatusSnapshot> {
    if (enabled) {
      await this.start()
    } else {
      await this.stop()
    }
    return this.getStatus()
  }

  async start(): Promise<void> {
    if (this.enabled && (this.state === 'starting' || this.state === 'running')) {
      return
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      this.enabled = false
      this.workspaceRoot = undefined
      this.updateState('error', 'No workspace opened for ArkTS LSP')
      return
    }

    this.enabled = true
    this.workspaceRoot = workspaceRoot
    this.updateState('starting', 'Initializing ArkTS LSP...')

    const config = vscode.workspace.getConfiguration('arkts')
    const customDevEcoPath = config.get<string>('deveco.path', '')
    const env = detectDevEco(customDevEcoPath || undefined)
    this.devecoDetected = Boolean(env)

    if (!env) {
      this.updateState('error', 'DevEco Studio not found')
      return
    }

    let initOptions: ReturnType<typeof buildInitializationOptions>
    try {
      const project = parseProject(workspaceRoot)
      initOptions = buildInitializationOptions(project, env)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateState('error', `ArkTS project parse failed: ${message}`)
      return
    }

    const launch = launchAceServer({ env })
    this.currentLaunch = launch
    const serverProcess = launch.process

    const serverOptions = (): Promise<StreamInfo> => Promise.resolve({
      reader: serverProcess.stdout!,
      writer: serverProcess.stdin!,
    })

    const getEditorFiles = (): string[] => {
      return vscode.workspace.textDocuments
        .filter((doc) => doc.languageId === 'arkts' || doc.fileName.endsWith('.ets'))
        .map((doc) => doc.uri.fsPath)
    }

    this.diagnostics = new DiagnosticsAccumulator(message => this.log(message))

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'arkts' },
        { scheme: 'file', pattern: '**/*.ets' },
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.ets'),
      },
      initializationOptions: initOptions,
      outputChannelName: 'ArkTS Language Server (ace-server)',
      middleware: {
        didOpen: async (doc, next) => {
          await next(doc)
          const uri = doc.uri.toString()
          this.client?.sendNotification('aceProject/onAsyncDidOpen', {
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
        didChange: async (event, next) => {
          await next(event)
          const changeUri = event.document.uri.toString()
          this.diagnostics?.clear(changeUri)
          this.client?.sendNotification('aceProject/onAsyncDidChange', {
            params: {
              textDocument: { uri: event.document.uri.toString(), version: event.document.version },
              contentChanges: event.contentChanges.map((change) => ({
                range: {
                  start: { line: change.range.start.line, character: change.range.start.character },
                  end: { line: change.range.end.line, character: change.range.end.character },
                },
                rangeLength: change.rangeLength,
                text: change.text,
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
        provideFoldingRanges: () => Promise.resolve(undefined as never),
        provideDocumentColors: () => Promise.resolve([]),
        handleDiagnostics: (uri, diagnostics) => {
          const uriText = uri.toString()
          this.log(`handleDiagnostics: ${uriText.split('/').pop()} -> ${diagnostics.length}`)
          this.diagnostics?.accumulate(uriText, diagnostics as any[])
        },
      },
    }

    this.client = new LanguageClient(
      'arkts-lsp',
      'ArkTS Language Server',
      serverOptions,
      clientOptions,
    )

    try {
      await this.client.start()
      this.updateState('running', 'ArkTS LSP ready')
      this.restartAttempted = false
      this.client.sendNotification('initialized', { editors: [] })
      registerAceResponseListeners(this.client, message => this.log(message))
      const request = (method: string, params: unknown, timeoutMs?: number) =>
        sendAceRequest(this.client!, method, params, message => this.log(message), timeoutMs)
      this.providerDisposables = registerLanguageProviders(request)
      this.context.subscriptions.push(...this.providerDisposables)

      this.client.onNotification('aceProject/onIndexingProgressUpdate', (params: any) => {
        if (params && typeof params.progress === 'number') {
          const pct = Math.round(params.progress * 100)
          this.statusBar.text = `$(sync~spin) ArkTS ${pct}%`
          this.statusBar.tooltip = `ArkTS indexing... ${pct}%`
          if (pct >= 100) {
            this.updateState('running', 'ArkTS LSP ready')
          }
        }
      })

      this.client.onNotification('aceProject/doValidateDocument', (data: any) => {
        this.log(`ace diagnostics: ${JSON.stringify(data).slice(0, 200)}`)
        this.diagnostics?.handleAceDiagnostic(data)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateState('error', `ArkTS LSP startup failed: ${message}`)
    }

    serverProcess.on('exit', (code) => {
      if (!this.enabled) return
      if (code !== 0 && !this.restartAttempted) {
        this.restartAttempted = true
        this.updateState('starting', 'ArkTS ace-server crashed, restarting once...')
        void this.restartAfterCrash()
      } else if (code !== 0) {
        this.updateState('error', `ArkTS ace-server exited with code ${code}`)
      }
    })
  }

  async stop(): Promise<void> {
    this.enabled = false
    this.restartAttempted = false
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath

    for (const disposable of this.providerDisposables) {
      disposable.dispose()
    }
    this.providerDisposables = []
    this.diagnostics?.dispose()
    this.diagnostics = undefined

    if (this.currentLaunch) {
      this.currentLaunch.kill()
      this.currentLaunch = undefined
    }

    if (this.client) {
      const currentClient = this.client
      this.client = undefined
      await currentClient.stop()
    }

    this.updateState('disabled', 'ArkTS LSP is disabled')
  }

  dispose(): void {
    void this.stop()
    this.statusBar.dispose()
    this.debugChannel?.dispose()
  }

  private async restartAfterCrash(): Promise<void> {
    await this.stop()
    if (!this.enabled) this.enabled = true
    await this.start()
  }

  private updateState(state: ArktsLspStatusSnapshot['state'], message: string): void {
    this.state = state
    this.message = message
    syncDevEcoColors(state === 'running')
    switch (state) {
      case 'disabled':
        this.statusBar.hide()
        break
      case 'starting':
        this.statusBar.text = '$(loading~spin) ArkTS'
        this.statusBar.tooltip = message
        this.statusBar.show()
        break
      case 'running':
        this.statusBar.text = '$(check) ArkTS'
        this.statusBar.tooltip = message
        this.statusBar.show()
        break
      case 'error':
        this.statusBar.text = '$(error) ArkTS'
        this.statusBar.tooltip = message
        this.statusBar.show()
        break
    }
  }

  private log(message: string): void {
    if (!this.debugChannel) {
      this.debugChannel = vscode.window.createOutputChannel('Antigravity ArkTS LSP Debug')
    }
    this.debugChannel.appendLine(`[${new Date().toISOString()}] ${message}`)
  }
}
