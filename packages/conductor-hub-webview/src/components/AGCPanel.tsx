import React, { useState, useEffect, useCallback } from 'react';
import { colors, radius, shadow, glass, s } from '../theme';
import Icon from './Icon';
import type { Lang } from './Dashboard';

// ─── 类型定义 ──────────────────────────────────────────────────────────

interface NodeState {
    nodeId: string;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
    durationMs?: number;
    model?: string;
    error?: string;
}

interface AGCRunState {
    runId: string;
    version: number;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    nodes: Record<string, NodeState>;
    latestRisk?: { drScore: number; level: string };
    routeDecision?: { lane: string; skippedCount: number; confidence: number };
}

interface BenchmarkData {
    suiteName: string;
    totalCases: number;
    passed: number;
    passRate: number;
    avgDurationMs: number;
}

interface HITLState {
    isPaused: boolean;
    pauseReason?: string;
    pausedAtNode?: string;
    pausedAt?: string;
}

// ─── 多语言 ────────────────────────────────────────────────────────────

const t = {
    en: {
        title: 'AGC Orchestration',
        subtitle: 'Multi-Agent Governance & Collaboration',
        dagFlow: 'DAG Flow',
        runStatus: 'Run Status',
        benchmark: 'Benchmark',
        hitl: 'HITL Gate',
        noRun: 'No active run',
        noRunHint: 'Start an AGC run to see the visualization',
        version: 'Version',
        risk: 'Risk',
        route: 'Route',
        confidence: 'Confidence',
        skipped: 'skipped',
        passRate: 'Pass Rate',
        avgTime: 'Avg Time',
        cases: 'Cases',
        paused: 'Paused',
        waiting: 'Waiting for human input',
        approve: 'Approve',
        reject: 'Reject',
        noHitl: 'No HITL interaction',
        reason: 'Reason',
        demo: 'Load Demo',
    },
    zh: {
        title: 'AGC 编排引擎',
        subtitle: '多 Agent 治理与协作',
        dagFlow: 'DAG 流程',
        runStatus: '运行状态',
        benchmark: '评估基准',
        hitl: 'HITL 人机交互',
        noRun: '无活跃运行',
        noRunHint: '启动一次 AGC 运行以查看可视化',
        version: '版本',
        risk: '风险',
        route: '路由',
        confidence: '置信度',
        skipped: '已跳过',
        passRate: '通过率',
        avgTime: '平均耗时',
        cases: '用例',
        paused: '已暂停',
        waiting: '等待人工输入',
        approve: '批准',
        reject: '拒绝',
        noHitl: '无 HITL 交互',
        reason: '原因',
        demo: '加载演示',
    },
};

// ─── AGC 7 节点定义 ───────────────────────────────────────────────────

const AGC_NODES = [
    { id: 'ANALYZE', en: 'Analyze', zh: '分析', icon: 'search' },
    { id: 'PARALLEL', en: 'Parallel', zh: '并行', icon: 'layers' },
    { id: 'DEBATE', en: 'Debate', zh: '辩论', icon: 'radio' },
    { id: 'SYNTHESIZE', en: 'Synthesize', zh: '综合', icon: 'pen-tool' },
    { id: 'VERIFY', en: 'Verify', zh: '验证', icon: 'shield' },
    { id: 'PERSIST', en: 'Persist', zh: '持久化', icon: 'download' },
    { id: 'HITL', en: 'HITL', zh: '人机交互', icon: 'brain' },
];

// ─── 节点状态颜色 ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; glow?: string }> = {
    pending: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', text: 'rgba(255,255,255,0.4)' },
    queued: { bg: 'rgba(251,191,36,0.08)', border: 'rgba(251,191,36,0.3)', text: '#FBBF24' },
    running: { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.4)', text: '#06b6d4', glow: 'rgba(6,182,212,0.3)' },
    completed: { bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.3)', text: '#34D399' },
    failed: { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.3)', text: '#F87171', glow: 'rgba(248,113,113,0.2)' },
    skipped: { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.25)' },
};

