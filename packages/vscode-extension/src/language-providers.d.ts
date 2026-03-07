import { ExtensionContext } from 'vscode';
type AceRequestFn = (method: string, params: any, timeoutMs?: number) => Promise<any>;
/**
 * 注册所有 VS Code 语言功能提供者。
 * 每个 provider 桥接 ace-server 的自定义通知协议。
 */
export declare function registerLanguageProviders(context: ExtensionContext, sendRequest: AceRequestFn): void;
export {};
//# sourceMappingURL=language-providers.d.ts.map