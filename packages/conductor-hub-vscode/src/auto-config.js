"use strict";
/**
 * Conductor Hub VS Code — 自动配置模块
 *
 * 从 Conductor Hub extension.ts 提取:
 * - syncKeysToFile: 导出 API Key 到 ~/.conductor-hub-keys.json
 * - autoRegisterMcpConfig: 注册 mcp-server 到 Antigravity mcp_config.json
 * - autoInstallSkill: 安装 AI 路由 Skill 到全局技能目录
 * - autoInjectRoutingRules: 注入路由规则到 geminicodeassist.rules
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
exports.syncKeysToFile = syncKeysToFile;
exports.autoRegisterMcpConfig = autoRegisterMcpConfig;
exports.autoInstallSkill = autoInstallSkill;
exports.autoInstallAgcWorkflow = autoInstallAgcWorkflow;
exports.autoInjectRoutingRules = autoInjectRoutingRules;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const settings_manager_js_1 = require("./settings-manager.js");
const KEYS_FILE = path.join(os.homedir(), '.conductor-hub-keys.json');
const CONDUCTOR_HUB_RULES_MARKER = '[Conductor Hub Auto-Routing]';
/**
 * 导出 API Key 到文件系统，供 standalone mcp-server 读取
 */
async function syncKeysToFile(settings, dbPath) {
    try {
        let existing = {};
        try {
            if (fs.existsSync(KEYS_FILE)) {
                existing = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
            }
        }
        catch { /* ignore */ }
        const legacyKeys = {};
        for (const provider of settings_manager_js_1.SUPPORTED_PROVIDERS) {
            const k = await settings.getApiKey(provider);
            if (k)
                legacyKeys[provider] = k;
        }
        const merged = { ...existing, legacy: legacyKeys };
        if (dbPath) {
            merged.dbPath = dbPath;
        }
        fs.writeFileSync(KEYS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    }
    catch (e) {
        console.error('[Conductor Hub] Failed to sync keys:', e);
    }
}
/**
 * 自动注册所有 MCP Server 到 Antigravity 配置 (幂等)
 * - conductor-hub: ai_ask / ai_multi_ask / ai_consensus / ai_codex_task / ai_gemini_task / ai_list_providers
 * - conductor: agc-run / agc-get-state / agc-verify-run / agc-plugins / agc-memory-search / agc-phase4
 */
function autoRegisterMcpConfig(extensionPath) {
    const mcpConfigPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
    if (!fs.existsSync(mcpConfigPath))
        return;
    try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (!config.mcpServers)
            config.mcpServers = {};
        let changed = false;
        // ── 1. Conductor Hub MCP Server (ai_ask 等 6 个工具) ──────────────────
        const conductorHubServerPath = path.join(extensionPath, 'dist', 'mcp-server.js');
        const conductorHubExisting = config.mcpServers['conductor-hub'];
        const conductorHubEntry = { command: 'node', args: [conductorHubServerPath], env: {} };
        if (!conductorHubExisting || conductorHubExisting.args?.[0] !== conductorHubServerPath) {
            if (config.mcpServers['conductor-hub']) {
                delete config.mcpServers['conductor-hub']; // 清理旧命名
            }
            config.mcpServers['conductor-hub'] = conductorHubEntry;
            changed = true;
        }
        // ── 2. Conductor MCP Server (agc-run 等 6 个工具) ─────────────
        const conductorServerPath = path.join(extensionPath, 'dist', 'conductor-mcp-server.js');
        const conductorExisting = config.mcpServers['conductor'];
        const conductorEntry = { command: 'node', args: [conductorServerPath], env: {} };
        if (fs.existsSync(conductorServerPath)) {
            if (!conductorExisting || conductorExisting.args?.[0] !== conductorServerPath) {
                config.mcpServers['conductor'] = conductorEntry;
                changed = true;
            }
        }
        if (changed) {
            fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 4), 'utf8');
            console.log('[Conductor Hub] Auto-registered MCP servers ✅');
        }
    }
    catch (err) {
        console.error('[Conductor Hub] Failed to auto-register MCP config:', err);
    }
}
/**
 * 自动安装 AI 路由 Skill (幂等，每次激活覆盖以保持最新)
 */
function autoInstallSkill(extensionPath) {
    const srcSkillFile = path.join(extensionPath, 'skills', 'conductor-hub-routing', 'SKILL.md');
    if (!fs.existsSync(srcSkillFile)) {
        console.warn('[Conductor Hub] SKILL.md not found, skipping');
        return;
    }
    const destDir = path.join(os.homedir(), '.gemini', 'antigravity', 'skills', 'conductor-hub-routing');
    const destFile = path.join(destDir, 'SKILL.md');
    try {
        if (!fs.existsSync(destDir))
            fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcSkillFile, destFile);
        console.log('[Conductor Hub] Installed AI routing Skill ✅');
    }
    catch (err) {
        console.error('[Conductor Hub] Failed to install Skill:', err);
    }
}
/**
 * 自动安装 AGC 工作流到当前工作区 (幂等，每次激活覆盖以保持最新)
 * 安装后用户在 Antigravity 聊天中输入 /agc 即可使用多模型协作工作流
 */
