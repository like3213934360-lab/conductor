import React, { useState, useEffect, useCallback } from 'react';
import { colors, radius, shadow, glass, s } from '../theme';
import Icon from './Icon';
import type { Lang } from './Dashboard';
import { vscode } from '../vscode-api';

// ─── 类型定义 ──────────────────────────────────────────────────────────

interface NodeState {
    nodeId: string;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
    durationMs?: number;
    model?: string;
    error?: string;
    startedAt?: string;
    completedAt?: string;
    output?: Record<string, unknown>;
}

interface AGCRunState {
    runId: string;
    version: number;
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    nodes: Record<string, NodeState>;
    latestRisk?: { drScore: number; level: string };
    routeDecision?: { lane: string; skippedCount: number; confidence: number };
    workflow?: string;
    verdict?: string;
    sourcePath?: string;
    updatedAt?: number;
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

type LaunchTone = 'idle' | 'info' | 'success' | 'error';

interface TimelineEntry {
    id: string;
    nodeId: string;
    kind: 'started' | 'completed' | 'failed';
    timestamp: number;
    label: string;
    detail?: string;
}

// ─── 多语言 ────────────────────────────────────────────────────────────

const t = {
    en: {
        title: 'Workflow Visualization',
        subtitle: 'Multi-Agent Workflow, Governance & Collaboration',
        startRun: 'Start AGC',
        goalLabel: 'Goal',
        goalPlaceholder: 'Describe the AGC analysis you want to run',
        goalHint: 'Use the runtime entrypoint instead of the prompt slash command to enforce full-path execution.',
        dagFlow: 'DAG Flow',
        runStatus: 'Run Status',
        benchmark: 'Benchmark',
        hitl: 'HITL Gate',
        phase: 'Phase',
        updated: 'Updated',
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
        starting: 'Starting...',
        startPending: 'AGC start request received. Initializing runtime...',
        startSuccess: 'AGC runtime started. Live state stream is now attached.',
        startError: 'Failed to start AGC',
        timeline: 'Live Timeline',
        currentNode: 'Current Node',
        selectedNode: 'Node Detail',
        liveLogs: 'Structured Output',
        noTimeline: 'No runtime events yet',
        noNodeSelected: 'Select a node to inspect its latest state',
        activeNode: 'Active Node',
        lastUpdated: 'Last Event',
        elapsed: 'Elapsed',
        failureReason: 'Failure Reason',
        outputSummary: 'Output Summary',
        models: 'Models',
        findings: 'Findings',
    },
    zh: {
        title: '工作流可视化',
        subtitle: '多 Agent 工作流、治理与协作',
        startRun: '启动 AGC',
        goalLabel: '目标',
        goalPlaceholder: '描述你希望 AGC 执行的分析任务',
        goalHint: '这里走的是真实运行时入口，不是 prompt 式 /agc，因此会强制执行完整路径。',
        dagFlow: 'DAG 流程',
        runStatus: '运行状态',
        benchmark: '评估基准',
        hitl: 'HITL 人机交互',
        phase: '阶段',
        updated: '更新时间',
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
        starting: '启动中...',
        startPending: '已接收启动请求，正在初始化运行时...',
        startSuccess: 'AGC 运行时已启动，实时状态流已接入。',
        startError: '启动 AGC 失败',
        timeline: '实时时间线',
        currentNode: '当前节点',
        selectedNode: '节点详情',
        liveLogs: '结构化输出',
        noTimeline: '暂无运行事件',
        noNodeSelected: '选择一个节点以查看它的最新状态',
        activeNode: '当前节点',
        lastUpdated: '最后事件',
        elapsed: '耗时',
        failureReason: '失败原因',
        outputSummary: '输出摘要',
        models: '模型',
        findings: '发现',
    },
};

// ─── AGC 7 节点定义 ───────────────────────────────────────────────────

const AGC_NODES = [
    { id: 'ANALYZE', en: 'Analyze', zh: '分析', icon: 'search' },
    { id: 'PARALLEL', en: 'Parallel', zh: '并行', icon: 'layers' },
    { id: 'DEBATE', en: 'Debate', zh: '辩论', icon: 'radio' },
    { id: 'SYNTHESIZE', en: 'Synthesize', zh: '综合', icon: 'pen-tool' },
    { id: 'IMPLEMENT', en: 'Implement', zh: '实现', icon: 'tool' },
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
    const [runGoal, setRunGoal] = useState('');
    const [isStarting, setIsStarting] = useState(false);
    const [launchTone, setLaunchTone] = useState<LaunchTone>('idle');
    const [launchMessage, setLaunchMessage] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState<string>('ANALYZE');
    const l = t[lang];

    // 脉冲动画 — running 节点呼吸效果
    useEffect(() => {
        const timer = setInterval(() => setPulseFrame(f => (f + 1) % 60), 50);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const handleMessage = (ev: MessageEvent) => {
            if (ev.data.command === 'agcState') {
                const mapped = mapAgcPayload(ev.data.data);
                setRunState(mapped.runState);
                setBenchmarks(mapped.benchmarks);
                setHitlState(mapped.hitlState);
                if (mapped.runState?.status !== 'pending' && mapped.runState?.status !== 'running') {
                    setIsStarting(false);
                }
                return;
            }

            if (ev.data.command === 'agcRunPending') {
                setLaunchTone('info');
                setLaunchMessage(ev.data.message || l.startPending);
                return;
            }

            if (ev.data.command === 'agcRunStarted') {
                setIsStarting(false);
                setLaunchTone('success');
                setLaunchMessage(`${l.startSuccess} Run ID: ${ev.data.runId}`);
                return;
            }

            if (ev.data.command === 'agcRunError') {
                setIsStarting(false);
                setLaunchTone('error');
                setLaunchMessage(ev.data.message || l.startError);
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'getAgcState' });
        const timer = setInterval(() => vscode.postMessage({ command: 'getAgcState' }), 3000);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(timer);
        };
    }, []);

