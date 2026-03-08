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
const vscode_api_1 = require("../vscode-api");
const theme_1 = require("../theme");
// ─── Token 格式化 (K / M) ─────────────────────────────────────────────────────
const formatTokens = (n) => {
    if (n >= 1000000)
        return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)
        return `${(n / 1000).toFixed(1)}K`;
    return String(n);
};
const Icon_1 = __importDefault(require("./Icon"));
// ─── Liquid Glass Stat Card ───────────────────────────────────────────────────
const CARD_CONFIGS = [
    { icon: 'monitor', gradient: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(59,130,246,0.15) 100%)', accentColor: '#22d3ee' },
    { icon: 'signal', gradient: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(99,102,241,0.15) 100%)', accentColor: '#a78bfa' },
    { icon: 'zap', gradient: 'linear-gradient(135deg, rgba(251,191,36,0.12) 0%, rgba(245,158,11,0.12) 100%)', accentColor: '#fbbf24' },
    { icon: 'gem', gradient: 'linear-gradient(135deg, rgba(236,72,153,0.12) 0%, rgba(168,85,247,0.12) 100%)', accentColor: '#e879f9' },
];
const StatCard = ({ icon, label, value, sub, config, delay }) => (react_1.default.createElement("div", { className: `animate-in animate-in-${delay}`, style: {
        flex: '1 1 0',
        minWidth: '140px',
        padding: '20px 18px',
        borderRadius: theme_1.radius.lg,
        background: config.gradient,
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: `1px solid rgba(255,255,255,0.08)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.12)`,
        position: 'relative',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    }, onMouseEnter: e => {
        e.currentTarget.style.transform = 'translateY(-3px)';
        e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.1), 0 12px 40px rgba(0,0,0,0.18), 0 0 30px ${config.accentColor}15`;
    }, onMouseLeave: e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.12)`;
    } },
    react_1.default.createElement("div", { className: "shimmer-bar", style: {
            position: 'absolute', inset: 0,
            borderRadius: theme_1.radius.lg,
            pointerEvents: 'none',
        } }),
    react_1.default.createElement("div", { style: { position: 'relative', zIndex: 1 } },
        react_1.default.createElement("div", { style: { marginBottom: '10px', opacity: 0.9, color: config.accentColor } },
            react_1.default.createElement(Icon_1.default, { name: icon, size: 18, color: config.accentColor })),
        react_1.default.createElement("div", { style: {
                fontSize: '30px', fontWeight: 800,
                fontFamily: "'SF Mono', 'JetBrains Mono', 'Cascadia Code', monospace",
                color: 'var(--vscode-editor-foreground)',
                lineHeight: 1.1, marginBottom: '6px',
                letterSpacing: '-1.5px',
            } }, value),
        react_1.default.createElement("div", { style: { fontSize: '11px', fontWeight: 600, color: 'var(--vscode-descriptionForeground)', textTransform: 'uppercase', letterSpacing: '0.8px' } }, label),
        sub && react_1.default.createElement("div", { style: { fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginTop: '3px', opacity: 0.6 } }, sub))));
