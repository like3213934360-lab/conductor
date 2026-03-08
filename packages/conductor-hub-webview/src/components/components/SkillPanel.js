"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const theme_1 = require("../theme");
const Icon_1 = __importDefault(require("./Icon"));
const SkillPanel = ({ lang }) => {
    const isEN = lang === 'en';
    const title = isEN ? 'Built-in AI Routing Skill' : '内置 AI 调度 Skill';
    const desc = isEN
        ? 'Conductor Hub auto-installs an Antigravity Skill that teaches the host model to delegate tasks intelligently, maximizing quota savings.'
        : 'Conductor Hub 安装后自动向 Antigravity 注入调度 Skill，教会主模型智能委派任务，最大化节省额度。';
    const sections = [
        {
            icon: 'dollar-sign',
            iconColor: '#34D399',
            title: isEN ? 'Routine Tasks (Low-cost Tier)' : '体力活（低成本梯队）',
            items: isEN
                ? ['Translation / Docs / Annotations → DeepSeek', 'Summaries / READMEs → DeepSeek']
                : ['翻译 / 文档 / 注释 → DeepSeek', '信息整理 / 总结 → DeepSeek']
        },
        {
            icon: 'tool',
            iconColor: '#60A5FA',
            title: isEN ? 'Code (Quality First)' : '代码（质量优先）',
            items: isEN
                ? ['Code Review / Bug Check → Codex CLI (GPT 5.3 Codex)', 'Code Generation → Host Model (primary), Codex CLI (backup)', 'Complex Debugging → GLM-5']
                : ['代码审查 / Bug检查 → Codex CLI（GPT 5.3 Codex）', '代码生成 → 主模型首选，Codex CLI 备选', '复杂调试 / 跨文件工程 → GLM-5']
        },
        {
            icon: 'crosshair',
            iconColor: '#F97316',
            title: isEN ? 'Specialized Domains' : '专业领域',
            items: isEN
                ? ['Reasoning / Algorithms → Gemini CLI', 'Frontend UI / UX → Gemini CLI', 'Multilingual / Structured → Qwen', 'High-speed Generation → MiniMax']
                : ['推理 / 算法 / 数学 → Gemini CLI', '前端 UI / UX → Gemini CLI', '多语言 / 结构化写作 → Qwen', '大量高速生成 → MiniMax']
        },
        {
            icon: 'pen-tool',
            iconColor: '#E879F9',
            title: isEN ? 'Creative Writing Chain' : '创意写作协作链',
            items: isEN
                ? ['Outline Bidding (multi-model parallel) → Fusion → Draft Competition → Best Selection → Polish (MiniMax) → Logic Check (GLM) → Deliver']
                : ['大纲竞标（多模型并行）→ 融合 → 初稿竞写 → 择优 → 文笔打磨（MiniMax）→ 逻辑检查（GLM）→ 交付']
        }
    ];
    const tip = isEN
        ? 'Host Model Exclusive (never delegated): Architecture Design · Final Decisions · User Conversations'
        : '主模型专属（绝不委派）：架构设计 · 最终决策 · 与用户对话';
    const philosophy = isEN
        ? 'Design philosophy: top-tier models each excel at different tasks. Multi-model parallel + host model arbitration = best results + lowest cost.'
        : '设计哲学：顶级梯队互有胜负，不押宝单一模型。多模型并行 + 主模型裁决 = 最优结果 + 最低成本。';
    return (react_1.default.createElement("div", { className: "animate-in", style: { maxWidth: '860px', paddingBottom: '20px' } },
        react_1.default.createElement("div", { style: { marginBottom: '20px' } },
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
                react_1.default.createElement(Icon_1.default, { name: "layers", size: 20, color: theme_1.colors.brand }),
                react_1.default.createElement("h2", { style: {
                        margin: 0, fontSize: '18px', fontWeight: 700,
                        letterSpacing: '-0.3px',
                        background: theme_1.colors.brandGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    } }, title)),
            react_1.default.createElement("div", { style: {
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.6, paddingLeft: '30px',
                } }, desc)),
        react_1.default.createElement("div", { style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                gap: '14px',
                marginBottom: '18px',
            } }, sections.map((section, i) => (react_1.default.createElement("div", { key: i, style: {
                ...theme_1.glass.panel,
                padding: '18px 20px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                cursor: 'default',
            }, onMouseEnter: e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `${theme_1.shadow.glassHover}, 0 0 20px ${section.iconColor}10`;
            }, onMouseLeave: e => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = theme_1.shadow.glass;
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', alignItems: 'center', gap: '10px',
                    marginBottom: '12px',
                } },
                react_1.default.createElement("div", { style: {
                        width: '32px', height: '32px',
                        borderRadius: theme_1.radius.sm,
                        background: `${section.iconColor}15`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    } },
                    react_1.default.createElement(Icon_1.default, { name: section.icon, size: 16, color: section.iconColor })),
                react_1.default.createElement("span", { style: {
                        fontSize: '13px', fontWeight: 600,
                        color: 'var(--vscode-editor-foreground)',
                    } }, section.title)),
            react_1.default.createElement("ul", { style: { margin: 0, paddingLeft: '0', listStyle: 'none' } }, section.items.map((item, j) => (react_1.default.createElement("li", { key: j, style: {
                    fontSize: '12px',
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.8,
                    marginBottom: '2px',
                    display: 'flex', alignItems: 'baseline', gap: '8px',
                } },
                react_1.default.createElement("span", { style: {
                        display: 'inline-block',
                        width: '4px', height: '4px', borderRadius: '50%',
                        background: section.iconColor,
                        flexShrink: 0,
                        marginTop: '6px',
                        opacity: 0.6,
                    } }),
                item)))))))),
        react_1.default.createElement("div", { style: {
                ...theme_1.glass.panel,
                padding: '14px 18px',
                marginBottom: '14px',
                display: 'flex', alignItems: 'center', gap: '12px',
                borderLeft: `3px solid ${theme_1.colors.warning}`,
            } },
            react_1.default.createElement(Icon_1.default, { name: "shield", size: 18, color: theme_1.colors.warning }),
            react_1.default.createElement("span", { style: {
                    fontSize: '12px',
                    color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.5,
                } }, tip)),
        react_1.default.createElement("div", { style: {
                fontSize: '11px',
                color: 'var(--vscode-descriptionForeground)',
                opacity: 0.5,
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '8px 0',
            } }, philosophy)));
};
exports.default = SkillPanel;