    const loadDemo = useCallback(() => {
        setRunState(DEMO_STATE);
        setBenchmarks(DEMO_BENCHMARKS);
        setHitlState({ isPaused: false });
    }, []);

    const startRun = useCallback(() => {
        const goal = runGoal.trim();
        if (!goal || isStarting) {
            return;
        }
        setIsStarting(true);
        setLaunchTone('info');
        setLaunchMessage(l.startPending);
        vscode.postMessage({ command: 'startAgcRun', goal });
    }, [isStarting, l.startPending, runGoal]);

    const pulseOpacity = 0.6 + 0.4 * Math.sin((pulseFrame / 60) * Math.PI * 2);
    const timeline = buildTimeline(runState, lang);
    const currentNodeId = inferFocusedNode(runState);
    const selectedNode = runState?.nodes[selectedNodeId] || (currentNodeId ? runState?.nodes[currentNodeId] : undefined);
    const selectedNodeKey = runState?.nodes[selectedNodeId] ? selectedNodeId : currentNodeId;
    const selectedNodeOutput = selectedNode?.output ? summarizeOutput(selectedNode.output) : [];
    const selectedNodeFindings = extractFindings(selectedNode?.output);

    // ─── DAG 流程图组件 ────────────────────────────────────────────

    // 布局常量
    const DAG_NODE_W = 120;
    const DAG_NODE_H = 140;
    const DAG_GAP = 28;
    const DAG_MAIN_NODES = AGC_NODES.filter(n => n.id !== 'HITL');
    const DAG_TOTAL_W = DAG_MAIN_NODES.length * DAG_NODE_W + (DAG_MAIN_NODES.length - 1) * DAG_GAP;
    const DAG_HITL_OFFSET_Y = 80;
    const DAG_SVG_H = DAG_NODE_H + DAG_HITL_OFFSET_Y + 60;