// ─── Token by Provider Bar ────────────────────────────────────────────────────
const TokenByProviderChart = ({ data, lang }) => {
    const total = data.reduce((s, d) => s + d.tokens, 0);
    if (!data.length || total === 0) {
        return (react_1.default.createElement("div", { style: { textAlign: 'center', padding: '16px', fontSize: '12px', color: 'var(--vscode-descriptionForeground)', opacity: 0.5 } }, lang === 'zh' ? '暂无 Token 数据' : 'No token data'));
    }
    return (react_1.default.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        react_1.default.createElement("div", { style: {
                display: 'flex', height: '8px', borderRadius: theme_1.radius.pill, overflow: 'hidden',
                background: 'rgba(255,255,255,0.04)',
            } }, data.map((d, i) => (react_1.default.createElement("div", { key: i, style: {
                width: `${(d.tokens / total) * 100}%`,
                background: d.color,
                transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                minWidth: d.tokens > 0 ? '4px' : '0',
            } })))),
        react_1.default.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '4px' } }, data.map((d, i) => (react_1.default.createElement("div", { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' } },
            react_1.default.createElement("span", { style: {
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: d.color, flexShrink: 0,
                    boxShadow: `0 0 6px ${d.color}40`,
                } }),
            react_1.default.createElement("span", { style: { fontWeight: 500, color: 'var(--vscode-editor-foreground)' } }, d.label),
            react_1.default.createElement("span", { style: {
                    fontFamily: "'SF Mono', monospace", fontSize: '10px',
                    color: 'var(--vscode-descriptionForeground)', opacity: 0.8,
                } },
                formatTokens(d.tokens),
                react_1.default.createElement("span", { style: { opacity: 0.5, marginLeft: '2px' } },
                    "(",
                    total > 0 ? Math.round((d.tokens / total) * 100) : 0,
                    "%)"))))))));
};
// ─── Glowing Status Dot ───────────────────────────────────────────────────────
const statusInfo = (s) => {
    if (s === 'online')
        return { color: '#34D399', glow: '0 0 8px #34D399, 0 0 20px rgba(52,211,153,0.3)' };
    if (s === 'offline')
        return { color: '#F87171', glow: '0 0 6px rgba(248,113,113,0.4)' };
    return { color: '#6B7280', glow: 'none' };
};
const ModelStatusChip = ({ m }) => {
    const info = statusInfo(m.status);
    return (react_1.default.createElement("div", { style: {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 14px',
            borderRadius: theme_1.radius.md,
            ...theme_1.glass.card,
            fontSize: '12px',
            opacity: m.enabled ? 1 : 0.35,
        }, onMouseEnter: e => { e.currentTarget.style.background = theme_1.colors.glassHover; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }, onMouseLeave: e => { e.currentTarget.style.background = theme_1.colors.glass; e.currentTarget.style.borderColor = theme_1.colors.glassBorder; }, title: m.testMsg || (m.status === 'online' ? '在线' : m.status === 'offline' ? '离线' : '未测试') },
        react_1.default.createElement("span", { className: m.status === 'online' ? 'dot-online' : undefined, style: {
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                background: info.color, boxShadow: info.glow, flexShrink: 0,
            } }),
        react_1.default.createElement("span", { style: {
                fontWeight: 600, fontSize: '12px',
                color: theme_1.providerColors[m.group] || 'var(--vscode-editor-foreground)',
            } }, m.group === 'cli' ? m.label : (m.group?.split(' ')[0] || m.modelId)),
        react_1.default.createElement("span", { style: { color: 'var(--vscode-descriptionForeground)', fontSize: '11px', opacity: 0.6 } }, m.group === 'cli' ? (m.testMsg || '') : m.label?.split(' ').slice(0, 2).join(' '))));
};
// ─── Activity Row ─────────────────────────────────────────────────────────────
const ActivityRow = ({ r, lang }) => (react_1.default.createElement("div", { style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 14px',
        borderRadius: theme_1.radius.md,
        background: 'rgba(255,255,255,0.02)',
        borderLeft: `3px solid ${r.status === 'success' ? '#34D399' : '#F87171'}`,
        fontSize: '12px',
        transition: 'background 0.2s',
        backdropFilter: 'blur(8px)',
    }, onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)', onMouseLeave: e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)' },
    react_1.default.createElement("span", { style: { color: 'var(--vscode-descriptionForeground)', fontSize: '11px', minWidth: '44px', fontFamily: "'SF Mono', monospace" } }, new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    react_1.default.createElement("span", { style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', borderRadius: '50%',
            background: r.status === 'success' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
            flexShrink: 0,
        } }, r.status === 'success'
        ? react_1.default.createElement(Icon_1.default, { name: "check-circle", size: 12, color: "#34D399" })
        : react_1.default.createElement(Icon_1.default, { name: "x-circle", size: 12, color: "#F87171" })),
    react_1.default.createElement("span", { style: { fontWeight: 600, minWidth: '70px', fontSize: '12px', color: 'var(--vscode-editor-foreground)' } }, r.model || 'unknown'),
    react_1.default.createElement("span", { style: { flex: 1, color: 'var(--vscode-descriptionForeground)', fontSize: '11px', fontFamily: "'SF Mono', monospace", opacity: 0.6 } }, r.method),
    react_1.default.createElement("span", { style: {
            padding: '3px 10px', borderRadius: theme_1.radius.pill, fontSize: '10px', fontFamily: "'SF Mono', monospace", fontWeight: 600,
            background: r.duration < 3000 ? 'rgba(52,211,153,0.1)' : r.duration < 8000 ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)',
            color: r.duration < 3000 ? '#34D399' : r.duration < 8000 ? '#FBBF24' : '#F87171',
            backdropFilter: 'blur(4px)',
        } }, r.duration < 1000 ? `${r.duration}ms` : `${(r.duration / 1000).toFixed(1)}s`),
    r.totalTokens > 0 && (react_1.default.createElement("span", { style: {
            padding: '3px 10px', borderRadius: theme_1.radius.pill, fontSize: '10px', fontFamily: "'SF Mono', monospace",
            background: 'rgba(139,92,246,0.1)', color: '#A78BFA',
            backdropFilter: 'blur(4px)',
        } }, formatTokens(r.totalTokens)))));
