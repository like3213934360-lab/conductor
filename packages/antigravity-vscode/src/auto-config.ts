/**
 * Antigravity Workflow VS Code — 自动配置模块
 *
 * 负责导出模型目录、注册 MCP、安装 skill，
 * 并把路由规则注入 Antigravity / Gemini 侧配置。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import type { SettingsManager } from './settings-manager.js';

const MODEL_CATALOG_FILE = path.join(os.homedir(), '.antigravity-model-catalog.json');
const ANTIGRAVITY_ROUTING_RULES_MARKER = '[Antigravity Auto-Routing]';

/**
 * 导出模型目录到文件系统，供 standalone mcp-server 读取
 */
export async function syncModelCatalogToFile(settings: SettingsManager, dbPath?: string) {
    try {
        const models = await settings.getModels();
        const enriched = await Promise.all(models.map(async model => ({
            ...model,
            apiKey: await settings.getModelApiKey(model.id) || '',
        })));
        const nextConfig: Record<string, unknown> = {
            version: 3,
            models: enriched,
        };
        if (dbPath) {
            nextConfig.dbPath = dbPath;
        }
        fs.writeFileSync(MODEL_CATALOG_FILE, JSON.stringify(nextConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('[Antigravity Workflow] Failed to sync model catalog:', e);
    }
}

/**
 * 自动注册统一 MCP Server 到 Antigravity 配置 (幂等)
 * 新架构: conductor MCP server 暴露 model 工具和 daemon-backed workflow 工具
 */
export function autoRegisterMcpConfig(extensionPath: string) {
    const mcpConfigPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');
    if (!fs.existsSync(mcpConfigPath)) return;

    try {
        const config = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
        if (!config.mcpServers) config.mcpServers = {};

        let changed = false;

        // Canonical Antigravity MCP server (model tools + daemon-backed workflow tools)
        const antigravityServerPath = path.join(extensionPath, 'dist', 'antigravity-mcp-server.js');
        const antigravityExisting = config.mcpServers['antigravity'];
        const antigravityEntry = { command: 'node', args: [antigravityServerPath], env: {} };
        if (fs.existsSync(antigravityServerPath)) {
            if (!antigravityExisting || antigravityExisting.args?.[0] !== antigravityServerPath) {
                config.mcpServers['antigravity'] = antigravityEntry;
                changed = true;
            }
        }

        if (changed) {
            fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 4), 'utf8');
            console.log('[Antigravity Workflow] Auto-registered unified MCP server ✅');
        }
    } catch (err) {
        console.error('[Antigravity Workflow] Failed to auto-register MCP config:', err);
    }
}

/**
 * 混合技能同步：项目级源 → 全局 UI 可见
 *
 * 源文件在 .agents/skills/（版本控制、跟随项目），
 * 激活时同步到 ~/.gemini/antigravity/skills/ 让聊天 UI 的 / 菜单能看到。
 */
export function autoInstallSkill(_extensionPath: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return;

    const globalSkillsRoot = path.join(os.homedir(), '.gemini', 'antigravity', 'skills');
    let installed = 0;

    for (const folder of workspaceFolders) {
        const projectSkillsRoot = path.join(folder.uri.fsPath, '.agents', 'skills');
        if (!fs.existsSync(projectSkillsRoot)) continue;

        try {
            const entries = fs.readdirSync(projectSkillsRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const srcSkillFile = path.join(projectSkillsRoot, entry.name, 'SKILL.md');
                if (!fs.existsSync(srcSkillFile)) continue;

                const destDir = path.join(globalSkillsRoot, entry.name);
                const destFile = path.join(destDir, 'SKILL.md');

                try {
                    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                    fs.copyFileSync(srcSkillFile, destFile);
                    installed++;
                } catch (err) {
                    console.error(`[Antigravity Workflow] Failed to sync skill ${entry.name}:`, err);
                }
            }
        } catch (err) {
            console.error(`[Antigravity Workflow] Failed to scan ${projectSkillsRoot}:`, err);
        }
    }

    if (installed > 0) {
        console.log(`[Antigravity Workflow] Synced ${installed} project skills to global ✅`);
    }
}

/**
 * 自动注入路由规则到 geminicodeassist.rules 设置 (幂等)
 * 策略: 多模型并行 + 主模型裁决，优先节省 Antigravity 额度
 */
export async function autoInjectRoutingRules(settings: SettingsManager) {
    try {
        const config = vscode.workspace.getConfiguration('geminicodeassist');
        const currentRules = config.get<string>('rules', '');
        if (currentRules.includes(ANTIGRAVITY_ROUTING_RULES_MARKER)) return; // 已注入

        const models = await settings.getModels();
        const enabledModels = models.filter(m => m.enabled !== false);
        const hasModelFamily = (keyword: string) => enabledModels.some(m =>
            m.label.toLowerCase().includes(keyword) || m.modelId.toLowerCase().includes(keyword)
        );

        const codexInstalled = !spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true }).error;
        const geminiInstalled = !spawnSync('gemini', ['--version'], { encoding: 'utf8', timeout: 3000, shell: true }).error;

        const rules: string[] = [
            ANTIGRAVITY_ROUTING_RULES_MARKER,
            '核心策略：多模型并行 + 主模型裁决（最大化节省 Antigravity 额度）',
            '主模型只做调度、决策和交付，体力活委派给 Antigravity Workflow 管理的专家模型。',
            '', '=== 体力活（低成本梯队优先）===',
        ];

        if (hasModelFamily('deepseek')) {
            rules.push('- 翻译/文档/注释/简单文本/信息整理 → mcp_antigravity_ai_ask(model_hint="deepseek")');
        }

        rules.push('', '=== 代码（质量优先）===');
        if (codexInstalled) {
            rules.push('- 代码审查/Bug检查 → mcp_antigravity_ai_codex_task()（首选）');
            rules.push('- 代码生成/实现功能 → 主模型首选，备选 mcp_antigravity_ai_codex_task()');
        }
        if (hasModelFamily('glm') || hasModelFamily('zhipu')) {
            rules.push('- 复杂调试/跨文件工程 → mcp_antigravity_ai_ask(model_hint="glm")');
        }

        rules.push('', '=== 专业领域 ===');
        if (geminiInstalled) {
            rules.push('- 推理/算法/数学 → mcp_antigravity_ai_gemini_task()');
            rules.push('- 前端UI/UX → mcp_antigravity_ai_gemini_task()');
        }
        if (hasModelFamily('qwen')) rules.push('- 多语言/结构化写作 → mcp_antigravity_ai_ask(model_hint="qwen")');
        if (hasModelFamily('minimax')) rules.push('- 大量高速生成 → mcp_antigravity_ai_ask(model_hint="minimax")');

        // 创意写作协作链
        if ((hasModelFamily('qwen') || hasModelFamily('glm') || hasModelFamily('minimax')) && enabledModels.length > 1) {
            rules.push('', '=== 创意写作（多模型协作链）===');
            rules.push('1. mcp_antigravity_ai_multi_ask() 至少2模型并行出大纲');
            rules.push('2. mcp_antigravity_ai_multi_ask() 多模型并行写初稿');
            rules.push('3. 主模型综合择优，融合最好段落');
        }

        if (enabledModels.length > 1) {
            rules.push('', '=== 多方案对比 ===');
            rules.push('- 需要多视角/对比方案 → mcp_antigravity_ai_multi_ask()');
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
        console.log('[Antigravity Workflow] Auto-injected routing rules ✅');
    } catch (err) {
        console.error('[Antigravity Workflow] Failed to inject routing rules:', err);
    }
}
