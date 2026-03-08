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
const react_1 = __importStar(require("react"));
const vscode_api_1 = require("../vscode-api");
const theme_1 = require("../theme");
// ─── Task Types ───────────────────────────────────────────────────────────────
const TASK_TYPES = [
    { id: 'code_gen', zh: '代码生成', en: 'Code Generation' },
    { id: 'code_review', zh: '调试 / 重构', en: 'Debug & Refactor' },
    { id: 'architecture', zh: '架构设计', en: 'Architecture' },
    { id: 'documentation', zh: '文档 / 注释', en: 'Documentation' },
    { id: 'translation', zh: '翻译', en: 'Translation' },
    { id: 'ui_design', zh: 'UI / 前端', en: 'UI & Frontend' },
    { id: 'vision', zh: '图像理解', en: 'Vision' },
    { id: 'long_context', zh: '长文本分析', en: 'Long Context' },
    { id: 'math_reasoning', zh: '数学 / 推理', en: 'Math & Reasoning' },
    { id: 'tool_calling', zh: '工具调用', en: 'Tool Calling' },
    { id: 'creative', zh: '创意写作', en: 'Creative Writing' },
    { id: 'agentic', zh: 'Agentic', en: 'Agentic Tasks' },
];
const MODEL_DEFS = {
    // ─── DeepSeek ─────────────────────────────────────────────────────────────
    'deepseek-chat': {
        label: 'V3.2',
        group: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultTasks: ['code_gen', 'code_review', 'math_reasoning'],
        note: '最新 V3.2（2025-12）综合能力强，性价比最高',
        pricing: { input: 0.32, output: 0.89 },
    },
    'deepseek-reasoner': {
        label: 'R1',
        group: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultTasks: ['math_reasoning', 'architecture', 'code_review'],
        note: 'R1 深度推理，思维链分析、数学、规划',
        pricing: { input: 0.70, output: 2.50 },
    },
    // ─── GLM (智谱) ────────────────────────────────────────────────────────────
    'glm-5': {
        label: 'GLM-5 通用',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultTasks: ['architecture', 'agentic', 'tool_calling', 'code_gen'],
        note: '最新旗舰（2026-02）· 通用 API 端点 · 按量计费',
        pricing: { input: 1.50, output: 6.00 },
    },
    'glm-5-coding': {
        label: 'GLM-5 编程版',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        defaultTasks: ['architecture', 'agentic', 'code_gen', 'code_review'],
        note: 'Coding Plan 包月专属端点 · 消耗 2x-3x 配额（Complex 任务）',
        pricing: undefined,
    },
    'glm-4.7': {
        label: 'GLM-4.7 编程版',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'tool_calling'],
        note: 'Coding Plan 日常首选 · 1x 配额消耗 · 省额度',
        pricing: undefined,
    },
    // ─── Qwen (通义) ──────────────────────────────────────────────────────────
    'qwen-max': {
        label: 'Qwen3-Max',
        group: 'Qwen (通义)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultTasks: ['translation', 'documentation', 'tool_calling', 'code_gen'],
        note: '通义最新旗舰（Qwen3.5），中文理解与翻译最强',
        pricing: { input: 0.50, output: 4.00 },
    },
    'qwen-coder-plus': {
        label: 'Qwen Coder Plus',
        group: 'Qwen (通义)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic'],
        note: '代码专项旗舰，Agentic 编程与工具调用',
        pricing: { input: 0.25, output: 2.00 },
    },
    // ─── MiniMax ──────────────────────────────────────────────────────────────
    'MiniMax-M2.5': {
        label: 'M2.5 通用',
        group: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        defaultTasks: ['agentic', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新旗舰（2025-12），SWE-bench 80.2%，按量计费，普通 API Key',
        pricing: { input: 0.40, output: 1.20 },
    },
    'MiniMax-M2.5-highspeed': {
        label: 'M2.5-highspeed Coding Plan',
        group: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'long_context'],
        note: 'Coding Plan 包月专用，填 sk-cp-... Key · Plus 高速套餐 · 已验证可连通',
        pricing: undefined,
    },
    // ─── Kimi K2 ──────────────────────────────────────────────────────────────
    'kimi-k2-instruct': {
        label: 'Kimi K2.5 (推荐)',
        group: 'Kimi K2',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultTasks: ['agentic', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新 K2.5（2026-01），1T MoE，256K 上下文，Agentic 顶尖',
        pricing: { input: 1.20, output: 4.80 },
    },
    // ─── OpenAI ───────────────────────────────────────────────────────────────
    'gpt-5.1': {
        label: 'GPT-5.1 (推荐)',
        group: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultTasks: ['code_gen', 'vision', 'architecture', 'long_context'],
        note: '最新旗舰，超长上下文，复杂推理与多模态，官方直连',
        pricing: { input: 1.25, output: 10.00 },
    },
    'gpt-5.3-codex': {
        label: 'GPT-5.3 Codex (编程)',
        group: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'tool_calling'],
        note: 'Terminal-Bench #1，Agentic 编程与 DevOps 顶尖，官方直连',
        pricing: { input: 1.75, output: 14.00 },
    },
    // ─── Anthropic (Claude) ───────────────────────────────────────────────────
    'claude-opus-4-6': {
        label: 'Claude Opus 4.6 (推荐)',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['architecture', 'agentic', 'code_review', 'long_context'],
        note: '最新旗舰（2026-02），全球编程最强，企业级 Agentic，官方直连',
        pricing: { input: 15.00, output: 75.00 },
    },
    'claude-sonnet-4-6': {
        label: 'Claude Sonnet 4.6',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_gen', 'creative', 'architecture', 'documentation'],
        note: '最新（2026-02），性能与成本最佳平衡，通用主力，官方直连',
        pricing: { input: 3.00, output: 15.00 },
    },
    'claude-opus-4-5': {
        label: 'Claude Opus 4.5',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_review', 'architecture', 'agentic'],
        note: 'SWE-bench 72.5% 编程顶尖（2025-05），官方直连',
        pricing: { input: 15.00, output: 75.00 },
    },
    'claude-sonnet-4-5': {
        label: 'Claude Sonnet 4.5',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_gen', 'creative', 'documentation'],
        note: '均衡旗舰（2025-05），代码与内容创作首选，官方直连',
        pricing: { input: 3.00, output: 15.00 },
    },
    // ─── Google Gemini ────────────────────────────────────────────────────────
    'gemini-3.1-flash': {
        label: 'Gemini 3.1 Flash (推荐)',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['vision', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新 Flash（2026），速度快成本低，多模态全能，官方直连',
        pricing: { input: 0.25, output: 1.00 },
    },
    'gemini-3.1-pro-preview': {
        label: 'Gemini 3.1 Pro Preview',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['math_reasoning', 'architecture', 'long_context', 'vision'],
        note: '顶级推理，百万 token 上下文，官方直连',
        pricing: { input: 1.25, output: 5.00 },
    },
    'gemini-3-image': {
        label: 'Gemini Image Gen (生图)',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['vision', 'creative', 'ui_design'],
        note: '专用图像生成与编辑（Imagen 3 驱动），官方直连',
        pricing: { input: 0.25, output: 1.50 },
    },
    // ─── Mistral ──────────────────────────────────────────────────────────────
    'mistral-large-latest': {
        label: 'Mistral Large 3 (推荐)',
        group: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        defaultTasks: ['translation', 'tool_calling', 'code_gen'],
        note: '欧洲隐私合规，多语言优秀，官方直连',
        pricing: { input: 2.00, output: 6.00 },
    },
    // ─── Meta Llama (中转) ────────────────────────────────────────────────────
    'meta-llama/llama-3.3-70b-instruct': {
        label: 'Llama 3.3 70B',
        group: 'Meta (Llama) — 需中转',
        baseUrl: '',
        defaultTasks: ['code_gen', 'translation'],
        note: '业界顶级梯队模型，需通过 OpenRouter / 硅基流动等中转',
        relay: true,
    },
    // ─── API 聚合平台 ─────────────────────────────────────────────────────────
    '__openrouter__': {
        label: 'OpenRouter',
        group: 'API 聚合平台',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultTasks: ['code_gen', 'architecture', 'translation'],
        note: '全球最大聚合（500+ 模型）。Model ID 格式：openai/gpt-5.1 · anthropic/claude-sonnet-4-6',
        relay: true,
    },
    '__yibuapi__': {
        label: '一步API',
        group: 'API 聚合平台',
        baseUrl: 'https://api.yibuapi.com/v1',
        defaultTasks: ['code_gen', 'translation'],
        note: '国内聚合，原价调用 GPT/Claude/Gemini/DeepSeek/Qwen/Kimi，无需科学上网',
        relay: true,
    },
    '__dmxapi__': {
        label: 'DMXAPI',
        group: 'API 聚合平台',
        baseUrl: 'https://www.dmxapi.cn/v1',
        defaultTasks: ['code_gen', 'translation'],
        note: '国内稳定聚合，Model ID 与官方一致',
        relay: true,
    },
    // ─── 自定义 ───────────────────────────────────────────────────────────────
    '__custom__': {
        label: '自定义模型',
        group: '自定义接口',
        baseUrl: '',
        defaultTasks: [],
        note: '任意兼容 OpenAI 接口的模型（中转、私有部署等）',
        relay: true,
    },
};
/** Example model IDs shown in the Model ID input per provider group */
const GROUP_MODEL_EXAMPLES = {
    'DeepSeek': 'deepseek-chat / deepseek-reasoner',
    'GLM (智谱)': 'glm-5 / glm-4.7',
    'Qwen (通义)': 'qwen-max / qwen-plus',
    'MiniMax': 'MiniMax-M2.5 / MiniMax-M2.5-highspeed',
    'Kimi K2': 'kimi-k2-0711-preview',
    'Anthropic (Claude)': 'claude-opus-4-5 / claude-sonnet-4-5',
    'OpenAI': 'gpt-4o / gpt-4.1',
    'Google (Gemini)': 'gemini-2.0-flash / gemini-1.5-pro',
    'Mistral': 'mistral-large / mistral-small',
};
const GROUPS = [
    // 官方直连（国内）
    'DeepSeek',
    'GLM (智谱)',
    'Qwen (通义)',
    'MiniMax',
    'Kimi K2',
    // 官方直连（国际）
    'OpenAI',
    'Anthropic (Claude)',
    'Google (Gemini)',
    'Mistral',
    // 第三方中转
    '第三方中转',
    // 自定义
    '自定义接口',
];
/** Verified relay platforms with HTTPS, proper websites, and good reputation */
const RELAY_PRESETS = [
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', site: 'https://openrouter.ai', note: '国际标杆，模型最全（500+）' },
    { name: 'UniAPI 内地 HK', url: 'https://hk.uniapi.io/v1', site: 'https://uniapi.io', note: '大陆优化线路，国内首选' },
    { name: 'UniAPI 国际', url: 'https://api.uniapi.io/v1', site: 'https://uniapi.io', note: '国际线路，支持 GPT/Claude/Gemini/DeepSeek' },
    { name: 'CloseAI', url: 'https://api.closeai-asia.com/v1', site: 'https://closeai-asia.com', note: '亚洲企业级中转' },
    { name: '硅基流动 SiliconFlow', url: 'https://api.siliconflow.cn/v1', site: 'https://cloud.siliconflow.cn', note: '国内正规大平台' },
];
// Provider colors imported from theme.ts
// ─── Shared Styles ────────────────────────────────────────────────────────────
// Styles imported from '../theme' — s, colors, radius, shadow, providerColors
// ─── TaskBadge ────────────────────────────────────────────────────────────────
const TaskBadge = ({ id, lang }) => {
    const t = TASK_TYPES.find(t => t.id === id);
    if (!t) {
        return null;
    }
    return (react_1.default.createElement("span", { style: {
            display: 'inline-block',
            margin: '2px 3px 2px 0',
            padding: '1px 7px',
            borderRadius: '3px',
            fontSize: '11px',
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
            whiteSpace: 'nowrap',
        } }, lang === 'zh' ? t.zh : t.en));
};
// ─── ModelCard ────────────────────────────────────────────────────────────────
const ModelCard = ({ model, apiKey, lang, initialTestResult, onEdit, onRemove, onToggle }) => {
    const def = MODEL_DEFS[model.modelId];
    const [testState, setTestState] = react_1.default.useState(initialTestResult ? (initialTestResult.ok ? 'ok' : 'fail') : 'idle');
    const [testMsg, setTestMsg] = react_1.default.useState(initialTestResult?.msg || '');
    const [confirmDelete, setConfirmDelete] = react_1.default.useState(false);
    // Update when auto-test result arrives from parent
    react_1.default.useEffect(() => {
        if (initialTestResult) {
            setTestState(initialTestResult.ok ? 'ok' : 'fail');
            setTestMsg(initialTestResult.msg);
        }
    }, [initialTestResult?.ok, initialTestResult?.msg]);
    const handleTest = async () => {
        if (!apiKey) {
            setTestState('fail');
            setTestMsg(lang === 'zh' ? '未配置 API Key' : 'API Key not set');
            return;
        }
        if (!model.baseUrl) {
            setTestState('fail');
            setTestMsg('Base URL 未设置');
            return;
        }
        setTestState('testing');
        setTestMsg('');
        // Route through extension host (Node.js) to bypass CORS restrictions
        const requestId = `test_${Date.now()}`;
        vscode_api_1.vscode.postMessage({ command: 'testConnection', modelId: model.modelId, baseUrl: model.baseUrl, apiKey, requestId });
        // Listen for the response
        const handler = (event) => {
            const msg = event.data;
            if (msg.command === 'testResult' && msg.requestId === requestId) {
                window.removeEventListener('message', handler);
                setTestState(msg.ok ? 'ok' : 'fail');
                setTestMsg(msg.msg || (msg.ok ? '已连通' : '失败'));
            }
        };
        window.addEventListener('message', handler);
        // Fallback cleanup after 17s
        setTimeout(() => {
            window.removeEventListener('message', handler);
            setTestState(s => s === 'testing' ? 'fail' : s);
            setTestMsg(m => m === '' ? '超时 15s' : m);
        }, 17000);
    };
    const testColor = testState === 'ok'
        ? 'var(--vscode-testing-iconPassed)'
        : testState === 'fail' ? 'var(--vscode-errorForeground)'
            : 'var(--vscode-descriptionForeground)';
    return (react_1.default.createElement("div", { style: {
            ...theme_1.s.card,
            opacity: model.enabled ? 1 : 0.55,
            borderLeft: `3px solid ${theme_1.providerColors[def?.group || ''] || theme_1.colors.brand}`,
            position: 'relative',
        } },
        react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' } },
            react_1.default.createElement("div", { style: { flex: 1, minWidth: 0 } },
                react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                    react_1.default.createElement("span", { style: { fontWeight: 600, fontSize: '13px' } }, def?.group || model.modelId),
                    react_1.default.createElement("span", { style: { fontSize: '11px', color: theme_1.providerColors[def?.group || ''] || 'var(--vscode-descriptionForeground)', fontWeight: 500 } }, model.label)),
                def && (react_1.default.createElement("div", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)', margin: '3px 0 7px' } }, def.note)),
                react_1.default.createElement("div", null, model.tasks.length > 0
                    ? model.tasks.map(t => react_1.default.createElement(TaskBadge, { key: t, id: t, lang: lang }))
                    : react_1.default.createElement("span", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)' } }, "\u672A\u5206\u914D\u4EFB\u52A1"))),
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
                react_1.default.createElement("button", { onClick: handleTest, disabled: testState === 'testing', style: {
                        ...theme_1.s.btnSecondary, padding: '3px 10px', fontSize: '11px',
                        cursor: testState === 'testing' ? 'default' : 'pointer',
                    } }, testState === 'testing' ? (lang === 'zh' ? '测试中…' : 'Testing…') : (lang === 'zh' ? '测试连通' : 'Test')),
                react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '3px 10px', fontSize: '11px' }, onClick: () => onToggle(model.id, !model.enabled) }, model.enabled ? (lang === 'zh' ? '禁用' : 'Disable') : (lang === 'zh' ? '启用' : 'Enable')),
                react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '3px 10px', fontSize: '11px' }, onClick: () => onEdit(model, apiKey) }, lang === 'zh' ? '编辑' : 'Edit'),
                !confirmDelete ? (react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '3px 10px', fontSize: '11px', color: 'var(--vscode-errorForeground)' }, onClick: () => setConfirmDelete(true) }, lang === 'zh' ? '删除' : 'Delete')) : (react_1.default.createElement("span", { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
                    react_1.default.createElement("span", { style: { fontSize: '10px', color: 'var(--vscode-errorForeground)' } }, lang === 'zh' ? '确认?' : 'Sure?'),
                    react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '2px 8px', fontSize: '11px', background: 'var(--vscode-errorForeground)', color: '#fff', border: 'none' }, onClick: () => { setConfirmDelete(false); onRemove(model.id); } }, lang === 'zh' ? '确认删除' : 'Yes'),
                    react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '2px 8px', fontSize: '11px' }, onClick: () => setConfirmDelete(false) }, lang === 'zh' ? '取消' : 'No'))))),
        react_1.default.createElement("div", { style: { marginTop: '7px', fontSize: '11px', color: 'var(--vscode-descriptionForeground)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' } },
            react_1.default.createElement("span", { style: { display: 'flex', gap: '14px', alignItems: 'center' } },
                react_1.default.createElement("span", null, model.baseUrl || '(未设置 Base URL)'),
                react_1.default.createElement("span", { style: { color: apiKey ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-errorForeground)' } }, apiKey ? (lang === 'zh' ? 'API Key 已配置' : 'API Key set') : (lang === 'zh' ? 'API Key 未配置' : 'API Key missing'))),
            testState !== 'idle' && (react_1.default.createElement("span", { style: { color: testColor, fontWeight: 500 } }, testState === 'testing' ? (lang === 'zh' ? '测试中…' : 'Testing…') : testState === 'ok' ? `✅ ${testMsg}` : `❌ ${testMsg}`)))));
};
// ─── AddEditModal ─────────────────────────────────────────────────────────────
const AddEditModal = ({ lang, existing, onSave, onClose }) => {
    const isEdit = !!existing;
    const [selectedGroup, setSelectedGroup] = (0, react_1.useState)(() => {
        if (existing) {
            // Try MODEL_DEFS lookup first (covers known models)
            const fromDef = MODEL_DEFS[existing.model.modelId]?.group;
            if (fromDef)
                return fromDef;
            // Fallback: detect from baseUrl pattern
            const url = existing.model.baseUrl || '';
            if (url.includes('bigmodel.cn') || url.includes('zhipuai'))
                return 'GLM (智谱)';
            if (url.includes('dashscope') || url.includes('aliyuncs'))
                return 'Qwen (通义)';
            if (url.includes('minimax') || url.includes('minimaxi'))
                return 'MiniMax';
            if (url.includes('moonshot') || url.includes('kimi'))
                return 'Kimi K2';
            if (url.includes('deepseek'))
                return 'DeepSeek';
            if (url.includes('anthropic') || url.includes('claude'))
                return '官方直连（国际）';
            if (url.includes('openai') || url.includes('googleapis'))
                return '官方直连（国际）';
        }
        return GROUPS[0];
    });
    const [selectedModelId, setSelectedModelId] = (0, react_1.useState)(existing?.model.modelId || '');
    const [customModelId, setCustomModelId] = (0, react_1.useState)(existing?.model.modelId || '');
    const [customLabel, setCustomLabel] = (0, react_1.useState)(existing?.model.label || '');
    const [baseUrl, setBaseUrl] = (0, react_1.useState)(existing?.model.baseUrl || '');
    const [tasks, setTasks] = (0, react_1.useState)(existing?.model.tasks || []);
    const [apiKey, setApiKey] = (0, react_1.useState)(existing?.apiKey || '');
    const [step, setStep] = (0, react_1.useState)(existing ? 2 : 1);
    const isCustomGroup = selectedGroup === '自定义接口';
    const isRelayGroup = selectedGroup === '第三方中转';
    const modelsInGroup = isRelayGroup
        ? Object.entries(MODEL_DEFS).filter(([, d]) => d.group !== '自定义接口' && d.group !== '第三方中转')
        : Object.entries(MODEL_DEFS).filter(([, d]) => d.group === selectedGroup && d.group !== '自定义接口');
    const effectiveModelId = isCustomGroup ? '__custom__' : selectedModelId;
    const def = MODEL_DEFS[effectiveModelId];
    const handleGroupChange = (g) => {
        setSelectedGroup(g);
        const isRelay = g === '第三方中转';
        // For relay group, pick first available model from all providers
        const candidates = isRelay
            ? Object.entries(MODEL_DEFS).filter(([, d]) => d.group !== '自定义接口' && d.group !== '第三方中转')
            : Object.entries(MODEL_DEFS).filter(([, d]) => d.group === g && d.group !== '自定义接口');
        const first = candidates[0];
        if (first) {
            setSelectedModelId(first[0]);
            // For relay, clear baseUrl so user must pick a platform
            setBaseUrl(isRelay ? '' : first[1].baseUrl);
            setTasks(first[1].defaultTasks);
        }
        else {
            setSelectedModelId('');
            setBaseUrl('');
            setTasks([]);
        }
    };
    const handleModelChange = (id) => {
        setSelectedModelId(id);
        const d = MODEL_DEFS[id];
        if (d) {
            setBaseUrl(d.baseUrl);
            setTasks(d.defaultTasks);
        }
    };
    const toggleTask = (id) => {
        setTasks(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };
    const handleSave = () => {
        const finalModelId = isCustomGroup ? customModelId : selectedModelId;
        if (!finalModelId) {
            alert('请选择或填写型号');
            return;
        }
        if (isRelayGroup && !baseUrl) {
            alert('第三方中转需要填写 Base URL');
            return;
        }
        const finalLabel = isCustomGroup
            ? (customLabel || customModelId)
            : (MODEL_DEFS[finalModelId]?.label || finalModelId);
        const config = {
            id: existing?.model.id || `mc_${Date.now()}`,
            modelId: finalModelId,
            label: finalLabel,
            baseUrl,
            tasks,
            enabled: existing?.model.enabled ?? true,
            priority: existing?.model.priority ?? 0,
        };
        onSave(config, apiKey);
    };
    const overlay = {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    };
    const modal = {
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '8px', padding: '22px 24px',
        width: '500px', maxWidth: '92vw', maxHeight: '82vh', overflowY: 'auto',
    };
    const stepHeader = (n, title) => (react_1.default.createElement("div", { style: { marginBottom: '16px' } },
        react_1.default.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' } },
            react_1.default.createElement("h3", { style: { margin: 0, fontSize: '14px' } }, isEdit ? '编辑模型' : `步骤 ${n}/3 — ${title}`),
            react_1.default.createElement("button", { style: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: 'var(--vscode-descriptionForeground)' }, onClick: onClose }, "\u2715")),
        react_1.default.createElement("div", { style: { height: '1px', background: 'var(--vscode-panel-border)' } })));
    return (react_1.default.createElement("div", { style: overlay, onClick: e => { if (e.target === e.currentTarget) {
            onClose();
        } } },
        react_1.default.createElement("div", { style: modal },
            step === 1 && (react_1.default.createElement(react_1.default.Fragment, null,
                stepHeader(1, '选择模型'),
                react_1.default.createElement("div", { style: { marginBottom: '14px' } },
                    react_1.default.createElement("label", { style: theme_1.s.label }, lang === 'zh' ? '提供商' : 'Provider'),
                    react_1.default.createElement("select", { style: theme_1.s.select, value: selectedGroup, onChange: e => handleGroupChange(e.target.value) }, GROUPS.map(g => react_1.default.createElement("option", { key: g, value: g }, g)))),
                !isCustomGroup && (react_1.default.createElement("div", { style: { marginBottom: '14px' } },
                    react_1.default.createElement("label", { style: theme_1.s.label }, lang === 'zh' ? '型号' : 'Model'),
                    isRelayGroup ? (react_1.default.createElement("select", { style: theme_1.s.select, value: selectedModelId, onChange: e => handleModelChange(e.target.value) }, (() => {
                        const grouped = {};
                        modelsInGroup.forEach(([id, d]) => {
                            (grouped[d.group] = grouped[d.group] || []).push([id, d]);
                        });
                        return Object.entries(grouped).map(([group, models]) => (react_1.default.createElement("optgroup", { key: group, label: group }, models.map(([id, d]) => react_1.default.createElement("option", { key: id, value: id }, d.label)))));
                    })())) : (react_1.default.createElement("select", { style: theme_1.s.select, value: selectedModelId, onChange: e => handleModelChange(e.target.value) }, modelsInGroup.map(([id, d]) => react_1.default.createElement("option", { key: id, value: id }, d.label)))),
                    def && react_1.default.createElement("p", { style: theme_1.s.hint }, def.note),
                    isRelayGroup && (react_1.default.createElement("div", { style: { marginTop: '10px' } },
                        react_1.default.createElement("label", { style: theme_1.s.label }, lang === 'zh' ? '中转平台（点击快速填入）' : 'Relay Platform (click to fill Base URL)'),
                        react_1.default.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' } }, RELAY_PRESETS.map(r => (react_1.default.createElement("button", { key: r.name, onClick: () => setBaseUrl(r.url), style: {
                                ...theme_1.s.btnSecondary, fontSize: '11px', padding: '4px 10px',
                                background: baseUrl === r.url ? 'var(--vscode-button-background)' : undefined,
                                color: baseUrl === r.url ? 'var(--vscode-button-foreground)' : undefined,
                            } }, r.name)))),
                        RELAY_PRESETS.map(r => baseUrl === r.url && (react_1.default.createElement("p", { key: r.name, style: { ...theme_1.s.hint, marginTop: '6px' } },
                            r.note,
                            " \u2014 ",
                            react_1.default.createElement("a", { href: r.site, style: { color: 'var(--vscode-textLink-foreground)' } }, "\u6CE8\u518C / \u83B7\u53D6 Key \u2197")))),
                        react_1.default.createElement("div", { style: { marginTop: '8px' } },
                            react_1.default.createElement("label", { style: theme_1.s.label }, "Base URL"),
                            react_1.default.createElement("input", { style: theme_1.s.input, value: baseUrl, onChange: e => setBaseUrl(e.target.value), placeholder: "https://your-relay.com/v1" })))),
                    !isRelayGroup && def?.relay && (react_1.default.createElement("p", { style: { ...theme_1.s.hint, color: 'var(--vscode-errorForeground)', marginTop: '6px' } }, "\u6B64\u6A21\u578B\u9700\u8981\u4E2D\u8F6C\u670D\u52A1\uFF0C\u4E0B\u4E00\u6B65\u586B\u5199\u4E2D\u8F6C\u5730\u5740\u3002")))),
                isCustomGroup && (react_1.default.createElement(react_1.default.Fragment, null,
                    react_1.default.createElement("div", { style: { marginBottom: '12px' } },
                        react_1.default.createElement("label", { style: theme_1.s.label },
                            "Model ID ",
                            react_1.default.createElement("span", { style: { fontWeight: 400, opacity: 0.7 } }, "(\u63A5\u53E3\u4E2D\u4F7F\u7528\u7684\u6A21\u578B\u540D\u79F0)")),
                        react_1.default.createElement("input", { style: theme_1.s.input, value: customModelId, onChange: e => setCustomModelId(e.target.value), placeholder: "e.g. gpt-4o / claude-3-5-sonnet-20241022" })),
                    react_1.default.createElement("div", { style: { marginBottom: '12px' } },
                        react_1.default.createElement("label", { style: theme_1.s.label },
                            "\u663E\u793A\u540D\u79F0 ",
                            react_1.default.createElement("span", { style: { fontWeight: 400, opacity: 0.7 } }, "(\u5728\u5217\u8868\u91CC\u663E\u793A\u7684\u540D\u5B57)")),
                        react_1.default.createElement("input", { style: theme_1.s.input, value: customLabel, onChange: e => setCustomLabel(e.target.value), placeholder: "e.g. \u6211\u7684\u4E13\u5C5E\u6A21\u578B" })))),
                react_1.default.createElement("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' } },
                    react_1.default.createElement("button", { style: theme_1.s.btnSecondary, onClick: onClose }, "\u53D6\u6D88"),
                    react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: () => setStep(2), disabled: !isCustomGroup && !selectedModelId }, "\u4E0B\u4E00\u6B65")))),
            step === 2 && (react_1.default.createElement(react_1.default.Fragment, null,
                stepHeader(2, '任务分配'),
                isEdit && (react_1.default.createElement("div", { style: { marginBottom: '14px' } },
                    react_1.default.createElement("label", { style: theme_1.s.label },
                        "Model ID\u00A0",
                        react_1.default.createElement("span", { style: { fontWeight: 400, opacity: 0.7 } }, `(可直接修改型号，如 ${GROUP_MODEL_EXAMPLES[selectedGroup] ?? 'glm-5 / glm-4.7'})`)),
                    react_1.default.createElement("input", { style: theme_1.s.input, value: isCustomGroup ? customModelId : selectedModelId, onChange: e => isCustomGroup ? setCustomModelId(e.target.value) : setSelectedModelId(e.target.value), placeholder: GROUP_MODEL_EXAMPLES[selectedGroup] ?? '如 glm-5、deepseek-chat、MiniMax-M2.5' }))),
                react_1.default.createElement("div", { style: { marginBottom: '16px' } },
                    react_1.default.createElement("label", { style: { ...theme_1.s.label, display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                        react_1.default.createElement("span", null,
                            lang === 'zh' ? '任务类型（多选）' : 'Task Types (multi-select)',
                            react_1.default.createElement("span", { style: { fontWeight: 400, fontSize: '11px', opacity: 0.65, marginLeft: '8px' } }, "\u5DF2\u6309\u6A21\u578B\u7279\u70B9\u9884\u8BBE\uFF0C\u53EF\u81EA\u7531\u4FEE\u6539")),
                        def?.defaultTasks && (react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, padding: '2px 8px', fontSize: '10px', marginLeft: '8px' }, onClick: () => setTasks([...(def?.defaultTasks || [])]) }, lang === 'zh' ? '恢复默认' : 'Reset'))),
                    react_1.default.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' } }, TASK_TYPES.map(t => {
                        const sel = tasks.includes(t.id);
                        return (react_1.default.createElement("span", { key: t.id, onClick: () => toggleTask(t.id), style: {
                                padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                                background: sel ? 'var(--vscode-button-background)' : 'var(--vscode-input-background)',
                                color: sel ? 'var(--vscode-button-foreground)' : 'var(--vscode-descriptionForeground)',
                                border: '1px solid var(--vscode-input-border)',
                                userSelect: 'none',
                            } }, lang === 'zh' ? t.zh : t.en));
                    }))),
                react_1.default.createElement("div", { style: { marginBottom: '14px' } },
                    react_1.default.createElement("label", { style: theme_1.s.label },
                        "Base URL",
                        def?.relay && (react_1.default.createElement("span", { style: { fontWeight: 400, fontSize: '11px', color: 'var(--vscode-errorForeground)', marginLeft: '6px' } }, "\u6B64\u6A21\u578B\u9700\u8981\u586B\u5199\u4E2D\u8F6C\u670D\u52A1\u5730\u5740"))),
                    react_1.default.createElement("input", { style: theme_1.s.input, value: baseUrl, onChange: e => setBaseUrl(e.target.value), placeholder: "https://api.xxx.com/v1" }),
                    react_1.default.createElement("p", { style: theme_1.s.hint }, def?.relay
                        ? '推荐中转：OpenRouter (openrouter.ai) · 硅基流动 (siliconflow.cn)'
                        : '已自动填入官方地址，如使用中转服务可修改。')),
                react_1.default.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' } },
                    react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: () => setStep(1) }, "\u4E0A\u4E00\u6B65"),
                    react_1.default.createElement("div", { style: { display: 'flex', gap: '8px' } },
                        react_1.default.createElement("button", { style: theme_1.s.btnSecondary, onClick: onClose }, "\u53D6\u6D88"),
                        react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: () => setStep(3) }, "\u4E0B\u4E00\u6B65"))))),
            step === 3 && (react_1.default.createElement(react_1.default.Fragment, null,
                stepHeader(3, 'API Key'),
                react_1.default.createElement("div", { style: { marginBottom: '6px' } },
                    react_1.default.createElement("label", { style: theme_1.s.label }, "API Key"),
                    react_1.default.createElement("input", { type: "password", style: theme_1.s.input, value: apiKey, onChange: e => setApiKey(e.target.value), placeholder: "sk-..." }),
                    react_1.default.createElement("p", { style: theme_1.s.hint }, "\u52A0\u5BC6\u5B58\u50A8\uFF0C\u4E0D\u4F1A\u660E\u6587\u4FDD\u5B58\u5230\u78C1\u76D8\u3002")),
                (() => {
                    const links = {
                        'DeepSeek': { text: '申请 DeepSeek Key', url: 'https://platform.deepseek.com' },
                        'GLM (智谱)': { text: '申请智谱 Key', url: 'https://open.bigmodel.cn' },
                        'Qwen (通义)': { text: '申请通义 Key', url: 'https://dashscope.aliyun.com' },
                        'MiniMax': { text: '申请 MiniMax Key', url: 'https://api.minimax.chat' },
                        'Moonshot (Kimi)': { text: '申请 Kimi Key', url: 'https://platform.moonshot.cn' },
                        'OpenAI': { text: '申请 OpenAI Key', url: 'https://platform.openai.com/api-keys' },
                        'Anthropic (Claude)': { text: '申请 Claude Key', url: 'https://console.anthropic.com' },
                        'Google (Gemini)': { text: '申请 Gemini Key', url: 'https://aistudio.google.com/apikey' },
                    };
                    const g = isEdit ? (MODEL_DEFS[existing.model.modelId]?.group || '') : selectedGroup;
                    const link = links[g];
                    if (!link) {
                        return null;
                    }
                    return (react_1.default.createElement("p", { style: { ...theme_1.s.hint, marginTop: '10px' } },
                        "\u8FD8\u6CA1\u6709 Key\uFF1F",
                        react_1.default.createElement("a", { href: link.url, style: { color: 'var(--vscode-textLink-foreground)', marginLeft: '4px', cursor: 'pointer' }, onClick: e => { e.preventDefault(); vscode_api_1.vscode.postMessage({ command: 'openUrl', url: link.url }); } }, link.text)));
                })(),
                react_1.default.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' } },
                    react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: () => setStep(2) }, "\u4E0A\u4E00\u6B65"),
                    react_1.default.createElement("div", { style: { display: 'flex', gap: '8px' } },
                        react_1.default.createElement("button", { style: theme_1.s.btnSecondary, onClick: onClose }, "\u53D6\u6D88"),
                        react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: handleSave }, "\u4FDD\u5B58"))))))));
};
const ConfigPanel = ({ lang }) => {
    const [models, setModels] = (0, react_1.useState)([]);
    const [apiKeys, setApiKeys] = (0, react_1.useState)({});
    const [showModal, setShowModal] = (0, react_1.useState)(false);
    const [editTarget, setEditTarget] = (0, react_1.useState)();
    const [showRouting, setShowRouting] = (0, react_1.useState)(false);
    const [testResults, setTestResults] = (0, react_1.useState)({});
    const [codexStatus, setCodexStatus] = (0, react_1.useState)(null);
    const [geminiStatus, setGeminiStatus] = (0, react_1.useState)(null);
    const hasAutoTested = react_1.default.useRef(false);
    (0, react_1.useEffect)(() => {
        const handler = (ev) => {
            if (ev.data.command === 'loadModelsV2') {
                const loadedModels = ev.data.models || [];
                const loadedKeys = ev.data.apiKeys || {};
                setModels(loadedModels);
                setApiKeys(loadedKeys);
                // Only auto-test on first load, not on every tab switch
                if (!hasAutoTested.current) {
                    hasAutoTested.current = true;
                    setTimeout(() => {
                        loadedModels.forEach((m) => {
                            const key = loadedKeys[m.id];
                            if (!key || !m.baseUrl || !m.enabled)
                                return;
                            const requestId = `autotest_${m.id}_${Date.now()}`;
                            vscode_api_1.vscode.postMessage({ command: 'testConnection', modelId: m.modelId, baseUrl: m.baseUrl, apiKey: key, requestId });
                        });
                    }, 2000);
                }
            }
            // Handle auto-test results (same handler as manual test)
            if (ev.data.command === 'testResult' && ev.data.requestId?.startsWith('autotest_')) {
                // Extract model config id from requestId: autotest_{configId}_{timestamp}
                const parts = ev.data.requestId.split('_');
                const configId = parts.slice(1, -1).join('_');
                setTestResults(prev => ({ ...prev, [configId]: { ok: ev.data.ok, msg: ev.data.ok ? '已连通' : (ev.data.msg || '失败') } }));
            }
            if (ev.data.command === 'codexStatus') {
                setCodexStatus({ installed: ev.data.installed, version: ev.data.version, loggedIn: ev.data.loggedIn });
            }
            if (ev.data.command === 'geminiStatus') {
                setGeminiStatus({ installed: ev.data.installed, version: ev.data.version, loggedIn: ev.data.loggedIn });
            }
        };
        window.addEventListener('message', handler);
        vscode_api_1.vscode.postMessage({ command: 'getModelsV2' });
        vscode_api_1.vscode.postMessage({ command: 'getCodexStatus' });
        vscode_api_1.vscode.postMessage({ command: 'getGeminiStatus' });
        return () => window.removeEventListener('message', handler);
    }, []);
    const handleSave = (0, react_1.useCallback)((modelConfig, apiKey) => {
        if (editTarget) {
            vscode_api_1.vscode.postMessage({ command: 'updateModel', id: modelConfig.id, patch: modelConfig, apiKey });
        }
        else {
            vscode_api_1.vscode.postMessage({ command: 'addModel', modelConfig, apiKey });
        }
        setShowModal(false);
        setEditTarget(undefined);
    }, [editTarget]);
    const handleEdit = (model, key) => { setEditTarget({ model, apiKey: key }); setShowModal(true); };
    const handleRemove = (id) => vscode_api_1.vscode.postMessage({ command: 'removeModel', id });
    const handleToggle = (id, enabled) => {
        vscode_api_1.vscode.postMessage({ command: 'updateModel', id, patch: { enabled } });
        setModels(prev => prev.map(m => m.id === id ? { ...m, enabled } : m));
    };
    const enabled = models.filter(m => m.enabled).length;
    return (react_1.default.createElement("div", { style: { maxWidth: '700px', paddingBottom: '40px' } },
        react_1.default.createElement("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' } },
            react_1.default.createElement("div", null,
                react_1.default.createElement("h2", { style: { margin: '0 0 4px', fontSize: '15px' } }, lang === 'zh' ? '模型管理' : 'Model Management'),
                react_1.default.createElement("p", { style: { margin: 0, fontSize: '12px', color: 'var(--vscode-descriptionForeground)' } }, lang === 'zh'
                    ? `${enabled} 个模型已启用 · 按任务类型自动路由`
                    : `${enabled} model(s) enabled · Conductor Hub auto-routes each task to the matching model`)),
            react_1.default.createElement("button", { style: theme_1.s.btnPrimary, onClick: () => { setEditTarget(undefined); setShowModal(true); } }, lang === 'zh' ? '+ 添加模型' : '+ Add Model')),
        models.length === 0 ? (react_1.default.createElement("div", { style: {
                textAlign: 'center', padding: '50px 20px',
                color: 'var(--vscode-descriptionForeground)',
                border: '1px dashed var(--vscode-panel-border)',
                borderRadius: '6px',
            } },
            react_1.default.createElement("div", { style: { marginBottom: '10px', fontSize: '14px' } }, lang === 'zh' ? '尚未配置任何模型' : 'No models configured'),
            react_1.default.createElement("div", { style: { fontSize: '12px' } }, lang === 'zh' ? '点击「+ 添加模型」开始' : 'Click "+ Add Model" to get started'))) : (models.map(m => (react_1.default.createElement(ModelCard, { key: m.id, model: m, apiKey: apiKeys[m.id] || '', lang: lang, onEdit: handleEdit, onRemove: handleRemove, onToggle: handleToggle, initialTestResult: testResults[m.id] })))),
        react_1.default.createElement("div", { style: { marginTop: '24px' } },
            react_1.default.createElement("h3", { style: { margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--vscode-descriptionForeground)', letterSpacing: '0.03em', textTransform: 'uppercase' } }, lang === 'zh' ? '本地 CLI 工具' : 'Local CLI Tools'),
            react_1.default.createElement("div", { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } },
                react_1.default.createElement("div", { style: {
                        flex: '1 1 300px', minWidth: '280px',
                        background: 'rgba(255,255,255,0.03)',
                        backdropFilter: 'blur(24px)',
                        border: `1px solid ${codexStatus?.installed && codexStatus?.loggedIn ? 'rgba(16,163,127,0.3)' : theme_1.colors.glassBorder}`,
                        borderRadius: theme_1.radius.md,
                        padding: '14px 16px',
                        boxShadow: codexStatus?.installed && codexStatus?.loggedIn
                            ? '0 0 20px rgba(16,163,127,0.08), 0 4px 12px rgba(0,0,0,0.1)'
                            : theme_1.shadow.glass,
                        transition: 'all 0.3s ease',
                    } },
                    react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
                        react_1.default.createElement("div", { style: {
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: codexStatus === null ? '#888'
                                    : codexStatus.installed && codexStatus.loggedIn ? '#10A37F'
                                        : codexStatus.installed ? '#FBBF24' : '#F87171',
                                boxShadow: codexStatus?.installed && codexStatus?.loggedIn ? '0 0 8px rgba(16,163,127,0.5)' : 'none',
                            } }),
                        react_1.default.createElement("span", { style: { fontWeight: 600, fontSize: '13px' } }, "Codex CLI"),
                        codexStatus?.version && (react_1.default.createElement("span", { style: {
                                fontSize: '10px', opacity: 0.5, fontFamily: 'monospace',
                                background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px',
                            } },
                            "v",
                            codexStatus.version))),
                    react_1.default.createElement("div", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.5', marginBottom: '10px' } }, codexStatus === null ? (lang === 'zh' ? '正在检测…' : 'Detecting…')
                        : codexStatus.installed
                            ? (codexStatus.loggedIn
                                ? (lang === 'zh' ? 'ChatGPT 已登录 · ai_codex_task 可用' : 'ChatGPT logged in · ai_codex_task available')
                                : (lang === 'zh' ? '已安装 · 需登录 ChatGPT 账号' : 'Installed · Login required'))
                            : (lang === 'zh' ? '未安装 · ChatGPT Plus 免 API Key' : 'Not installed · ChatGPT Plus, no API Key needed')),
                    react_1.default.createElement("div", { style: { display: 'flex', gap: '6px' } },
                        !codexStatus?.installed && (react_1.default.createElement("button", { style: { ...theme_1.s.btnPrimary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'npm install -g @openai/codex && codex login' }) }, lang === 'zh' ? '安装' : 'Install')),
                        codexStatus?.installed && (react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'codex login' }) }, lang === 'zh' ? '登录' : 'Login')),
                        react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/openai/codex' }) }, lang === 'zh' ? '文档' : 'Docs'))),
                react_1.default.createElement("div", { style: {
                        flex: '1 1 300px', minWidth: '280px',
                        background: 'rgba(255,255,255,0.03)',
                        backdropFilter: 'blur(24px)',
                        border: `1px solid ${geminiStatus?.installed && geminiStatus?.loggedIn ? 'rgba(66,133,244,0.3)' : theme_1.colors.glassBorder}`,
                        borderRadius: theme_1.radius.md,
                        padding: '14px 16px',
                        boxShadow: geminiStatus?.installed && geminiStatus?.loggedIn
                            ? '0 0 20px rgba(66,133,244,0.08), 0 4px 12px rgba(0,0,0,0.1)'
                            : theme_1.shadow.glass,
                        transition: 'all 0.3s ease',
                    } },
                    react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
                        react_1.default.createElement("div", { style: {
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: geminiStatus === null ? '#888'
                                    : geminiStatus.installed && geminiStatus.loggedIn ? '#4285F4'
                                        : geminiStatus.installed ? '#FBBF24' : '#F87171',
                                boxShadow: geminiStatus?.installed && geminiStatus?.loggedIn ? '0 0 8px rgba(66,133,244,0.5)' : 'none',
                            } }),
                        react_1.default.createElement("span", { style: { fontWeight: 600, fontSize: '13px' } }, "Gemini CLI"),
                        geminiStatus?.version && (react_1.default.createElement("span", { style: {
                                fontSize: '10px', opacity: 0.5, fontFamily: 'monospace',
                                background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px',
                            } },
                            "v",
                            geminiStatus.version))),
                    react_1.default.createElement("div", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.5', marginBottom: '10px' } }, geminiStatus === null ? (lang === 'zh' ? '正在检测…' : 'Detecting…')
                        : geminiStatus.installed
                            ? (geminiStatus.loggedIn
                                ? (lang === 'zh' ? 'Google 已登录 · ai_gemini_task 可用' : 'Google logged in · ai_gemini_task available')
                                : (lang === 'zh' ? '已安装 · 需登录 Google 账号' : 'Installed · Login required'))
                            : (lang === 'zh' ? '未安装 · Google 账号免 API Key' : 'Not installed · Google account, no API Key needed')),
                    react_1.default.createElement("div", { style: { display: 'flex', gap: '6px' } },
                        !geminiStatus?.installed && (react_1.default.createElement("button", { style: { ...theme_1.s.btnPrimary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'npm install -g @google/gemini-cli && gemini' }) }, lang === 'zh' ? '安装' : 'Install')),
                        geminiStatus?.installed && (react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'gemini' }) }, lang === 'zh' ? '登录' : 'Login')),
                        react_1.default.createElement("button", { style: { ...theme_1.s.btnSecondary, fontSize: '11px', padding: '5px 12px', borderRadius: theme_1.radius.sm }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/google/gemini-cli' }) }, lang === 'zh' ? '文档' : 'Docs'))))),
        react_1.default.createElement("div", { style: { marginTop: '18px' } },
            react_1.default.createElement("button", { onClick: () => setShowRouting(!showRouting), style: {
                    ...theme_1.s.btnSecondary,
                    width: '100%', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                } },
                react_1.default.createElement("span", null, lang === 'zh' ? '路由推荐参考 — 各任务最佳模型' : 'Routing Reference (Best Model per Task)'),
                react_1.default.createElement("span", { style: { fontSize: '10px' } }, showRouting ? '▲' : '▼')),
            showRouting && (react_1.default.createElement("div", { style: {
                    marginTop: '6px', border: '1px solid var(--vscode-input-border)',
                    borderRadius: '4px', overflow: 'hidden',
                } },
                react_1.default.createElement("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } },
                    react_1.default.createElement("thead", null,
                        react_1.default.createElement("tr", { style: { background: 'var(--vscode-editor-inactiveSelectionBackground)', textAlign: 'left' } },
                            react_1.default.createElement("th", { style: { padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' } }, lang === 'zh' ? '任务类型' : 'Task Type'),
                            react_1.default.createElement("th", { style: { padding: '6px 10px', fontWeight: 600 } }, lang === 'zh' ? '推荐模型' : 'Recommended'),
                            react_1.default.createElement("th", { style: { padding: '6px 10px', fontWeight: 600 } }, lang === 'zh' ? '原因' : 'Why'))),
                    react_1.default.createElement("tbody", null, [
                        [lang === 'zh' ? '代码生成' : 'Code Gen', [['DeepSeek', 'V3'], ['Qwen (通义)', 'Coder-Plus']], lang === 'zh' ? '性价比最高；代码专项同级' : 'Best cost-efficiency; code specialist'],
                        [lang === 'zh' ? '调试 / 重构' : 'Debug', [['Anthropic (Claude)', 'Opus 4.6'], ['OpenAI', 'GPT-5.3 Codex']], lang === 'zh' ? '全球编程最强；Terminal-Bench #1' : 'Best coding; Terminal-Bench #1'],
                        [lang === 'zh' ? '架构设计' : 'Architecture', [['Anthropic (Claude)', 'Opus 4.6'], ['GLM (智谱)', 'GLM-5']], lang === 'zh' ? '企业级 Agentic；工程接近 Opus' : 'Enterprise Agentic; near Opus'],
                        [lang === 'zh' ? '文档' : 'Docs', [['Anthropic (Claude)', 'Sonnet 4.6'], ['Qwen (通义)', 'Max']], lang === 'zh' ? '均衡首选；中文文档最强' : 'Balanced; best Chinese docs'],
                        [lang === 'zh' ? '翻译' : 'Translation', [['Qwen (通义)', 'Max'], ['Mistral', 'Large 3']], lang === 'zh' ? '中文第一；欧洲多语言' : 'Chinese #1; EU multilingual'],
                        [lang === 'zh' ? 'UI / 前端' : 'UI & Frontend', [['Google (Gemini)', '3.1 Flash'], ['MiniMax', 'M2.5']], lang === 'zh' ? '多模态视觉；100 tok/s' : 'Multimodal; 100 tok/s'],
                        [lang === 'zh' ? '图像理解' : 'Vision', [['Google (Gemini)', '3.1 Pro'], ['OpenAI', 'GPT-5.1']], lang === 'zh' ? '百万 token 多模态' : 'Million token multimodal'],
                        [lang === 'zh' ? '长文本' : 'Long Context', [['Google (Gemini)', '3.1 Pro'], ['Kimi K2', 'K2.5']], lang === 'zh' ? '百万上下文；256K MoE' : 'Million ctx; 256K MoE'],
                        [lang === 'zh' ? '推理' : 'Reasoning', [['DeepSeek', 'R1'], ['Google (Gemini)', '3.1 Pro']], lang === 'zh' ? '思维链顶尖；ARC-AGI-2 #1' : 'CoT top; ARC-AGI-2 #1'],
                        [lang === 'zh' ? '工具调用' : 'Tool Calling', [['Qwen (通义)', 'Max'], ['OpenAI', 'GPT-5.1']], lang === 'zh' ? 'Tau2-bench #1' : 'Tau2-bench #1'],
                        [lang === 'zh' ? 'Agentic' : 'Agentic', [['MiniMax', 'M2.5'], ['Anthropic (Claude)', 'Opus 4.6']], lang === 'zh' ? 'SWE-bench 80.2%' : 'SWE-bench 80.2%'],
                        [lang === 'zh' ? '终端 / DevOps' : 'Terminal', [['OpenAI', 'GPT-5.3 Codex'], ['OpenAI', 'Codex CLI']], lang === 'zh' ? 'Terminal-Bench #1' : 'Terminal-Bench #1'],
                    ].map(([task, models, reason], i) => (react_1.default.createElement("tr", { key: task, style: {
                            background: i % 2 === 0 ? 'transparent' : 'var(--vscode-editor-inactiveSelectionBackground)',
                            borderTop: '1px solid var(--vscode-input-border)',
                        } },
                        react_1.default.createElement("td", { style: { padding: '5px 10px', whiteSpace: 'nowrap', fontWeight: 500 } }, task),
                        react_1.default.createElement("td", { style: { padding: '5px 10px', fontSize: '11px' } }, models.map(([prov, name], j) => (react_1.default.createElement("span", { key: j },
                            j > 0 && react_1.default.createElement("span", { style: { opacity: 0.4, margin: '0 4px' } }, "/"),
                            react_1.default.createElement("span", { style: {
                                    color: theme_1.providerColors[prov] || 'inherit',
                                    fontWeight: 600,
                                } }, name))))),
                        react_1.default.createElement("td", { style: { padding: '5px 10px', fontSize: '11px', opacity: 0.8 } }, reason)))))),
                react_1.default.createElement("div", { style: {
                        padding: '6px 10px', fontSize: '10px',
                        color: 'var(--vscode-descriptionForeground)',
                        borderTop: '1px solid var(--vscode-input-border)',
                    } }, lang === 'zh'
                    ? '以上仅为参考，实际路由取决于已配置的模型。Conductor Hub 支持所有 OpenAI 兼容接口，不限于上表。'
                    : 'These are recommendations only. Actual routing depends on your configured models. Conductor Hub supports any OpenAI-compatible model.')))),
        react_1.default.createElement("div", { style: {
                marginTop: '12px', padding: '10px 14px',
                background: 'var(--vscode-textBlockQuote-background)',
                borderLeft: '3px solid var(--vscode-activityBarBadge-background)',
                borderRadius: '0 4px 4px 0',
                fontSize: '11px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.6',
            } }, lang === 'zh'
            ? '路由规则：按任务类型匹配已启用的模型，选优先级最高的（列表靠上）。可随时添加新模型、自定义任务分配。'
            : 'Routing: Conductor Hub matches the task type to enabled models and picks the highest-priority one (top of list). You can add any model and customize task assignments.'),
        showModal && (react_1.default.createElement(AddEditModal, { lang: lang, existing: editTarget, onSave: handleSave, onClose: () => { setShowModal(false); setEditTarget(undefined); } }))));
};
exports.default = ConfigPanel;
