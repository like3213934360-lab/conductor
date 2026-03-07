"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticsAccumulator = void 0;
const vscode_1 = require("vscode");
/**
 * 诊断累积器
 * ace-server 分多个验证波次发送 publishDiagnostics（Resource/Ets/Ts），
 * 每波会替换该 URI 的全部诊断。后续空波会覆盖前面的有效诊断。
 * 解决方案：拦截 publishDiagnostics，累积所有波次的诊断，
 * 用防抖延迟合并后推送给 VS Code。
 */
class DiagnosticsAccumulator {
    constructor(logFn) {
        this.accumulator = new Map();
        this.timers = new Map();
        this.collection = vscode_1.languages.createDiagnosticCollection('arkts');
        this.logFn = logFn;
    }
    /** 累积一个波次的诊断 */
    accumulate(uri, diagnostics) {
        const waveKey = `wave-${Date.now()}-${Math.random()}`;
        if (!this.accumulator.has(uri)) {
            this.accumulator.set(uri, new Map());
        }
        const uriMap = this.accumulator.get(uri);
        if (diagnostics.length > 0) {
            uriMap.set(waveKey, diagnostics);
        }
        // 防抖合并
        if (this.timers.has(uri)) {
            clearTimeout(this.timers.get(uri));
        }
        this.timers.set(uri, setTimeout(() => {
            this.pushMerged(uri);
            this.timers.delete(uri);
        }, 500));
    }
    /** 清除指定 URI 的旧诊断波次（文件变更时调用） */
    clear(uri) {
        this.accumulator.delete(uri);
    }
    /** 处理 ace 自定义诊断通知（raw LSP → VS Code Diagnostic） */
    handleAceDiagnostic(data) {
        if (data?.result?.uri && data?.result?.diagnostics?.length > 0) {
            const vsDiags = data.result.diagnostics.map((d) => {
                const range = new vscode_1.Range(d.range?.start?.line ?? 0, d.range?.start?.character ?? 0, d.range?.end?.line ?? 0, d.range?.end?.character ?? 0);
                const severity = d.severity === 1 ? vscode_1.DiagnosticSeverity.Error
                    : d.severity === 2 ? vscode_1.DiagnosticSeverity.Warning
                        : d.severity === 3 ? vscode_1.DiagnosticSeverity.Information
                            : vscode_1.DiagnosticSeverity.Hint;
                const diag = new vscode_1.Diagnostic(range, d.message || '', severity);
                if (d.source)
                    diag.source = d.source;
                if (d.code !== undefined)
                    diag.code = d.code;
                return diag;
            });
            this.accumulate(data.result.uri, vsDiags);
        }
    }
    get diagnosticCollection() {
        return this.collection;
    }
    pushMerged(uri) {
        const uriMap = this.accumulator.get(uri);
        if (!uriMap)
            return;
        const merged = [];
        for (const diags of uriMap.values()) {
            merged.push(...diags);
        }
        // 去重（基于行号+消息）
        const seen = new Set();
        const unique = merged.filter(d => {
            const startLine = d.range?.start?.line ?? 0;
            const startChar = d.range?.start?.character ?? 0;
            const key = `${startLine}:${startChar}:${d.message}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        this.collection.set(vscode_1.Uri.parse(uri), unique);
        this.logFn(`诊断推送: ${uri.split('/').pop()} → ${unique.length} 条`);
    }
}
exports.DiagnosticsAccumulator = DiagnosticsAccumulator;
//# sourceMappingURL=diagnostics.js.map