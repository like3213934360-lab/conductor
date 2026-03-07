"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLanguageProviders = registerLanguageProviders;
const vscode_1 = require("vscode");
/**
 * 注册所有 VS Code 语言功能提供者。
 * 每个 provider 桥接 ace-server 的自定义通知协议。
 */
function registerLanguageProviders(context, sendRequest) {
    const selector = { language: 'arkts', scheme: 'file' };
    // Hover
    context.subscriptions.push(vscode_1.languages.registerHoverProvider(selector, {
        async provideHover(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncHover', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result)
                return null;
            const contents = result.contents;
            if (!contents)
                return null;
            // ace-server 对 ETS 文件返回特殊格式：
            // { kind: 'plaintext', value: JSON.stringify({ code: { language, value }, data: [...] }) }
            if (contents.kind === 'plaintext' && typeof contents.value === 'string') {
                try {
                    const parsed = JSON.parse(contents.value);
                    if (parsed.code) {
                        const mdParts = [];
                        const codeMd = new vscode_1.MarkdownString();
                        codeMd.appendCodeblock(parsed.code.value, parsed.code.language || 'typescript');
                        mdParts.push(codeMd);
                        if (parsed.data && Array.isArray(parsed.data)) {
                            for (const item of parsed.data) {
                                if (item.document) {
                                    mdParts.push(new vscode_1.MarkdownString(item.document));
                                }
                            }
                        }
                        const range = result.range
                            ? new vscode_1.Range(result.range.start.line, result.range.start.character, result.range.end.line, result.range.end.character)
                            : undefined;
                        return new vscode_1.Hover(mdParts, range);
                    }
                }
                catch {
                    return new vscode_1.Hover(new vscode_1.MarkdownString(contents.value));
                }
            }
            if (contents.kind === 'markdown') {
                return new vscode_1.Hover(new vscode_1.MarkdownString(contents.value));
            }
            if (typeof contents === 'string') {
                return new vscode_1.Hover(new vscode_1.MarkdownString(contents));
            }
            if (Array.isArray(contents)) {
                return new vscode_1.Hover(contents.map((c) => typeof c === 'string' ? new vscode_1.MarkdownString(c) : new vscode_1.MarkdownString(c.value)));
            }
            return new vscode_1.Hover(new vscode_1.MarkdownString(String(contents.value || contents)));
        },
    }));
    // Go to Definition
    context.subscriptions.push(vscode_1.languages.registerDefinitionProvider(selector, {
        async provideDefinition(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncDefinition', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result)
                return null;
            const locations = Array.isArray(result) ? result : [result];
            return locations
                .filter((loc) => loc && loc.uri)
                .map((loc) => new vscode_1.Location(vscode_1.Uri.parse(loc.uri), new vscode_1.Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character)));
        },
    }));
    // Document Highlight
    context.subscriptions.push(vscode_1.languages.registerDocumentHighlightProvider(selector, {
        async provideDocumentHighlights(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncDocumentHighlight', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result || !Array.isArray(result))
                return [];
            return result.map((h) => ({
                range: new vscode_1.Range(h.range.start.line, h.range.start.character, h.range.end.line, h.range.end.character),
                kind: h.kind,
            }));
        },
    }));
    // Find References
    context.subscriptions.push(vscode_1.languages.registerReferenceProvider(selector, {
        async provideReferences(doc, pos, _ctx, _token) {
            const result = await sendRequest('aceProject/onAsyncFindUsages', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result || !Array.isArray(result))
                return [];
            return result
                .filter((loc) => loc && loc.uri)
                .map((loc) => new vscode_1.Location(vscode_1.Uri.parse(loc.uri), new vscode_1.Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character)));
        },
    }));
    // Go to Implementation
    context.subscriptions.push(vscode_1.languages.registerImplementationProvider(selector, {
        async provideImplementation(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncImplementation', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result)
                return null;
            const locations = Array.isArray(result) ? result : [result];
            return locations
                .filter((loc) => loc && loc.uri)
                .map((loc) => new vscode_1.Location(vscode_1.Uri.parse(loc.uri), new vscode_1.Range(loc.range.start.line, loc.range.start.character, loc.range.end.line, loc.range.end.character)));
        },
    }));
    // Completion
    context.subscriptions.push(vscode_1.languages.registerCompletionItemProvider(selector, {
        async provideCompletionItems(doc, pos, _token, ctx) {
            const result = await sendRequest('aceProject/onAsyncCompletion', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
                context: {
                    triggerKind: ctx.triggerKind + 1,
                    triggerCharacter: ctx.triggerCharacter,
                },
            });
            if (!result)
                return null;
            const items = result.items || result;
            if (!Array.isArray(items))
                return null;
            return new vscode_1.CompletionList(items.map((item) => {
                const ci = new vscode_1.CompletionItem(item.label, item.kind ?? vscode_1.CompletionItemKind.Text);
                if (item.detail)
                    ci.detail = item.detail;
                if (item.documentation) {
                    ci.documentation = typeof item.documentation === 'string'
                        ? new vscode_1.MarkdownString(item.documentation)
                        : new vscode_1.MarkdownString(item.documentation?.value ?? '');
                }
                if (item.insertText)
                    ci.insertText = item.insertText;
                if (item.filterText)
                    ci.filterText = item.filterText;
                if (item.sortText)
                    ci.sortText = item.sortText;
                if (item.data)
                    ci.command = { title: '', command: 'arkts.completionResolve', arguments: [item] };
                return ci;
            }), result.isIncomplete ?? false);
        },
    }, '.', ':', '<', '>', '"', "'", '/', '@', '*', '{'));
    // Signature Help
    context.subscriptions.push(vscode_1.languages.registerSignatureHelpProvider(selector, {
        async provideSignatureHelp(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncSignatureHelp', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result || !result.signatures || result.signatures.length === 0)
                return null;
            const help = new vscode_1.SignatureHelp();
            help.activeSignature = result.activeSignature ?? 0;
            help.activeParameter = result.activeParameter ?? 0;
            help.signatures = result.signatures.map((sig) => {
                const info = new vscode_1.SignatureInformation(sig.label, sig.documentation);
                info.parameters = (sig.parameters || []).map((p) => new vscode_1.ParameterInformation(p.label, p.documentation));
                return info;
            });
            return help;
        },
    }, '(', ','));
    // Code Action
    context.subscriptions.push(vscode_1.languages.registerCodeActionsProvider(selector, {
        async provideCodeActions(doc, range, _ctx, _token) {
            const result = await sendRequest('aceProject/onAsyncCodeAction', {
                textDocument: { uri: doc.uri.toString() },
                range: {
                    start: { line: range.start.line, character: range.start.character },
                    end: { line: range.end.line, character: range.end.character },
                },
            });
            if (!result || !Array.isArray(result))
                return [];
            return result.map((action) => {
                const ca = new vscode_1.CodeAction(action.title, action.kind ? vscode_1.CodeActionKind.QuickFix : undefined);
                if (action.edit && action.edit.changes) {
                    const we = new vscode_1.WorkspaceEdit();
                    for (const [uri, edits] of Object.entries(action.edit.changes)) {
                        we.set(vscode_1.Uri.parse(uri), edits.map((e) => new vscode_1.TextEdit(new vscode_1.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)));
                    }
                    ca.edit = we;
                }
                return ca;
            });
        },
    }));
    // Document Links
    context.subscriptions.push(vscode_1.languages.registerDocumentLinkProvider(selector, {
        async provideDocumentLinks(doc, _token) {
            const result = await sendRequest('aceProject/onAsyncDocumentLinks', {
                textDocument: { uri: doc.uri.toString() },
            });
            if (!result || !Array.isArray(result))
                return [];
            return result.map((link) => new vscode_1.DocumentLink(new vscode_1.Range(link.range.start.line, link.range.start.character, link.range.end.line, link.range.end.character), link.target ? vscode_1.Uri.parse(link.target) : undefined));
        },
    }));
    // Rename
    context.subscriptions.push(vscode_1.languages.registerRenameProvider(selector, {
        async prepareRename(doc, pos, _token) {
            const result = await sendRequest('aceProject/onAsyncPrepareRename', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
            });
            if (!result || !result.canRename)
                return null;
            if (result.range) {
                return new vscode_1.Range(result.range.start.line, result.range.start.character, result.range.end.line, result.range.end.character);
            }
            return null;
        },
        async provideRenameEdits(doc, pos, newName, _token) {
            const result = await sendRequest('aceProject/onAsyncRename', {
                textDocument: { uri: doc.uri.toString() },
                position: { line: pos.line, character: pos.character },
                newName,
            });
            if (!result || !result.changes)
                return null;
            const we = new vscode_1.WorkspaceEdit();
            for (const [uri, edits] of Object.entries(result.changes)) {
                we.set(vscode_1.Uri.parse(uri), edits.map((e) => new vscode_1.TextEdit(new vscode_1.Range(e.range.start.line, e.range.start.character, e.range.end.line, e.range.end.character), e.newText)));
            }
            return we;
        },
    }));
}
//# sourceMappingURL=language-providers.js.map