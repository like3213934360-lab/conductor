import React, { useState, useEffect } from 'react';
import { vscode } from '../vscode-api';
import { Lang } from './Dashboard';
import { s, colors, radius, shadow, glass } from '../theme';
import Icon from './Icon';

interface RequestRecord {
    id: string;
    timestamp: number;
    clientName: string;
    method: string;
    duration: number;
    requestPreview: string;
    responsePreview: string;
    status: 'success' | 'error';
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
}

const HistoryConsole: React.FC<{ lang: Lang }> = ({ lang }) => {
    const [records, setRecords] = useState<RequestRecord[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [search, setSearch] = useState('');

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
        ? records.filter(r =>
            r.method.toLowerCase().includes(search.toLowerCase()) ||
            (r.model || '').toLowerCase().includes(search.toLowerCase()) ||
            r.requestPreview.toLowerCase().includes(search.toLowerCase())
        )
        : records;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'loadHistory') {
                setRecords(message.data.records || []);
            }
        };
        window.addEventListener('message', handleMessage);

        const loadPage = () => vscode.postMessage({ command: 'getHistory', page: 1, pageSize: 50 });
        loadPage();

        const timer = setInterval(loadPage, 3000);
        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(timer);
        };
    }, []);

    const selectedRecord = records.find(r => r.id === selectedId);

    return (
        <div style={{
            display: 'flex', height: '100%', gap: '0',
            borderRadius: radius.md, overflow: 'hidden',
            ...glass.panel,
        }}>
            {/* ── Sidebar ────────────────────────────────────── */}
            <div style={{
                width: '300px',
                borderRight: `1px solid ${colors.glassBorder}`,
                overflowY: 'auto',
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(24px)',
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Search box */}
                <div style={{
                    padding: '12px', borderBottom: `1px solid ${colors.glassBorder}`,
                    display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                    <span style={{ opacity: 0.4, flexShrink: 0 }}>
                        <Icon name="search" size={14} color="var(--vscode-descriptionForeground)" />
                    </span>
                    <input
                        type="text"
                        placeholder={T.search}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{
                            ...s.input,
                            fontSize: '12px',
                            padding: '7px 10px',
                            background: 'rgba(255,255,255,0.03)',
                            border: `1px solid ${colors.glassBorder}`,
                        }}
                    />
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filtered.map(record => (
                        <div
                            key={record.id}
                            onClick={() => setSelectedId(record.id)}
                            style={{
                                padding: '12px 14px',
                                cursor: 'pointer',
                                borderBottom: `1px solid rgba(255,255,255,0.04)`,
                                backgroundColor: selectedId === record.id
                                    ? 'rgba(6,182,212,0.08)'
                                    : 'transparent',
                                transition: 'all 0.2s ease',
                                borderLeft: `3px solid ${record.status === 'success' ? colors.success : colors.error}`,
                            }}
                            onMouseEnter={e => {
                                if (selectedId !== record.id) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                            }}
                            onMouseLeave={e => {
                                if (selectedId !== record.id) e.currentTarget.style.backgroundColor = 'transparent';
                            }}
                        >
                            <div style={{
                                display: 'flex', justifyContent: 'space-between',
                                fontSize: '10px', color: 'var(--vscode-descriptionForeground)',
                                marginBottom: '4px', opacity: 0.7,
                            }}>
                                <span style={{ fontFamily: "'SF Mono', monospace" }}>
                                    {new Date(record.timestamp).toLocaleTimeString()}
                                </span>
                                <span style={{
                                    color: record.status === 'success' ? colors.success : colors.error,
                                    fontWeight: 600,
                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                }}>
                                    <Icon
                                        name={record.status === 'success' ? 'check-circle' : 'x-circle'}
                                        size={10}
                                        color={record.status === 'success' ? colors.success : colors.error}
                                    />
                                    {record.duration}ms
                                </span>
                            </div>
                            <div style={{
                                fontWeight: 600, fontSize: '12px',
                                fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                                marginBottom: '3px',
                                color: 'var(--vscode-editor-foreground)',
                            }}>
                                {record.method}
                            </div>
                            {record.model && (
                                <div style={{
                                    fontSize: '11px', color: 'var(--vscode-descriptionForeground)',
                                    marginBottom: '2px', opacity: 0.8,
                                }}>
                                    {record.model}
                                </div>
                            )}
                            {(record.inputTokens || record.outputTokens) ? (
                                <div style={{
                                    fontSize: '10px', opacity: 0.6,
                                    color: 'var(--vscode-descriptionForeground)',
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                }}>
                                    <Icon name="gem" size={10} color="var(--vscode-descriptionForeground)" />
                                    {record.totalTokens || ((record.inputTokens || 0) + (record.outputTokens || 0))} tokens
                                </div>
                            ) : null}
                        </div>
                    ))}
                    {filtered.length === 0 && (
                        <div style={{
                            padding: '50px 20px', textAlign: 'center',
                            color: 'var(--vscode-descriptionForeground)',
                        }}>
                            <div style={{ marginBottom: '12px', opacity: 0.25 }}>
                                <Icon name="inbox" size={40} color="var(--vscode-descriptionForeground)" />
                            </div>
                            <div style={{ fontSize: '12px', opacity: 0.6 }}>
                                {search ? `No results for "${search}"` : T.empty}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Detail Panel ───────────────────────────────── */}
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: 'transparent' }}>
                {selectedRecord ? (
                    <div style={{ maxWidth: '800px' }}>
                        {/* Method title */}
                        <h2 style={{
                            marginTop: 0, marginBottom: '14px',
                            fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                            fontSize: '16px', fontWeight: 700,
                            letterSpacing: '-0.3px',
                        }}>
                            {selectedRecord.method}
                        </h2>

                        {/* Status badges */}
                        <div style={{
                            marginBottom: '18px', display: 'flex',
                            gap: '8px', alignItems: 'center', flexWrap: 'wrap',
                        }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '4px 12px', borderRadius: radius.pill,
                                fontSize: '11px', fontWeight: 600,
                                background: selectedRecord.status === 'success'
                                    ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                                color: selectedRecord.status === 'success' ? colors.success : colors.error,
                                backdropFilter: 'blur(8px)',
                            }}>
                                <Icon
                                    name={selectedRecord.status === 'success' ? 'check-circle' : 'x-circle'}
                                    size={12}
                                    color={selectedRecord.status === 'success' ? colors.success : colors.error}
                                />
                                {selectedRecord.status.toUpperCase()}
                            </span>

                            {selectedRecord.model && selectedRecord.model !== 'unknown' && (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '4px 12px', borderRadius: radius.pill,
                                    fontSize: '11px', fontWeight: 500,
                                    background: 'rgba(139,92,246,0.1)',
                                    color: '#A78BFA',
                                    backdropFilter: 'blur(8px)',
                                }}>
                                    <Icon name="cpu" size={11} color="#A78BFA" />
                                    {selectedRecord.model}
                                </span>
                            )}

                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '4px 12px', borderRadius: radius.pill,
                                fontSize: '11px',
                                background: 'rgba(255,255,255,0.04)',
                                border: `1px solid ${colors.glassBorder}`,
                                color: 'var(--vscode-foreground)',
                                backdropFilter: 'blur(8px)',
                            }}>
                                <Icon name="clock" size={11} />
                                {selectedRecord.duration}ms
                            </span>

                            {(selectedRecord.inputTokens || selectedRecord.outputTokens) ? (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                                    padding: '4px 12px', borderRadius: radius.pill,
                                    fontSize: '11px',
                                    background: 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${colors.glassBorder}`,
                                    color: 'var(--vscode-foreground)',
                                    backdropFilter: 'blur(8px)',
                                }}>
                                    <Icon name="upload" size={11} /> {selectedRecord.inputTokens || 0}
                                    <span style={{ opacity: 0.3 }}>/</span>
                                    <Icon name="download" size={11} /> {selectedRecord.outputTokens || 0}
                                </span>
                            ) : null}
                        </div>

                        <div style={{ height: '1px', background: colors.glassBorder, margin: '0 0 20px' }} />

                        {/* Request section */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <Icon name="upload" size={14} color={colors.brand} />
                            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>
                                {T.request}
                            </h3>
                        </div>
                        <pre style={{
                            ...glass.panel,
                            padding: '14px', fontSize: '12px',
                            whiteSpace: 'pre-wrap', overflow: 'auto',
                            fontFamily: "'SF Mono', 'JetBrains Mono', var(--vscode-editor-font-family)",
                            color: 'var(--vscode-editor-foreground)',
                            lineHeight: 1.6,
                        }}>
                            {selectedRecord.requestPreview}
                        </pre>

                        {/* Response section */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '24px 0 10px' }}>
                            <Icon name="download" size={14} color={colors.success} />
                            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>
                                {T.response}
                            </h3>
                        </div>
                        <pre style={{
                            ...glass.panel,
                            padding: '14px', fontSize: '12px',
                            whiteSpace: 'pre-wrap', overflow: 'auto',
                            fontFamily: "'SF Mono', 'JetBrains Mono', var(--vscode-editor-font-family)",
                            color: 'var(--vscode-editor-foreground)',
                            lineHeight: 1.6,
                        }}>
                            {selectedRecord.responsePreview}
                        </pre>
                    </div>
                ) : (
                    <div style={{
                        display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column', gap: '12px',
                        color: 'var(--vscode-descriptionForeground)',
                    }}>
                        <div style={{ opacity: 0.15 }}>
                            <Icon name="clipboard" size={48} color="var(--vscode-descriptionForeground)" />
                        </div>
                        <span style={{ fontSize: '13px', opacity: 0.5 }}>{T.selectHint}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryConsole;
