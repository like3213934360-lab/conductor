import type { LanguageClient } from 'vscode-languageclient/node';
/** 根据文件路径获取 ace-server 内部语言 ID */
export declare function getAceLanguageId(filePath: string): string;
export declare function nextRequestId(): string;
/**
 * 发送 ace-server 自定义通知并等待响应。
 * ace-server 内部协议格式：{params: {...}, requestId: "..."}
 * 响应通过同名通知返回，包含 {requestId: "...", result: ...}
 */
export declare function sendAceRequest(client: LanguageClient, method: string, params: any, logFn: (msg: string) => void, timeoutMs?: number): Promise<any>;
/**
 * 注册 ace-server 响应通知监听器。
 * ace-server worker 处理完后，main process 通过同名通知回发结果：
 *   sendNotification(method, {requestId, result, traceId})
 * 我们通过 requestId 匹配对应的 Promise resolver。
 */
export declare function registerAceResponseListeners(client: LanguageClient, logFn: (msg: string) => void): void;
//# sourceMappingURL=ace-protocol.d.ts.map