const STATUS_LABELS: Record<string, { en: string; zh: string }> = {
    pending: { en: 'Pending', zh: '等待中' },
    queued: { en: 'Queued', zh: '排队中' },
    running: { en: 'Running', zh: '运行中' },
    completed: { en: 'Done', zh: '已完成' },
    failed: { en: 'Failed', zh: '失败' },
    skipped: { en: 'Skipped', zh: '已跳过' },
};

// ─── 演示数据 ─────────────────────────────────────────────────────────

const DEMO_STATE: AGCRunState = {
    runId: 'agc-demo-20260310',
    version: 12,
    status: 'running',
    nodes: {
        ANALYZE: { nodeId: 'ANALYZE', status: 'completed', durationMs: 1250, model: 'gemini-2.5-pro' },
        PARALLEL: { nodeId: 'PARALLEL', status: 'completed', durationMs: 3200, model: 'deepseek-v3' },
        DEBATE: { nodeId: 'DEBATE', status: 'completed', durationMs: 2100, model: 'claude-4-sonnet' },
        SYNTHESIZE: { nodeId: 'SYNTHESIZE', status: 'running', model: 'gemini-2.5-pro' },
        VERIFY: { nodeId: 'VERIFY', status: 'pending' },
        PERSIST: { nodeId: 'PERSIST', status: 'pending' },
        HITL: { nodeId: 'HITL', status: 'skipped' },
    },
    latestRisk: { drScore: 42, level: 'medium' },
    routeDecision: { lane: 'standard', skippedCount: 1, confidence: 85 },
};

const DEMO_BENCHMARKS: BenchmarkData[] = [
    { suiteName: 'DAG Correctness', totalCases: 5, passed: 5, passRate: 100, avgDurationMs: 2 },
    { suiteName: 'Governance Coverage', totalCases: 5, passed: 4, passRate: 80, avgDurationMs: 8 },
];

// ─── 组件 ──────────────────────────────────────────────────────────────

