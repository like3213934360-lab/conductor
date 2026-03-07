import {
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
  ExtensionContext,
} from 'vscode'
import type { LanguageClient } from 'vscode-languageclient/node'

type AceRequestFn = (method: string, params: any, timeoutMs?: number) => Promise<any>

/**
 * 注册所有 VS Code 语言功能提供者。
 * 每个 provider 桥接 ace-server 的自定义通知协议。
 */
export function registerLanguageProviders(
  context: ExtensionContext,
  sendRequest: AceRequestFn,
): void {
  const selector = { language: 'arkts', scheme: 'file' }

  // Hover
  context.subscriptions.push(
    languages.registerHoverProvider(selector, {
      async provideHover(doc: TextDocument, pos: Position, _token: CancellationToken): Promise<Hover | null> {
        const result = await sendRequest('aceProject/onAsyncHover', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const contents = result.contents
        if (!contents) return null

        // ace-server 对 ETS 文件返回特殊格式：
        // { kind: 'plaintext', value: JSON.stringify({ code: { language, value }, data: [...] }) }
        if (contents.kind === 'plaintext' && typeof contents.value === 'string') {
          try {
            const parsed = JSON.parse(contents.value)
            if (parsed.code) {
              const mdParts: MarkdownString[] = []
              const codeMd = new MarkdownString()
              codeMd.appendCodeblock(parsed.code.value, parsed.code.language || 'typescript')
              mdParts.push(codeMd)
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
            return new Hover(new MarkdownString(contents.value))
          }
        }
        if (contents.kind === 'markdown') {
          return new Hover(new MarkdownString(contents.value))
        }
        if (typeof contents === 'string') {
          return new Hover(new MarkdownString(contents))
        }
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
        const result = await sendRequest('aceProject/onAsyncDefinition', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const locations = Array.isArray(result) ? result : [result]
        return locations
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character),
          ))
      },
    }),
  )

  // Document Highlight
  context.subscriptions.push(
    languages.registerDocumentHighlightProvider(selector, {
      async provideDocumentHighlights(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncDocumentHighlight', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((h: any) => ({
          range: new Range(h.range.start.line, h.range.start.character, h.range.end.line, h.range.end.character),
          kind: h.kind,
        }))
      },
    }),
  )

  // Find References
  context.subscriptions.push(
    languages.registerReferenceProvider(selector, {
      async provideReferences(doc: TextDocument, pos: Position, _ctx, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncFindUsages', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !Array.isArray(result)) return []
        return result
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character),
          ))
      },
    }),
  )

  // Go to Implementation
  context.subscriptions.push(
    languages.registerImplementationProvider(selector, {
      async provideImplementation(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncImplementation', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const locations = Array.isArray(result) ? result : [result]
        return locations
          .filter((loc: any) => loc && loc.uri)
          .map((loc: any) => new Location(
            Uri.parse(loc.uri),
            new Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character),
          ))
      },
    }),
  )

  // Completion
  context.subscriptions.push(
    languages.registerCompletionItemProvider(selector, {
      async provideCompletionItems(doc: TextDocument, pos: Position, _token: CancellationToken, ctx: CompletionContext) {
        const result = await sendRequest('aceProject/onAsyncCompletion', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
          context: {
            triggerKind: ctx.triggerKind + 1,
            triggerCharacter: ctx.triggerCharacter,
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

  // Signature Help
  context.subscriptions.push(
    languages.registerSignatureHelpProvider(selector, {
      async provideSignatureHelp(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncSignatureHelp', {
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

  // Code Action
  context.subscriptions.push(
    languages.registerCodeActionsProvider(selector, {
      async provideCodeActions(doc: TextDocument, range: Range, _ctx, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncCodeAction', {
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
        const result = await sendRequest('aceProject/onAsyncDocumentLinks', {
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

  // Rename
  context.subscriptions.push(
    languages.registerRenameProvider(selector, {
      async prepareRename(doc: TextDocument, pos: Position, _token: CancellationToken) {
        const result = await sendRequest('aceProject/onAsyncPrepareRename', {
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
        const result = await sendRequest('aceProject/onAsyncRename', {
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