function autoInstallAgcWorkflow(extensionPath) {
    const srcWorkflow = path.join(extensionPath, 'workflows', 'agc.md');
    if (!fs.existsSync(srcWorkflow)) {
        console.warn('[Conductor Hub] agc.md not found in extension, skipping');
        return;
    }
    // 安装到所有打开的工作区
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0)
        return;
    for (const folder of workspaceFolders) {
        const destDir = path.join(folder.uri.fsPath, '.agents', 'workflows');
        const destFile = path.join(destDir, 'agc.md');
        try {
            // 如果工作区已有 agc.md 且内容相同，跳过
            if (fs.existsSync(destFile)) {
                const existing = fs.readFileSync(destFile, 'utf8');
                const incoming = fs.readFileSync(srcWorkflow, 'utf8');
                if (existing === incoming)
                    continue;
            }
            if (!fs.existsSync(destDir))
                fs.mkdirSync(destDir, { recursive: true });
            fs.copyFileSync(srcWorkflow, destFile);
            console.log(`[Conductor Hub] Installed AGC workflow → ${destDir} ✅`);
        }
        catch (err) {
            console.error('[Conductor Hub] Failed to install AGC workflow:', err);
        }
    }
}
/**
 * 自动注入路由规则到 geminicodeassist.rules 设置 (幂等)
 * 策略: 多模型并行 + 主模型裁决，优先节省 Antigravity 额度
 */
async function autoInjectRoutingRules(settings) {
    try {
        const config = vscode.workspace.getConfiguration('geminicodeassist');
        const currentRules = config.get('rules', '');
        if (currentRules.includes(CONDUCTOR_HUB_RULES_MARKER))
            return; // 已注入
        const models = await settings.getModels();
        const enabledModels = models.filter(m => m.enabled !== false);
        const hasProvider = (keyword) => enabledModels.some(m => m.label.toLowerCase().includes(keyword) || m.modelId.toLowerCase().includes(keyword));
        const codexInstalled = !(0, child_process_1.spawnSync)('codex', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true }).error;
        const geminiInstalled = !(0, child_process_1.spawnSync)('gemini', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true }).error;
        const rules = [
            CONDUCTOR_HUB_RULES_MARKER,
            '核心策略：多模型并行 + 主模型裁决（最大化节省 Antigravity 额度）',
            '主模型只做调度、决策和交付，体力活委派给 Conductor Hub 中的专家模型。',
            '', '=== 体力活（低成本梯队优先）===',
        ];
        if (hasProvider('deepseek')) {
            rules.push('- 翻译/文档/注释/简单文本/信息整理 → mcp_conductor_hub_ai_ask(provider="deepseek")');
        }
        rules.push('', '=== 代码（质量优先）===');
        if (codexInstalled) {
            rules.push('- 代码审查/Bug检查 → mcp_conductor_hub_ai_codex_task()（首选）');
            rules.push('- 代码生成/实现功能 → 主模型首选，备选 mcp_conductor_hub_ai_codex_task()');
        }
        if (hasProvider('glm') || hasProvider('zhipu')) {
            rules.push('- 复杂调试/跨文件工程 → mcp_conductor_hub_ai_ask(provider="glm")');
        }
        rules.push('', '=== 专业领域 ===');
        if (geminiInstalled) {
            rules.push('- 推理/算法/数学 → mcp_conductor_hub_ai_gemini_task()');
            rules.push('- 前端UI/UX → mcp_conductor_hub_ai_gemini_task()');
        }
        if (hasProvider('qwen'))
            rules.push('- 多语言/结构化写作 → mcp_conductor_hub_ai_ask(provider="qwen")');
        if (hasProvider('minimax'))
            rules.push('- 大量高速生成 → mcp_conductor_hub_ai_ask(provider="minimax")');
        // 创意写作协作链
        if ((hasProvider('qwen') || hasProvider('glm') || hasProvider('minimax')) && enabledModels.length > 1) {
            rules.push('', '=== 创意写作（多模型协作链）===');
            rules.push('1. mcp_conductor_hub_ai_multi_ask() 至少2模型并行出大纲');
            rules.push('2. mcp_conductor_hub_ai_multi_ask() 多模型并行写初稿');
            rules.push('3. 主模型综合择优，融合最好段落');
        }
        if (enabledModels.length > 1) {
            rules.push('', '=== 多方案对比 ===');
            rules.push('- 需要多视角/对比方案 → mcp_conductor_hub_ai_multi_ask()');
        }
        rules.push('', '=== 主模型专属（不委派）===');
        rules.push('- 架构设计/系统方案 → 主模型自己做');
        rules.push('- 最终决策/综合输出 → 主模型自己做');
        rules.push('- 与用户对话 → 主模型自己做');
        rules.push('', '设计哲学：多模型并行 + 主模型裁决。');
        const merged = currentRules
            ? currentRules + '\n\n' + rules.join('\n')
            : rules.join('\n');
        await config.update('rules', merged, vscode.ConfigurationTarget.Global);
        console.log('[Conductor Hub] Auto-injected routing rules ✅');
    }
    catch (err) {
        console.error('[Conductor Hub] Failed to inject routing rules:', err);
    }
}
//# sourceMappingURL=auto-config.js.map