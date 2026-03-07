"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAceLanguageId = getAceLanguageId;
exports.nextRequestId = nextRequestId;
exports.sendAceRequest = sendAceRequest;
exports.registerAceResponseListeners = registerAceResponseListeners;
const path = __importStar(require("path"));
// ace-server 内部语言 ID 映射
// ace-server 使用 "deveco.apptool.*" 格式的语言 ID，而非标准的 "arkts"、"typescript" 等。
// isValidateFile() 守卫使用这些 ID 来验证文件类型，传入错误的 ID 会导致
// hover、definition 等功能被阻断。
const ACE_LANGUAGE_ID = {
    '.ets': 'deveco.apptool.ets',
    '.ts': 'deveco.apptool.ts',
    '.js': 'deveco.apptool.js',
    '.json': 'deveco.apptool.json',
    '.css': 'deveco.apptool.css',
    '.hml': 'deveco.apptool.hml',
};
/** 根据文件路径获取 ace-server 内部语言 ID */
function getAceLanguageId(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ACE_LANGUAGE_ID[ext] ?? 'deveco.apptool.unknown';
}
/** 通过 requestId 维护待处理的 Promise resolver */
const pendingRequests = new Map();
let requestIdCounter = 0;
function nextRequestId() {
    return `req-${++requestIdCounter}-${Date.now()}`;
}
/**
 * 发送 ace-server 自定义通知并等待响应。
 * ace-server 内部协议格式：{params: {...}, requestId: "..."}
 * 响应通过同名通知返回，包含 {requestId: "...", result: ...}
 */
function sendAceRequest(client, method, params, logFn, timeoutMs = 10000) {
    return new Promise((resolve) => {
        const requestId = nextRequestId();
        logFn(`→ ${method} [${requestId}]`);
        pendingRequests.set(requestId, resolve);
        client.sendNotification(method, {
            params,
            requestId,
        });
        setTimeout(() => {
            if (pendingRequests.get(requestId) === resolve) {
                pendingRequests.delete(requestId);
                logFn(`⏰ ${method} [${requestId}] 超时`);
                resolve(null);
            }
        }, timeoutMs);
    });
}
/**
 * 注册 ace-server 响应通知监听器。
 * ace-server worker 处理完后，main process 通过同名通知回发结果：
 *   sendNotification(method, {requestId, result, traceId})
 * 我们通过 requestId 匹配对应的 Promise resolver。
 */
function registerAceResponseListeners(client, logFn) {
    const methods = [
        'aceProject/onAsyncHover',
        'aceProject/onAsyncDefinition',
        'aceProject/onAsyncDocumentHighlight',
        'aceProject/onAsyncCompletion',
        'aceProject/onAsyncCompletionResolve',
        'aceProject/onAsyncSignatureHelp',
        'aceProject/onAsyncCodeAction',
        'aceProject/onAsyncDocumentLinks',
        'aceProject/onAsyncFindUsages',
        'aceProject/onAsyncImplementation',
        'aceProject/onAsyncPrepareRename',
        'aceProject/onAsyncRename',
    ];
    for (const method of methods) {
        client.onNotification(method, (data) => {
            const reqId = data?.requestId;
            logFn(`← ${method} [${reqId}] hasResult=${!!data?.result}`);
            if (reqId && pendingRequests.has(reqId)) {
                const resolver = pendingRequests.get(reqId);
                pendingRequests.delete(reqId);
                resolver(data?.result ?? data);
            }
        });
    }
}
//# sourceMappingURL=ace-protocol.js.map