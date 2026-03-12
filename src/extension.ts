import {
  ExtensionContext,
} from 'vscode'
import {
  activateAntigravityHost,
  deactivateAntigravityHost,
} from '@anthropic/antigravity-vscode'

// ── 插件激活 ────────────────────────────────────────────────────────────────

export async function activate(context: ExtensionContext): Promise<void> {
  await activateAntigravityHost(context)
}

export function deactivate(): Thenable<void> | undefined {
  deactivateAntigravityHost()
  return undefined
}
