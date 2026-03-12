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
  Disposable,
} from 'vscode'

type AceRequestFn = (method: string, params: any, timeoutMs?: number) => Promise<any>

export function registerLanguageProviders(
  sendRequest: AceRequestFn,
): Disposable[] {
  const selector = { language: 'arkts', scheme: 'file' }
  const disposables: Disposable[] = []

  disposables.push(
    languages.registerHoverProvider(selector, {
      async provideHover(doc: TextDocument, pos: Position, _token: CancellationToken): Promise<Hover | null> {
        const result = await sendRequest('aceProject/onAsyncHover', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result) return null
        const contents = result.contents
        if (!contents) return null
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
          return new Hover(contents.map((entry: any) =>
            typeof entry === 'string' ? new MarkdownString(entry) : new MarkdownString(entry.value),
          ))
        }
        return new Hover(new MarkdownString(String(contents.value || contents)))
      },
    }),
  )

  disposables.push(
    languages.registerDefinitionProvider(selector, {
      async provideDefinition(doc: TextDocument, pos: Position) {
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

  disposables.push(
    languages.registerDocumentHighlightProvider(selector, {
      async provideDocumentHighlights(doc: TextDocument, pos: Position) {
        const result = await sendRequest('aceProject/onAsyncDocumentHighlight', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((item: any) => ({
          range: new Range(item.range.start.line, item.range.start.character, item.range.end.line, item.range.end.character),
          kind: item.kind,
        }))
      },
    }),
  )

  disposables.push(
    languages.registerReferenceProvider(selector, {
      async provideReferences(doc: TextDocument, pos: Position) {
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

  disposables.push(
    languages.registerImplementationProvider(selector, {
      async provideImplementation(doc: TextDocument, pos: Position) {
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

  disposables.push(
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
            const completion = new CompletionItem(item.label, item.kind ?? CompletionItemKind.Text)
            if (item.detail) completion.detail = item.detail
            if (item.documentation) {
              completion.documentation = typeof item.documentation === 'string'
                ? new MarkdownString(item.documentation)
                : new MarkdownString(item.documentation?.value ?? '')
            }
            if (item.insertText) completion.insertText = item.insertText
            if (item.filterText) completion.filterText = item.filterText
            if (item.sortText) completion.sortText = item.sortText
            if (item.data) completion.command = { title: '', command: 'arkts.completionResolve', arguments: [item] }
            return completion
          }),
          result.isIncomplete ?? false,
        )
      },
    }, '.', ':', '<', '>', '"', "'", '/', '@', '*', '{'),
  )

  disposables.push(
    languages.registerSignatureHelpProvider(selector, {
      async provideSignatureHelp(doc: TextDocument, pos: Position) {
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
          info.parameters = (sig.parameters || []).map((parameter: any) =>
            new ParameterInformation(parameter.label, parameter.documentation),
          )
          return info
        })
        return help
      },
    }, '(', ','),
  )

  disposables.push(
    languages.registerCodeActionsProvider(selector, {
      async provideCodeActions(doc: TextDocument, range: Range) {
        const result = await sendRequest('aceProject/onAsyncCodeAction', {
          textDocument: { uri: doc.uri.toString() },
          range: {
            start: { line: range.start.line, character: range.start.character },
            end: { line: range.end.line, character: range.end.character },
          },
        })
        if (!result || !Array.isArray(result)) return []
        return result.map((action: any) => {
          const codeAction = new CodeAction(action.title, action.kind ? CodeActionKind.QuickFix : undefined)
          if (action.edit && action.edit.changes) {
            const edit = new WorkspaceEdit()
            for (const [uri, edits] of Object.entries(action.edit.changes as Record<string, any[]>)) {
              edit.set(Uri.parse(uri), edits.map((entry: any) => new TextEdit(
                new Range(entry.range.start.line, entry.range.start.character, entry.range.end.line, entry.range.end.character),
                entry.newText,
              )))
            }
            codeAction.edit = edit
          }
          return codeAction
        })
      },
    }),
  )

  disposables.push(
    languages.registerDocumentLinkProvider(selector, {
      async provideDocumentLinks(doc: TextDocument) {
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

  disposables.push(
    languages.registerRenameProvider(selector, {
      async prepareRename(doc: TextDocument, pos: Position) {
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
      async provideRenameEdits(doc: TextDocument, pos: Position, newName: string) {
        const result = await sendRequest('aceProject/onAsyncRename', {
          textDocument: { uri: doc.uri.toString() },
          position: { line: pos.line, character: pos.character },
          newName,
        })
        if (!result || !result.changes) return null
        const edit = new WorkspaceEdit()
        for (const [uri, edits] of Object.entries(result.changes as Record<string, any[]>)) {
          edit.set(Uri.parse(uri), edits.map((entry: any) => new TextEdit(
            new Range(entry.range.start.line, entry.range.start.character, entry.range.end.line, entry.range.end.character),
            entry.newText,
          )))
        }
        return edit
      },
    }),
  )

  return disposables
}
