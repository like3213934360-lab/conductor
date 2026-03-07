import { DiagnosticCollection } from 'vscode';
export type LogFn = (msg: string) => void;
/**
 * 诊断累积器
 * ace-server 分多个验证波次发送 publishDiagnostics（Resource/Ets/Ts），
 * 每波会替换该 URI 的全部诊断。后续空波会覆盖前面的有效诊断。
 * 解决方案：拦截 publishDiagnostics，累积所有波次的诊断，
 * 用防抖延迟合并后推送给 VS Code。
 */
export declare class DiagnosticsAccumulator {
    private readonly collection;
    private readonly accumulator;
    private readonly timers;
    private readonly logFn;
    constructor(logFn: LogFn);
    /** 累积一个波次的诊断 */
    accumulate(uri: string, diagnostics: any[]): void;
    /** 清除指定 URI 的旧诊断波次（文件变更时调用） */
    clear(uri: string): void;
    /** 处理 ace 自定义诊断通知（raw LSP → VS Code Diagnostic） */
    handleAceDiagnostic(data: any): void;
    get diagnosticCollection(): DiagnosticCollection;
    private pushMerged;
}
//# sourceMappingURL=diagnostics.d.ts.map