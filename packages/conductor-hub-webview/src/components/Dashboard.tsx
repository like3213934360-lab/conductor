import React, { useState } from 'react';
import OverviewPanel from './OverviewPanel';
import ConfigPanel from './ConfigPanel';
import HistoryConsole from './HistoryConsole';
import RoutingGuidePanel from './RoutingGuidePanel';
import SkillPanel from './SkillPanel';
import TestPanel from './TestPanel';
import AGCPanel from './AGCPanel';
import { colors, radius, s, glass } from '../theme';
import Icon from './Icon';
import { vscode } from '../vscode-api';

export type Lang = 'en' | 'zh';

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
const TAB_ICON_MAP: Record<string, string> = {
    overview: 'grid',
    settings: 'settings',
    history: 'clock',
    guide: 'compass',
    skill: 'layers',
    agc: 'workflow',
    test: 'flask',
};

const Dashboard: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'history' | 'guide' | 'skill' | 'agc' | 'test'>('overview');
    const [lang, setLang] = useState<Lang>('zh');

    const logoUri = document.getElementById('root')?.getAttribute('data-logo-uri') || '';

    const langBtnStyle = (active: boolean): React.CSSProperties => ({
        padding: '4px 12px',
        borderRadius: radius.pill,
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: active ? '600' : '400',
        background: active ? 'rgba(6,182,212,0.15)' : 'transparent',
        color: active ? colors.brand : 'var(--vscode-descriptionForeground)',
        border: active ? `1px solid ${colors.brand}40` : '1px solid transparent',
        userSelect: 'none',
        transition: 'all 0.2s',
        backdropFilter: 'blur(8px)',
    });

    const footerBtnStyle: React.CSSProperties = {
        padding: '7px 16px',
        borderRadius: radius.pill,
        border: `1px solid ${colors.glassBorder}`,
        background: colors.glass,
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
        { key: 'agc', label: 'AGC', icon: 'agc' },
        { key: 'test', label: t[lang].test, icon: 'test' },
    ] as const;

    return (
        <div style={{
            height: '100%', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
            background: 'var(--vscode-editor-background)',
        }}>
            {/* ── Brand Header (Liquid Glass) ────────────────────────── */}
            <div style={{
                padding: '20px 24px 0',
                borderBottom: `1px solid ${colors.glassBorder}`,
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(20px)',
            }}>
                {/* Top row: brand + language toggle */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '6px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {logoUri && (
                            <img src={logoUri} alt="Conductor Hub" style={{
                                width: '30px', height: '30px', objectFit: 'contain',
                                filter: 'drop-shadow(0 2px 8px rgba(6,182,212,0.3))',
                            }} />
                        )}
                        <div>
                            <h1 style={{
                                margin: 0, fontSize: '20px', fontWeight: 700,
                                letterSpacing: '-0.4px',
                                background: colors.brandGradient,
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
                    {tabs.map(tab => (
                        <span
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key as any)}
                            style={{
                                ...s.pillTab(activeTab === tab.key),
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            <Icon name={TAB_ICON_MAP[tab.icon] || tab.icon} size={13} />
                            {tab.label}
                        </span>
                    ))}
                </div>
            </div>

            {/* ── Content Area ─────────────────────────────────────────── */}
            <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
                {activeTab === 'overview' && <OverviewPanel lang={lang} onSwitchTab={(tab) => setActiveTab(tab as any)} />}
                {activeTab === 'config' && <ConfigPanel lang={lang} />}
                {activeTab === 'history' && <HistoryConsole lang={lang} />}
                {activeTab === 'guide' && <RoutingGuidePanel lang={lang} />}
                {activeTab === 'skill' && <SkillPanel lang={lang} />}
                {activeTab === 'agc' && <AGCPanel lang={lang} />}
                {activeTab === 'test' && <TestPanel lang={lang} />}
            </div>

            {/* ── Footer (Liquid Glass) ──────────────────────────────── */}
            <div style={{
                padding: '10px 24px',
                borderTop: `1px solid ${colors.glassBorder}`,
                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
                background: 'rgba(255,255,255,0.015)',
                backdropFilter: 'blur(16px)',
            }}>
                <span style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground)', marginRight: '4px', opacity: 0.6 }}>
                    Conductor Hub
                </span>
                <button
                    style={{ ...footerBtnStyle, background: colors.brandGradient, color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(6,182,212,0.2)' }}
                    onClick={() => vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor' })}
                >
                    {t[lang].github}
                </button>
                <button
                    style={footerBtnStyle}
                    onClick={() => vscode.postMessage({ command: 'openUrl', url: 'https://github.com/like3213934360-lab/conductor/issues' })}
                >
                    {t[lang].feedback}
                </button>
            </div>
        </div>
    );
};

export default Dashboard;