// ─── Section Header ───────────────────────────────────────────────────────────
const SectionHeader = ({ icon, title, right }) => (react_1.default.createElement("div", { style: {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '14px',
    } },
    react_1.default.createElement("div", { style: {
            fontSize: '14px', fontWeight: 600, letterSpacing: '-0.2px',
            display: 'flex', alignItems: 'center', gap: '8px',
        } },
        react_1.default.createElement(Icon_1.default, { name: icon, size: 16, color: theme_1.colors.brand }),
        title),
    right && react_1.default.createElement("div", { style: { fontSize: '12px', color: 'var(--vscode-descriptionForeground)' } }, right)));
// ─── OverviewPanel ────────────────────────────────────────────────────────────
const OverviewPanel = ({ lang, onSwitchTab }) => {
    const [stats, setStats] = (0, react_1.useState)(null);
    const [testingAll, setTestingAll] = (0, react_1.useState)(false);
    const hasAutoTriggered = react_1.default.useRef(false);
    (0, react_1.useEffect)(() => {
        const handler = (ev) => {
            if (ev.data.command === 'overviewStats') {
                // 兼容: 如果后端没有 tokensByProvider，用 totalTokens 回退
                const rawStats = ev.data.stats;
                if (!rawStats.tokensByProvider) {
                    rawStats.tokensByProvider = rawStats.totalTokens > 0
                        ? [{ provider: 'total', label: 'Total', tokens: rawStats.totalTokens, color: '#a78bfa' }]
                        : [];
                }
                setStats(rawStats);
                const models = rawStats.models || [];
                const apiModels = models.filter((m) => m.group !== 'cli');
                const onlineApi = apiModels.filter((m) => m.status === 'online').length;
                if (!hasAutoTriggered.current && onlineApi === 0 && apiModels.length > 0) {
                    hasAutoTriggered.current = true;
                    setTestingAll(true);
                    setTimeout(() => vscode_api_1.vscode.postMessage({ command: 'testAllModels' }), 1000);
                }
            }
            if (ev.data.command === 'testAllComplete') {
                setTestingAll(false);
                vscode_api_1.vscode.postMessage({ command: 'getOverviewStats' });
            }
            if (ev.data.command === 'testResult' && ev.data.requestId?.startsWith('autotest_')) {
                const parts = ev.data.requestId.split('_');
                const configId = parts.slice(1, -1).join('_');
                setStats(prev => {
                    if (!prev)
                        return prev;
                    return {
                        ...prev,
                        models: prev.models.map(m => m.id === configId
                            ? { ...m, status: ev.data.ok ? 'online' : 'offline', testMsg: ev.data.msg }
                            : m),
                    };
                });
            }
        };
        window.addEventListener('message', handler);
        vscode_api_1.vscode.postMessage({ command: 'getOverviewStats' });
        const timer = setInterval(() => {
            vscode_api_1.vscode.postMessage({ command: 'getOverviewStats' });
        }, 30000);
        return () => {
            window.removeEventListener('message', handler);
            clearInterval(timer);
        };
    }, []);
    const T = {
        en: {
            models: 'MODELS', requests: 'REQUESTS', latency: 'AVG LATENCY', tokens: 'TOKENS',
            online: 'online', today: 'today', modelStatus: 'System Status',
            recentActivity: 'Live Activity', quickActions: 'Quick Actions', tokenBreakdown: 'Token Usage by Provider',
            testAll: 'Test All', addModel: 'Add Model', viewHistory: 'View History',
            noModels: 'No models configured. Add your first model to get started.',
            noActivity: 'No recent activity.',
            success: 'success',
        },
        zh: {
            models: '模型', requests: '请求', latency: '平均延迟', tokens: 'TOKEN',
            online: '在线', today: '今日', modelStatus: '系统状态',
            recentActivity: '实时动态', quickActions: '快速操作', tokenBreakdown: '各模型 Token 用量',
            testAll: '全部测试', addModel: '添加模型', viewHistory: '查看历史',
            noModels: '尚未配置任何模型，点击下方按钮开始添加。',
            noActivity: '暂无近期调用。',
            success: '成功',
        },
    }[lang];
    if (!stats) {
        return (react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' } },
            react_1.default.createElement("div", { style: { textAlign: 'center' } },
                react_1.default.createElement("div", { className: "shimmer-bar", style: { width: '200px', height: '4px', borderRadius: '2px', marginBottom: '12px' } }),
                react_1.default.createElement("span", { style: { fontSize: '13px', color: 'var(--vscode-descriptionForeground)', opacity: 0.6 } }, lang === 'zh' ? '加载中…' : 'Loading…'))));
    }
    const onlineCount = stats.models.filter(m => m.status === 'online').length;
    const totalEnabled = stats.models.filter(m => m.enabled).length;
    return (react_1.default.createElement("div", { style: { maxWidth: '880px' } },
        react_1.default.createElement("div", { style: { display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' } },
            react_1.default.createElement(StatCard, { icon: "monitor", label: T.models, value: `${onlineCount}/${totalEnabled}`, sub: T.online, config: CARD_CONFIGS[0], delay: 1 }),
            react_1.default.createElement(StatCard, { icon: "signal", label: T.requests, value: stats.todayRequests || '0', sub: `${T.today} · ${stats.successRate}% ${T.success}`, config: CARD_CONFIGS[1], delay: 2 }),
            react_1.default.createElement(StatCard, { icon: "zap", label: T.latency, value: stats.avgLatency > 0 ? `${(stats.avgLatency / 1000).toFixed(1)}s` : '—', sub: T.today, config: CARD_CONFIGS[2], delay: 3 }),
            react_1.default.createElement(StatCard, { icon: "gem", label: T.tokens, value: stats.totalTokens > 0 ? formatTokens(stats.totalTokens) : '—', sub: T.today, config: CARD_CONFIGS[3], delay: 4 })),
        stats.tokensByProvider.length > 0 && (react_1.default.createElement("div", { className: "animate-in", style: {
                padding: '20px',
                ...theme_1.glass.panel,
                marginBottom: '16px',
            } },
            react_1.default.createElement(SectionHeader, { icon: "bar-chart", title: T.tokenBreakdown }),
            react_1.default.createElement(TokenByProviderChart, { data: stats.tokensByProvider, lang: lang }))),
        react_1.default.createElement("div", { className: "animate-in", style: {
                padding: '20px',
                ...theme_1.glass.panel,
                marginBottom: '16px',
            } },
            react_1.default.createElement(SectionHeader, { icon: "cpu", title: T.modelStatus, right: react_1.default.createElement("span", null,
                    onlineCount,
                    "/",
                    totalEnabled,
                    " ",
                    T.online) }),
            stats.models.length > 0 ? (react_1.default.createElement("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
                stats.models.filter(m => m.enabled).map(m => (react_1.default.createElement(ModelStatusChip, { key: m.id, m: m }))),
                stats.models.filter(m => !m.enabled).length > 0 && (react_1.default.createElement("div", { style: {
                        fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
                        padding: '8px 14px', alignSelf: 'center', opacity: 0.4,
                    } },
                    "+",
                    stats.models.filter(m => !m.enabled).length,
                    " ",
                    lang === 'zh' ? '已禁用' : 'disabled')))) : (react_1.default.createElement("div", { style: {
                    textAlign: 'center', padding: '30px',
                    color: 'var(--vscode-descriptionForeground)', fontSize: '13px',
                } },
                react_1.default.createElement(Icon_1.default, { name: "help-circle", size: 36, color: "rgba(255,255,255,0.15)" }),
                react_1.default.createElement("div", { style: { marginTop: '10px' } }, T.noModels)))),
        react_1.default.createElement("div", { className: "animate-in", style: {
                padding: '20px',
                ...theme_1.glass.panel,
                marginBottom: '20px',
            } },
            react_1.default.createElement(SectionHeader, { icon: "activity", title: T.recentActivity }),
            stats.recentRequests.length > 0 ? (react_1.default.createElement("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, stats.recentRequests.slice(0, 8).map(r => (react_1.default.createElement(ActivityRow, { key: r.id, r: r, lang: lang }))))) : (react_1.default.createElement("div", { style: {
                    textAlign: 'center', padding: '24px',
                    color: 'var(--vscode-descriptionForeground)', fontSize: '12px', opacity: 0.5,
                } }, T.noActivity))),
        react_1.default.createElement("div", { className: "animate-in", style: {
                display: 'flex', gap: '10px', justifyContent: 'center',
                flexWrap: 'wrap', padding: '8px 0',
            } },
            react_1.default.createElement("button", { style: {
                    padding: '11px 26px',
                    background: testingAll ? 'rgba(255,255,255,0.04)' : theme_1.colors.brandGradient,
                    color: '#fff',
                    border: 'none',
                    borderRadius: theme_1.radius.pill,
                    cursor: testingAll ? 'wait' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    boxShadow: testingAll ? 'none' : '0 4px 20px rgba(6,182,212,0.3)',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    opacity: testingAll ? 0.4 : 1,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                }, disabled: testingAll, onClick: () => {
                    setTestingAll(true);
                    vscode_api_1.vscode.postMessage({ command: 'testAllModels' });
                }, onMouseEnter: e => { if (!testingAll)
                    e.currentTarget.style.transform = 'translateY(-2px)'; }, onMouseLeave: e => { e.currentTarget.style.transform = ''; } },
                react_1.default.createElement(Icon_1.default, { name: "refresh", size: 13 }),
                testingAll ? (lang === 'zh' ? '测试中…' : 'Testing…') : T.testAll),
            react_1.default.createElement("button", { style: {
                    padding: '11px 22px',
                    ...theme_1.glass.card,
                    color: 'var(--vscode-editor-foreground)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                }, onClick: () => onSwitchTab('config'), onMouseEnter: e => { e.currentTarget.style.background = theme_1.colors.glassHover; e.currentTarget.style.transform = 'translateY(-2px)'; }, onMouseLeave: e => { e.currentTarget.style.background = theme_1.colors.glass; e.currentTarget.style.transform = ''; } },
                react_1.default.createElement(Icon_1.default, { name: "plus", size: 13 }),
                T.addModel),
            react_1.default.createElement("button", { style: {
                    padding: '11px 22px',
                    ...theme_1.glass.card,
                    color: 'var(--vscode-editor-foreground)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                }, onClick: () => onSwitchTab('history'), onMouseEnter: e => { e.currentTarget.style.background = theme_1.colors.glassHover; e.currentTarget.style.transform = 'translateY(-2px)'; }, onMouseLeave: e => { e.currentTarget.style.background = theme_1.colors.glass; e.currentTarget.style.transform = ''; } },
                react_1.default.createElement(Icon_1.default, { name: "bar-chart", size: 13 }),
                T.viewHistory))));
};
exports.default = OverviewPanel;
