/**
 * Conductor Hub VS Code — 设置管理器
 *
 * 从 Conductor Hub settings.ts 直接迁移。
 * 管理 VS Code SecretStorage 中的 API Key 和 v2 ModelConfig。
 */
import type * as vscode from 'vscode';
export interface BridgeConfig {
    defaultModel: string;
    retentionDays: number;
}
export declare const SUPPORTED_PROVIDERS: readonly ["deepseek", "glm", "qwen", "minimax", "kimi", "gpt", "gemini", "mistral"];
export type Provider = typeof SUPPORTED_PROVIDERS[number];
export interface ModelConfig {
    id: string;
    modelId: string;
    label: string;
    baseUrl: string;
    tasks: string[];
    enabled: boolean;
    priority: number;
}
export declare class SettingsManager {
    private context;
    private secretStorage;
    private static readonly MODELS_KEY;
    constructor(context: vscode.ExtensionContext);
    saveApiKey(provider: string, apiKey: string): Promise<void>;
    getApiKey(provider: string): Promise<string | undefined>;
    getAllApiKeys(): Promise<Record<string, string>>;
    getModelApiKey(modelConfigId: string): Promise<string | undefined>;
    getModels(): Promise<ModelConfig[]>;
    saveModels(models: ModelConfig[]): Promise<void>;
    addModel(model: ModelConfig): Promise<void>;
    updateModel(id: string, patch: Partial<ModelConfig>): Promise<void>;
    removeModel(id: string): Promise<void>;
    getGeneralConfig(): BridgeConfig;
}
//# sourceMappingURL=settings-manager.d.ts.map