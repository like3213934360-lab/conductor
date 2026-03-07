"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
const deveco_detector_1 = require("../../ace-bridge/src/deveco-detector");
const project_parser_1 = require("../../ace-bridge/src/project-parser");
const module_builder_1 = require("../../ace-bridge/src/module-builder");
const ace_launcher_1 = require("../../ace-bridge/src/ace-launcher");
const ace_protocol_1 = require("./ace-protocol");
const language_providers_1 = require("./language-providers");
const deveco_theme_1 = require("./deveco-theme");
const diagnostics_1 = require("./diagnostics");
let client;
let currentLaunch;
// ── 调试日志 ────────────────────────────────────────────────────────────────
let debugChannel;
function log(msg) {
    if (!debugChannel) {
        debugChannel = vscode_1.window.createOutputChannel('ArkTS Bridge Debug');
    }
    debugChannel.appendLine(`[${new Date().toISOString()}] ${msg}`);
}
// ── 插件激活 ────────────────────────────────────────────────────────────────
function activate(context) {
    log('ArkTS 插件激活开始');
    (0, deveco_theme_1.applyDevEcoColors)();
    context.subscriptions.push(vscode_1.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('workbench.colorTheme')) {
            (0, deveco_theme_1.applyDevEcoColors)();
        }
    }));
    // 状态栏
    const statusBar = vscode_1.window.createStatusBarItem(vscode_1.StatusBarAlignment.Right, 100);
    statusBar.text = '$(loading~spin) ArkTS';
    statusBar.tooltip = 'ArkTS Language Server 正在初始化...';
    statusBar.show();
    context.subscriptions.push(statusBar);
    // 检测 DevEco
    const config = vscode_1.workspace.getConfiguration('arkts');
    const customDevEcoPath = config.get('deveco.path', '');
    const env = (0, deveco_detector_1.detectDevEco)(customDevEcoPath || undefined);
    if (!env) {
        statusBar.text = '$(error) ArkTS';
        statusBar.tooltip = '未找到 DevEco Studio';
        vscode_1.window.showErrorMessage('未找到 DevEco Studio 安装。\n\n' +
            '请安装 DevEco Studio 或在设置中配置 arkts.deveco.path。');
        return;
    }
    // 解析项目
    const workspaceRoot = vscode_1.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        statusBar.text = '$(warning) ArkTS';
        statusBar.tooltip = '未打开工作区';
        return;
    }
    let initOptions;
    try {
        const project = (0, project_parser_1.parseProject)(workspaceRoot);
        initOptions = (0, module_builder_1.buildInitializationOptions)(project, env);
    }
    catch (err) {
        statusBar.text = '$(error) ArkTS';
        statusBar.tooltip = `项目解析失败: ${err.message}`;
        vscode_1.window.showErrorMessage(`ArkTS 项目解析失败: ${err.message}`);
        return;
    }
    // 启动 ace-server
    const launch = (0, ace_launcher_1.launchAceServer)({ env });
    currentLaunch = launch;
    const serverProcess = launch.process;
    const serverOptions = () => {
        return Promise.resolve({
            reader: serverProcess.stdout,
            writer: serverProcess.stdin,
        });
    };
    function getEditorFiles() {
        return vscode_1.workspace.textDocuments
            .filter((d) => d.languageId === 'arkts' || d.fileName.endsWith('.ets'))
            .map((d) => d.uri.fsPath);
    }
    // 诊断累积器
    const diagAccumulator = new diagnostics_1.DiagnosticsAccumulator(log);
    const clientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'arkts' },
            { scheme: 'file', pattern: '**/*.ets' },
        ],
        synchronize: {
            fileEvents: vscode_1.workspace.createFileSystemWatcher('**/*.ets'),
        },
        initializationOptions: initOptions,
        outputChannelName: 'ArkTS Language Server (ace-server)',
        middleware: {
            didOpen: async (doc, next) => {
                await next(doc);
                const uri = doc.uri.toString();
                client.sendNotification('aceProject/onAsyncDidOpen', {
                    params: {
                        textDocument: {
                            uri,
                            languageId: (0, ace_protocol_1.getAceLanguageId)(uri),
                            version: doc.version,
                            text: doc.getText(),
                        },
                    },
                    requestId: (0, ace_protocol_1.nextRequestId)(),
                    editorFiles: getEditorFiles(),
                });
            },
            didChange: async (e, next) => {
                await next(e);
                const changeUri = e.document.uri.toString();
                diagAccumulator.clear(changeUri);
                client.sendNotification('aceProject/onAsyncDidChange', {
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
                    requestId: (0, ace_protocol_1.nextRequestId)(),
                    editorFiles: getEditorFiles(),
                });
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
            provideFoldingRanges: () => Promise.resolve(undefined),
            provideDocumentColors: () => Promise.resolve([]),
            handleDiagnostics: (uri, diagnostics, _next) => {
                const uriStr = uri.toString();
                log(`handleDiagnostics: ${uriStr.split('/').pop()} → ${diagnostics.length} 条`);
                diagAccumulator.accumulate(uriStr, diagnostics);
            },
        },
    };
    client = new node_1.LanguageClient('arkts-lsp', 'ArkTS Language Server', serverOptions, clientOptions);
    client.start().then(() => {
        statusBar.text = '$(check) ArkTS';
        statusBar.tooltip = 'ArkTS Language Server 已就绪';
        log('LanguageClient 已启动');
        client.sendNotification('initialized', { editors: [] });
        // 注册 ace-server 响应监听
        (0, ace_protocol_1.registerAceResponseListeners)(client, log);
        // 注册语言提供者（通过闭包绑定 client + log）
        const boundSendRequest = (method, params, timeoutMs) => (0, ace_protocol_1.sendAceRequest)(client, method, params, log, timeoutMs);
        (0, language_providers_1.registerLanguageProviders)(context, boundSendRequest);
        // 索引进度
        client.onNotification('aceProject/onIndexingProgressUpdate', (params) => {
            if (params && typeof params.progress === 'number') {
                const pct = Math.round(params.progress * 100);
                statusBar.text = `$(sync~spin) ArkTS ${pct}%`;
                statusBar.tooltip = `ArkTS 索引中... ${pct}%`;
                if (pct >= 100) {
                    statusBar.text = '$(check) ArkTS';
                    statusBar.tooltip = 'ArkTS Language Server 已就绪';
                }
            }
        });
        // ace 自定义诊断
        client.onNotification('aceProject/doValidateDocument', (data) => {
            log(`ace 诊断通知: ${JSON.stringify(data).substring(0, 200)}`);
            diagAccumulator.handleAceDiagnostic(data);
        });
    }, (err) => {
        statusBar.text = '$(error) ArkTS';
        statusBar.tooltip = `ArkTS LSP 启动失败: ${err.message}`;
        vscode_1.window.showErrorMessage(`ArkTS LSP 启动失败: ${err.message}\n\n` +
            '请确认 DevEco Studio 已正确安装。');
    });
    // ace-server 崩溃自动重启一次
    let hasRestarted = false;
    serverProcess.on('exit', (code) => {
        if (code !== 0 && !hasRestarted) {
            hasRestarted = true;
            statusBar.text = '$(sync~spin) ArkTS';
            statusBar.tooltip = 'ace-server 崩溃，正在重启...';
            if (client) {
                client.stop().then(() => {
                    activate(context);
                });
            }
        }
    });
    context.subscriptions.push({
        dispose: () => {
            if (currentLaunch) {
                currentLaunch.kill();
            }
            if (client) {
                client.stop();
            }
        },
    });
}
function deactivate() {
    if (!client)
        return undefined;
    return client.stop();
}
//# sourceMappingURL=extension.js.map