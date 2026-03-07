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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const OverviewPanel_1 = __importDefault(require("./OverviewPanel"));
const ConfigPanel_1 = __importDefault(require("./ConfigPanel"));
const HistoryConsole_1 = __importDefault(require("./HistoryConsole"));
const RoutingGuidePanel_1 = __importDefault(require("./RoutingGuidePanel"));
const SkillPanel_1 = __importDefault(require("./SkillPanel"));
const TestPanel_1 = __importDefault(require("./TestPanel"));
const theme_1 = require("../theme");
const vscode_api_1 = require("../vscode-api");
const t = {
    en: {
        overview: 'Overview',
        settings: 'Models',
        history: 'History',
        guide: 'Routing',
        skill: 'AI Skill',
        test: 'Test',
        subtitle: 'AI Model Orchestration Hub',
        github: 'GitHub',
        docs: 'Docs',
        feedback: 'Feedback',
    },
    zh: {
        overview: '概览',
        settings: '模型管理',
        history: '调用历史',
        guide: '路由推荐',
        skill: 'AI 调度',
        test: '测试',
        subtitle: 'AI 模型智能编排中心',
        github: 'GitHub',
        docs: '文档',
        feedback: '反馈',
    }
};
// Tab 图标映射 (Lucide-style SVG inline — 避免额外依赖)
const TabIcon = ({ name, size = 14 }) => {
    const svgProps = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
    switch (name) {
        case 'overview': return <svg {...svgProps}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
        case 'settings': return <svg {...svgProps}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>;
        case 'history': return <svg {...svgProps}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
        case 'guide': return <svg {...svgProps}><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49"/><line x1="12" y1="12" x2="12" y2="12.01"/></svg>;
        case 'skill': return <svg {...svgProps}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
        case 'test': return <svg {...svgProps}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>;
        default: return null;
    }
};
const Dashboard = () => {
    const [activeTab, setActiveTab] = (0, react_1.useState)('overview');
    const [lang, setLang] = (0, react_1.useState)('zh');
    const logoUri = document.getElementById('root')?.getAttribute('data-logo-uri') || '';
    const langBtnStyle = (active) => ({
        padding: '4px 12px',
        borderRadius: theme_1.radius.pill,
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: active ? '600' : '400',
        background: active ? 'rgba(6,182,212,0.15)' : 'transparent',
        color: active ? theme_1.colors.brand : 'var(--vscode-descriptionForeground)',
        border: active ? `1px solid ${theme_1.colors.brand}40` : '1px solid transparent',
        userSelect: 'none',
        transition: 'all 0.2s',
        backdropFilter: 'blur(8px)',
    });
    const footerBtnStyle = {
        padding: '7px 16px',
        borderRadius: theme_1.radius.pill,
        border: `1px solid ${theme_1.colors.glassBorder}`,
        background: theme_1.colors.glass,
        color: 'var(--vscode-descriptionForeground)',
        cursor: 'pointer',
        fontSize: '12px',
        transition: 'all 0.2s',
        backdropFilter: 'blur(12px)',
    };
    const tabs = [
        { key: 'overview', label: t[lang].overview, icon: 'overview' },
        { key: 'config', label: t[lang].settings, icon: 'settings' },
        { key: 'history', label: t[lang].history, icon: 'history' },
        { key: 'guide', label: t[lang].guide, icon: 'guide' },
        { key: 'skill', label: t[lang].skill, icon: 'skill' },
        { key: 'test', label: t[lang].test, icon: 'test' },
    ];
    return (<div style={{
            height: '100%', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
            background: 'var(--vscode-editor-background)',
        }}>
            {/* ── Brand Header (Liquid Glass) ────────────────────────── */}
            <div style={{
            padding: '20px 24px 0',
            borderBottom: `1px solid ${theme_1.colors.glassBorder}`,
            background: 'rgba(255,255,255,0.015)',
            backdropFilter: 'blur(20px)',
        }}>
                {/* Top row: brand + language toggle */}
                <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: '6px',
        }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {logoUri && (<img src={logoUri} alt="ArkTS" style={{
                width: '30px', height: '30px', objectFit: 'contain',
                filter: 'drop-shadow(0 2px 8px rgba(6,182,212,0.3))',
            }}/>)}
                        <div>
                            <h1 style={{
            margin: 0, fontSize: '20px', fontWeight: 700,
            letterSpacing: '-0.4px',
            background: theme_1.colors.brandGradient,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
        }}>
                                Conductor Hub
                            </h1>
                            <span style={{
            fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
            fontWeight: 400, opacity: 0.7, letterSpacing: '0.02em',
        }}>
                                {t[lang].subtitle}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span onClick={() => setLang('en')} style={langBtnStyle(lang === 'en')}>EN</span>
                        <span onClick={() => setLang('zh')} style={langBtnStyle(lang === 'zh')}>中文</span>
                    </div>
                </div>

                {/* Liquid Glass Pill Tabs */}
                <div style={{
            display: 'flex', gap: '6px',
            padding: '12px 0 14px',
        }}>
                    {tabs.map(tab => (<span key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                ...theme_1.s.pillTab(activeTab === tab.key),
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
            }}>
                            <TabIcon name={tab.icon} size={13}/>
                            {tab.label}
                        </span>))}
                </div>
            </div>

            {/* ── Content Area ─────────────────────────────────────────── */}
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                {activeTab === 'overview' && <OverviewPanel_1.default lang={lang} onSwitchTab={(tab) => setActiveTab(tab)}/>}
                {activeTab === 'config' && <ConfigPanel_1.default lang={lang}/>}
                {activeTab === 'history' && <HistoryConsole_1.default lang={lang}/>}
                {activeTab === 'guide' && <RoutingGuidePanel_1.default lang={lang}/>}
                {activeTab === 'skill' && <SkillPanel_1.default lang={lang}/>}
                {activeTab === 'test' && <TestPanel_1.default lang={lang}/>}
            </div>

            {/* ── Footer (Liquid Glass) ──────────────────────────────── */}
            <div style={{
            padding: '10px 24px',
            borderTop: `1px solid ${theme_1.colors.glassBorder}`,
            display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
            background: 'rgba(255,255,255,0.015)',
            backdropFilter: 'blur(16px)',
        }}>
                <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginRight: '4px', opacity: 0.6 }}>
                    ArkTS Language Support
                </span>
                <button style={{ ...footerBtnStyle, background: theme_1.colors.brandGradient, color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(6,182,212,0.2)' }} onClick={() => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor' })}>
                    {t[lang].github}
                </button>
                <button style={footerBtnStyle} onClick={() => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor/issues' })}>
                    {t[lang].feedback}
                </button>
            </div>
        </div>);
};
exports.default = Dashboard;
//# sourceMappingURL=Dashboard.js.map