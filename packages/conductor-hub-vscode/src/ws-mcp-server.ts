/**
 * Conductor Hub VS Code — WebSocket MCP Server
 *
 * 从 Conductor Hub ws-server.ts 重构迁移。
 * 在 VS Code 扩展进程内启动 WebSocket MCP Server，
 * 供 CLI bridge (cli.ts) 或其他 WebSocket 客户端连接。
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type JSONRPCMessage, CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { SettingsManager, Provider } from './settings-manager.js';
import type { IHistoryStorage, HistoryRecord } from './dashboard-panel.js';

/** WebSocket → MCP Transport 适配器 */
class WsTransport implements Transport {
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(private ws: any) {
        ws.on('message', (data: Buffer) => {
            try {
                this.onmessage?.(JSON.parse(data.toString('utf8')));
            } catch (e) {
                console.error('[Conductor Hub WS] parse error:', e);
            }
        });
        ws.on('close', () => this.onclose?.());
        ws.on('error', (err: Error) => this.onerror?.(err));
    }

    async start() {}
    async close() { this.ws.close(); }
    async send(message: JSONRPCMessage) { this.ws.send(JSON.stringify(message) + '\n'); }
}

export class ConductorWsMcpServer {
    private httpServer: http.Server;
    private wss: any; // WebSocketServer
    private portFile = path.join(os.homedir(), '.conductor-hub.port');

    constructor(
        private storage: IHistoryStorage | null,
        private settings: SettingsManager,
    ) {
        this.httpServer = http.createServer();
        // 延迟加载 ws (可能未安装)
        try {
            const { WebSocketServer } = require('ws');
            this.wss = new WebSocketServer({ server: this.httpServer });
            this._setupConnections();
        } catch {
            console.warn('[Conductor Hub] ws module not available, WebSocket MCP disabled');
        }
    }

    private _setupConnections() {
        this.wss.on('connection', (ws: any) => {
            const transport = new WsTransport(ws);
            const mcpServer = new Server(
                { name: 'conductor-hub', version: '0.2.0' },
                { capabilities: { tools: {} } },
            );

            mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
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

            mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
                const startTime = Date.now();
                try {
                    if (request.params.name === 'ai_ask') {
                        const args = request.params.arguments as { provider?: string; message: string; system_prompt?: string };
                        let provider = (args.provider || this.settings.getGeneralConfig().defaultModel) as Provider;

                        // 简易路由
                        if (!args.provider) {
                            const msg = args.message.toLowerCase();
                            if (msg.includes('架构') || msg.includes('architecture')) provider = 'glm' as Provider;
                            else if (msg.includes('翻译') || msg.includes('translate')) provider = 'qwen' as Provider;
                            else provider = 'deepseek' as Provider;
                        }

                        const apiKey = await this.settings.getApiKey(provider);
                        if (!apiKey) throw new Error(`API Key for ${provider} is not configured.`);

                        const result = await this._callProvider(provider, apiKey, args.message, args.system_prompt);
                        this._logTransaction('ai_ask', provider, startTime, result.inputTokens, result.outputTokens, 'success');
                        return { content: [{ type: 'text', text: result.text }], isError: false };
                    }
                    throw new Error(`Unknown tool: ${request.params.name}`);
                } catch (e: any) {
                    this._logTransaction('ai_ask', 'unknown', startTime, 0, 0, 'error', e.message);
                    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
                }
            });

            mcpServer.connect(transport);
        });
    }

    private async _callProvider(provider: string, apiKey: string, message: string, systemPrompt?: string) {
        const messages: any[] = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: message });

        const PROVIDER_URLS: Record<string, { url: string; model: string }> = {
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
        if (!res.ok) throw new Error(`API error from ${provider}: ${res.status}`);
        const data = await res.json() as any;
        return {
            text: data.choices?.[0]?.message?.content || 'No response',
            inputTokens: data.usage?.prompt_tokens || 0,
            outputTokens: data.usage?.completion_tokens || 0,
        };
    }

    private _logTransaction(tool: string, model: string, startTime: number, inputTokens: number, outputTokens: number, status: 'success' | 'error', errorMsg?: string) {
        if (!this.storage) return;
        try {
            const record: HistoryRecord = {
                id: Date.now().toString(), timestamp: startTime, clientName: 'VS Code WS', clientVersion: '1.0',
                method: 'tools/call', toolName: tool, model, duration: Date.now() - startTime,
                inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
                requestPreview: '', responsePreview: '', status, errorMessage: errorMsg,
            };
            // Use duck typing to call saveRecord
            (this.storage as any).saveRecord?.(record);
        } catch { /* non-critical */ }
    }

    public async start(): Promise<void> {
        if (!this.wss) return;
        return new Promise<void>(resolve => {
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

    public stop() {
        if (fs.existsSync(this.portFile)) fs.unlinkSync(this.portFile);
        this.wss?.close();
        this.httpServer.close();
    }
}