    // 注入 CSS keyframes (仅一次)
    useEffect(() => {
        const STYLE_ID = 'dag-flow-keyframes';
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            @keyframes dagFlowDash {
                to { stroke-dashoffset: -24; }
            }
            @keyframes dagPulseGlow {
                0%, 100% { filter: drop-shadow(0 0 6px var(--glow-color)); opacity: 0.85; }
                50%      { filter: drop-shadow(0 0 18px var(--glow-color)); opacity: 1; }
            }
            @keyframes dagNodeEnter {
                from { opacity: 0; transform: translateY(8px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes dagDotFlow {
                0%   { offset-distance: 0%; opacity: 0; }
                10%  { opacity: 1; }
                90%  { opacity: 1; }
                100% { offset-distance: 100%; opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }, []);

    /** 计算主线节点中心 X */
    const nodeX = (i: number) => i * (DAG_NODE_W + DAG_GAP) + DAG_NODE_W / 2;
    /** 节点中心 Y (主线) */
    const mainY = DAG_NODE_H / 2 + 8;

    /** 连接线状态色 */
    const edgeStyle = (fromId: string, toId: string) => {
        const fromStatus = runState?.nodes[fromId]?.status;
        const toStatus = runState?.nodes[toId]?.status;
        if (fromStatus === 'completed' && toStatus === 'completed') return 'completed';
        if (fromStatus === 'completed' && (toStatus === 'running' || toStatus === 'queued')) return 'active';
        if (fromStatus === 'failed' || toStatus === 'failed') return 'failed';
        return 'idle';
    };

    const EDGE_COLORS: Record<string, { stroke: string; glow: string }> = {
        completed: { stroke: '#34D399', glow: 'rgba(52,211,153,0.35)' },
        active:    { stroke: '#06b6d4', glow: 'rgba(6,182,212,0.4)' },
        failed:    { stroke: '#F87171', glow: 'rgba(248,113,113,0.3)' },
        idle:      { stroke: 'rgba(255,255,255,0.1)', glow: 'none' },
    };

    /** SVG 连接线 + 动画光点 */
    const renderEdge = (fromIdx: number, toIdx: number, key: string, toId?: string, isBranch?: boolean) => {
        const x1 = nodeX(fromIdx) + DAG_NODE_W / 2 - 4;
        const x2 = isBranch ? nodeX(toIdx) : nodeX(toIdx) - DAG_NODE_W / 2 + 4;
        const y1 = mainY;
        const y2 = isBranch ? mainY + DAG_HITL_OFFSET_Y + 20 : mainY;

        const fromId = DAG_MAIN_NODES[fromIdx]!.id;
        const targetId = toId || DAG_MAIN_NODES[toIdx]!.id;
        const es = edgeStyle(fromId, targetId);
        const ec = EDGE_COLORS[es]!;

        // 贝塞尔控制点
        const cx1 = isBranch ? x1 + 20 : x1 + (x2 - x1) * 0.4;
        const cy1 = isBranch ? y1 + 40 : y1;
        const cx2 = isBranch ? x2 - 10 : x1 + (x2 - x1) * 0.6;
        const cy2 = isBranch ? y2 - 30 : y2;

        const d = `M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`;
        const pathId = `dagEdge-${key}`;
        const isAnimated = es === 'active' || es === 'completed';

        return (
            <g key={key}>
                {/* 发光底层 */}
                {es !== 'idle' && (
                    <path
                        d={d} fill="none"
                        stroke={ec.glow} strokeWidth={6}
                        strokeLinecap="round" opacity={0.5}
                    />
                )}
                {/* 主线 */}
                <path
                    id={pathId} d={d} fill="none"
                    stroke={ec.stroke}
                    strokeWidth={es === 'idle' ? 1.5 : 2}
                    strokeLinecap="round"
                    strokeDasharray={es === 'idle' ? '4 6' : es === 'active' ? '8 8' : 'none'}
                    style={es === 'active' ? {
                        animation: 'dagFlowDash 0.8s linear infinite',
                    } : undefined}
                />
                {/* 箭头 */}
                <circle
                    cx={x2} cy={y2} r={3}
                    fill={ec.stroke}
                    opacity={es === 'idle' ? 0.3 : 0.8}
                />
                {/* 流动光点 */}
                {isAnimated && (
                    <>
                        <circle r={3} fill={ec.stroke} opacity={0.9}>
                            <animateMotion dur="1.8s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
                                <mpath href={`#${pathId}`} />
                            </animateMotion>
                        </circle>
                        <circle r={2} fill="#fff" opacity={0.6}>
                            <animateMotion dur="1.8s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear" begin="0.6s">
                                <mpath href={`#${pathId}`} />
                            </animateMotion>
                        </circle>
                    </>
                )}
            </g>
        );
    };

    /** 渲染单个 DAG 节点卡片 */
    const renderDagNodeCard = (node: typeof AGC_NODES[0], x: number, y: number) => {
        const state = runState?.nodes[node.id];
        const status = state?.status || 'pending';
        const sc = STATUS_COLORS[status] || STATUS_COLORS.pending!;
        const isRunning = status === 'running';
        const isSelected = selectedNodeId === node.id;
        const isCompleted = status === 'completed';
        const isFailed = status === 'failed';

        return (
            <div
                key={node.id}
                onClick={() => setSelectedNodeId(node.id)}
                style={{
                    position: 'absolute',
                    left: x, top: y,
                    width: DAG_NODE_W,
                    cursor: 'pointer',
                    animation: 'dagNodeEnter 0.4s ease-out both',
                    animationDelay: `${AGC_NODES.indexOf(node) * 60}ms`,
                }}
            >
                <div style={{
                    background: sc.bg,
                    border: `1.5px solid ${isSelected ? colors.brand : sc.border}`,
                    borderRadius: radius.lg,
                    padding: '14px 10px 12px',
                    textAlign: 'center',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isSelected
                        ? `0 0 0 1px ${colors.brand}40, 0 0 24px ${colors.brand}30, ${shadow.glass}`
                        : isFailed
                            ? `0 0 20px rgba(248,113,113,0.15), 0 0 40px rgba(248,113,113,0.08), ${shadow.glass}`
                            : isRunning
                                ? `0 0 20px ${sc.glow || 'transparent'}, ${shadow.glass}`
                                : shadow.glass,
                    opacity: isRunning ? pulseOpacity : 1,
                    transform: isSelected ? 'scale(1.04)' : 'scale(1)',
                }}>
                    {/* 图标圆圈 */}
                    <div style={{
                        width: '36px', height: '36px',
                        borderRadius: '50%',
                        background: `${sc.text}14`,
                        border: `1px solid ${sc.text}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 8px',
                        position: 'relative',
                    }}>
                        <Icon name={node.icon} size={16} color={sc.text} />
                        {/* 完成对勾 */}
                        {isCompleted && (
                            <div style={{
                                position: 'absolute', right: '-4px', bottom: '-2px',
                                width: '14px', height: '14px', borderRadius: '50%',
                                background: colors.success,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 0 8px rgba(52,211,153,0.5)`,
                            }}>
                                <Icon name="check" size={8} color="#fff" />
                            </div>
                        )}
                        {/* 失败叉号 */}
                        {isFailed && (
                            <div style={{
                                position: 'absolute', right: '-4px', bottom: '-2px',
                                width: '14px', height: '14px', borderRadius: '50%',
                                background: colors.error,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 0 8px rgba(248,113,113,0.5)`,
                            }}>
                                <Icon name="x" size={8} color="#fff" />
                            </div>
                        )}
                    </div>
                    {/* 节点名 */}
                    <div style={{
                        fontSize: '12px', fontWeight: 700,
                        color: sc.text, letterSpacing: '-0.01em',
                        marginBottom: '6px',
                    }}>
                        {lang === 'zh' ? node.zh : node.en}
                    </div>
                    {/* 状态标签 */}
                    <div style={{
                        fontSize: '10px',
                        padding: '2px 10px', borderRadius: radius.pill,
                        background: `${sc.text}18`,
                        border: `1px solid ${sc.text}28`,
                        color: sc.text, fontWeight: 600,
                        display: 'inline-block',
                        letterSpacing: '0.02em',
                    }}>
                        {STATUS_LABELS[status]?.[lang] || status}
                    </div>
                    {/* 耗时 + 模型 */}
                    <div style={{ marginTop: '6px', lineHeight: 1.4 }}>
                        {state?.durationMs && (
                            <div style={{
                                fontSize: '10px',
                                color: 'rgba(255,255,255,0.45)',
                                fontFamily: 'monospace',
                            }}>
                                {formatDuration(state.durationMs)}
                            </div>
                        )}
                        {state?.model && (
                            <div style={{
                                fontSize: '9px',
                                color: 'rgba(255,255,255,0.3)',
                                maxWidth: '100px', overflow: 'hidden',
                                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                margin: '0 auto',
                            }}>
                                {state.model}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ─── 渲染 ──────────────────────────────────────────────────────

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
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
                    {runState?.workflow && (
                        <p style={{ ...s.hint, marginTop: '6px' }}>{runState.workflow}</p>
                    )}
                    {runState?.updatedAt && (
                        <p style={{ ...s.hint, marginTop: '4px' }}>
                            {l.updated}: {new Date(runState.updatedAt).toLocaleTimeString()}
                        </p>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {runState && (
                        <div style={{
                            ...glass.card,
                            padding: '10px 14px',
                            minWidth: '120px',
                            textAlign: 'center',
                            borderColor: STATUS_COLORS[runState.status]?.border || glass.card.borderColor,
                            background: STATUS_COLORS[runState.status]?.bg || glass.card.background,
                        }}>
                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>
                                {l.phase}
                            </div>
                            <div style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: STATUS_COLORS[runState.status]?.text || 'var(--vscode-editor-foreground)',
                            }}>
                                {STATUS_LABELS[runState.status]?.[lang] || runState.status}
                            </div>
                        </div>
                    )}
                    <button style={s.btnSecondary} onClick={loadDemo}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon name="activity" size={13} />
                            {l.demo}
                        </span>
                    </button>
                </div>
            </div>

            <div style={{
                ...glass.panel,
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
            }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>
                    {l.goalLabel}
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 220px',
                    gap: '14px',
                    alignItems: 'stretch',
                }}>
                    <div style={{
                        ...glass.card,
                        padding: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}>
                        <textarea
                            value={runGoal}
                            onChange={(event) => setRunGoal(event.target.value)}
                            placeholder={l.goalPlaceholder}
                            style={{
                                flex: 1,
                                minHeight: '108px',
                                resize: 'vertical',
                                borderRadius: radius.md,
                                border: '1px solid rgba(255,255,255,0.08)',
                                background: 'rgba(255,255,255,0.03)',
                                color: 'var(--vscode-editor-foreground)',
                                padding: '14px 16px',
                                fontSize: '14px',
                                lineHeight: 1.55,
                                outline: 'none',
                            }}
                        />
                        <div style={{ ...s.hint, marginTop: 0 }}>
                            {l.goalHint}
                        </div>
                    </div>
                    <div style={{
                        ...glass.card,
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '14px',
                        background: 'linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(59,130,246,0.05) 100%)',
                        borderColor: 'rgba(6,182,212,0.16)',
                    }}>
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.86)' }}>
                                AGC Runtime
                            </div>
                            <div style={{ ...s.hint, marginTop: '6px' }}>
                                Full-path orchestration with live WAL updates.
                            </div>
                        </div>
                        <button
                            style={{
                                ...s.btnPrimary,
                                width: '100%',
                                minHeight: '52px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                fontSize: '14px',
                                letterSpacing: '-0.01em',
                                opacity: !runGoal.trim() || isStarting ? 0.6 : 1,
                                cursor: !runGoal.trim() || isStarting ? 'not-allowed' : 'pointer',
                                boxShadow: isStarting ? '0 0 0 1px rgba(255,255,255,0.08), 0 8px 28px rgba(6,182,212,0.25)' : s.btnPrimary.boxShadow,
                            }}
                            disabled={!runGoal.trim() || isStarting}
                            onClick={startRun}
                        >
                            <Icon name="activity" size={14} />
                            {isStarting ? l.starting : l.startRun}
                        </button>
                    </div>
                </div>
                {launchTone !== 'idle' && (
                    <div style={{
                        ...glass.card,
                        padding: '10px 12px',
                        borderColor:
                            launchTone === 'error'
                                ? 'rgba(248,113,113,0.28)'
                                : launchTone === 'success'
                                    ? 'rgba(52,211,153,0.24)'
                                    : 'rgba(6,182,212,0.24)',
                        background:
                            launchTone === 'error'
                                ? 'rgba(248,113,113,0.06)'
                                : launchTone === 'success'
                                    ? 'rgba(52,211,153,0.06)'
                                    : 'rgba(6,182,212,0.06)',
                        color:
                            launchTone === 'error'
                                ? colors.error
                                : launchTone === 'success'
                                    ? colors.success
                                    : colors.brandGlow,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '12px',
                        fontWeight: 600,
                    }}>
                        <Icon
                            name={
                                launchTone === 'error'
                                    ? 'x-circle'
                                    : launchTone === 'success'
                                        ? 'check-circle'
                                        : 'activity'
                            }
                            size={14}
                            color="currentColor"
                        />
                        <span>{launchMessage}</span>
                    </div>
                )}
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '16px' }}>
                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="activity" size={15} color={colors.brand} />
                                    {l.timeline}
                                </span>
                            </h3>
                            {timeline.length === 0 ? (
                                <p style={s.hint}>{l.noTimeline}</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                                    {timeline.map((entry, index) => (
                                        <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: '10px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                <div style={{
                                                    width: '10px',
                                                    height: '10px',
                                                    borderRadius: '50%',
                                                    marginTop: '6px',
                                                    background:
                                                        entry.kind === 'failed'
                                                            ? colors.error
                                                            : entry.kind === 'completed'
                                                                ? colors.success
                                                                : colors.brand,
                                                    boxShadow: `0 0 18px ${entry.kind === 'failed' ? 'rgba(248,113,113,0.35)' : entry.kind === 'completed' ? 'rgba(52,211,153,0.35)' : 'rgba(6,182,212,0.35)'}`,
                                                }} />
                                                {index < timeline.length - 1 && (
                                                    <div style={{ width: '1px', flex: 1, background: 'rgba(255,255,255,0.08)', marginTop: '6px' }} />
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setSelectedNodeId(entry.nodeId)}
                                                style={{
                                                    ...glass.card,
                                                    textAlign: 'left',
                                                    padding: '10px 12px',
                                                    borderColor: selectedNodeKey === entry.nodeId ? 'rgba(6,182,212,0.28)' : glass.card.borderColor,
                                                    background: selectedNodeKey === entry.nodeId ? 'rgba(6,182,212,0.06)' : glass.card.background,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                                                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                                                        {entry.label}
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)' }}>
                                                        {new Date(entry.timestamp).toLocaleTimeString()}
                                                    </div>
                                                </div>
                                                {entry.detail && (
                                                    <div style={{ ...s.hint, marginTop: '6px', opacity: 0.9 }}>
                                                        {entry.detail}
                                                    </div>
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="radio" size={15} color={colors.brand} />
                                    {l.selectedNode}
                                </span>
                            </h3>
                            {!selectedNode || !selectedNodeKey ? (
                                <p style={s.hint}>{l.noNodeSelected}</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                        <StatCard label={l.activeNode} value={selectedNodeKey} color={STATUS_COLORS[selectedNode.status]?.text} />
                                        <StatCard label={l.elapsed} value={selectedNode.durationMs ? `${selectedNode.durationMs}ms` : '—'} />
                                    </div>
                                    {selectedNode.model && (
                                        <div style={{ ...glass.card, padding: '12px 14px' }}>
                                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: '4px' }}>{l.models}</div>
                                            <div style={{ fontSize: '13px', fontWeight: 600 }}>{selectedNode.model}</div>
                                        </div>
                                    )}
                                    {selectedNode.error && (
                                        <div style={{ ...glass.card, padding: '12px 14px', borderColor: 'rgba(248,113,113,0.24)', background: 'rgba(248,113,113,0.06)' }}>
                                            <div style={{ fontSize: '11px', color: 'rgba(248,113,113,0.8)', marginBottom: '4px' }}>{l.failureReason}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5, color: 'rgba(255,255,255,0.88)' }}>{selectedNode.error}</div>
                                        </div>
                                    )}
                                    {selectedNode.startedAt && (
                                        <div style={{ ...s.hint, marginTop: 0 }}>
                                            {l.lastUpdated}: {new Date(selectedNode.completedAt || selectedNode.startedAt).toLocaleString()}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── DAG 流程图 (SVG + 绝对定位节点) ──────────── */}
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
                                position: 'relative',
                                width: DAG_TOTAL_W,
                                height: DAG_SVG_H,
                                margin: '0 auto',
                                minWidth: DAG_TOTAL_W,
                            }}>
                                {/* SVG 连接线层 */}
                                <svg
                                    width={DAG_TOTAL_W}
                                    height={DAG_SVG_H}
                                    style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                                >
                                    {/* 主线连接 */}
                                    {DAG_MAIN_NODES.slice(0, -1).map((node, i) =>
                                        renderEdge(i, i + 1, `main-${i}`)
                                    )}
                                    {/* HITL 分支线 — 从 PERSIST 向下 */}
                                    {renderEdge(
                                        DAG_MAIN_NODES.length - 1,
                                        DAG_MAIN_NODES.length - 1,
                                        'hitl-branch',
                                        'HITL',
                                        true
                                    )}
                                </svg>
                                {/* 主线节点 */}
                                {DAG_MAIN_NODES.map((node, i) =>
                                    renderDagNodeCard(
                                        node,
                                        i * (DAG_NODE_W + DAG_GAP),
                                        mainY - DAG_NODE_H / 2 + 8
                                    )
                                )}
                                {/* HITL 分支节点 */}
                                {renderDagNodeCard(
                                    AGC_NODES.find(n => n.id === 'HITL')!,
                                    (DAG_MAIN_NODES.length - 1) * (DAG_NODE_W + DAG_GAP),
                                    mainY + DAG_HITL_OFFSET_Y
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="file-text" size={15} color={colors.brand} />
                                    {l.liveLogs}
                                </span>
                            </h3>
                            {!selectedNode || selectedNodeOutput.length === 0 ? (
                                <p style={s.hint}>{l.noNodeSelected}</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                                    {selectedNodeOutput.map((line) => (
                                        <div key={line.key} style={{ ...glass.card, padding: '10px 12px' }}>
                                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: '4px' }}>{line.key}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{line.value}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="shield" size={15} color={colors.brand} />
                                    {l.findings}
                                </span>
                            </h3>
                            {selectedNodeFindings.length === 0 ? (
                                <p style={s.hint}>{l.noNodeSelected}</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto', paddingRight: '4px' }}>
                                    {selectedNodeFindings.map((finding, index) => (
                                        <div
                                            key={`${finding.type}-${index}`}
                                            style={{
                                                ...glass.card,
                                                padding: '10px 12px',
                                                borderColor: finding.type === 'warning' ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.08)',
                                                background: finding.type === 'warning' ? 'rgba(251,191,36,0.05)' : glass.card.background,
                                            }}
                                        >
                                            <div style={{ fontSize: '11px', color: finding.type === 'warning' ? colors.warning : 'rgba(255,255,255,0.45)', marginBottom: '4px', textTransform: 'uppercase' }}>
                                                {finding.type}
                                            </div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.6 }}>{finding.message}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
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
                            {runState.sourcePath && (
                                <div style={{ ...s.hint, marginTop: '10px' }}>
                                    Source: {runState.sourcePath}
                                </div>
                            )}
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

                    {runState.verdict && (
                        <div style={{ ...glass.panel, padding: '16px 20px' }}>
                            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Icon name="check-circle" size={15} color={colors.brand} />
                                    Verdict
                                </span>
                            </h3>
                            <div style={{ ...glass.card, padding: '12px 14px', lineHeight: 1.6 }}>
                                {runState.verdict}
                            </div>
                        </div>
                    )}
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

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

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

function mapAgcPayload(payload: any): {
    runState: AGCRunState | null;
    benchmarks: BenchmarkData[];
    hitlState: HITLState;
} {
    if (!payload) {
        return {
            runState: null,
            benchmarks: [],
            hitlState: { isPaused: false },
        };
    }

    const rawNodes = payload.nodes && typeof payload.nodes === 'object' ? payload.nodes : {};
    const nodes: Record<string, NodeState> = {};
    let skippedCount = 0;

    for (const node of AGC_NODES) {
        const rawNode = rawNodes[node.id];
        const status = normalizeStatus(rawNode?.status, payload.phase, node.id, rawNodes);
        if (status === 'skipped') skippedCount++;
        nodes[node.id] = {
            nodeId: node.id,
            status,
            durationMs: rawNode?.duration_ms ?? rawNode?.durationMs,
            model: Array.isArray(rawNode?.models)
                ? rawNode.models.join(', ')
                : rawNode?.model,
            error: rawNode?.error,
            startedAt: rawNode?.startedAt,
            completedAt: rawNode?.completedAt,
            output: rawNode?.output,
        };
    }

    const verify = rawNodes.VERIFY?.output || rawNodes.VERIFY || {};
    const benchmarks: BenchmarkData[] = [];
    if (typeof verify.vitest_passed === 'number' || typeof verify.vitest_failed === 'number') {
        const passed = Number(verify.vitest_passed || 0);
        const failed = Number(verify.vitest_failed || 0);
        const totalCases = passed + failed;
        benchmarks.push({
            suiteName: 'Vitest',
            totalCases,
            passed,
            passRate: totalCases > 0 ? Math.round((passed / totalCases) * 100) : 0,
            avgDurationMs: 0,
        });
    }
    if (typeof verify.tsc_errors === 'number') {
        benchmarks.push({
            suiteName: 'TypeScript',
            totalCases: 1,
            passed: verify.tsc_errors === 0 ? 1 : 0,
            passRate: verify.tsc_errors === 0 ? 100 : 0,
            avgDurationMs: 0,
        });
    }

    const hitlState: HITLState =
        payload.phase === 'PAUSED' || rawNodes.HITL?.status === 'paused' || rawNodes.HITL?.status === 'running'
            ? {
                isPaused: true,
                pauseReason: rawNodes.HITL?.reason || rawNodes.HITL?.finding || payload.verdict,
                pausedAtNode: 'HITL',
            }
            : { isPaused: false };

    const runState: AGCRunState = {
        runId: payload.run_id || payload.runId || 'agc-run',
        version: typeof payload.version === 'number' ? payload.version : 1,
        status: normalizeRunStatus(payload.phase || payload.status),
        nodes,
        latestRisk: payload.latestRisk || inferRisk(rawNodes),
        routeDecision: {
            lane: payload.routeDecision?.lane || inferLane(payload.phase || payload.status, rawNodes),
            skippedCount: payload.routeDecision?.skippedCount ?? skippedCount,
            confidence: payload.routeDecision?.confidence ?? inferConfidence(rawNodes),
        },
        workflow: payload.workflow,
        verdict: payload.verdict,
        sourcePath: payload._meta?.sourcePath,
        updatedAt: payload._meta?.updatedAt || (payload.updated_at ? Date.parse(payload.updated_at) : undefined),
    };

    return { runState, benchmarks, hitlState };
}

function normalizeRunStatus(status?: string): AGCRunState['status'] {
    switch ((status || '').toLowerCase()) {
        case 'completed': return 'completed';
        case 'failed': return 'failed';
        case 'cancelled': return 'cancelled';
        case 'paused': return 'paused';
        case 'pending': return 'pending';
        default: return 'running';
    }
}

function normalizeStatus(
    status?: string,
    phase?: string,
    nodeId?: string,
    rawNodes?: Record<string, any>,
): NodeState['status'] {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'pending' || normalized === 'queued' || normalized === 'running' ||
        normalized === 'completed' || normalized === 'failed' || normalized === 'skipped') {
        return normalized;
    }
    if (nodeId === 'HITL' && phase === 'PAUSED') return 'running';
    if (phase === 'COMPLETED' && rawNodes?.[nodeId || '']) return 'completed';
    return 'pending';
}

function inferRisk(rawNodes: Record<string, any>): AGCRunState['latestRisk'] {
    const score = Number(rawNodes.PARALLEL?.dr_score
        ?? rawNodes.PARALLEL?.output?.dr_value
        ?? rawNodes.ANALYZE?.dr_score
        ?? 0);
    const level =
        score >= 80 ? 'critical'
            : score >= 60 ? 'high'
                : score >= 30 ? 'medium'
                    : 'low';
    return { drScore: score, level };
}

function inferLane(phase?: string, rawNodes?: Record<string, any>): string {
    if ((phase || '').toLowerCase() === 'completed') return 'standard';
    if (rawNodes?.PARALLEL?.models?.length > 1) return 'full';
    return 'standard';
}

function inferConfidence(rawNodes: Record<string, any>): number {
    if (rawNodes.DEBATE?.finding && String(rawNodes.DEBATE.finding).toLowerCase().includes('converged')) return 92;
    if (rawNodes.VERIFY?.vitest_failed === 0 && rawNodes.VERIFY?.tsc_errors === 0) return 90;
    return 75;
}

function buildTimeline(runState: AGCRunState | null, lang: Lang): TimelineEntry[] {
    if (!runState) return [];
    const entries: TimelineEntry[] = [];

    for (const node of AGC_NODES) {
        const state = runState.nodes[node.id];
        if (!state) continue;

        if (state.startedAt) {
            entries.push({
                id: `${node.id}:started`,
                nodeId: node.id,
                kind: 'started',
                timestamp: Date.parse(state.startedAt),
                label: `${labelForNode(node.id, lang)} started`,
                detail: state.model || state.status,
            });
        }

        if (state.completedAt && state.status === 'completed') {
            entries.push({
                id: `${node.id}:completed`,
                nodeId: node.id,
                kind: 'completed',
                timestamp: Date.parse(state.completedAt),
                label: `${labelForNode(node.id, lang)} completed`,
                detail: state.durationMs ? `${state.durationMs}ms` : undefined,
            });
        }

        if (state.completedAt && state.status === 'failed') {
            entries.push({
                id: `${node.id}:failed`,
                nodeId: node.id,
                kind: 'failed',
                timestamp: Date.parse(state.completedAt),
                label: `${labelForNode(node.id, lang)} failed`,
                detail: state.error || 'Execution failed',
            });
        }
    }

    return entries
        .filter((entry) => Number.isFinite(entry.timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);
}

function inferFocusedNode(runState: AGCRunState | null): string | undefined {
    if (!runState) return undefined;

    for (const node of AGC_NODES) {
        const state = runState.nodes[node.id];
        if (state?.status === 'running' || state?.status === 'queued') {
            return node.id;
        }
    }

    for (let i = AGC_NODES.length - 1; i >= 0; i--) {
        const node = AGC_NODES[i];
        const state = runState.nodes[node.id];
        if (state?.status === 'failed' || state?.status === 'completed') {
            return node.id;
        }
    }

    return AGC_NODES[0]?.id;
}

function labelForNode(nodeId: string, lang: Lang): string {
    const match = AGC_NODES.find((node) => node.id === nodeId);
    if (!match) return nodeId;
    return lang === 'zh' ? match.zh : match.en;
}

function summarizeOutput(output: Record<string, unknown>): Array<{ key: string; value: string }> {
    return Object.entries(output)
        .filter(([key]) => key !== 'findings')
        .slice(0, 8)
        .map(([key, value]) => ({
            key,
            value: stringifyValue(value),
        }));
}

function extractFindings(output?: Record<string, unknown>): Array<{ type: string; message: string }> {
    const findings = output?.findings;
    if (!Array.isArray(findings)) return [];

    return findings
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const typed = item as { type?: unknown; message?: unknown };
            return {
                type: typeof typed.type === 'string' ? typed.type : 'info',
                message: typeof typed.message === 'string' ? typed.message : stringifyValue(item),
            };
        })
        .filter((item): item is { type: string; message: string } => Boolean(item));
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        return value.map((item) => stringifyValue(item)).join(', ');
    }
    if (value && typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return '—';
}

export default AGCPanel;
