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
const Icon_1 = __importDefault(require("./Icon"));
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
// Tab 图标映射 — 使用共享 Icon 组件
const TAB_ICON_MAP = {
    overview: 'grid',
    settings: 'settings',
    history: 'clock',
    guide: 'compass',
    skill: 'layers',
    test: 'flask',
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
    return (react_1.default.createElement("div", { style: {
            height: '100%', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
            background: 'var(--vscode-editor-background)',
        } },
        react_1.default.createElement("div", { style: {
                padding: '20px 24px 0',
                borderBottom: `1px solid ${theme_1.colors.glassBorder}`,
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(20px)',
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '6px',
                } },
                react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                    logoUri && (react_1.default.createElement("img", { src: logoUri, alt: "Conductor Hub", style: {
                            width: '30px', height: '30px', objectFit: 'contain',
                            filter: 'drop-shadow(0 2px 8px rgba(6,182,212,0.3))',
                        } })),
                    react_1.default.createElement("div", null,
                        react_1.default.createElement("h1", { style: {
                                margin: 0, fontSize: '20px', fontWeight: 700,
                                letterSpacing: '-0.4px',
                                background: theme_1.colors.brandGradient,
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            } }, "Conductor Hub"),
                        react_1.default.createElement("span", { style: {
                                fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
                                fontWeight: 400, opacity: 0.7, letterSpacing: '0.02em',
                            } }, t[lang].subtitle))),
                react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
                    react_1.default.createElement("span", { onClick: () => setLang('en'), style: langBtnStyle(lang === 'en') }, "EN"),
                    react_1.default.createElement("span", { onClick: () => setLang('zh'), style: langBtnStyle(lang === 'zh') }, "\u4E2D\u6587"))),
            react_1.default.createElement("div", { style: {
                    display: 'flex', gap: '6px',
                    padding: '12px 0 14px',
                } }, tabs.map(tab => (react_1.default.createElement("span", { key: tab.key, onClick: () => setActiveTab(tab.key), style: {
                    ...theme_1.s.pillTab(activeTab === tab.key),
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                } },
                react_1.default.createElement(Icon_1.default, { name: TAB_ICON_MAP[tab.icon] || tab.icon, size: 13 }),
                tab.label))))),
        react_1.default.createElement("div", { style: { flex: 1, overflow: 'auto', padding: '20px 24px' } },
            activeTab === 'overview' && react_1.default.createElement(OverviewPanel_1.default, { lang: lang, onSwitchTab: (tab) => setActiveTab(tab) }),
            activeTab === 'config' && react_1.default.createElement(ConfigPanel_1.default, { lang: lang }),
            activeTab === 'history' && react_1.default.createElement(HistoryConsole_1.default, { lang: lang }),
            activeTab === 'guide' && react_1.default.createElement(RoutingGuidePanel_1.default, { lang: lang }),
            activeTab === 'skill' && react_1.default.createElement(SkillPanel_1.default, { lang: lang }),
            activeTab === 'test' && react_1.default.createElement(TestPanel_1.default, { lang: lang })),
        react_1.default.createElement("div", { style: {
                padding: '10px 24px',
                borderTop: `1px solid ${theme_1.colors.glassBorder}`,
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(16px)',
            } },
            react_1.default.createElement("span", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginRight: '4px', opacity: 0.6 } }, "Conductor Hub"),
            react_1.default.createElement("button", { style: { ...footerBtnStyle, background: theme_1.colors.brandGradient, color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(6,182,212,0.2)' }, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor' }) }, t[lang].github),
            react_1.default.createElement("button", { style: footerBtnStyle, onClick: () => vscode_api_1.vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor/issues' }) }, t[lang].feedback))));
};
exports.default = Dashboard;
