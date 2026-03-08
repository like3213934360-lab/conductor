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
const Icon_1 = __importDefault(require("./Icon"));
const HistoryConsole = ({ lang }) => {
    const [records, setRecords] = (0, react_1.useState)([]);
    const [selectedId, setSelectedId] = (0, react_1.useState)(null);
    const [search, setSearch] = (0, react_1.useState)('');
    const T = {
        en: {
            title: 'Request History', clear: 'Clear',
            empty: 'No requests yet. Make an ai_ask call to see history.',
            search: 'Search method, model, prompt…',
            model: 'Model', tokens: 'Tokens', duration: 'Duration',
            status: 'Status', request: 'Request', response: 'Response',
            selectHint: 'Select a request from the sidebar',
        },
        zh: {
            title: '调用历史', clear: '清空',
            empty: '暂无记录，调用 ai_ask 后将显示在这里。',
            search: '搜索 method / 模型 / prompt…',
            model: '模型', tokens: 'Token', duration: '耗时',
            status: '状态', request: '请求内容', response: '响应内容',
            selectHint: '选择左侧请求查看详情',
        },
    }[lang];
    const filtered = search.trim()
        ? records.filter(r => r.method.toLowerCase().includes(search.toLowerCase()) ||
            (r.model || '').toLowerCase().includes(search.toLowerCase()) ||
            r.requestPreview.toLowerCase().includes(search.toLowerCase()))
        : records;
    (0, react_1.useEffect)(() => {
        const handleMessage = (event) => {
            const message = event.data;
            if (message.command === 'loadHistory') {
                setRecords(message.data.records || []);
            }
        };
        window.addEventListener('message', handleMessage);
        const loadPage = () => vscode_api_1.vscode.postMessage({ command: 'getHistory', page: 1, pageSize: 50 });
        loadPage();
        const timer = setInterval(loadPage, 3000);
        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(timer);
        };
    }, []);
    const selectedRecord = records.find(r => r.id === selectedId);
    return (react_1.default.createElement("div", { style: {
            display: 'flex', height: '100%', gap: '0',
            borderRadius: theme_1.radius.md, overflow: 'hidden',
            ...theme_1.glass.panel,
        } },
        react_1.default.createElement("div", { style: {
                width: '300px',
                borderRight: `1px solid ${theme_1.colors.glassBorder}`,
                overflowY: 'auto',
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(24px)',
                display: 'flex', flexDirection: 'column',
            } },
            react_1.default.createElement("div", { style: {
                    padding: '12px', borderBottom: `1px solid ${theme_1.colors.glassBorder}`,
                    display: 'flex', alignItems: 'center', gap: '8px',
                } },
                react_1.default.createElement("span", { style: { opacity: 0.4, flexShrink: 0 } },
                    react_1.default.createElement(Icon_1.default, { name: "search", size: 14, color: "var(--vscode-descriptionForeground)" })),
                react_1.default.createElement("input", { type: "text", placeholder: T.search, value: search, onChange: e => setSearch(e.target.value), style: {
                        ...theme_1.s.input,
                        fontSize: '12px',
                        padding: '7px 10px',
                        background: 'rgba(255,255,255,0.03)',
                        border: `1px solid ${theme_1.colors.glassBorder}`,
                    } })),
            react_1.default.createElement("div", { style: { flex: 1, overflowY: 'auto' } },
                filtered.map(record => (react_1.default.createElement("div", { key: record.id, onClick: () => setSelectedId(record.id), style: {
                        padding: '12px 14px',
                        cursor: 'pointer',
                        borderBottom: `1px solid rgba(255,255,255,0.04)`,
                        backgroundColor: selectedId === record.id
                            ? 'rgba(6,182,212,0.08)'
                            : 'transparent',
                        transition: 'all 0.2s ease',
                        borderLeft: `3px solid ${record.status === 'success' ? theme_1.colors.success : theme_1.colors.error}`,
                    }, onMouseEnter: e => {
                        if (selectedId !== record.id)
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                    }, onMouseLeave: e => {
                        if (selectedId !== record.id)
                            e.currentTarget.style.backgroundColor = 'transparent';
                    } },
                    react_1.default.createElement("div", { style: {
                            display: 'flex', justifyContent: 'space-between',
                            fontSize: '10px', color: 'var(--vscode-descriptionForeground)',
                            marginBottom: '4px', opacity: 0.7,
                        } },
                        react_1.default.createElement("span", { style: { fontFamily: "'SF Mono', monospace" } }, new Date(record.timestamp).toLocaleTimeString()),
                        react_1.default.createElement("span", { style: {
                                color: record.status === 'success' ? theme_1.colors.success : theme_1.colors.error,
                                fontWeight: 600,
                                display: 'inline-flex', alignItems: 'center', gap: '3px',
                            } },
                            react_1.default.createElement(Icon_1.default, { name: record.status === 'success' ? 'check-circle' : 'x-circle', size: 10, color: record.status === 'success' ? theme_1.colors.success : theme_1.colors.error }),
                            record.duration,
                            "ms")),
                    react_1.default.createElement("div", { style: {
                            fontWeight: 600, fontSize: '12px',
                            fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                            marginBottom: '3px',
                            color: 'var(--vscode-editor-foreground)',
                        } }, record.method),
                    record.model && (react_1.default.createElement("div", { style: {
                            fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
                            marginBottom: '2px', opacity: 0.8,
                        } }, record.model)),
                    (record.inputTokens || record.outputTokens) ? (react_1.default.createElement("div", { style: {
                            fontSize: '10px', opacity: 0.6,
                            color: 'var(--vscode-descriptionForeground)',
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                        } },
                        react_1.default.createElement(Icon_1.default, { name: "gem", size: 10, color: "var(--vscode-descriptionForeground)" }),
                        record.totalTokens || ((record.inputTokens || 0) + (record.outputTokens || 0)),
                        " tokens")) : null))),
                filtered.length === 0 && (react_1.default.createElement("div", { style: {
                        padding: '50px 20px', textAlign: 'center',
                        color: 'var(--vscode-descriptionForeground)',
                    } },
                    react_1.default.createElement("div", { style: { marginBottom: '12px', opacity: 0.25 } },
                        react_1.default.createElement(Icon_1.default, { name: "inbox", size: 40, color: "var(--vscode-descriptionForeground)" })),
                    react_1.default.createElement("div", { style: { fontSize: '12px', opacity: 0.6 } }, search ? `No results for "${search}"` : T.empty))))),
        react_1.default.createElement("div", { style: { flex: 1, padding: '24px', overflowY: 'auto', background: 'transparent' } }, selectedRecord ? (react_1.default.createElement("div", { style: { maxWidth: '800px' } },
            react_1.default.createElement("h2", { style: {
                    marginTop: 0, marginBottom: '14px',
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                    fontSize: '16px', fontWeight: 700,
                    letterSpacing: '-0.3px',
                } }, selectedRecord.method),
            react_1.default.createElement("div", { style: {
                    marginBottom: '18px', display: 'flex',
                    gap: '8px', alignItems: 'center', flexWrap: 'wrap',
                } },
                react_1.default.createElement("span", { style: {
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '4px 12px', borderRadius: theme_1.radius.pill,
                        fontSize: '11px', fontWeight: 600,
                        background: selectedRecord.status === 'success'
                            ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                        color: selectedRecord.status === 'success' ? theme_1.colors.success : theme_1.colors.error,
                        backdropFilter: 'blur(8px)',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: selectedRecord.status === 'success' ? 'check-circle' : 'x-circle', size: 12, color: selectedRecord.status === 'success' ? theme_1.colors.success : theme_1.colors.error }),
                    selectedRecord.status.toUpperCase()),
                selectedRecord.model && selectedRecord.model !== 'unknown' && (react_1.default.createElement("span", { style: {
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '4px 12px', borderRadius: theme_1.radius.pill,
                        fontSize: '11px', fontWeight: 500,
                        background: 'rgba(139,92,246,0.1)',
                        color: '#A78BFA',
                        backdropFilter: 'blur(8px)',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: "cpu", size: 11, color: "#A78BFA" }),
                    selectedRecord.model)),
                react_1.default.createElement("span", { style: {
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '4px 12px', borderRadius: theme_1.radius.pill,
                        fontSize: '11px',
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${theme_1.colors.glassBorder}`,
                        color: 'var(--vscode-foreground)',
                        backdropFilter: 'blur(8px)',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: "clock", size: 11 }),
                    selectedRecord.duration,
                    "ms"),
                (selectedRecord.inputTokens || selectedRecord.outputTokens) ? (react_1.default.createElement("span", { style: {
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '4px 12px', borderRadius: theme_1.radius.pill,
                        fontSize: '11px',
                        background: 'rgba(255,255,255,0.04)',
                        border: `1px solid ${theme_1.colors.glassBorder}`,
                        color: 'var(--vscode-foreground)',
                        backdropFilter: 'blur(8px)',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: "upload", size: 11 }),
                    " ",
                    selectedRecord.inputTokens || 0,
                    react_1.default.createElement("span", { style: { opacity: 0.3 } }, "/"),
                    react_1.default.createElement(Icon_1.default, { name: "download", size: 11 }),
                    " ",
                    selectedRecord.outputTokens || 0)) : null),
            react_1.default.createElement("div", { style: { height: '1px', background: theme_1.colors.glassBorder, margin: '0 0 20px' } }),
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } },
                react_1.default.createElement(Icon_1.default, { name: "upload", size: 14, color: theme_1.colors.brand }),
                react_1.default.createElement("h3", { style: { margin: 0, fontSize: '13px', fontWeight: 600 } }, T.request)),
            react_1.default.createElement("pre", { style: {
                    ...theme_1.glass.panel,
                    padding: '14px', fontSize: '12px',
                    whiteSpace: 'pre-wrap', overflow: 'auto',
                    fontFamily: "'SF Mono', 'JetBrains Mono', var(--vscode-editor-font-family)",
                    color: 'var(--vscode-editor-foreground)',
                    lineHeight: 1.6,
                } }, selectedRecord.requestPreview),
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '24px 0 10px' } },
                react_1.default.createElement(Icon_1.default, { name: "download", size: 14, color: theme_1.colors.success }),
                react_1.default.createElement("h3", { style: { margin: 0, fontSize: '13px', fontWeight: 600 } }, T.response)),
            react_1.default.createElement("pre", { style: {
                    ...theme_1.glass.panel,
                    padding: '14px', fontSize: '12px',
                    whiteSpace: 'pre-wrap', overflow: 'auto',
                    fontFamily: "'SF Mono', 'JetBrains Mono', var(--vscode-editor-font-family)",
                    color: 'var(--vscode-editor-foreground)',
                    lineHeight: 1.6,
                } }, selectedRecord.responsePreview))) : (react_1.default.createElement("div", { style: {
                display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: '12px',
                color: 'var(--vscode-descriptionForeground)',
            } },
            react_1.default.createElement("div", { style: { opacity: 0.15 } },
                react_1.default.createElement(Icon_1.default, { name: "clipboard", size: 48, color: "var(--vscode-descriptionForeground)" })),
            react_1.default.createElement("span", { style: { fontSize: '13px', opacity: 0.5 } }, T.selectHint))))));
};
exports.default = HistoryConsole;
