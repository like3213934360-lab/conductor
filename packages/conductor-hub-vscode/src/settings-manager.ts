/**
 * Conductor Hub VS Code — 设置管理器
 *
 * 从 Conductor Hub settings.ts 直接迁移。
 * 管理 VS Code SecretStorage 中的 API Key 和 v2 ModelConfig。
 */

import type * as vscode from 'vscode';

// 通用配置
export interface BridgeConfig {
    defaultModel: string;
    retentionDays: number;
}

// Legacy 固定 provider 列表
export const SUPPORTED_PROVIDERS = ['deepseek', 'glm', 'qwen', 'minimax', 'kimi', 'gpt', 'gemini', 'mistral'] as const;
export type Provider = typeof SUPPORTED_PROVIDERS[number];

// v2 动态模型配置
export interface ModelConfig {
    id: string;           // UUID
    modelId: string;      // MODEL_REGISTRY 中的 key
    label: string;        // 显示名称
    baseUrl: string;      // API base URL
    tasks: string[];      // 分配的任务 ID
    enabled: boolean;
    priority: number;     // 同任务模型中，数字越小优先级越高
}

// URL / modelId 自动迁移映射
const URL_MIGRATIONS: [string, string][] = [
    ['https://api.minimaxi.com/v1', 'https://api.minimax.io/v1'],
    ['https://api.minimax.chat/v1', 'https://api.minimax.io/v1'],
    ['https://api.minimaxi.io/v1', 'https://api.minimax.io/v1'],
];
const MODEL_ID_MIGRATIONS: [string, string][] = [
    ['minimax-text-2.5', 'MiniMax-M2.5'],
    ['minimax-text-01', 'MiniMax-M2.5'],
];

export class SettingsManager {
    private secretStorage: vscode.SecretStorage;
    private static readonly MODELS_KEY = 'conductor-hub.models.v2';

    constructor(private context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
    }

    // ── API Key 方法 ─────────────────────────────────────────────────────────
    public async saveApiKey(provider: string, apiKey: string): Promise<void> {
        await this.secretStorage.store(`apikey.${provider}`, apiKey);
    }

    public async getApiKey(provider: string): Promise<string | undefined> {
        return await this.secretStorage.get(`apikey.${provider}`);
    }

    public async getAllApiKeys(): Promise<Record<string, string>> {
        const keys: Record<string, string> = {};
        for (const provider of SUPPORTED_PROVIDERS) {
            const key = await this.getApiKey(provider);
            if (key) { keys[provider] = key; }
        }
        return keys;
    }

    public async getModelApiKey(modelConfigId: string): Promise<string | undefined> {
        return await this.secretStorage.get(`apikey.model.${modelConfigId}`);
    }

    // ── v2 ModelConfig CRUD ──────────────────────────────────────────────────

    public async getModels(): Promise<ModelConfig[]> {
        const raw = await this.secretStorage.get(SettingsManager.MODELS_KEY);
        if (!raw) { return []; }
        try {
            const models = JSON.parse(raw) as ModelConfig[];
            let dirty = false;
            for (const m of models) {
                for (const [from, to] of URL_MIGRATIONS) {
                    if (m.baseUrl === from) { m.baseUrl = to; dirty = true; }
                }
                for (const [from, to] of MODEL_ID_MIGRATIONS) {
                    if (m.modelId === from) { m.modelId = to; dirty = true; }
                }
            }
            if (dirty) { await this.saveModels(models); }
            return models;
        }
        catch { return []; }
    }

    public async saveModels(models: ModelConfig[]): Promise<void> {
        await this.secretStorage.store(SettingsManager.MODELS_KEY, JSON.stringify(models));
    }

    public async addModel(model: ModelConfig): Promise<void> {
        const models = await this.getModels();
        models.push(model);
        await this.saveModels(models);
    }

    public async updateModel(id: string, patch: Partial<ModelConfig>): Promise<void> {
        const models = await this.getModels();
        const idx = models.findIndex(m => m.id === id);
        if (idx !== -1) { models[idx] = { ...models[idx], ...patch }; }
        await this.saveModels(models);
    }

    public async removeModel(id: string): Promise<void> {
        const models = await this.getModels();
        await this.saveModels(models.filter(m => m.id !== id));
    }

    // ── 通用配置 ─────────────────────────────────────────────────────────────
    public getGeneralConfig(): BridgeConfig {
        // 延迟导入 vscode 以支持类型检查
        const vscodeModule = require('vscode') as typeof vscode;
        const config = vscodeModule.workspace.getConfiguration('conductor-hub');
        return {
            defaultModel: config.get<string>('defaultModel', 'deepseek'),
            retentionDays: config.get<number>('retentionDays', 30),
        };
    }
}
