"use strict";
/**
 * Conductor Hub VS Code — 设置管理器
 *
 * 从 Conductor Hub settings.ts 直接迁移。
 * 管理 VS Code SecretStorage 中的 API Key 和 v2 ModelConfig。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsManager = exports.SUPPORTED_PROVIDERS = void 0;
// Legacy 固定 provider 列表
exports.SUPPORTED_PROVIDERS = ['deepseek', 'glm', 'qwen', 'minimax', 'kimi', 'gpt', 'gemini', 'mistral'];
// URL / modelId 自动迁移映射
const URL_MIGRATIONS = [
    ['https://api.minimaxi.com/v1', 'https://api.minimax.io/v1'],
    ['https://api.minimax.chat/v1', 'https://api.minimax.io/v1'],
    ['https://api.minimaxi.io/v1', 'https://api.minimax.io/v1'],
];
const MODEL_ID_MIGRATIONS = [
    ['minimax-text-2.5', 'MiniMax-M2.5'],
    ['minimax-text-01', 'MiniMax-M2.5'],
];
class SettingsManager {
    constructor(context) {
        this.context = context;
        this.secretStorage = context.secrets;
    }
    // ── API Key 方法 ─────────────────────────────────────────────────────────
    async saveApiKey(provider, apiKey) {
        await this.secretStorage.store(`apikey.${provider}`, apiKey);
    }
    async getApiKey(provider) {
        return await this.secretStorage.get(`apikey.${provider}`);
    }
    async getAllApiKeys() {
        const keys = {};
        for (const provider of exports.SUPPORTED_PROVIDERS) {
            const key = await this.getApiKey(provider);
            if (key) {
                keys[provider] = key;
            }
        }
        return keys;
    }
    async getModelApiKey(modelConfigId) {
        return await this.secretStorage.get(`apikey.model.${modelConfigId}`);
    }
    // ── v2 ModelConfig CRUD ──────────────────────────────────────────────────
    async getModels() {
        const raw = await this.secretStorage.get(SettingsManager.MODELS_KEY);
        if (!raw) {
            return [];
        }
        try {
            const models = JSON.parse(raw);
            let dirty = false;
            for (const m of models) {
                for (const [from, to] of URL_MIGRATIONS) {
                    if (m.baseUrl === from) {
                        m.baseUrl = to;
                        dirty = true;
                    }
                }
                for (const [from, to] of MODEL_ID_MIGRATIONS) {
                    if (m.modelId === from) {
                        m.modelId = to;
                        dirty = true;
                    }
                }
            }
            if (dirty) {
                await this.saveModels(models);
            }
            return models;
        }
        catch {
            return [];
        }
    }
    async saveModels(models) {
        await this.secretStorage.store(SettingsManager.MODELS_KEY, JSON.stringify(models));
    }
    async addModel(model) {
        const models = await this.getModels();
        models.push(model);
        await this.saveModels(models);
    }
    async updateModel(id, patch) {
        const models = await this.getModels();
        const idx = models.findIndex(m => m.id === id);
        if (idx !== -1) {
            models[idx] = { ...models[idx], ...patch };
        }
        await this.saveModels(models);
    }
    async removeModel(id) {
        const models = await this.getModels();
        await this.saveModels(models.filter(m => m.id !== id));
    }
    // ── 通用配置 ─────────────────────────────────────────────────────────────
    getGeneralConfig() {
        // 延迟导入 vscode 以支持类型检查
        const vscodeModule = require('vscode');
        const config = vscodeModule.workspace.getConfiguration('conductor-hub');
        return {
            defaultModel: config.get('defaultModel', 'deepseek'),
            retentionDays: config.get('retentionDays', 30),
        };
    }
}
exports.SettingsManager = SettingsManager;
SettingsManager.MODELS_KEY = 'conductor-hub.models.v2';
//# sourceMappingURL=settings-manager.js.map