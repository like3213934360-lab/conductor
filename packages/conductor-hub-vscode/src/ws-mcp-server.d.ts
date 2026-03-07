/**
 * Conductor Hub VS Code — WebSocket MCP Server
 *
 * 从 Conductor Hub ws-server.ts 重构迁移。
 * 在 VS Code 扩展进程内启动 WebSocket MCP Server，
 * 供 CLI bridge (cli.ts) 或其他 WebSocket 客户端连接。
 */
import type { SettingsManager } from './settings-manager.js';
import type { IHistoryStorage } from './dashboard-panel.js';
export declare class ConductorWsMcpServer {
    private storage;
    private settings;
    private httpServer;
    private wss;
    private portFile;
    constructor(storage: IHistoryStorage | null, settings: SettingsManager);
    private _setupConnections;
    private _callProvider;
    private _logTransaction;
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=ws-mcp-server.d.ts.map