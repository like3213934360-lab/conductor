import React, { useState, useEffect, useCallback } from 'react';
import { vscode } from '../vscode-api';
import { s, colors, radius, shadow, providerColors } from '../theme';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelConfig {
    id: string;
    modelId: string;
    label: string;
    baseUrl: string;
    tasks: string[];
    enabled: boolean;
    priority: number;
}

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

// ─── Model Registry ───────────────────────────────────────────────────────────

interface ModelDef {
    label: string;
    group: string;
    baseUrl: string;
    defaultTasks: string[];
    note: string;
    relay?: boolean;
}

const MODEL_DEFS: Record<string, ModelDef> = {
    // ─── DeepSeek ─────────────────────────────────────────────────────────────
    'deepseek-chat': {
        label: 'V3.2',
        group: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultTasks: ['code_gen', 'code_review', 'math_reasoning'],
        note: '最新 V3.2（2025-12）综合能力强，性价比最高',
    },
    'deepseek-reasoner': {
        label: 'R1',
        group: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultTasks: ['math_reasoning', 'architecture', 'code_review'],
        note: 'R1 深度推理，思维链分析、数学、规划',
    },
    // ─── GLM (智谱) ────────────────────────────────────────────────────────────
    'glm-5': {
        label: 'GLM-5 通用',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        defaultTasks: ['architecture', 'agentic', 'tool_calling', 'code_gen'],
        note: '最新旗舰（2026-02）· 通用 API 端点 · 按量计费',
    },
    'glm-5-coding': {
        label: 'GLM-5 编程版',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        defaultTasks: ['architecture', 'agentic', 'code_gen', 'code_review'],
        note: 'Coding Plan 包月专属端点 · 消耗 2x-3x 配额（Complex 任务）',
    },
    'glm-4.7': {
        label: 'GLM-4.7 编程版',
        group: 'GLM (智谱)',
        baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'tool_calling'],
        note: 'Coding Plan 日常首选 · 1x 配额消耗 · 省额度',
    },
    // ─── Qwen (通义) ──────────────────────────────────────────────────────────
    'qwen-max': {
        label: 'Qwen3-Max',
        group: 'Qwen (通义)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultTasks: ['translation', 'documentation', 'tool_calling', 'code_gen'],
        note: '通义最新旗舰（Qwen3.5），中文理解与翻译最强',
    },
    'qwen-coder-plus': {
        label: 'Qwen Coder Plus',
        group: 'Qwen (通义)',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic'],
        note: '代码专项旗舰，Agentic 编程与工具调用',
    },
    // ─── MiniMax ──────────────────────────────────────────────────────────────
    'MiniMax-M2.5': {
        label: 'M2.5 通用',
        group: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        defaultTasks: ['agentic', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新旗舰（2025-12），SWE-bench 80.2%，按量计费，普通 API Key',
    },
    'MiniMax-M2.5-highspeed': {
        label: 'M2.5-highspeed Coding Plan',
        group: 'MiniMax',
        baseUrl: 'https://api.minimax.io/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'long_context'],
        note: 'Coding Plan 包月专用，填 sk-cp-... Key · Plus 高速套餐 · 已验证可连通',
    },
    // ─── Kimi K2 ──────────────────────────────────────────────────────────────
    'kimi-k2-instruct': {
        label: 'Kimi K2.5 (推荐)',
        group: 'Kimi K2',
        baseUrl: 'https://api.moonshot.cn/v1',
        defaultTasks: ['agentic', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新 K2.5（2026-01），1T MoE，256K 上下文，Agentic 顶尖',
    },
    // ─── OpenAI ───────────────────────────────────────────────────────────────
    'gpt-5.1': {
        label: 'GPT-5.1 (推荐)',
        group: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultTasks: ['code_gen', 'vision', 'architecture', 'long_context'],
        note: '最新旗舰，超长上下文，复杂推理与多模态，官方直连',
    },
    'gpt-5.3-codex': {
        label: 'GPT-5.3 Codex (编程)',
        group: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultTasks: ['code_gen', 'code_review', 'agentic', 'tool_calling'],
        note: 'Terminal-Bench #1，Agentic 编程与 DevOps 顶尖，官方直连',
    },
    // ─── Anthropic (Claude) ───────────────────────────────────────────────────
    'claude-opus-4-6': {
        label: 'Claude Opus 4.6 (推荐)',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['architecture', 'agentic', 'code_review', 'long_context'],
        note: '最新旗舰（2026-02），全球编程最强，企业级 Agentic，官方直连',
    },
    'claude-sonnet-4-6': {
        label: 'Claude Sonnet 4.6',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_gen', 'creative', 'architecture', 'documentation'],
        note: '最新（2026-02），性能与成本最佳平衡，通用主力，官方直连',
    },
    'claude-opus-4-5': {
        label: 'Claude Opus 4.5',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_review', 'architecture', 'agentic'],
        note: 'SWE-bench 72.5% 编程顶尖（2025-05），官方直连',
    },
    'claude-sonnet-4-5': {
        label: 'Claude Sonnet 4.5',
        group: 'Anthropic (Claude)',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultTasks: ['code_gen', 'creative', 'documentation'],
        note: '均衡旗舰（2025-05），代码与内容创作首选，官方直连',
    },
    // ─── Google Gemini ────────────────────────────────────────────────────────
    'gemini-3.1-flash': {
        label: 'Gemini 3.1 Flash (推荐)',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['vision', 'code_gen', 'tool_calling', 'long_context'],
        note: '最新 Flash（2026），速度快成本低，多模态全能，官方直连',
    },
    'gemini-3.1-pro-preview': {
        label: 'Gemini 3.1 Pro Preview',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['math_reasoning', 'architecture', 'long_context', 'vision'],
        note: '顶级推理，百万 token 上下文，官方直连',
    },
    'gemini-3-image': {
        label: 'Gemini Image Gen (生图)',
        group: 'Google (Gemini)',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultTasks: ['vision', 'creative', 'ui_design'],
        note: '专用图像生成与编辑（Imagen 3 驱动），官方直连',
    },
    // ─── Mistral ──────────────────────────────────────────────────────────────
    'mistral-large-latest': {
        label: 'Mistral Large 3 (推荐)',
        group: 'Mistral',
        baseUrl: 'https://api.mistral.ai/v1',
        defaultTasks: ['translation', 'tool_calling', 'code_gen'],
        note: '欧洲隐私合规，多语言优秀，官方直连',
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
const GROUP_MODEL_EXAMPLES: Record<string, string> = {
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

const TaskBadge: React.FC<{ id: string; lang: string }> = ({ id, lang }) => {
    const t = TASK_TYPES.find(t => t.id === id);
    if (!t) { return null; }
    return (
        <span style={{
            display: 'inline-block',
            margin: '2px 4px 2px 0',
            padding: '3px 10px',
            borderRadius: radius.pill,
            fontSize: '10px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--vscode-descriptionForeground)',
            border: `1px solid ${colors.glassBorder}`,
            whiteSpace: 'nowrap',
        }}>
            {lang === 'zh' ? t.zh : t.en}
        </span>
    );
};

// ── SourceBadge ───────────────────────────────────────────────────────────────

const SOURCE_META: Record<string, { label: string; color: string }> = {
    builtin: { label: '内置', color: '#06B6D4' },
    local:   { label: '本地', color: '#94A3B8' },
    npm:     { label: 'npm',  color: '#CB3837' },
    pypi:    { label: 'PyPI', color: '#3B82F6' },
    ai:      { label: 'AI',   color: '#8B5CF6' },
};

const SourceBadge: React.FC<{ source?: string }> = ({ source }) => {
    const meta = SOURCE_META[source || ''];
    if (!meta) return null;
    return (
        <span style={{
            display: 'inline-block',
            padding: '1px 6px',
            borderRadius: radius.pill,
            fontSize: '9px',
            fontWeight: 600,
            letterSpacing: '0.03em',
            background: `${meta.color}18`,
            color: meta.color,
            border: `1px solid ${meta.color}30`,
            whiteSpace: 'nowrap',
            flexShrink: 0,
        }}>
            {meta.label}
        </span>
    );
};

// ─── ModelCard ────────────────────────────────────────────────────────────────

const ModelCard: React.FC<{
    model: ModelConfig;
    apiKey: string;
    lang: string;
    initialTestResult?: { ok: boolean; msg: string };
    onEdit: (m: ModelConfig, key: string) => void;
    onRemove: (id: string) => void;
    onToggle: (id: string, enabled: boolean) => void;
}> = ({ model, apiKey, lang, initialTestResult, onEdit, onRemove, onToggle }) => {
    const def = MODEL_DEFS[model.modelId];
    const [testState, setTestState] = React.useState<'idle' | 'testing' | 'ok' | 'fail'>(
        initialTestResult ? (initialTestResult.ok ? 'ok' : 'fail') : 'idle'
    );
    const [testMsg, setTestMsg] = React.useState(initialTestResult?.msg || '');
    const [confirmDelete, setConfirmDelete] = React.useState(false);

    // Update when auto-test result arrives from parent
    React.useEffect(() => {
        if (initialTestResult) {
            setTestState(initialTestResult.ok ? 'ok' : 'fail');
            setTestMsg(initialTestResult.msg);
        }
    }, [initialTestResult?.ok, initialTestResult?.msg]);

    const handleTest = async () => {
        if (!apiKey) { setTestState('fail'); setTestMsg(lang === 'zh' ? '未配置 API Key' : 'API Key not set'); return; }
        if (!model.baseUrl) { setTestState('fail'); setTestMsg('Base URL 未设置'); return; }
        setTestState('testing'); setTestMsg('');
        // Route through extension host (Node.js) to bypass CORS restrictions
        const requestId = `test_${Date.now()}`;
        vscode.postMessage({ command: 'testConnection', modelId: model.modelId, baseUrl: model.baseUrl, apiKey, requestId });
        // Listen for the response
        const handler = (event: MessageEvent) => {
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

    return (
        <div style={{
            background: colors.glass,
            backdropFilter: colors.glassBlur,
            WebkitBackdropFilter: colors.glassBlur,
            border: `1px solid ${colors.glassBorder}`,
            borderRadius: radius.lg,
            boxShadow: shadow.glass,
            padding: '16px 18px',
            marginBottom: '10px',
            opacity: model.enabled ? 1 : 0.5,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative' as const,
        }}>
            {/* Row 1: Provider info + actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                    {/* Provider color dot */}
                    <div style={{
                        width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                        background: providerColors[def?.group || ''] || colors.brand,
                        boxShadow: `0 0 8px ${providerColors[def?.group || ''] || colors.brand}60`,
                    }} />
                    <span style={{ fontWeight: 600, fontSize: '13px', letterSpacing: '-0.2px' }}>{def?.group || model.modelId}</span>
                    <span style={{
                        fontSize: '12px', fontWeight: 500,
                        color: providerColors[def?.group || ''] || colors.brand,
                        opacity: 0.9,
                    }}>{model.label}</span>
                </div>
                {/* Compact action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <button onClick={handleTest} disabled={testState === 'testing'}
                        style={{ ...s.btnSecondary, padding: '4px 12px', fontSize: '11px', borderRadius: radius.pill }}>
                        {testState === 'testing' ? '…' : (lang === 'zh' ? '测试' : 'Test')}
                    </button>
                    <button style={{ ...s.btnSecondary, padding: '4px 12px', fontSize: '11px', borderRadius: radius.pill }}
                        onClick={() => onToggle(model.id, !model.enabled)}>
                        {model.enabled ? (lang === 'zh' ? '禁用' : 'Off') : (lang === 'zh' ? '启用' : 'On')}
                    </button>
                    <button style={{ ...s.btnSecondary, padding: '4px 12px', fontSize: '11px', borderRadius: radius.pill }}
                        onClick={() => onEdit(model, apiKey)}>
                        {lang === 'zh' ? '编辑' : 'Edit'}
                    </button>
                    {!confirmDelete ? (
                        <button style={{ ...s.btnSecondary, padding: '4px 12px', fontSize: '11px', borderRadius: radius.pill, color: colors.error }}
                            onClick={() => setConfirmDelete(true)}>
                            {lang === 'zh' ? '删除' : 'Del'}
                        </button>
                    ) : (
                        <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button style={{ ...s.btnSecondary, padding: '3px 10px', fontSize: '10px', borderRadius: radius.pill, background: colors.error, color: '#fff', border: 'none' }}
                                onClick={() => { setConfirmDelete(false); onRemove(model.id); }}>
                                {lang === 'zh' ? '确认' : 'Yes'}
                            </button>
                            <button style={{ ...s.btnSecondary, padding: '3px 10px', fontSize: '10px', borderRadius: radius.pill }}
                                onClick={() => setConfirmDelete(false)}>
                                {lang === 'zh' ? '取消' : 'No'}
                            </button>
                        </span>
                    )}
                </div>
            </div>
            {/* Row 2: Description */}
            {def && (
                <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', margin: '8px 0 0 20px', opacity: 0.8, lineHeight: '1.5' }}>
                    {def.note}
                </div>
            )}
            {/* Row 3: Task badges */}
            <div style={{ margin: '10px 0 0 20px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {model.tasks.length > 0
                    ? model.tasks.map(t => <TaskBadge key={t} id={t} lang={lang} />)
                    : <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', opacity: 0.5 }}>{lang === 'zh' ? '未分配任务' : 'No tasks assigned'}</span>
                }
            </div>
            {/* Row 4: Footer — URL + API Key + test status */}
            <div style={{
                marginTop: '10px', paddingTop: '10px',
                borderTop: `1px solid ${colors.glassBorder}`,
                fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px',
                opacity: 0.7,
            }}>
                <span style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>{model.baseUrl || '(Base URL 未设置)'}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            background: apiKey ? colors.success : colors.error,
                            boxShadow: `0 0 4px ${apiKey ? colors.success : colors.error}`,
                        }} />
                        {apiKey ? 'API Key ✓' : 'API Key ✗'}
                    </span>
                </span>
                {testState !== 'idle' && (
                    <span style={{ color: testColor, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            background: testState === 'ok' ? colors.success : testState === 'fail' ? colors.error : 'var(--vscode-descriptionForeground)',
                            boxShadow: testState === 'ok' ? `0 0 4px ${colors.success}` : testState === 'fail' ? `0 0 4px ${colors.error}` : 'none',
                        }} />
                        {testState === 'testing' ? (lang === 'zh' ? '测试中…' : 'Testing…') : testMsg}
                    </span>
                )}
            </div>
        </div>
    );
};

// ─── AddEditModal ─────────────────────────────────────────────────────────────

const AddEditModal: React.FC<{
    lang: string;
    existing?: { model: ModelConfig; apiKey: string };
    onSave: (model: ModelConfig, apiKey: string) => void;
    onClose: () => void;
}> = ({ lang, existing, onSave, onClose }) => {
    const isEdit = !!existing;

    const [selectedGroup, setSelectedGroup] = useState(() => {
        if (existing) {
            // Try MODEL_DEFS lookup first (covers known models)
            const fromDef = MODEL_DEFS[existing.model.modelId]?.group;
            if (fromDef) return fromDef;
            // Fallback: detect from baseUrl pattern
            const url = existing.model.baseUrl || '';
            if (url.includes('bigmodel.cn') || url.includes('zhipuai')) return 'GLM (智谱)';
            if (url.includes('dashscope') || url.includes('aliyuncs')) return 'Qwen (通义)';
            if (url.includes('minimax') || url.includes('minimaxi')) return 'MiniMax';
            if (url.includes('moonshot') || url.includes('kimi')) return 'Kimi K2';
            if (url.includes('deepseek')) return 'DeepSeek';
            if (url.includes('anthropic') || url.includes('claude')) return '官方直连（国际）';
            if (url.includes('openai') || url.includes('googleapis')) return '官方直连（国际）';
        }
        return GROUPS[0];
    });
    const [selectedModelId, setSelectedModelId] = useState(existing?.model.modelId || '');
    const [customModelId, setCustomModelId] = useState(existing?.model.modelId || '');
    const [customLabel, setCustomLabel] = useState(existing?.model.label || '');
    const [baseUrl, setBaseUrl] = useState(existing?.model.baseUrl || '');
    const [tasks, setTasks] = useState<string[]>(existing?.model.tasks || []);
    const [apiKey, setApiKey] = useState(existing?.apiKey || '');
    const [step, setStep] = useState(existing ? 2 : 1);

    const isCustomGroup = selectedGroup === '自定义接口';
    const isRelayGroup = selectedGroup === '第三方中转';
    const modelsInGroup = isRelayGroup
        ? Object.entries(MODEL_DEFS).filter(([, d]) => d.group !== '自定义接口' && d.group !== '第三方中转')
        : Object.entries(MODEL_DEFS).filter(([, d]) => d.group === selectedGroup && d.group !== '自定义接口');
    const effectiveModelId = isCustomGroup ? '__custom__' : selectedModelId;
    const def = MODEL_DEFS[effectiveModelId];

    const handleGroupChange = (g: string) => {
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
        } else {
            setSelectedModelId('');
            setBaseUrl('');
            setTasks([]);
        }
    };

    const handleModelChange = (id: string) => {
        setSelectedModelId(id);
        const d = MODEL_DEFS[id];
        if (d) {
            setBaseUrl(d.baseUrl);
            setTasks(d.defaultTasks);
        }
    };

    const toggleTask = (id: string) => {
        setTasks(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };

    const handleSave = () => {
        const finalModelId = isCustomGroup ? customModelId : selectedModelId;
        if (!finalModelId) { alert('请选择或填写型号'); return; }
        if (isRelayGroup && !baseUrl) { alert('第三方中转需要填写 Base URL'); return; }

        const finalLabel = isCustomGroup
            ? (customLabel || customModelId)
            : (MODEL_DEFS[finalModelId]?.label || finalModelId);

        const config: ModelConfig = {
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

    const overlay: React.CSSProperties = {
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    };
    const modal: React.CSSProperties = {
        background: 'var(--vscode-editor-background)',
        border: `1px solid ${colors.glassBorder}`,
        borderRadius: radius.xl,
        padding: '0',
        width: '560px', maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 0 1px rgba(255,255,255,0.1)',
        position: 'relative' as const,
    };

    const stepLabels = lang === 'zh' ? ['选择模型', '任务分配', 'API Key'] : ['Model', 'Tasks', 'API Key'];

    const stepIndicator = () => (
        <div style={{
            background: `linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(59,130,246,0.05) 100%)`,
            borderBottom: `1px solid ${colors.glassBorder}`,
            padding: '20px 28px 18px',
            borderRadius: `${radius.xl} ${radius.xl} 0 0`,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, letterSpacing: '-0.3px' }}>
                    {isEdit ? (lang === 'zh' ? '✏️ 编辑模型' : '✏️ Edit Model') : (lang === 'zh' ? '✨ 添加模型' : '✨ Add Model')}
                </h3>
                <button style={{
                    background: 'rgba(255,255,255,0.06)', border: `1px solid ${colors.glassBorder}`,
                    borderRadius: '50%', width: '28px', height: '28px',
                    cursor: 'pointer', fontSize: '13px', color: 'var(--vscode-descriptionForeground)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s',
                }} onClick={onClose}>✕</button>
            </div>
            {!isEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0', justifyContent: 'center' }}>
                    {stepLabels.map((label, i) => {
                        const stepNum = i + 1;
                        const isActive = step === stepNum;
                        const isDone = step > stepNum;
                        return (
                            <React.Fragment key={i}>
                                {i > 0 && (
                                    <div style={{
                                        width: '48px', height: '2px',
                                        background: isDone ? colors.brand : 'rgba(255,255,255,0.08)',
                                        borderRadius: '1px', transition: 'background 0.3s',
                                    }} />
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', minWidth: '64px' }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '12px', fontWeight: 600, transition: 'all 0.3s',
                                        background: isActive ? colors.brandGradient : isDone ? colors.brand : 'rgba(255,255,255,0.06)',
                                        color: isActive || isDone ? '#fff' : 'var(--vscode-descriptionForeground)',
                                        border: isActive ? 'none' : isDone ? 'none' : `1px solid ${colors.glassBorder}`,
                                        boxShadow: isActive ? `0 0 16px rgba(6,182,212,0.4)` : 'none',
                                    }}>
                                        {isDone ? '✓' : stepNum}
                                    </div>
                                    <span style={{
                                        fontSize: '10px', fontWeight: isActive ? 600 : 400,
                                        color: isActive ? colors.brand : 'var(--vscode-descriptionForeground)',
                                        transition: 'all 0.3s', whiteSpace: 'nowrap',
                                    }}>{label}</span>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}
        </div>
    );

    return (
        <div style={overlay} onClick={e => { if (e.target === e.currentTarget) { onClose(); } }}>
            <div style={modal}>
                {/* Step 1: Provider + model */}
                {step === 1 && (
                    <>
                        {stepIndicator()}
                        <div style={{ padding: '20px 28px 24px' }}>

                        {/* Provider Group Selection */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ ...s.label, marginBottom: '10px' }}>{lang === 'zh' ? '选择提供商' : 'Select Provider'}</label>

                            {/* 国内直连 */}
                            <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                {lang === 'zh' ? '官方直连（国内）' : 'Direct (China)'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                                {GROUPS.slice(0, 5).map(g => {
                                    const active = selectedGroup === g;
                                    const clr = providerColors[g] || colors.brand;
                                    return (
                                        <div key={g} onClick={() => handleGroupChange(g)} style={{
                                            padding: '10px 12px', borderRadius: radius.md, cursor: 'pointer',
                                            background: active ? `${clr}18` : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${active ? `${clr}60` : colors.glassBorder}`,
                                            boxShadow: active ? `0 0 16px ${clr}25` : 'none',
                                            transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                                            transform: active ? 'scale(1.02)' : 'scale(1)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: clr, boxShadow: active ? `0 0 8px ${clr}` : 'none', flexShrink: 0 }} />
                                                <span style={{ fontSize: '12px', fontWeight: active ? 600 : 400, color: active ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 国际直连 */}
                            <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                {lang === 'zh' ? '官方直连（国际）' : 'Direct (International)'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                                {GROUPS.slice(5, 9).map(g => {
                                    const active = selectedGroup === g;
                                    const clr = providerColors[g] || colors.brand;
                                    return (
                                        <div key={g} onClick={() => handleGroupChange(g)} style={{
                                            padding: '10px 12px', borderRadius: radius.md, cursor: 'pointer',
                                            background: active ? `${clr}18` : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${active ? `${clr}60` : colors.glassBorder}`,
                                            boxShadow: active ? `0 0 16px ${clr}25` : 'none',
                                            transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                                            transform: active ? 'scale(1.02)' : 'scale(1)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: clr, boxShadow: active ? `0 0 8px ${clr}` : 'none', flexShrink: 0 }} />
                                                <span style={{ fontSize: '12px', fontWeight: active ? 600 : 400, color: active ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 中转 & 自定义 */}
                            <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6, marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                {lang === 'zh' ? '中转 & 自定义' : 'Relay & Custom'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '14px' }}>
                                {GROUPS.slice(9).map(g => {
                                    const active = selectedGroup === g;
                                    return (
                                        <div key={g} onClick={() => handleGroupChange(g)} style={{
                                            padding: '10px 12px', borderRadius: radius.md, cursor: 'pointer',
                                            background: active ? `${colors.brand}18` : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${active ? `${colors.brand}60` : colors.glassBorder}`,
                                            boxShadow: active ? `0 0 16px ${colors.brand}25` : 'none',
                                            transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '14px' }}>{g === '第三方中转' ? '🔄' : '⚙️'}</span>
                                                <span style={{ fontSize: '12px', fontWeight: active ? 600 : 400, color: active ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground)' }}>{g}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Model selection as pill chips */}
                        {!isCustomGroup && (
                            <div style={{ marginBottom: '14px' }}>
                                <label style={s.label}>{lang === 'zh' ? '选择型号' : 'Select Model'}</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                                    {(isRelayGroup
                                        ? (() => { const grouped: Record<string, [string, ModelDef][]> = {}; modelsInGroup.forEach(([id, d]) => { (grouped[d.group] = grouped[d.group] || []).push([id, d]); }); return Object.values(grouped).flat(); })()
                                        : modelsInGroup
                                    ).map(([id, d]) => {
                                        const active = selectedModelId === id;
                                        const clr = providerColors[d.group] || colors.brand;
                                        return (
                                            <div key={id} onClick={() => handleModelChange(id)} style={{
                                                padding: '8px 14px', borderRadius: radius.pill, cursor: 'pointer',
                                                background: active ? `${clr}20` : 'rgba(255,255,255,0.04)',
                                                border: `1px solid ${active ? `${clr}50` : colors.glassBorder}`,
                                                color: active ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground)',
                                                fontSize: '12px', fontWeight: active ? 600 : 400,
                                                transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px',
                                            }}>
                                                {isRelayGroup && <span style={{ fontSize: '9px', opacity: 0.5 }}>{d.group.split(' ')[0]}</span>}
                                                <span>{d.label}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                {def && <p style={{ ...s.hint, marginTop: '8px' }}>💡 {def.note}</p>}

                                {/* Relay platform quick-fill */}
                                {isRelayGroup && (
                                    <div style={{ marginTop: '14px', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: radius.md, border: `1px solid ${colors.glassBorder}` }}>
                                        <label style={{ ...s.label, fontSize: '11px' }}>{lang === 'zh' ? '🔗 中转平台（点击快速填入）' : '🔗 Relay Platform'}</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                            {RELAY_PRESETS.map(r => (
                                                <button key={r.name} onClick={() => setBaseUrl(r.url)} style={{
                                                    ...s.btnSecondary, fontSize: '11px', padding: '5px 12px', borderRadius: radius.pill,
                                                    background: baseUrl === r.url ? colors.brandGradient : undefined,
                                                    color: baseUrl === r.url ? '#fff' : undefined,
                                                    border: baseUrl === r.url ? 'none' : undefined,
                                                    boxShadow: baseUrl === r.url ? `0 0 12px rgba(6,182,212,0.3)` : undefined,
                                                }}>{r.name}</button>
                                            ))}
                                        </div>
                                        {RELAY_PRESETS.map(r => baseUrl === r.url && (
                                            <p key={r.name} style={{ ...s.hint, marginTop: '8px' }}>
                                                {r.note} — <a href={r.site} style={{ color: colors.link }}>获取 Key ↗</a>
                                            </p>
                                        ))}
                                        <div style={{ marginTop: '10px' }}>
                                            <label style={{ ...s.label, fontSize: '11px' }}>Base URL</label>
                                            <input style={s.input} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://your-relay.com/v1" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Custom model inputs */}
                        {isCustomGroup && (
                            <>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>Model ID <span style={{ fontWeight: 400, opacity: 0.6, fontSize: '11px' }}>(接口中使用的模型名称)</span></label>
                                    <input style={s.input} value={customModelId} onChange={e => setCustomModelId(e.target.value)} placeholder="e.g. gpt-4o / claude-3-5-sonnet" />
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>显示名称 <span style={{ fontWeight: 400, opacity: 0.6, fontSize: '11px' }}>(列表中的名字)</span></label>
                                    <input style={s.input} value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. 我的专属模型" />
                                </div>
                            </>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
                            <button style={s.btnSecondary} onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
                            <button style={s.btnPrimary} onClick={() => setStep(2)} disabled={!isCustomGroup && !selectedModelId}>
                                {lang === 'zh' ? '下一步 →' : 'Next →'}
                            </button>
                        </div>
                        </div>
                    </>
                )}

                {/* Step 2: Tasks + Base URL */}
                {step === 2 && (
                    <>
                        {stepIndicator()}
                        <div style={{ padding: '20px 28px 24px' }}>

                        {isEdit && (
                            <div style={{ marginBottom: '14px' }}>
                                <label style={s.label}>Model ID <span style={{ fontWeight: 400, opacity: 0.6, fontSize: '11px' }}>{`(${GROUP_MODEL_EXAMPLES[selectedGroup] ?? 'glm-5 / glm-4.7'})`}</span></label>
                                <input
                                    style={s.input}
                                    value={isCustomGroup ? customModelId : selectedModelId}
                                    onChange={e => isCustomGroup ? setCustomModelId(e.target.value) : setSelectedModelId(e.target.value)}
                                    placeholder={GROUP_MODEL_EXAMPLES[selectedGroup] ?? 'glm-5、deepseek-chat'}
                                />
                            </div>
                        )}

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ ...s.label, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span>
                                    {lang === 'zh' ? '🎯 任务类型（多选）' : '🎯 Task Types'}
                                    <span style={{ fontWeight: 400, fontSize: '10px', opacity: 0.5, marginLeft: '8px' }}>
                                        {lang === 'zh' ? '已按模型特点预设' : 'Pre-selected by model'}
                                    </span>
                                </span>
                                {def?.defaultTasks && (
                                    <button
                                        style={{ ...s.btnSecondary, padding: '3px 10px', fontSize: '10px', borderRadius: radius.pill }}
                                        onClick={() => setTasks([...(def?.defaultTasks || [])])}
                                    >
                                        {lang === 'zh' ? '恢复默认' : 'Reset'}
                                    </button>
                                )}
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                                {TASK_TYPES.map(t => {
                                    const sel = tasks.includes(t.id);
                                    return (
                                        <span
                                            key={t.id}
                                            onClick={() => toggleTask(t.id)}
                                            style={{
                                                padding: '6px 14px', borderRadius: radius.pill, cursor: 'pointer', fontSize: '12px',
                                                fontWeight: sel ? 600 : 400,
                                                background: sel ? colors.brandGradient : 'rgba(255,255,255,0.04)',
                                                color: sel ? '#fff' : 'var(--vscode-descriptionForeground)',
                                                border: `1px solid ${sel ? 'transparent' : colors.glassBorder}`,
                                                boxShadow: sel ? '0 0 12px rgba(6,182,212,0.25)' : 'none',
                                                transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                                                userSelect: 'none' as const,
                                            }}
                                        >
                                            {lang === 'zh' ? t.zh : t.en}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <label style={s.label}>
                                Base URL
                                {def?.relay && (
                                    <span style={{ fontWeight: 400, fontSize: '10px', color: colors.warning, marginLeft: '8px' }}>
                                        ⚠ {lang === 'zh' ? '需填写中转地址' : 'Relay URL required'}
                                    </span>
                                )}
                            </label>
                            <input style={s.input} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.xxx.com/v1" />
                            <p style={s.hint}>
                                {def?.relay
                                    ? (lang === 'zh' ? '推荐：OpenRouter · 硅基流动' : 'Recommended: OpenRouter · SiliconFlow')
                                    : (lang === 'zh' ? '已自动填入官方地址，可修改为中转。' : 'Auto-filled; editable for relay.')}
                            </p>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                            <button style={{ ...s.btnSecondary, fontSize: '12px' }} onClick={() => setStep(1)}>
                                {lang === 'zh' ? '← 上一步' : '← Back'}
                            </button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button style={s.btnSecondary} onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
                                <button style={s.btnPrimary} onClick={() => setStep(3)}>{lang === 'zh' ? '下一步 →' : 'Next →'}</button>
                            </div>
                        </div>
                        </div>
                    </>
                )}

                {/* Step 3: API Key */}
                {step === 3 && (
                    <>
                        {stepIndicator()}
                        <div style={{ padding: '20px 28px 24px' }}>

                        {/* Provider branding header */}
                        {(() => {
                            const g = isEdit ? (MODEL_DEFS[existing!.model.modelId]?.group || '') : selectedGroup;
                            const clr = providerColors[g] || colors.brand;
                            return (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px',
                                    padding: '10px 14px', borderRadius: radius.md,
                                    background: `${clr}10`, border: `1px solid ${clr}30`,
                                }}>
                                    <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: clr, boxShadow: `0 0 8px ${clr}` }} />
                                    <span style={{ fontSize: '13px', fontWeight: 600, color: clr }}>{g}</span>
                                    <span style={{ fontSize: '11px', opacity: 0.6 }}>{isCustomGroup ? customModelId : (def?.label || selectedModelId)}</span>
                                </div>
                            );
                        })()}

                        <div style={{ marginBottom: '6px' }}>
                            <label style={s.label}>🔑 API Key</label>
                            <input type="password" style={s.input} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
                            <p style={{ ...s.hint, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                🔒 {lang === 'zh' ? '加密存储，不会明文保存到磁盘。' : 'Encrypted storage, never saved in plaintext.'}
                            </p>
                        </div>

                        {/* API Key links */}
                        {(() => {
                            const links: Record<string, { text: string; url: string }> = {
                                'DeepSeek': { text: '申请 DeepSeek Key', url: 'https://platform.deepseek.com' },
                                'GLM (智谱)': { text: '申请智谱 Key', url: 'https://open.bigmodel.cn' },
                                'Qwen (通义)': { text: '申请通义 Key', url: 'https://dashscope.aliyun.com' },
                                'MiniMax': { text: '申请 MiniMax Key', url: 'https://api.minimax.chat' },
                                'Kimi K2': { text: '申请 Kimi Key', url: 'https://platform.moonshot.cn' },
                                'OpenAI': { text: '申请 OpenAI Key', url: 'https://platform.openai.com/api-keys' },
                                'Anthropic (Claude)': { text: '申请 Claude Key', url: 'https://console.anthropic.com' },
                                'Google (Gemini)': { text: '申请 Gemini Key', url: 'https://aistudio.google.com/apikey' },
                            };
                            const g = isEdit ? (MODEL_DEFS[existing!.model.modelId]?.group || '') : selectedGroup;
                            const link = links[g];
                            if (!link) { return null; }
                            const clr = providerColors[g] || colors.brand;
                            return (
                                <p style={{ ...s.hint, marginTop: '12px' }}>
                                    {lang === 'zh' ? '还没有 Key？' : 'No key yet?'}
                                    <a href={link.url} style={{ color: clr, marginLeft: '6px', fontWeight: 500, cursor: 'pointer' }}
                                        onClick={e => { e.preventDefault(); vscode.postMessage({ command: 'openUrl', url: link.url }); }}>
                                        {link.text} ↗
                                    </a>
                                </p>
                            );
                        })()}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
                            <button style={{ ...s.btnSecondary, fontSize: '12px' }} onClick={() => setStep(2)}>
                                {lang === 'zh' ? '← 上一步' : '← Back'}
                            </button>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button style={s.btnSecondary} onClick={onClose}>{lang === 'zh' ? '取消' : 'Cancel'}</button>
                                <button style={{ ...s.btnPrimary, background: colors.success, boxShadow: '0 4px 16px rgba(52,211,153,0.3)' }} onClick={handleSave}>
                                    {lang === 'zh' ? '✓ 保存' : '✓ Save'}
                                </button>
                            </div>
                        </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ─── ConfigPanel ──────────────────────────────────────────────────────────────

export interface ConfigPanelProps { lang: 'zh' | 'en'; }

const ConfigPanel: React.FC<ConfigPanelProps> = ({ lang }) => {
    const [models, setModels] = useState<ModelConfig[]>([]);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<{ model: ModelConfig; apiKey: string } | undefined>();
    const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
    const [codexStatus, setCodexStatus] = useState<{ installed: boolean; version?: string; loggedIn?: boolean } | null>(null);
    const [geminiStatus, setGeminiStatus] = useState<{ installed: boolean; version?: string; loggedIn?: boolean } | null>(null);
    const [ecosystem, setEcosystem] = useState<{ codex?: { mcpServers: { name: string; description: string; source?: 'builtin' | 'local' | 'npm' | 'pypi' | 'ai' }[] }; gemini?: { mcpServers: { name: string; description: string; source?: 'builtin' | 'local' | 'npm' | 'pypi' | 'ai' }[]; extensions: { name: string; description: string; source?: 'builtin' | 'local' | 'npm' | 'pypi' | 'ai' }[] } } | null>(null);
    const hasAutoTested = React.useRef(false);

    useEffect(() => {
        const handler = (ev: MessageEvent) => {
            if (ev.data.command === 'loadModelsV2') {
                const loadedModels: ModelConfig[] = ev.data.models || [];
                const loadedKeys: Record<string, string> = ev.data.apiKeys || {};
                setModels(loadedModels);
                setApiKeys(loadedKeys);
                // Only auto-test on first load, not on every tab switch
                if (!hasAutoTested.current) {
                    hasAutoTested.current = true;
                    setTimeout(() => {
                        loadedModels.forEach((m) => {
                            const key = loadedKeys[m.id];
                            if (!key || !m.baseUrl || !m.enabled) return;
                            const requestId = `autotest_${m.id}_${Date.now()}`;
                            vscode.postMessage({ command: 'testConnection', modelId: m.modelId, baseUrl: m.baseUrl, apiKey: key, requestId });
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
            if (ev.data.command === 'ecosystemData' && ev.data.data) {
                setEcosystem(ev.data.data);
            }
        };
        window.addEventListener('message', handler);
        vscode.postMessage({ command: 'getModelsV2' });
        vscode.postMessage({ command: 'getCodexStatus' });
        vscode.postMessage({ command: 'getGeminiStatus' });
        vscode.postMessage({ command: 'getEcosystem' });
        return () => window.removeEventListener('message', handler);
    }, []);

    const handleSave = useCallback((modelConfig: ModelConfig, apiKey: string) => {
        if (editTarget) {
            vscode.postMessage({ command: 'updateModel', id: modelConfig.id, patch: modelConfig, apiKey });
        } else {
            vscode.postMessage({ command: 'addModel', modelConfig, apiKey });
        }
        setShowModal(false);
        setEditTarget(undefined);
    }, [editTarget]);

    const handleEdit = (model: ModelConfig, key: string) => { setEditTarget({ model, apiKey: key }); setShowModal(true); };
    const handleRemove = (id: string) => vscode.postMessage({ command: 'removeModel', id });
    const handleToggle = (id: string, enabled: boolean) => {
        vscode.postMessage({ command: 'updateModel', id, patch: { enabled } });
        setModels(prev => prev.map(m => m.id === id ? { ...m, enabled } : m));
    };

    const enabled = models.filter(m => m.enabled).length;

    return (
        <div style={{ maxWidth: '700px', paddingBottom: '40px' }}>
            {/* Header */}
            {/* iOS-style Navigation Header */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '20px', paddingBottom: '14px',
                borderBottom: `1px solid ${colors.glassBorder}`,
            }}>
                <div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700, letterSpacing: '-0.3px' }}>
                        {lang === 'zh' ? '模型管理' : 'Models'}
                    </h2>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--vscode-descriptionForeground)', opacity: 0.7 }}>
                        {lang === 'zh'
                            ? `${enabled} 个模型已启用 · 按任务类型自动路由`
                            : `${enabled} model(s) enabled · auto-routed by task type`}
                    </p>
                </div>
                <button style={{
                    ...s.btnPrimary,
                    borderRadius: radius.pill,
                    padding: '8px 20px',
                    fontSize: '12px',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                }} onClick={() => { setEditTarget(undefined); setShowModal(true); }}>
                    {lang === 'zh' ? '+ 添加模型' : '+ Add Model'}
                </button>
            </div>

            {/* List */}
            {models.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '60px 30px',
                    background: colors.glass,
                    backdropFilter: colors.glassBlur,
                    WebkitBackdropFilter: colors.glassBlur,
                    border: `1px solid ${colors.glassBorder}`,
                    borderRadius: radius.lg,
                    boxShadow: shadow.glass,
                }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.5 }}>🤖</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>
                        {lang === 'zh' ? '尚未配置任何模型' : 'No models configured'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6 }}>
                        {lang === 'zh' ? '点击「+ 添加模型」开始配置你的 AI 模型' : 'Click "+ Add Model" to configure your first AI model'}
                    </div>
                </div>
            ) : (
                models.map(m => (
                    <ModelCard
                        key={m.id} model={m} apiKey={apiKeys[m.id] || ''}
                        lang={lang} onEdit={handleEdit} onRemove={handleRemove} onToggle={handleToggle}
                        initialTestResult={testResults[m.id]}
                    />
                ))
            )}

            {/* Codex CLI (ChatGPT OAuth) Card */}
            <div style={{
                background: colors.glass,
                backdropFilter: colors.glassBlur,
                WebkitBackdropFilter: colors.glassBlur,
                border: `1px solid ${colors.glassBorder}`,
                borderRadius: radius.lg,
                boxShadow: shadow.glass,
                padding: '14px 18px',
                marginTop: '16px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                            background: codexStatus?.installed ? '#10A37F' : '#E8740C',
                            boxShadow: `0 0 8px ${codexStatus?.installed ? '#10A37F60' : '#E8740C60'}`,
                        }} />
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>
                                {codexStatus === null ? '🔍 Codex CLI…' : codexStatus.installed ? 'Codex CLI' : 'Codex CLI 未安装'}
                            </span>
                            {codexStatus?.version && <span style={{ marginLeft: '8px', opacity: 0.5, fontSize: '11px' }}>v{codexStatus.version}</span>}
                            <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px', opacity: 0.7 }}>
                                {codexStatus?.installed
                                    ? (codexStatus.loggedIn
                                        ? 'ChatGPT 账号已登录 · ai_codex_task 可用'
                                        : 'Codex CLI 已安装 · 需先登录 ChatGPT 账号')
                                    : '安装后可用 ChatGPT Plus 账号直接调用'}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {!codexStatus?.installed && (
                            <button style={{ ...s.btnPrimary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                                onClick={() => vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'npm install -g @openai/codex && codex login' })}>
                                安装
                            </button>
                        )}
                        {codexStatus?.installed && (
                            <button style={{ ...s.btnSecondary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                                onClick={() => vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'codex login' })}>
                                登录
                            </button>
                        )}
                        <button style={{ ...s.btnSecondary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                            onClick={() => vscode.postMessage({ command: 'openUrl', url: 'https://github.com/openai/codex' })}>
                            文档
                        </button>
                    </div>
                </div>
                {codexStatus?.installed && codexStatus.loggedIn && (
                    <div style={{ textAlign: 'right', marginTop: '8px', fontSize: '10px', color: '#10A37F', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10A37F', boxShadow: '0 0 4px #10A37F' }} />
                        已连通
                    </div>
                )}
                {/* Codex MCP Servers */}
                {ecosystem?.codex?.mcpServers && ecosystem.codex.mcpServers.length > 0 && codexStatus?.installed && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${colors.glassBorder}` }}>
                        <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.5, marginBottom: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                            MCP Servers ({ecosystem.codex.mcpServers.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {ecosystem.codex.mcpServers.map(s => (
                                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                                    <span style={{ fontWeight: 600, color: '#10A37F', flexShrink: 0, minWidth: '80px' }}>{s.name}</span>
                                    <span style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.7, flex: 1 }}>{s.description}</span>
                                    <SourceBadge source={s.source} />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Gemini CLI Card */}
            <div style={{
                background: colors.glass,
                backdropFilter: colors.glassBlur,
                WebkitBackdropFilter: colors.glassBlur,
                border: `1px solid ${colors.glassBorder}`,
                borderRadius: radius.lg,
                boxShadow: shadow.glass,
                padding: '14px 18px',
                marginTop: '10px',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                            width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                            background: geminiStatus?.installed ? '#4285F4' : '#E8740C',
                            boxShadow: `0 0 8px ${geminiStatus?.installed ? '#4285F460' : '#E8740C60'}`,
                        }} />
                        <div>
                            <span style={{ fontWeight: 600, fontSize: '13px' }}>
                                {geminiStatus === null ? '🔍 Gemini CLI…' : geminiStatus.installed ? 'Gemini CLI' : 'Gemini CLI 未安装'}
                            </span>
                            {geminiStatus?.version && <span style={{ marginLeft: '8px', opacity: 0.5, fontSize: '11px' }}>v{geminiStatus.version}</span>}
                            <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '2px', opacity: 0.7 }}>
                                {geminiStatus?.installed
                                    ? (geminiStatus.loggedIn
                                        ? 'Google 账号已登录 · ai_gemini_task 可用'
                                        : 'Gemini CLI 已安装 · 需先登录 Google 账号')
                                    : '安装后可用 Google 账号本地凭据调用'}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {!geminiStatus?.installed && (
                            <button style={{ ...s.btnPrimary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                                onClick={() => vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'npm install -g @google/gemini-cli && gemini' })}>
                                安装
                            </button>
                        )}
                        {geminiStatus?.installed && (
                            <button style={{ ...s.btnSecondary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                                onClick={() => vscode.postMessage({ command: 'openTerminalWithCmd', cmd: 'gemini' })}>
                                登录
                            </button>
                        )}
                        <button style={{ ...s.btnSecondary, fontSize: '11px', padding: '5px 14px', borderRadius: radius.pill }}
                            onClick={() => vscode.postMessage({ command: 'openUrl', url: 'https://github.com/google/gemini-cli' })}>
                            文档
                        </button>
                    </div>
                </div>
                {geminiStatus?.installed && geminiStatus.loggedIn && (
                    <div style={{ textAlign: 'right', marginTop: '8px', fontSize: '10px', color: '#4285F4', fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4285F4', boxShadow: '0 0 4px #4285F4' }} />
                        已连通
                    </div>
                )}
                {/* Gemini MCP Servers + Extensions */}
                {ecosystem?.gemini && geminiStatus?.installed && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${colors.glassBorder}` }}>
                        {ecosystem.gemini.mcpServers.length > 0 && (
                            <>
                                <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.5, marginBottom: '8px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                    MCP Servers ({ecosystem.gemini.mcpServers.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {ecosystem.gemini.mcpServers.map(s => (
                                        <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                                            <span style={{ fontWeight: 600, color: '#4285F4', flexShrink: 0, minWidth: '80px' }}>{s.name}</span>
                                            <span style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.7, flex: 1 }}>{s.description}</span>
                                            <SourceBadge source={s.source} />
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        {ecosystem.gemini.extensions.length > 0 && (
                            <>
                                <div style={{ fontSize: '10px', color: 'var(--vscode-descriptionForeground)', opacity: 0.5, marginBottom: '8px', marginTop: '10px', letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                                    Extensions ({ecosystem.gemini.extensions.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {ecosystem.gemini.extensions.map(e => (
                                        <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                                            <span style={{ fontWeight: 600, color: '#8B5CF6', flexShrink: 0, minWidth: '80px' }}>{e.name}</span>
                                            <span style={{ color: 'var(--vscode-descriptionForeground)', opacity: 0.7, flex: 1 }}>{e.description}</span>
                                            <SourceBadge source={e.source} />
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>


            {/* iOS-style inline tip */}
            <div style={{
                marginTop: '16px', padding: '12px 16px',
                background: colors.glass,
                backdropFilter: colors.glassBlur,
                WebkitBackdropFilter: colors.glassBlur,
                border: `1px solid ${colors.glassBorder}`,
                borderRadius: radius.md,
                fontSize: '11px', color: 'var(--vscode-descriptionForeground)', lineHeight: '1.6',
                opacity: 0.7,
            }}>
                {lang === 'zh'
                    ? '路由规则：按任务类型匹配已启用的模型，选优先级最高的（列表靠上）。可随时添加新模型、自定义任务分配。'
                    : 'Routing: matches task type to enabled models → picks highest-priority (top of list). Add any OpenAI-compatible model.'}
            </div>

            {showModal && (
                <AddEditModal
                    lang={lang} existing={editTarget}
                    onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditTarget(undefined); }}
                />
            )}
        </div>
    );
};

export default ConfigPanel;