const AGCPanel: React.FC<{ lang: Lang }> = ({ lang }) => {
    const [runState, setRunState] = useState<AGCRunState | null>(null);
    const [benchmarks, setBenchmarks] = useState<BenchmarkData[]>([]);
    const [hitlState, setHitlState] = useState<HITLState>({ isPaused: false });
    const [pulseFrame, setPulseFrame] = useState(0);
    const l = t[lang];

    // 脉冲动画 — running 节点呼吸效果
    useEffect(() => {
        const timer = setInterval(() => setPulseFrame(f => (f + 1) % 60), 50);
        return () => clearInterval(timer);
    }, []);

    const loadDemo = useCallback(() => {
        setRunState(DEMO_STATE);
        setBenchmarks(DEMO_BENCHMARKS);
        setHitlState({ isPaused: false });
    }, []);

    const pulseOpacity = 0.6 + 0.4 * Math.sin((pulseFrame / 60) * Math.PI * 2);

    // ─── DAG 节点渲染 ──────────────────────────────────────────────

    const renderDagNode = (node: typeof AGC_NODES[0], index: number) => {
        const state = runState?.nodes[node.id];
        const status = state?.status || 'pending';
        const sc = STATUS_COLORS[status] || STATUS_COLORS.pending!;
        const isRunning = status === 'running';
        const isHitl = node.id === 'HITL';

        return (
            <React.Fragment key={node.id}>
                {/* 连接箭头 (非第一个节点, 非 HITL) */}
                {index > 0 && !isHitl && (
                    <div style={{
                        display: 'flex', alignItems: 'center',
                        color: status === 'completed' ? colors.success : 'rgba(255,255,255,0.15)',
                        fontSize: '18px', margin: '0 -2px',
                        transition: 'color 0.5s',
                    }}>
                        <Icon name="arrow-right" size={16} />
                    </div>
                )}
                {/* HITL 特殊位置 — 分支线 */}
                {isHitl && (
                    <div style={{
                        position: 'absolute', bottom: '-48px', right: '60px',
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        <div style={{
                            width: '1px', height: '20px',
                            background: sc.border,
                            transform: 'rotate(0deg)',
                        }} />
                    </div>
                )}
                {/* 节点卡片 */}
                <div style={{
                    ...glass.card,
                    background: sc.bg,
                    borderColor: sc.border,
                    padding: '12px 16px',
                    minWidth: isHitl ? '80px' : '100px',
                    textAlign: 'center',
                    position: isHitl ? 'absolute' : 'relative',
                    bottom: isHitl ? '-60px' : undefined,
                    right: isHitl ? '30px' : undefined,
                    opacity: isRunning ? pulseOpacity : 1,
                    boxShadow: sc.glow
                        ? `0 0 20px ${sc.glow}, ${shadow.glass}`
                        : shadow.glass,
                    transition: 'all 0.3s',
                }}>
                    <div style={{ marginBottom: '6px' }}>
                        <Icon name={node.icon} size={18} color={sc.text} />
                    </div>
                    <div style={{
                        fontSize: '12px', fontWeight: 600,
                        color: sc.text, letterSpacing: '-0.01em',
                    }}>
                        {lang === 'zh' ? node.zh : node.en}
                    </div>
                    {/* 状态标签 */}
                    <div style={{
                        marginTop: '6px', fontSize: '10px',
                        padding: '2px 8px', borderRadius: radius.pill,
                        background: `${sc.border}`,
                        color: sc.text, fontWeight: 500,
                        display: 'inline-block',
                    }}>
                        {STATUS_LABELS[status]?.[lang] || status}
                    </div>
                    {/* 耗时 */}
                    {state?.durationMs && (
                        <div style={{
                            marginTop: '4px', fontSize: '10px',
                            color: 'rgba(255,255,255,0.4)',
                        }}>
                            {state.durationMs}ms
                        </div>
                    )}
                    {/* 模型 */}
                    {state?.model && (
                        <div style={{
                            marginTop: '2px', fontSize: '9px',
                            color: 'rgba(255,255,255,0.3)',
                            maxWidth: '90px', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {state.model}
                        </div>
                    )}
                </div>
            </React.Fragment>
        );
    };

    // ─── 渲染 ──────────────────────────────────────────────────────

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{
                        ...s.sectionTitle, fontSize: '18px',
                        background: colors.brandGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        {l.title}
                    </h2>
                    <p style={s.hint}>{l.subtitle}</p>
                </div>
                <button style={s.btnSecondary} onClick={loadDemo}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Icon name="activity" size={13} />
                        {l.demo}
                    </span>
                </button>
            </div>

            {!runState ? (
                /* 空状态 */
                <div style={{
                    ...glass.panel, padding: '60px 24px',
                    textAlign: 'center',
                }}>
                    <Icon name="grid" size={40} color="rgba(255,255,255,0.15)" />
                    <p style={{ ...s.sectionTitle, marginTop: '16px', color: 'rgba(255,255,255,0.5)' }}>
                        {l.noRun}
                    </p>
                    <p style={s.hint}>{l.noRunHint}</p>
                </div>
            ) : (
                <>
                    {/* ── DAG 流程图 ──────────────────────────────── */}
                    <div style={glass.panel}>
                        <div style={{ padding: '16px 20px 8px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: 0 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="git-branch" size={15} color={colors.brand} />
                                    {l.dagFlow}
                                </span>
                            </h3>
                        </div>
                        <div style={{
                            padding: '16px 20px 24px',
                            overflowX: 'auto',
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center',
                                gap: '8px', position: 'relative',
                                paddingBottom: '70px', // HITL 分支空间
                            }}>
                                {AGC_NODES.filter(n => n.id !== 'HITL').map((node, i) => renderDagNode(node, i))}
                                {/* HITL 分支节点 */}
                                {renderDagNode(AGC_NODES.find(n => n.id === 'HITL')!, 6)}
                            </div>
                        </div>
                    </div>

                    {/* ── 运行状态 + Benchmark 并排 ──────────────── */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        {/* 运行状态 */}
                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="activity" size={15} color={colors.brand} />
                                    {l.runStatus}
                                </span>
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <StatCard label="Run ID" value={runState.runId.slice(-12)} />
                                <StatCard label={l.version} value={`v${runState.version}`} />
                                <StatCard
                                    label={l.risk}
                                    value={`${runState.latestRisk?.drScore ?? '—'}`}
                                    sub={runState.latestRisk?.level}
                                    color={riskColor(runState.latestRisk?.level)}
                                />
                                <StatCard
                                    label={l.route}
                                    value={runState.routeDecision?.lane ?? '—'}
                                    sub={`${l.confidence}: ${runState.routeDecision?.confidence ?? 0}%`}
                                    color={laneColor(runState.routeDecision?.lane)}
                                />
                            </div>
                        </div>

                        {/* Benchmark */}
                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="bar-chart" size={15} color={colors.brand} />
                                    {l.benchmark}
                                </span>
                            </h3>
                            {benchmarks.length === 0 ? (
                                <p style={s.hint}>No benchmark data</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {benchmarks.map(b => (
                                        <div key={b.suiteName} style={{
                                            ...glass.card, padding: '10px 14px',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '12px', fontWeight: 600 }}>{b.suiteName}</div>
                                                <div style={{ ...s.hint, marginTop: '2px' }}>
                                                    {b.passed}/{b.totalCases} {l.cases} · {b.avgDurationMs}ms {l.avgTime}
                                                </div>
                                            </div>
                                            <div style={{
                                                fontSize: '20px', fontWeight: 700,
                                                color: b.passRate >= 90 ? colors.success : b.passRate >= 70 ? colors.warning : colors.error,
                                            }}>
                                                {b.passRate}%
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── HITL 交互区 ──────────────────────────────── */}
                    <div style={{ ...glass.panel, padding: '16px 20px' }}>
                        <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Icon name="brain" size={15} color={colors.brand} />
                                {l.hitl}
                            </span>
                        </h3>
                        {hitlState.isPaused ? (
                            <div style={{
                                ...glass.card, padding: '16px 20px',
                                borderColor: 'rgba(251,191,36,0.3)',
                                background: 'rgba(251,191,36,0.06)',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{
                                            fontSize: '13px', fontWeight: 600,
                                            color: colors.warning, marginBottom: '4px',
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                        }}>
                                            <span style={{
                                                width: '8px', height: '8px', borderRadius: '50%',
                                                background: colors.warning,
                                                animation: 'pulse 1.5s infinite',
                                            }} />
                                            {l.paused} — {l.waiting}
                                        </div>
                                        {hitlState.pauseReason && (
                                            <div style={s.hint}>
                                                {l.reason}: {hitlState.pauseReason}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button style={{
                                            ...s.btnPrimary, padding: '8px 18px', fontSize: '12px',
                                        }} onClick={() => setHitlState({ isPaused: false })}>
                                            <Icon name="check" size={13} /> {l.approve}
                                        </button>
                                        <button style={{
                                            ...s.btnSecondary, padding: '8px 18px', fontSize: '12px',
                                            borderColor: 'rgba(248,113,113,0.3)',
                                            color: colors.error,
                                        }} onClick={() => setHitlState({ isPaused: false })}>
                                            <Icon name="x-circle" size={13} /> {l.reject}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                padding: '20px', textAlign: 'center',
                                color: 'rgba(255,255,255,0.3)', fontSize: '13px',
                            }}>
                                <Icon name="check-circle" size={24} color="rgba(52,211,153,0.4)" />
                                <p style={{ margin: '8px 0 0' }}>{l.noHitl}</p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

// ─── 子组件 ────────────────────────────────────────────────────────────

const StatCard: React.FC<{
    label: string; value: string; sub?: string; color?: string;
}> = ({ label, value, sub, color }) => (
    <div style={{
        ...glass.card, padding: '10px 14px',
    }}>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
            {label}
        </div>
        <div style={{
            fontSize: '16px', fontWeight: 700,
            color: color || 'var(--vscode-editor-foreground)',
            letterSpacing: '-0.02em',
        }}>
            {value}
        </div>
        {sub && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>{sub}</div>}
    </div>
);

// ─── 辅助函数 ──────────────────────────────────────────────────────────

function riskColor(level?: string): string {
    switch (level) {
        case 'low': return colors.success;
        case 'medium': return colors.warning;
        case 'high': return colors.error;
        case 'critical': return '#EF4444';
        default: return 'inherit';
    }
}

function laneColor(lane?: string): string {
    switch (lane) {
        case 'express': return colors.success;
        case 'standard': return colors.brand;
        case 'full': return colors.warning;
        case 'escalated': return colors.error;
        default: return 'inherit';
    }
}

export default AGCPanel;
