/**
 * Antigravity Task Kernel VS Code — 激活入口
 */

import * as vscode from 'vscode'
import * as path from 'path'
import { SettingsManager } from './settings-manager.js'
import { DashboardPanel } from './dashboard-panel.js'
import type { IHistoryStorage } from './dashboard-panel.js'
import type { ArktsLspControlSurface } from './arkts-lsp-surface.js'
import { AntigravityStatusBar } from './status-bar.js'
import { syncModelCatalogToFile, autoRegisterMcpConfig, autoInstallSkill, autoInjectRoutingRules } from './auto-config.js'
import { WorkflowOrchestrator } from './workflow-orchestrator.js'
import { WORKFLOW_COMMAND_IDS } from './workflow-contract.js'

let statusBar: AntigravityStatusBar | undefined
let workflowOrchestrator: WorkflowOrchestrator | undefined

export async function activateAntigravityRuntime(
  context: vscode.ExtensionContext,
  extensionUri: vscode.Uri,
  storage?: IHistoryStorage,
  arktsLspController?: ArktsLspControlSurface,
) {
  console.log('[Antigravity Task Kernel] Activating...')

  const settings = new SettingsManager(context)

  const openPanelCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.openPanel, () => {
    DashboardPanel.createOrShow(extensionUri, storage || null, settings, workflowOrchestrator!, arktsLspController, () => statusBar?.refresh())
  })
  context.subscriptions.push(openPanelCmd)

  workflowOrchestrator = new WorkflowOrchestrator(extensionUri.fsPath)
  context.subscriptions.push(workflowOrchestrator)

  const promptTaskGoal = async (): Promise<string | undefined> => {
    return vscode.window.showInputBox({
      title: 'Run Antigravity Task',
      prompt: 'Describe the antigravity-taskd goal',
      placeHolder: 'Analyze this workspace against current SOTA and identify gaps',
      ignoreFocusOut: true,
      validateInput: value => value.trim().length === 0 ? 'Goal is required' : undefined,
    })
  }

  const pickTaskMode = async (): Promise<'analysis' | 'write' | undefined> => {
    const selection = await vscode.window.showQuickPick([
      {
        label: 'Analysis',
        description: 'Long-running analysis with shard orchestration and semantic progress.',
        value: 'analysis' as const,
      },
      {
        label: 'Write',
        description: 'Analyze first, then commit changes through a single writer worker.',
        value: 'write' as const,
      },
    ], {
      title: 'Select Antigravity Task Mode',
      ignoreFocusOut: true,
    })
    return selection?.value
  }

  const runTask = async () => {
    const mode = await pickTaskMode()
    if (!mode) return
    const goal = await promptTaskGoal()
    if (!goal) return

    DashboardPanel.createOrShow(extensionUri, storage || null, settings, workflowOrchestrator!, arktsLspController, () => statusBar?.refresh())

    try {
      const result = await workflowOrchestrator!.startRun({ goal, mode })
      vscode.window.showInformationMessage(`Antigravity task started (${mode}): ${result.runId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed to start Antigravity task: ${message}`)
    }
  }

  const runTaskCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.runTask, runTask)
  context.subscriptions.push(runTaskCmd)

  const getTaskCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getTask, async () => {
    try {
      const run = await workflowOrchestrator!.getRun()
      const summary = JSON.stringify({
        runId: run.snapshot.runId,
        status: run.snapshot.status,
        phase: run.snapshot.phase,
        nodes: Object.fromEntries(
          Object.entries(run.snapshot.nodes).map(([nodeId, node]) => [nodeId, (node as { status: string }).status]),
        ),
      }, null, 2)
      const channel = vscode.window.createOutputChannel('Antigravity Task')
      channel.clear()
      channel.appendLine(summary)
      channel.show(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed to get task state: ${message}`)
    }
  })
  context.subscriptions.push(getTaskCmd)

  const streamTaskCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.streamTask, async () => {
    try {
      const run = await workflowOrchestrator!.getRun()
      const channel = vscode.window.createOutputChannel(`Antigravity Task Stream ${run.snapshot.runId}`)
      channel.show(true)
      const disposable = await workflowOrchestrator!.streamRun(run.snapshot.runId, (event) => {
        channel.clear()
        channel.appendLine(`runId: ${event.snapshot.runId}`)
        channel.appendLine(`status: ${event.snapshot.status}`)
        channel.appendLine(`phase: ${event.snapshot.phase}`)
        channel.appendLine('')
        for (const entry of event.entries) {
          channel.appendLine(`[${entry.sequence}] ${entry.createdAt} ${entry.kind}${entry.nodeId ? ` (${entry.nodeId})` : ''}`)
        }
      })
      context.subscriptions.push(disposable)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed to stream task state: ${message}`)
    }
  })
  context.subscriptions.push(streamTaskCmd)

  const cancelTaskCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.cancelTask, async () => {
    try {
      const run = await workflowOrchestrator!.cancelRun()
      vscode.window.showInformationMessage(`Cancellation requested: ${run.snapshot.runId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      vscode.window.showErrorMessage(`Failed to cancel task: ${message}`)
    }
  })
  context.subscriptions.push(cancelTaskCmd)

  const toggleArktsLspCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.toggleArktsLsp, async () => {
    if (!arktsLspController) {
      vscode.window.showWarningMessage('ArkTS LSP controller is unavailable.')
      return
    }

    const current = arktsLspController.getStatus()
    const next = await arktsLspController.setEnabled(!current.enabled)
    await settings.setArktsLspEnabled(next.enabled)
    vscode.window.showInformationMessage(
      next.enabled
        ? `ArkTS LSP enabled: ${next.message}`
        : 'ArkTS LSP disabled.',
    )
  })
  context.subscriptions.push(toggleArktsLspCmd)

  statusBar = new AntigravityStatusBar(settings)
  context.subscriptions.push(statusBar.getItem())
  try {
    await statusBar.initialize()
  } catch (e) {
    console.error('[Antigravity Task Kernel] StatusBar initialize failed:', e)
  }

  if (arktsLspController) {
    try {
      const enabled = await settings.getArktsLspEnabled()
      await arktsLspController.setEnabled(enabled)
    } catch (e) {
      console.error('[Antigravity Task Kernel] ArkTS LSP controller initialize failed:', e)
    }
  }

  const dbFilePath = storage
    ? (storage as any).getDbPath?.() || ''
    : path.join(context.globalStorageUri.fsPath, 'history.db')
  try { await syncModelCatalogToFile(settings, dbFilePath) } catch (e) { console.error('[Antigravity Task Kernel] syncModelCatalogToFile failed:', e) }
  try { autoRegisterMcpConfig(context.extensionPath) } catch (e) { console.error('[Antigravity Task Kernel] autoRegisterMcpConfig failed:', e) }
  try { autoInstallSkill(context.extensionPath) } catch (e) { console.error('[Antigravity Task Kernel] autoInstallSkill failed:', e) }
  try { await autoInjectRoutingRules(settings) } catch (e) { console.error('[Antigravity Task Kernel] autoInjectRoutingRules failed:', e) }

  console.log('[Antigravity Task Kernel] Activation complete')
}

export function deactivateAntigravityRuntime() {
  statusBar?.dispose()
  workflowOrchestrator?.dispose()
}
