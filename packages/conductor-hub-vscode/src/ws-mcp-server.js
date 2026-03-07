"use strict";
/**
 * Conductor Hub VS Code — WebSocket MCP Server
 *
 * 从 Conductor Hub ws-server.ts 重构迁移。
 * 在 VS Code 扩展进程内启动 WebSocket MCP Server，
 * 供 CLI bridge (cli.ts) 或其他 WebSocket 客户端连接。
 */
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
exports.ConductorWsMcpServer = void 0;
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
/** WebSocket → MCP Transport 适配器 */
class WsTransport {
    constructor(ws) {
        this.ws = ws;
        ws.on('message', (data) => {
            try {
                this.onmessage?.(JSON.parse(data.toString('utf8')));
            }
            catch (e) {
                console.error('[Conductor Hub WS] parse error:', e);
            }
        });
        ws.on('close', () => this.onclose?.());
        ws.on('error', (err) => this.onerror?.(err));
    }
    async start() { }
    async close() { this.ws.close(); }
    async send(message) { this.ws.send(JSON.stringify(message) + '\n'); }
}
class ConductorWsMcpServer {
    constructor(storage, settings) {
        this.storage = storage;
        this.settings = settings;
        this.portFile = path.join(os.homedir(), '.conductor-hub.port');
        this.httpServer = http.createServer();
        // 延迟加载 ws (可能未安装)
        try {
            const { WebSocketServer } = require('ws');
            this.wss = new WebSocketServer({ server: this.httpServer });
            this._setupConnections();
        }
        catch {
            console.warn('[Conductor Hub] ws module not available, WebSocket MCP disabled');
        }
    }
    _setupConnections() {
        this.wss.on('connection', (ws) => {
            const transport = new WsTransport(ws);
            const mcpServer = new index_js_1.Server({ name: 'conductor-hub', version: '0.2.0' }, { capabilities: { tools: {} } });
            mcpServer.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
                tools: [{
                        name: 'ai_ask',
                        description: 'Ask a single question to an AI provider via WebSocket bridge.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                provider: { type: 'string', description: 'AI provider to use' },
                                message: { type: 'string', description: 'The question' },
                                system_prompt: { type: 'string', description: 'Optional system instructions' },
                            },
                            required: ['message'],
                        },
                    }],
            }));
            mcpServer.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
                const startTime = Date.now();
                try {
                    if (request.params.name === 'ai_ask') {
                        const args = request.params.arguments;
                        let provider = (args.provider || this.settings.getGeneralConfig().defaultModel);
                        // 简易路由
                        if (!args.provider) {
                            const msg = args.message.toLowerCase();
                            if (msg.includes('架构') || msg.includes('architecture'))
                                provider = 'glm';
                            else if (msg.includes('翻译') || msg.includes('translate'))
                                provider = 'qwen';
                            else
                                provider = 'deepseek';
                        }
                        const apiKey = await this.settings.getApiKey(provider);
                        if (!apiKey)
                            throw new Error(`API Key for ${provider} is not configured.`);
                        const result = await this._callProvider(provider, apiKey, args.message, args.system_prompt);
                        this._logTransaction('ai_ask', provider, startTime, result.inputTokens, result.outputTokens, 'success');
                        return { content: [{ type: 'text', text: result.text }], isError: false };
                    }
                    throw new Error(`Unknown tool: ${request.params.name}`);
                }
                catch (e) {
                    this._logTransaction('ai_ask', 'unknown', startTime, 0, 0, 'error', e.message);
                    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
                }
            });
            mcpServer.connect(transport);
        });
    }
    async _callProvider(provider, apiKey, message, systemPrompt) {
        const messages = [];
        if (systemPrompt)
            messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: message });
        const PROVIDER_URLS = {
            deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
            glm: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4' },
            qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-max' },
            minimax: { url: 'https://api.minimax.chat/v1/text/chatcompletion_v2', model: 'abab6.5-chat' },
        };
        const { url, model } = PROVIDER_URLS[provider] || PROVIDER_URLS['deepseek'];
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, temperature: 0.7 }),
        });
        if (!res.ok)
            throw new Error(`API error from ${provider}: ${res.status}`);
        const data = await res.json();
        return {
            text: data.choices?.[0]?.message?.content || 'No response',
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
        };
    }
    _logTransaction(tool, model, startTime, inputTokens, outputTokens, status, errorMsg) {
        if (!this.storage)
            return;
        try {
            const record = {
                id: Date.now().toString(), timestamp: startTime, clientName: 'VS Code WS', clientVersion: '1.0',
                method: 'tools/call', toolName: tool, model, duration: Date.now() - startTime,
                inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
                requestPreview: '', responsePreview: '', status, errorMessage: errorMsg,
            };
            // Use duck typing to call saveRecord
            this.storage.saveRecord?.(record);
        }
        catch { /* non-critical */ }
    }
    async start() {
        if (!this.wss)
            return;
        return new Promise(resolve => {
            this.httpServer.listen(0, '127.0.0.1', () => {
                const addr = this.httpServer.address();
                if (addr && typeof addr !== 'string') {
                    fs.writeFileSync(this.portFile, addr.port.toString(), 'utf8');
                    console.log(`[Conductor Hub] WS MCP on port ${addr.port}`);
                }
                resolve();
            });
        });
    }
    stop() {
        if (fs.existsSync(this.portFile))
            fs.unlinkSync(this.portFile);
        this.wss?.close();
        this.httpServer.close();
    }
}
exports.ConductorWsMcpServer = ConductorWsMcpServer;
//# sourceMappingURL=ws-mcp-server.js.map