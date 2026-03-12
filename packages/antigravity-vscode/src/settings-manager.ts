/**
 * Antigravity Workflow VS Code — 设置管理器
 *
 * 从旧宿主设置层迁移而来。
 * 管理 VS Code SecretStorage 中的模型密钥和模型目录。
 */

import type * as vscode from 'vscode';

// 动态模型配置
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
    private static readonly MODELS_KEY = 'antigravity.models.catalog';
    private static readonly ARKTS_LSP_ENABLED_KEY = 'antigravity.features.arktsLsp.enabled';

    constructor(private context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
    }

    // ── Secret 方法 ─────────────────────────────────────────────────────────
    public async storeSecret(secretId: string, secretValue: string): Promise<void> {
        await this.secretStorage.store(`apikey.${secretId}`, secretValue);
    }

    public async readSecret(secretId: string): Promise<string | undefined> {
        return await this.secretStorage.get(`apikey.${secretId}`);
    }

    public async storeModelApiKey(modelConfigId: string, apiKey: string): Promise<void> {
        await this.storeSecret(`model.${modelConfigId}`, apiKey);
    }

    public async getModelApiKey(modelConfigId: string): Promise<string | undefined> {
        return await this.readSecret(`model.${modelConfigId}`);
    }

    // ── Model Catalog CRUD ───────────────────────────────────────────────────

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

    // ── Feature flags ───────────────────────────────────────────────────────

    public async getArktsLspEnabled(): Promise<boolean> {
        return this.context.globalState.get<boolean>(SettingsManager.ARKTS_LSP_ENABLED_KEY, false);
    }

    public async setArktsLspEnabled(enabled: boolean): Promise<void> {
        await this.context.globalState.update(SettingsManager.ARKTS_LSP_ENABLED_KEY, enabled);
    }
}
