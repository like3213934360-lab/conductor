import {
  workspace,
  type ExtensionContext,
  window,
  type OutputChannel,
} from 'vscode'
import * as path from 'path'
import { ArktsLspController } from './arkts/arkts-lsp-controller.js'
import { syncDevEcoColors } from './arkts/deveco-theme.js'
import { RequestHistoryRepository } from './request-history-repository.js'
import { activateAntigravityRuntime, deactivateAntigravityRuntime } from './activation.js'

let sqliteClient: { close(): void } | undefined
let arktsLspController: ArktsLspController | undefined
let debugChannel: OutputChannel | undefined

function log(msg: string): void {
  if (!debugChannel) {
    debugChannel = window.createOutputChannel('Antigravity Workflow Host')
  }
  debugChannel.appendLine(`[${new Date().toISOString()}] ${msg}`)
}

export async function activateAntigravityHost(context: ExtensionContext): Promise<void> {
  log('Antigravity Workflow extension activation started')

  let storage: any = undefined
  try {
    const dataDir = context.globalStorageUri.fsPath
    const [{ SqliteClient }] = await Promise.all([
      import('@anthropic/antigravity-persistence'),
    ])
    sqliteClient = await SqliteClient.create({ dataDir, dbName: 'antigravity-workflow.db' })
    const historyRepo = new RequestHistoryRepository(sqliteClient as any)
    const dbPath = path.join(dataDir, 'db', 'antigravity-workflow.db')

    storage = {
      queryHistory: (page: number, pageSize: number) => historyRepo.queryHistory(page, pageSize),
      getDbPath: () => dbPath,
    }
    log('Antigravity workspace persistence initialized')
  } catch (err: any) {
    log(`Workspace persistence initialization failed (non-fatal): ${err.message}`)
  }

  try {
    arktsLspController = new ArktsLspController(context)
    context.subscriptions.push(arktsLspController)
    await activateAntigravityRuntime(context, context.extensionUri, storage, arktsLspController)
    syncDevEcoColors(arktsLspController.getStatus().state === 'running')
    log('Antigravity Workflow extension activated')
  } catch (err: any) {
    const msg = `Antigravity Workflow activation failed: ${err.message}\n${err.stack || ''}`
    log(msg)
    window.showWarningMessage(`Antigravity Workflow activation failed: ${err.message}`)
  }

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbench.colorTheme')) {
        syncDevEcoColors(arktsLspController?.getStatus().state === 'running')
      }
    }),
  )
}

export function deactivateAntigravityHost(): void {
  deactivateAntigravityRuntime()
  arktsLspController?.dispose()
  arktsLspController = undefined
  sqliteClient?.close()
}
