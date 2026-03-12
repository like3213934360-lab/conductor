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
    tribunalVerdict?: string;
    tribunalConfidence?: number;
    tribunalMode?: string;
    tribunalUpdatedAt?: string;
    tribunalQuorumSatisfied?: boolean;
}

interface WorkflowRunState {
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
    authorityOwner?: string;
    authorityHost?: string;
    hostSessionId?: string;
    timelineCursor?: number;
    activeLease?: {
        leaseId: string;
        nodeId: string;
        attempt: number;
        expiresAt: string;
        requiredEvidence: string[];
        allowedModelPool: string[];
    };
    activeHeartbeat?: {
        leaseId: string;
        nodeId: string;
        attempt: number;
        heartbeatAt: string;
    };
    pendingCompletionReceipt?: {
        leaseId: string;
        nodeId: string;
        attempt: number;
        status: string;
        model?: string;
        completedAt: string;
    };
    preparedCompletionReceipt?: {
        leaseId: string;
        nodeId: string;
        attempt: number;
        status: string;
        model?: string;
        completedAt: string;
        preparedAt: string;
    };
    acknowledgedCompletionReceipt?: {
        leaseId: string;
        nodeId: string;
        attempt: number;
        status: string;
        model?: string;
        completedAt: string;
    };
    latestTribunalVerdict?: {
        tribunalId: string;
        nodeId: string;
        mode: string;
        verdict: string;
        confidence: number;
        quorumSatisfied: boolean;
        createdAt: string;
    };
    policyReport?: {
        path: string;
        verified?: boolean;
        payloadDigestOk?: boolean;
        signatureVerified?: boolean;
        signatureRequired?: boolean;
        signaturePolicyId?: string;
        signatureKeyId?: string;
        issues: string[];
    };
    releaseArtifacts?: {
        traceBundle?: {
            path: string;
            integrityOk?: boolean;
            signatureVerified?: boolean;
            signatureRequired?: boolean;
            signaturePolicyId?: string;
            signatureKeyId?: string;
            issues: string[];
        };
        releaseAttestation?: {
            path: string;
            verified?: boolean;
            payloadDigestOk?: boolean;
            signatureVerified?: boolean;
            signatureRequired?: boolean;
            signaturePolicyId?: string;
            signatureKeyId?: string;
            issues: string[];
        };
    };
    invariantReport?: {
        path: string;
        verified?: boolean;
        payloadDigestOk?: boolean;
        signatureVerified?: boolean;
        signatureRequired?: boolean;
        signaturePolicyId?: string;
        signatureKeyId?: string;
        issues: string[];
    };
    releaseDossier?: {
        path: string;
        verified?: boolean;
        payloadDigestOk?: boolean;
        signatureVerified?: boolean;
        signatureRequired?: boolean;
        signaturePolicyId?: string;
        signatureKeyId?: string;
        issues: string[];
    };
    releaseBundle?: {
        path: string;
        verified?: boolean;
        payloadDigestOk?: boolean;
        signatureVerified?: boolean;
        signatureRequired?: boolean;
        signaturePolicyId?: string;
        signatureKeyId?: string;
        issues: string[];
    };
    certificationRecord?: {
        path: string;
        verified?: boolean;
        payloadDigestOk?: boolean;
        signatureVerified?: boolean;
        signatureRequired?: boolean;
        signaturePolicyId?: string;
        signatureKeyId?: string;
        issues: string[];
    };
}

interface BenchmarkData {
    id: string;
    suiteName: string;
    totalCases: number;
    passed: number;
    passRate: number;
    avgDurationMs: number;
    detail?: string;
}

interface TrustRegistryData {
    registryId: string;
    version: string;
    sourcePath?: string;
    loadedAt?: string;
    verification: {
        summary: 'verified' | 'warning';
        checkCount: number;
        warningCount: number;
        errorCount: number;
        failingMessages: string[];
    };
    keyCount: number;
    policyCount: number;
    scopedKeyCount: number;
    resolvableKeyCount: number;
    keys: Array<{
        keyId: string;
        issuer?: string;
        envVar?: string;
        scopes: string[];
        status: 'active' | 'staged' | 'retired';
        validFrom?: string;
        expiresAt?: string;
        rotationGroup?: string;
        hasSecret: boolean;
    }>;
    signerPolicies: Array<{
        policyId: string;
        scope: string;
        enabled: boolean;
        requireSignature: boolean;
        allowedKeyStatuses: Array<'active' | 'staged' | 'retired'>;
        allowedRotationGroups: string[];
        allowedKeyIds: string[];
        allowedIssuers: string[];
        maxSignatureAgeMs?: number;
    }>;
}

interface BenchmarkSourceRegistryData {
    registryId: string;
    version: string;
    sourcePath?: string;
    loadedAt?: string;
    trustPolicyId: string;
    digestSha256?: string;
    signatureKeyId?: string;
    signatureSignedAt?: string;
    verification: {
        summary: 'verified' | 'warning';
        checkCount: number;
        warningCount: number;
        errorCount: number;
        failingMessages: string[];
    };
    sourceCount: number;
    lockedSourceCount: number;
}

interface RemoteWorkerData {
    id: string;
    name: string;
    agentCardVersion: string;
    agentCardSchemaVersion?: string;
    agentCardPublishedAt?: string;
    agentCardExpiresAt?: string;
    agentCardAdvertisementSignatureKeyId?: string;
    agentCardAdvertisementSignatureIssuer?: string;
    agentCardAdvertisementSignedAt?: string;
    advertisementTrustPolicyId: string;
    agentCardSha256: string;
    agentCardEtag?: string;
    agentCardLastModified?: string;
    endpoint: string;
    taskEndpoint: string;
    selectedResponseMode: 'inline' | 'poll' | 'stream' | 'callback';
    supportedResponseModes: Array<'inline' | 'poll' | 'stream' | 'callback'>;
    taskProtocolSource: 'agent-card';
    statusEndpointTemplate?: string;
    streamEndpointTemplate?: string;
    callbackUrlTemplate?: string;
    callbackAuthScheme?: string;
    callbackSignatureHeader?: string;
    callbackTimestampHeader?: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    callbackTimeoutMs?: number;
    capabilities: string[];
    health: 'healthy' | 'degraded' | 'unreachable' | 'unknown';
    trustScore: number;
    source: string;
    preferredNodeIds: string[];
    verification: {
        summary: 'verified' | 'warning';
        checkCount: number;
        warningCount: number;
    };
    lastError?: string;
}

interface RemoteWorkerDiscoveryIssueData {
    id: string;
    issueKind: 'discovery' | 'agent-card' | 'protocol' | 'auth' | 'routing';
    endpoint: string;
    agentCardUrl: string;
    expectedAgentCardSha256?: string;
    expectedAdvertisementSchemaVersion?: string;
    advertisementTrustPolicyId?: string;
    requiredAdvertisementSignature?: boolean;
    allowedAdvertisementKeyStatuses: string[];
    allowedAdvertisementRotationGroups: string[];
    allowedAdvertisementKeyIds: string[];
    allowedAdvertisementIssuers: string[];
    error: string;
    capabilities: string[];
    preferredNodeIds: string[];
    minTrustScore: number;
    detectedAt: string;
}

interface HITLState {
    isPaused: boolean;
    pauseReason?: string;
    pausedAtNode?: string;
    pausedAt?: string;
}

type WorkflowTemplateId = 'antigravity.strict-full' | 'antigravity.adaptive';
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
        subtitle: 'Antigravity Control Plane, Governance & Collaboration',
        startRun: 'Start Workflow',
        goalLabel: 'Goal',
        workflowTemplate: 'Workflow Template',
        strictFull: 'Strict Full',
        adaptive: 'Adaptive',
        goalPlaceholder: 'Describe the Antigravity workflow you want the daemon to execute',
        goalHint: 'This entrypoint transfers execution authority to antigravity-daemon and enforces the compiled workflow.',
        dagFlow: 'DAG Flow',
        runStatus: 'Run Status',
        benchmark: 'Benchmark',
        trustRegistry: 'Trust Registry',
        benchmarkSources: 'Benchmark Sources',
        remoteWorkers: 'Remote Workers',
        remoteWorkerIssues: 'Discovery Issues',
        controls: 'Control Plane',
        hitl: 'HITL Gate',
        phase: 'Phase',
        updated: 'Updated',
        noRun: 'No active run',
        noRunHint: 'Start a daemon-owned Antigravity run to see the visualization',
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
        replay: 'Replay',
        cancel: 'Cancel',
        exportTrace: 'Export Trace',
        loadReleaseArtifacts: 'Load Release Artifacts',
        loadPolicyReport: 'Load Policy Report',
        verifyReleaseArtifacts: 'Verify Release Artifacts',
        verifyPolicyReport: 'Verify Policy Report',
        loadInvariantReport: 'Load Invariant Report',
        verifyInvariantReport: 'Verify Invariant Report',
        loadAttestation: 'Load Attestation',
        verifyAttestation: 'Verify Attestation',
        loadBundle: 'Load Bundle',
        verifyBundle: 'Verify Bundle',
        loadDossier: 'Load Dossier',
        verifyDossier: 'Verify Dossier',
        loadCertification: 'Load Certification',
        verifyCertification: 'Verify Certification',
        runInterop: 'Run Interop',
        runBenchmarks: 'Run Benchmarks',
        refreshWorkers: 'Refresh Workers',
        reloadPolicy: 'Reload Policy',
        reloadTrustRegistry: 'Reload Trust Registry',
        reloadBenchmarkSources: 'Reload Benchmark Sources',
        authority: 'Authority',
        lease: 'Active Lease',
        heartbeat: 'Heartbeat',
        completionReceipt: 'Completion Receipt',
        tribunal: 'Tribunal',
        quorum: 'Quorum',
        policy: 'Policy Report',
        trace: 'Trace Bundle',
        invariant: 'Invariant Report',
        attestation: 'Release Attestation',
        bundle: 'Release Bundle',
        dossier: 'Release Dossier',
        certification: 'Certification Record',
        noRemoteWorkers: 'No remote workers configured',
        remoteWorkerHint: 'Remote workers execute delegated nodes, but authority stays local.',
        remoteWorkerIssuesHint: 'Discovery failures are reported separately and are never treated as delegatable workers.',
        endpoint: 'Endpoint',
        taskEndpointLabel: 'Task Endpoint',
        trust: 'Trust',
        capabilities: 'Capabilities',
        delegatedNodes: 'Delegated Nodes',
        health: 'Health',
        verification: 'Verification',
        issueKind: 'Issue Kind',
        lifecycle: 'Lifecycle',
        supportedModes: 'Supported Modes',
        protocolSource: 'Protocol Source',
        agentCardSource: 'Agent Card',
        statusEndpoint: 'Status Endpoint',
        streamEndpoint: 'Stream Endpoint',
        callbackUrl: 'Callback URL',
        callbackAuth: 'Callback Auth',
        agentCardVersionLabel: 'Agent Card Version',
        agentCardSchema: 'Advertisement Schema',
        publishedAt: 'Published At',
        expiresAt: 'Expires At',
        digest: 'SHA256 Digest',
        etag: 'ETag',
        lastModified: 'Last Modified',
        expectedDigest: 'Expected Digest',
        expectedSchemaVersion: 'Expected Schema',
        expectedKeyId: 'Expected Key',
        expectedIssuer: 'Expected Issuer',
        advertisementSignature: 'Advertisement Signature',
        advertisementIssuer: 'Advertisement Issuer',
        advertisementSignedAt: 'Signed At',
        agentCardUrl: 'Agent Card URL',
        polling: 'Polling',
        refreshed: 'Refreshed',
        starting: 'Starting...',
        startPending: 'Workflow start request received. Initializing antigravity-daemon...',
        startSuccess: 'Antigravity workflow started. Live daemon state is now attached.',
        startError: 'Failed to start workflow',
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
        registrySummary: 'Registry Summary',
        registrySources: 'Sources',
        registryLocked: 'Locked',
        registrySignature: 'Signature',
        registryDigest: 'Digest',
        registryLoadedAt: 'Loaded At',
        registryKeys: 'Keys',
        registryResolvable: 'Resolvable',
        registryPolicies: 'Signer Policies',
        trustPolicyLabel: 'Trust Policy',
        signatureMode: 'Signature Mode',
        allowedStatuses: 'Allowed Statuses',
        allowedKeys: 'Allowed Keys',
        allowedIssuers: 'Allowed Issuers',
        advertisementTrustPolicy: 'Advertisement Trust Policy',
        keyLifecycle: 'Lifecycle',
        keyWindow: 'Validity Window',
        rotationGroup: 'Rotation Group',
        noBenchmarkSources: 'No benchmark source registry configured',
        noTrustRegistry: 'No trust registry configured',
    },
    zh: {
        title: '工作流可视化',
        subtitle: 'Antigravity 控制面、治理与协作',
        startRun: '启动工作流',
        goalLabel: '目标',
        workflowTemplate: '工作流模板',
        strictFull: '严格全路径',
        adaptive: '自适应',
        goalPlaceholder: '描述你希望 antigravity-daemon 执行的 Antigravity 工作流目标',
        goalHint: '这里走的是 daemon-owned 运行时入口，不是 prompt 式临时代理，因此会严格执行编译后的工作流。',
        dagFlow: 'DAG 流程',
        runStatus: '运行状态',
        benchmark: '评估基准',
        trustRegistry: 'Trust Registry',
        benchmarkSources: '基准数据源',
        remoteWorkers: '远程 Worker',
        remoteWorkerIssues: '发现异常',
        controls: '控制面',
        hitl: 'HITL 人机交互',
        phase: '阶段',
        updated: '更新时间',
        noRun: '无活跃运行',
        noRunHint: '启动一次 Antigravity 工作流运行以查看可视化',
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
        replay: '重放',
        cancel: '取消',
        exportTrace: '导出 Trace',
        loadReleaseArtifacts: '读取发布证明集',
        loadPolicyReport: '读取策略报告',
        verifyReleaseArtifacts: '校验发布证明集',
        verifyPolicyReport: '校验策略报告',
        loadInvariantReport: '读取约束报告',
        verifyInvariantReport: '校验约束报告',
        loadAttestation: '读取证明',
        verifyAttestation: '校验证明',
        loadBundle: '读取 Bundle',
        verifyBundle: '校验 Bundle',
        loadDossier: '读取 Dossier',
        verifyDossier: '校验 Dossier',
        loadCertification: '读取 Certification',
        verifyCertification: '校验 Certification',
        runInterop: '运行互操作',
        runBenchmarks: '运行基准套件',
        refreshWorkers: '刷新 Worker',
        reloadPolicy: '重载 Policy',
        reloadTrustRegistry: '重载 Trust Registry',
        reloadBenchmarkSources: '重载基准数据源',
        authority: '执行主权',
        lease: '当前租约',
        heartbeat: '心跳',
        completionReceipt: '完成回执',
        tribunal: '裁决庭',
        quorum: '法定人数',
        policy: '策略报告',
        trace: 'Trace Bundle',
        invariant: 'Invariant Report',
        attestation: 'Release Attestation',
        bundle: 'Release Bundle',
        dossier: 'Release Dossier',
        certification: 'Certification Record',
        noRemoteWorkers: '未配置远程 Worker',
        remoteWorkerHint: '远程 Worker 只负责被委派节点执行，工作流主权仍在本地。',
        remoteWorkerIssuesHint: '发现失败的端点会单独展示，绝不会被当成可委派 Worker。',
        endpoint: '端点',
        taskEndpointLabel: '任务端点',
        trust: '信任分',
        capabilities: '能力',
        delegatedNodes: '委派节点',
        health: '健康状态',
        verification: '验证状态',
        issueKind: '问题类型',
        lifecycle: '生命周期',
        supportedModes: '支持模式',
        protocolSource: '协议来源',
        agentCardSource: 'Agent Card',
        statusEndpoint: '状态端点',
        streamEndpoint: '流式端点',
        callbackUrl: '回调地址',
        callbackAuth: '回调认证',
        agentCardVersionLabel: 'Agent Card 版本',
        agentCardSchema: '广告 Schema',
        publishedAt: '发布时间',
        expiresAt: '过期时间',
        digest: 'SHA256 摘要',
        etag: 'ETag',
        lastModified: '最后修改',
        expectedDigest: '期望摘要',
        expectedSchemaVersion: '期望 Schema',
        expectedKeyId: '期望 Key',
        expectedIssuer: '期望签发方',
        advertisementSignature: '广告签名',
        advertisementIssuer: '广告签发方',
        advertisementSignedAt: '签名时间',
        agentCardUrl: 'Agent Card 地址',
        polling: '轮询策略',
        refreshed: '刷新时间',
        starting: '启动中...',
        startPending: '已接收工作流启动请求，正在初始化 antigravity-daemon...',
        startSuccess: 'Antigravity 工作流已启动，实时 daemon 状态已接入。',
        startError: '启动工作流失败',
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
        registrySummary: 'Registry 摘要',
        registrySources: '数据源数量',
        registryLocked: '锁定源',
        registrySignature: '签名',
        registryDigest: '摘要',
        registryLoadedAt: '加载时间',
        registryKeys: '密钥数',
        registryResolvable: '可解析密钥',
        registryPolicies: '签名策略',
        trustPolicyLabel: '信任策略',
        signatureMode: '签名模式',
        allowedStatuses: '允许状态',
        allowedKeys: '允许的 Key',
        allowedIssuers: '允许的签发方',
        advertisementTrustPolicy: '广告信任策略',
        keyLifecycle: '生命周期',
        keyWindow: '有效期窗口',
        rotationGroup: '轮换组',
        noBenchmarkSources: '未配置 benchmark source registry',
        noTrustRegistry: '未配置 trust registry',
    },
};

// ─── Antigravity 7 节点定义 ───────────────────────────────────────────

const WORKFLOW_NODES = [
    { id: 'ANALYZE', en: 'Analyze', zh: '分析', icon: 'search' },
    { id: 'PARALLEL', en: 'Parallel', zh: '并行', icon: 'layers' },
    { id: 'DEBATE', en: 'Debate', zh: '辩论', icon: 'radio' },
    { id: 'VERIFY', en: 'Verify', zh: '验证', icon: 'shield' },
    { id: 'SYNTHESIZE', en: 'Synthesize', zh: '综合', icon: 'pen-tool' },
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

const REMOTE_HEALTH_COLORS: Record<RemoteWorkerData['health'], { text: string; border: string; bg: string }> = {
    healthy: { text: colors.success, border: 'rgba(52,211,153,0.25)', bg: 'rgba(52,211,153,0.08)' },
    degraded: { text: colors.warning, border: 'rgba(251,191,36,0.25)', bg: 'rgba(251,191,36,0.08)' },
    unreachable: { text: colors.error, border: 'rgba(248,113,113,0.25)', bg: 'rgba(248,113,113,0.08)' },
    unknown: { text: 'rgba(255,255,255,0.6)', border: 'rgba(255,255,255,0.12)', bg: 'rgba(255,255,255,0.04)' },
};

// ─── 演示数据 ─────────────────────────────────────────────────────────

// ─── 组件 ──────────────────────────────────────────────────────────────

const WorkflowPanel: React.FC<{ lang: Lang }> = ({ lang }) => {
    const [runState, setRunState] = useState<WorkflowRunState | null>(null);
    const [benchmarks, setBenchmarks] = useState<BenchmarkData[]>([]);
    const [trustRegistry, setTrustRegistry] = useState<TrustRegistryData | null>(null);
    const [benchmarkSourceRegistry, setBenchmarkSourceRegistry] = useState<BenchmarkSourceRegistryData | null>(null);
    const [hitlState, setHitlState] = useState<HITLState>({ isPaused: false });
    const [remoteWorkers, setRemoteWorkers] = useState<RemoteWorkerData[]>([]);
    const [remoteWorkerIssues, setRemoteWorkerIssues] = useState<RemoteWorkerDiscoveryIssueData[]>([]);
    const [pulseFrame, setPulseFrame] = useState(0);
    const [runGoal, setRunGoal] = useState('');
    const [workflowTemplate, setWorkflowTemplate] = useState<WorkflowTemplateId>('antigravity.strict-full');
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
            if (ev.data.command === 'runSnapshot') {
                const mapped = mapRunSnapshotPayload(ev.data.data);
                setRunState(mapped.runState);
                setBenchmarks(mapped.benchmarks);
                setTrustRegistry(mapped.trustRegistry);
                setBenchmarkSourceRegistry(mapped.benchmarkSourceRegistry);
                setHitlState(mapped.hitlState);
                setRemoteWorkers(mapped.remoteWorkers);
                setRemoteWorkerIssues(mapped.remoteWorkerIssues);
                if (mapped.runState?.status !== 'pending' && mapped.runState?.status !== 'running') {
                    setIsStarting(false);
                }
                return;
            }

            if (ev.data.command === 'runPending') {
                setLaunchTone('info');
                setLaunchMessage(ev.data.message || l.startPending);
                return;
            }

            if (ev.data.command === 'runStarted') {
                setIsStarting(false);
                setLaunchTone('success');
                setLaunchMessage(`${l.startSuccess} Run ID: ${ev.data.runId}`);
                return;
            }

            if (ev.data.command === 'runError') {
                setIsStarting(false);
                setLaunchTone('error');
                setLaunchMessage(ev.data.message || l.startError);
                return;
            }

            if (ev.data.command === 'runActionSuccess') {
                setLaunchTone('success');
                setLaunchMessage(ev.data.message || 'Action completed');
                return;
            }

            if (ev.data.command === 'runActionError') {
                setLaunchTone('error');
                setLaunchMessage(ev.data.message || 'Action failed');
            }
        };

        window.addEventListener('message', handleMessage);
        vscode.postMessage({ command: 'getRunSnapshot' });
        const timer = setInterval(() => vscode.postMessage({ command: 'getRunSnapshot' }), 3000);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        if (runState?.workflow?.startsWith('antigravity.adaptive')) {
            setWorkflowTemplate('antigravity.adaptive');
            return;
        }
        if (runState?.workflow?.startsWith('antigravity.strict-full')) {
            setWorkflowTemplate('antigravity.strict-full');
        }
    }, [runState?.workflow]);

    const startRun = useCallback(() => {
        const goal = runGoal.trim();
        if (!goal || isStarting) {
            return;
        }
        setIsStarting(true);
        setLaunchTone('info');
        setLaunchMessage(l.startPending);
        vscode.postMessage({ command: 'startRun', goal, workflowId: workflowTemplate });
    }, [isStarting, l.startPending, runGoal, workflowTemplate]);

    const approveGate = useCallback(() => {
        vscode.postMessage({ command: 'approveGate', gateId: 'antigravity-final-gate' });
    }, []);

    const rejectGate = useCallback(() => {
        vscode.postMessage({ command: 'cancelRun' });
    }, []);

    const replayRun = useCallback(() => {
        vscode.postMessage({ command: 'replayRun' });
    }, []);

    const exportTraceBundle = useCallback(() => {
        vscode.postMessage({ command: 'exportTraceBundle' });
    }, []);

    const getReleaseArtifacts = useCallback(() => {
        vscode.postMessage({ command: 'getReleaseArtifacts' });
    }, []);

    const getPolicyReport = useCallback(() => {
        vscode.postMessage({ command: 'getPolicyReport' });
    }, []);

    const verifyReleaseArtifacts = useCallback(() => {
        vscode.postMessage({ command: 'verifyReleaseArtifacts' });
    }, []);

    const verifyPolicyReport = useCallback(() => {
        vscode.postMessage({ command: 'verifyPolicyReport' });
    }, []);

    const getInvariantReport = useCallback(() => {
        vscode.postMessage({ command: 'getInvariantReport' });
    }, []);

    const verifyInvariantReport = useCallback(() => {
        vscode.postMessage({ command: 'verifyInvariantReport' });
    }, []);

    const getReleaseAttestation = useCallback(() => {
        vscode.postMessage({ command: 'getReleaseAttestation' });
    }, []);

    const verifyReleaseAttestation = useCallback(() => {
        vscode.postMessage({ command: 'verifyReleaseAttestation' });
    }, []);

    const getReleaseBundle = useCallback(() => {
        vscode.postMessage({ command: 'getReleaseBundle' });
    }, []);

    const verifyReleaseBundle = useCallback(() => {
        vscode.postMessage({ command: 'verifyReleaseBundle' });
    }, []);

    const getReleaseDossier = useCallback(() => {
        vscode.postMessage({ command: 'getReleaseDossier' });
    }, []);

    const verifyReleaseDossier = useCallback(() => {
        vscode.postMessage({ command: 'verifyReleaseDossier' });
    }, []);
    const getCertificationRecord = useCallback(() => {
        vscode.postMessage({ command: 'getCertificationRecord' });
    }, []);
    const verifyCertificationRecord = useCallback(() => {
        vscode.postMessage({ command: 'verifyCertificationRecord' });
    }, []);

    const runBenchmarkHarness = useCallback(() => {
        vscode.postMessage({ command: 'runBenchmarkHarness' });
    }, []);

    const runInteropHarness = useCallback(() => {
        vscode.postMessage({ command: 'runInteropHarness' });
    }, []);

    const refreshRemoteWorkers = useCallback(() => {
        vscode.postMessage({ command: 'refreshRemoteWorkers' });
    }, []);

    const reloadPolicyPack = useCallback(() => {
        vscode.postMessage({ command: 'reloadPolicyPack' });
    }, []);

    const reloadTrustRegistry = useCallback(() => {
        vscode.postMessage({ command: 'reloadTrustRegistry' });
    }, []);

    const reloadBenchmarkSourceRegistry = useCallback(() => {
        vscode.postMessage({ command: 'reloadBenchmarkSourceRegistry' });
    }, []);

    const cancelRun = useCallback(() => {
        vscode.postMessage({ command: 'cancelRun' });
    }, []);

    const pulseOpacity = 0.6 + 0.4 * Math.sin((pulseFrame / 60) * Math.PI * 2);
    const timeline = buildTimeline(runState, lang);
    const currentNodeId = inferFocusedNode(runState);
    const selectedNode = runState?.nodes[selectedNodeId] || (currentNodeId ? runState?.nodes[currentNodeId] : undefined);
    const selectedNodeKey = runState?.nodes[selectedNodeId] ? selectedNodeId : currentNodeId;
    const selectedNodeOutput = selectedNode?.output ? summarizeOutput(selectedNode.output) : [];
    const selectedNodeFindings = extractFindings(selectedNode?.output);
    const remoteWorkersPanel = (
        <div style={{ ...glass.panel, padding: '16px 20px' }}>
            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon name="layers" size={15} color={colors.brand} />
                    {l.remoteWorkers}
                </span>
            </h3>
            <div style={{ ...s.hint, marginBottom: '12px' }}>{l.remoteWorkerHint}</div>
            {remoteWorkers.length === 0 ? (
                <div style={{
                    padding: '20px', textAlign: 'center',
                    color: 'rgba(255,255,255,0.3)', fontSize: '13px',
                }}>
                    <Icon name="layers" size={24} color="rgba(255,255,255,0.18)" />
                    <p style={{ margin: '8px 0 0' }}>{l.noRemoteWorkers}</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {remoteWorkers.map(worker => {
                        const healthStyle = REMOTE_HEALTH_COLORS[worker.health] || REMOTE_HEALTH_COLORS.unknown;
                        return (
                            <div key={worker.id} style={{
                                ...glass.card,
                                padding: '12px 14px',
                                borderColor: healthStyle.border,
                                background: healthStyle.bg,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '8px',
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.88)' }}>
                                            {worker.name}
                                        </div>
                                        <div style={{ ...s.hint, marginTop: '2px' }}>{worker.id}</div>
                                    </div>
                                    <div style={{
                                        fontSize: '11px',
                                        padding: '4px 10px',
                                        borderRadius: radius.pill,
                                        color: healthStyle.text,
                                        border: `1px solid ${healthStyle.border}`,
                                        background: 'rgba(255,255,255,0.02)',
                                        fontWeight: 700,
                                    }}>
                                        {l.health}: {worker.health}
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.endpoint}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>{worker.endpoint}</div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.taskEndpointLabel}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>{worker.taskEndpoint}</div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.trust}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{worker.trustScore}</div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.agentCardVersionLabel}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {`v${worker.agentCardVersion}${worker.agentCardSchemaVersion ? ` · ${worker.agentCardSchemaVersion}` : ''}`}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.verification}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.verification.summary === 'verified'
                                                ? `verified (${worker.verification.checkCount})`
                                                : `warning (${worker.verification.warningCount}/${worker.verification.checkCount})`}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.health}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{worker.health}</div>
                                    </div>
                                </div>
                                <div>
                                    <div style={{ ...s.hint, marginBottom: '4px' }}>{l.advertisementTrustPolicy}</div>
                                    <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{worker.advertisementTrustPolicyId}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.lifecycle}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{worker.selectedResponseMode}</div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.polling}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.selectedResponseMode === 'inline'
                                                ? 'inline terminal'
                                                : worker.selectedResponseMode === 'callback'
                                                    ? `callback ≤ ${worker.callbackTimeoutMs || 0}ms`
                                                : `${worker.pollIntervalMs || 0}ms × ${worker.maxPollAttempts || 0}`}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.supportedModes}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.supportedResponseModes.length > 0 ? worker.supportedResponseModes.join(', ') : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.protocolSource}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.taskProtocolSource === 'agent-card' ? l.agentCardSource : worker.taskProtocolSource}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.agentCardSchema}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.agentCardSchemaVersion || '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.digest}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                            {worker.agentCardSha256 || '—'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.publishedAt}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.agentCardPublishedAt || '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.expiresAt}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.agentCardExpiresAt || '—'}
                                        </div>
                                    </div>
                                </div>
                                {(worker.agentCardAdvertisementSignatureKeyId || worker.agentCardAdvertisementSignatureIssuer || worker.agentCardAdvertisementSignedAt) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                                        <div>
                                            <div style={{ ...s.hint, marginBottom: '4px' }}>{l.advertisementSignature}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                                {worker.agentCardAdvertisementSignatureKeyId || '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ ...s.hint, marginBottom: '4px' }}>{l.advertisementIssuer}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                                {worker.agentCardAdvertisementSignatureIssuer || '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ ...s.hint, marginBottom: '4px' }}>{l.advertisementSignedAt}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                                {worker.agentCardAdvertisementSignedAt || '—'}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.etag}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                            {worker.agentCardEtag || '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.lastModified}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.agentCardLastModified || '—'}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.capabilities}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.capabilities.length > 0 ? worker.capabilities.join(', ') : '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.delegatedNodes}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {worker.preferredNodeIds.length > 0 ? worker.preferredNodeIds.join(', ') : 'All matching nodes'}
                                        </div>
                                    </div>
                                </div>
                                {(worker.statusEndpointTemplate || worker.streamEndpointTemplate || worker.callbackUrlTemplate || worker.callbackAuthScheme) && (
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: worker.callbackUrlTemplate && worker.callbackAuthScheme
                                            ? '1fr 1fr 1fr 1fr'
                                            : worker.callbackUrlTemplate || worker.callbackAuthScheme
                                                ? '1fr 1fr 1fr'
                                                : '1fr 1fr',
                                        gap: '10px',
                                    }}>
                                        <div>
                                            <div style={{ ...s.hint, marginBottom: '4px' }}>{l.statusEndpoint}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                                {worker.statusEndpointTemplate || '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ ...s.hint, marginBottom: '4px' }}>{l.streamEndpoint}</div>
                                            <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                                {worker.streamEndpointTemplate || '—'}
                                            </div>
                                        </div>
                                        {worker.callbackUrlTemplate && (
                                            <div>
                                                <div style={{ ...s.hint, marginBottom: '4px' }}>{l.callbackUrl}</div>
                                                <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                                    {worker.callbackUrlTemplate}
                                                </div>
                                            </div>
                                        )}
                                        {worker.callbackAuthScheme && (
                                            <div>
                                                <div style={{ ...s.hint, marginBottom: '4px' }}>{l.callbackAuth}</div>
                                                <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                                    {`${worker.callbackAuthScheme} (${worker.callbackSignatureHeader}, ${worker.callbackTimestampHeader})`}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {worker.lastError && (
                                    <div style={{
                                        fontSize: '12px',
                                        lineHeight: 1.5,
                                        color: colors.error,
                                        borderTop: '1px solid rgba(255,255,255,0.06)',
                                        paddingTop: '8px',
                                    }}>
                                        {worker.lastError}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {remoteWorkerIssues.length > 0 && (
                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ ...s.hint }}>{l.remoteWorkerIssuesHint}</div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: colors.warning }}>{l.remoteWorkerIssues}</div>
                    {remoteWorkerIssues.map(issue => (
                        <div key={issue.id} style={{
                            ...glass.card,
                            padding: '12px 14px',
                            borderColor: 'rgba(248,113,113,0.25)',
                            background: 'rgba(248,113,113,0.06)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.88)' }}>{issue.id}</div>
                                    <div style={{ ...s.hint, marginTop: '2px' }}>{issue.endpoint}</div>
                                </div>
                                <div style={{ fontSize: '11px', color: colors.error, fontWeight: 700 }}>{issue.issueKind}</div>
                            </div>
                            <div style={{ fontSize: '12px', lineHeight: 1.5, color: 'rgba(255,255,255,0.82)' }}>{issue.error}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                    <div style={{ ...s.hint, marginBottom: '4px' }}>{l.agentCardUrl}</div>
                                    <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>{issue.agentCardUrl}</div>
                                </div>
                                <div>
                                    <div style={{ ...s.hint, marginBottom: '4px' }}>{l.issueKind}</div>
                                    <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{issue.issueKind}</div>
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div>
                                    <div style={{ ...s.hint, marginBottom: '4px' }}>{l.trust}</div>
                                    <div style={{ fontSize: '12px', lineHeight: 1.5 }}>{issue.minTrustScore}</div>
                                </div>
                                <div>
                                    <div style={{ ...s.hint, marginBottom: '4px' }}>{l.capabilities}</div>
                                    <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                        {issue.capabilities.length > 0 ? issue.capabilities.join(', ') : '—'}
                                    </div>
                                </div>
                            </div>
                            {(issue.expectedAgentCardSha256 || issue.expectedAdvertisementSchemaVersion || issue.advertisementTrustPolicyId) && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.expectedDigest}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5, wordBreak: 'break-all' }}>
                                            {issue.expectedAgentCardSha256 || '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.expectedSchemaVersion}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.expectedAdvertisementSchemaVersion || '—'}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {(issue.advertisementTrustPolicyId || issue.allowedAdvertisementKeyStatuses.length > 0 || issue.allowedAdvertisementRotationGroups.length > 0 || issue.allowedAdvertisementKeyIds.length > 0 || issue.allowedAdvertisementIssuers.length > 0) && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.trustPolicyLabel}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.advertisementTrustPolicyId || '—'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.signatureMode}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.requiredAdvertisementSignature ? 'required' : 'optional'}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {(issue.allowedAdvertisementKeyStatuses.length > 0 || issue.allowedAdvertisementRotationGroups.length > 0 || issue.allowedAdvertisementKeyIds.length > 0 || issue.allowedAdvertisementIssuers.length > 0) && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.allowedStatuses}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.allowedAdvertisementKeyStatuses.length > 0 ? issue.allowedAdvertisementKeyStatuses.join(', ') : 'active'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.rotationGroup}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.allowedAdvertisementRotationGroups.length > 0 ? issue.allowedAdvertisementRotationGroups.join(', ') : 'any'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.allowedKeys}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.allowedAdvertisementKeyIds.length > 0 ? issue.allowedAdvertisementKeyIds.join(', ') : 'any scoped key'}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ ...s.hint, marginBottom: '4px' }}>{l.allowedIssuers}</div>
                                        <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                            {issue.allowedAdvertisementIssuers.length > 0 ? issue.allowedAdvertisementIssuers.join(', ') : 'any issuer'}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div>
                                <div style={{ ...s.hint, marginBottom: '4px' }}>{l.delegatedNodes}</div>
                                <div style={{ fontSize: '12px', lineHeight: 1.5 }}>
                                    {issue.preferredNodeIds.length > 0 ? issue.preferredNodeIds.join(', ') : 'All matching nodes'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
    const trustRegistryPanel = (
        <div style={{ ...glass.panel, padding: '16px 20px' }}>
            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon name="key" size={15} color={colors.brand} />
                    {l.trustRegistry}
                </span>
            </h3>
            {!trustRegistry ? (
                <p style={s.hint}>{l.noTrustRegistry}</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <StatCard label="Registry ID" value={trustRegistry.registryId} sub={`v${trustRegistry.version}`} />
                        <StatCard
                            label={l.registrySummary}
                            value={trustRegistry.verification.summary}
                            sub={`${trustRegistry.verification.checkCount} checks · ${trustRegistry.verification.warningCount} warn · ${trustRegistry.verification.errorCount} error`}
                            color={trustRegistry.verification.summary === 'verified' ? colors.success : colors.warning}
                        />
                        <StatCard label={l.registryKeys} value={String(trustRegistry.keyCount)} />
                        <StatCard label={l.registryPolicies} value={String(trustRegistry.policyCount)} sub={`${trustRegistry.resolvableKeyCount} secret-ready keys`} />
                    </div>
                    {trustRegistry.sourcePath && (
                        <div style={s.hint}>Source: {trustRegistry.sourcePath}</div>
                    )}
                    {trustRegistry.loadedAt && (
                        <div style={s.hint}>{l.registryLoadedAt}: {trustRegistry.loadedAt}</div>
                    )}
                    {trustRegistry.keys.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {trustRegistry.keys.map((key) => (
                                <div key={`${key.keyId}:${key.issuer || 'default'}`} style={{ ...glass.card, padding: '10px 12px', lineHeight: 1.6 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{key.keyId}{key.issuer ? ` · ${key.issuer}` : ''}</div>
                                    <div style={s.hint}>
                                        {key.scopes.join(', ') || 'unscoped'} · {l.keyLifecycle}: {key.status} · {key.hasSecret ? 'secret-ready' : 'secret-missing'}
                                    </div>
                                    {key.envVar && <div style={s.hint}>{key.envVar}</div>}
                                    {(key.validFrom || key.expiresAt) && (
                                        <div style={s.hint}>
                                            {l.keyWindow}: {key.validFrom || '−'} → {key.expiresAt || '∞'}
                                        </div>
                                    )}
                                    {key.rotationGroup && <div style={s.hint}>{l.rotationGroup}: {key.rotationGroup}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                    {trustRegistry.signerPolicies.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {trustRegistry.signerPolicies.map((policy) => (
                                <div key={policy.policyId} style={{ ...glass.card, padding: '10px 12px', lineHeight: 1.6 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{policy.policyId}</div>
                                    <div style={s.hint}>
                                        {policy.scope} · {policy.enabled ? 'enabled' : 'disabled'} · {policy.requireSignature ? 'signature-required' : 'signature-optional'}
                                    </div>
                                    <div style={s.hint}>
                                        {l.allowedStatuses}: {policy.allowedKeyStatuses.length > 0 ? policy.allowedKeyStatuses.join(', ') : 'active'} · {l.allowedKeys}: {policy.allowedKeyIds.length > 0 ? policy.allowedKeyIds.join(', ') : 'any scoped key'}
                                    </div>
                                    <div style={s.hint}>
                                        {l.rotationGroup}: {policy.allowedRotationGroups.length > 0 ? policy.allowedRotationGroups.join(', ') : 'any'}
                                    </div>
                                    <div style={s.hint}>
                                        {l.allowedIssuers}: {policy.allowedIssuers.length > 0 ? policy.allowedIssuers.join(', ') : 'any issuer'}
                                    </div>
                                    {policy.maxSignatureAgeMs !== undefined && (
                                        <div style={s.hint}>max age: {policy.maxSignatureAgeMs}ms</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {trustRegistry.verification.failingMessages.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {trustRegistry.verification.failingMessages.map((message, index) => (
                                <div key={`${message}-${index}`} style={{
                                    ...glass.card,
                                    padding: '10px 12px',
                                    borderColor: 'rgba(251,191,36,0.24)',
                                    background: 'rgba(251,191,36,0.06)',
                                    color: colors.warning,
                                    fontSize: '12px',
                                    lineHeight: 1.6,
                                }}>
                                    {message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
    const benchmarkSourceRegistryPanel = (
        <div style={{ ...glass.panel, padding: '16px 20px' }}>
            <h3 style={{ ...s.sectionTitle, fontSize: '14px', margin: '0 0 12px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icon name="file-text" size={15} color={colors.brand} />
                    {l.benchmarkSources}
                </span>
            </h3>
            {!benchmarkSourceRegistry ? (
                <p style={s.hint}>{l.noBenchmarkSources}</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <StatCard label="Registry ID" value={benchmarkSourceRegistry.registryId} sub={`v${benchmarkSourceRegistry.version}`} />
                        <StatCard
                            label={l.registrySummary}
                            value={benchmarkSourceRegistry.verification.summary}
                            sub={`${benchmarkSourceRegistry.verification.checkCount} checks · ${benchmarkSourceRegistry.verification.warningCount} warn · ${benchmarkSourceRegistry.verification.errorCount} error`}
                            color={benchmarkSourceRegistry.verification.summary === 'verified' ? colors.success : colors.warning}
                        />
                        <StatCard label={l.registrySources} value={String(benchmarkSourceRegistry.sourceCount)} />
                        <StatCard label={l.registryLocked} value={String(benchmarkSourceRegistry.lockedSourceCount)} />
                    </div>
                    {(benchmarkSourceRegistry.signatureKeyId || benchmarkSourceRegistry.digestSha256) && (
                        <div style={{ ...glass.card, padding: '10px 14px', lineHeight: 1.6 }}>
                            <div style={{ ...s.hint, marginBottom: '6px' }}>
                                {l.trustPolicyLabel}: {benchmarkSourceRegistry.trustPolicyId}
                            </div>
                            {benchmarkSourceRegistry.signatureKeyId && (
                                <div style={{ ...s.hint, marginBottom: '6px' }}>
                                    {l.registrySignature}: {benchmarkSourceRegistry.signatureKeyId}
                                    {benchmarkSourceRegistry.signatureSignedAt ? ` · ${benchmarkSourceRegistry.signatureSignedAt}` : ''}
                                </div>
                            )}
                            {benchmarkSourceRegistry.digestSha256 && (
                                <div style={s.hint}>
                                    {l.registryDigest}: {benchmarkSourceRegistry.digestSha256}
                                </div>
                            )}
                        </div>
                    )}
                    {benchmarkSourceRegistry.sourcePath && (
                        <div style={s.hint}>
                            Source: {benchmarkSourceRegistry.sourcePath}
                        </div>
                    )}
                    {benchmarkSourceRegistry.loadedAt && (
                        <div style={s.hint}>
                            {l.registryLoadedAt}: {benchmarkSourceRegistry.loadedAt}
                        </div>
                    )}
                    {benchmarkSourceRegistry.verification.failingMessages.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {benchmarkSourceRegistry.verification.failingMessages.map((message, index) => (
                                <div key={`${message}-${index}`} style={{
                                    ...glass.card,
                                    padding: '10px 12px',
                                    borderColor: 'rgba(251,191,36,0.24)',
                                    background: 'rgba(251,191,36,0.06)',
                                    color: colors.warning,
                                    fontSize: '12px',
                                    lineHeight: 1.6,
                                }}>
                                    {message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    // ─── DAG 流程图组件 ────────────────────────────────────────────

    // 布局常量
    const DAG_NODE_W = 120;
    const DAG_NODE_H = 140;
    const DAG_GAP = 28;
    const DAG_MAIN_NODES = WORKFLOW_NODES.filter(n => n.id !== 'HITL');
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
    const renderDagNodeCard = (node: typeof WORKFLOW_NODES[0], x: number, y: number) => {
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
                    animationDelay: `${WORKFLOW_NODES.indexOf(node) * 60}ms`,
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
                        {state?.tribunalVerdict && (
                            <div style={{
                                fontSize: '9px',
                                color: state.tribunalQuorumSatisfied ? 'rgba(52,211,153,0.8)' : 'rgba(251,191,36,0.8)',
                                maxWidth: '100px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                margin: '2px auto 0',
                            }}>
                                {`${state.tribunalMode || 'tribunal'} · ${state.tribunalVerdict}`}
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
                                Antigravity Daemon
                            </div>
                            <div style={{ ...s.hint, marginTop: '6px' }}>
                                {workflowTemplate === 'antigravity.adaptive'
                                    ? 'Daemon-owned adaptive orchestration with policy-authorized debate skipping.'
                                    : 'Full-path orchestration with daemon-enforced execution authority.'}
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.68)' }}>
                                {l.workflowTemplate}
                            </div>
                            <select
                                value={workflowTemplate}
                                onChange={(event) => setWorkflowTemplate(event.target.value as WorkflowTemplateId)}
                                style={{
                                    width: '100%',
                                    borderRadius: radius.md,
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    background: 'rgba(10,14,24,0.75)',
                                    color: 'var(--vscode-editor-foreground)',
                                    padding: '10px 12px',
                                    fontSize: '12px',
                                    outline: 'none',
                                }}
                            >
                                <option value="antigravity.strict-full">{l.strictFull}</option>
                                <option value="antigravity.adaptive">{l.adaptive}</option>
                            </select>
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    <button style={s.btnSecondary} onClick={refreshRemoteWorkers}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon name="refresh" size={13} />
                            {l.refreshWorkers}
                        </span>
                    </button>
                    <button style={s.btnSecondary} onClick={reloadPolicyPack}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon name="shield" size={13} />
                            {l.reloadPolicy}
                        </span>
                    </button>
                    <button style={s.btnSecondary} onClick={reloadTrustRegistry}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon name="key" size={13} />
                            {l.reloadTrustRegistry}
                        </span>
                    </button>
                    <button style={s.btnSecondary} onClick={reloadBenchmarkSourceRegistry}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon name="file-text" size={13} />
                            {l.reloadBenchmarkSources}
                        </span>
                    </button>
                    {runState && (
                        <>
                        <button style={s.btnSecondary} onClick={runBenchmarkHarness}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="bar-chart" size={13} />
                                {l.runBenchmarks}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={runInteropHarness}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.runInterop}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={exportTraceBundle}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="download" size={13} />
                                {l.exportTrace}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getReleaseArtifacts}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="package" size={13} />
                                {l.loadReleaseArtifacts}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getPolicyReport}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.loadPolicyReport}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyReleaseArtifacts}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyReleaseArtifacts}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyPolicyReport}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyPolicyReport}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getInvariantReport}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="file-text" size={13} />
                                {l.loadInvariantReport}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyInvariantReport}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyInvariantReport}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getReleaseAttestation}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="file-text" size={13} />
                                {l.loadAttestation}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyReleaseAttestation}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyAttestation}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getReleaseBundle}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="package" size={13} />
                                {l.loadBundle}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyReleaseBundle}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyBundle}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getReleaseDossier}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="file-text" size={13} />
                                {l.loadDossier}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyReleaseDossier}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyDossier}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={getCertificationRecord}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="award" size={13} />
                                {l.loadCertification}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={verifyCertificationRecord}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="shield" size={13} />
                                {l.verifyCertification}
                            </span>
                        </button>
                        <button style={s.btnSecondary} onClick={replayRun}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="refresh" size={13} />
                                {l.replay}
                            </span>
                        </button>
                        <button
                            style={{
                                ...s.btnSecondary,
                                borderColor: 'rgba(248,113,113,0.3)',
                                color: colors.error,
                            }}
                            onClick={cancelRun}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Icon name="x-circle" size={13} />
                                {l.cancel}
                            </span>
                        </button>
                        </>
                    )}
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
                                    {selectedNode.tribunalVerdict && (
                                        <div style={{ ...glass.card, padding: '12px 14px' }}>
                                            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', marginBottom: '4px' }}>{l.tribunal}</div>
                                            <div style={{ fontSize: '13px', fontWeight: 600 }}>
                                                {selectedNode.tribunalVerdict}
                                                {selectedNode.tribunalMode ? ` · ${selectedNode.tribunalMode}` : ''}
                                            </div>
                                            <div style={{ ...s.hint, marginTop: '4px' }}>
                                                {l.quorum}: {selectedNode.tribunalQuorumSatisfied ? 'ok' : 'missing'}
                                                {typeof selectedNode.tribunalConfidence === 'number' ? ` · ${l.confidence}: ${(selectedNode.tribunalConfidence * 100).toFixed(0)}%` : ''}
                                            </div>
                                        </div>
                                    )}
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
                                    WORKFLOW_NODES.find(n => n.id === 'HITL')!,
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
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                                <StatCard
                                    label={l.authority}
                                    value={runState.authorityOwner || 'daemon'}
                                    sub={runState.authorityHost || 'antigravity'}
                                />
                                <StatCard
                                    label="Cursor"
                                    value={typeof runState.timelineCursor === 'number' ? String(runState.timelineCursor) : '—'}
                                    sub={runState.hostSessionId || 'host session'}
                                />
                            </div>
                            {runState.sourcePath && (
                                <div style={{ ...s.hint, marginTop: '10px' }}>
                                    Source: {runState.sourcePath}
                                </div>
                            )}
                            {runState.activeLease && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.lease}: {runState.activeLease.nodeId} · {runState.activeLease.leaseId}
                                    {runState.activeLease.allowedModelPool.length > 0 ? ` · ${runState.activeLease.allowedModelPool.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.activeHeartbeat && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.heartbeat}: {runState.activeHeartbeat.nodeId} · {runState.activeHeartbeat.heartbeatAt}
                                </div>
                            )}
                            {runState.pendingCompletionReceipt && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    Pending {l.completionReceipt}: {runState.pendingCompletionReceipt.nodeId} · {runState.pendingCompletionReceipt.status}
                                    {runState.pendingCompletionReceipt.model ? ` · ${runState.pendingCompletionReceipt.model}` : ''}
                                </div>
                            )}
                            {runState.preparedCompletionReceipt && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    Prepared {l.completionReceipt}: {runState.preparedCompletionReceipt.nodeId} · {runState.preparedCompletionReceipt.status}
                                    {runState.preparedCompletionReceipt.model ? ` · ${runState.preparedCompletionReceipt.model}` : ''}
                                </div>
                            )}
                            {runState.acknowledgedCompletionReceipt && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    Acknowledged {l.completionReceipt}: {runState.acknowledgedCompletionReceipt.nodeId} · {runState.acknowledgedCompletionReceipt.status}
                                    {runState.acknowledgedCompletionReceipt.model ? ` · ${runState.acknowledgedCompletionReceipt.model}` : ''}
                                </div>
                            )}
                            {runState.latestTribunalVerdict && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.tribunal}: {runState.latestTribunalVerdict.nodeId} · {runState.latestTribunalVerdict.verdict}
                                    {runState.latestTribunalVerdict.mode ? ` · ${runState.latestTribunalVerdict.mode}` : ''}
                                    {` · ${l.quorum}: ${runState.latestTribunalVerdict.quorumSatisfied ? 'ok' : 'missing'}`}
                                    {` · ${l.confidence}: ${(runState.latestTribunalVerdict.confidence * 100).toFixed(0)}%`}
                                </div>
                            )}
                            {runState.policyReport?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.policy}: {runState.policyReport.path}
                                </div>
                            )}
                            {runState.policyReport?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.policyReport.verified ? 'ok' : 'failed'}
                                    {runState.policyReport.signaturePolicyId ? ` · ${runState.policyReport.signaturePolicyId}` : ''}
                                    {runState.policyReport.signatureKeyId ? ` · ${runState.policyReport.signatureKeyId}` : ''}
                                    {runState.policyReport.issues.length > 0 ? ` · ${runState.policyReport.issues.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.releaseArtifacts?.traceBundle?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.trace}: {runState.releaseArtifacts.traceBundle.path}
                                </div>
                            )}
                            {runState.releaseArtifacts?.releaseAttestation?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.attestation}: {runState.releaseArtifacts.releaseAttestation.path}
                                </div>
                            )}
                            {runState.releaseArtifacts?.releaseAttestation?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.releaseArtifacts.releaseAttestation.verified ? 'ok' : 'failed'}
                                    {runState.releaseArtifacts.releaseAttestation.signaturePolicyId ? ` · ${runState.releaseArtifacts.releaseAttestation.signaturePolicyId}` : ''}
                                    {runState.releaseArtifacts.releaseAttestation.signatureKeyId ? ` · ${runState.releaseArtifacts.releaseAttestation.signatureKeyId}` : ''}
                                    {runState.releaseArtifacts.releaseAttestation.issues.length > 0 ? ` · ${runState.releaseArtifacts.releaseAttestation.issues.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.invariantReport?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.invariant}: {runState.invariantReport.path}
                                </div>
                            )}
                            {runState.invariantReport?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.invariantReport.verified ? 'ok' : 'failed'}
                                    {runState.invariantReport.signaturePolicyId ? ` · ${runState.invariantReport.signaturePolicyId}` : ''}
                                    {runState.invariantReport.signatureKeyId ? ` · ${runState.invariantReport.signatureKeyId}` : ''}
                                    {runState.invariantReport.issues.length > 0 ? ` · ${runState.invariantReport.issues.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.releaseBundle?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.bundle}: {runState.releaseBundle.path}
                                </div>
                            )}
                            {runState.releaseBundle?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.releaseBundle.verified ? 'ok' : 'failed'}
                                    {runState.releaseBundle.signaturePolicyId ? ` · ${runState.releaseBundle.signaturePolicyId}` : ''}
                                    {runState.releaseBundle.signatureKeyId ? ` · ${runState.releaseBundle.signatureKeyId}` : ''}
                                    {runState.releaseBundle.issues.length > 0 ? ` · ${runState.releaseBundle.issues.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.releaseDossier?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.dossier}: {runState.releaseDossier.path}
                                </div>
                            )}
                            {runState.releaseDossier?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.releaseDossier.verified ? 'ok' : 'failed'}
                                    {runState.releaseDossier.signaturePolicyId ? ` · ${runState.releaseDossier.signaturePolicyId}` : ''}
                                    {runState.releaseDossier.signatureKeyId ? ` · ${runState.releaseDossier.signatureKeyId}` : ''}
                                    {runState.releaseDossier.issues.length > 0 ? ` · ${runState.releaseDossier.issues.join(', ')}` : ''}
                                </div>
                            )}
                            {runState.certificationRecord?.path && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.certification}: {runState.certificationRecord.path}
                                </div>
                            )}
                            {runState.certificationRecord?.verified !== undefined && (
                                <div style={{ ...s.hint, marginTop: '6px' }}>
                                    {l.verification}: {runState.certificationRecord.verified ? 'ok' : 'failed'}
                                    {runState.certificationRecord.signaturePolicyId ? ` · ${runState.certificationRecord.signaturePolicyId}` : ''}
                                    {runState.certificationRecord.signatureKeyId ? ` · ${runState.certificationRecord.signatureKeyId}` : ''}
                                    {runState.certificationRecord.issues.length > 0 ? ` · ${runState.certificationRecord.issues.join(', ')}` : ''}
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
                                        <div key={b.id} style={{
                                            ...glass.card, padding: '10px 14px',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        }}>
                                            <div>
                                                <div style={{ fontSize: '12px', fontWeight: 600 }}>{b.suiteName}</div>
                                                <div style={{ ...s.hint, marginTop: '2px' }}>
                                                    {b.passed}/{b.totalCases} {l.cases} · {b.avgDurationMs}ms {l.avgTime}{b.detail ? ` · ${b.detail}` : ''}
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
                                        }} onClick={approveGate}>
                                            <Icon name="check" size={13} /> {l.approve}
                                        </button>
                                        <button style={{
                                            ...s.btnSecondary, padding: '8px 18px', fontSize: '12px',
                                            borderColor: 'rgba(248,113,113,0.3)',
                                            color: colors.error,
                                        }} onClick={rejectGate}>
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

            {trustRegistryPanel}
            {benchmarkSourceRegistryPanel}
            {remoteWorkersPanel}
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

function mapRunSnapshotPayload(payload: any): {
    runState: WorkflowRunState | null;
    benchmarks: BenchmarkData[];
    trustRegistry: TrustRegistryData | null;
    benchmarkSourceRegistry: BenchmarkSourceRegistryData | null;
    hitlState: HITLState;
    remoteWorkers: RemoteWorkerData[];
    remoteWorkerIssues: RemoteWorkerDiscoveryIssueData[];
} {
    if (!payload) {
        return {
            runState: null,
            benchmarks: [],
            trustRegistry: null,
            benchmarkSourceRegistry: null,
            hitlState: { isPaused: false },
            remoteWorkers: [],
            remoteWorkerIssues: [],
        };
    }

    const rawNodes = payload.nodes && typeof payload.nodes === 'object' ? payload.nodes : {};
    const nodes: Record<string, NodeState> = {};
    let skippedCount = 0;

    for (const node of WORKFLOW_NODES) {
        const rawNode = rawNodes[node.id];
        const status = normalizeStatus(rawNode?.status, payload.phase, node.id, rawNodes);
        if (status === 'skipped') skippedCount++;
        nodes[node.id] = {
            nodeId: node.id,
            status,
            durationMs: rawNode?.durationMs,
            model: rawNode?.model,
            error: rawNode?.error,
            startedAt: rawNode?.startedAt,
            completedAt: rawNode?.completedAt,
            output: rawNode?.output,
            tribunalVerdict: typeof rawNode?.tribunalVerdict === 'string' ? rawNode.tribunalVerdict : undefined,
            tribunalConfidence: typeof rawNode?.tribunalConfidence === 'number' ? rawNode.tribunalConfidence : undefined,
            tribunalMode: typeof rawNode?.tribunalMode === 'string' ? rawNode.tribunalMode : undefined,
            tribunalUpdatedAt: typeof rawNode?.tribunalUpdatedAt === 'string' ? rawNode.tribunalUpdatedAt : undefined,
            tribunalQuorumSatisfied: rawNode?.tribunalQuorumSatisfied === true ? true : rawNode?.tribunalQuorumSatisfied === false ? false : undefined,
        };
    }

    const benchmarks: BenchmarkData[] = [];
    const trustRegistry: TrustRegistryData | null = payload.trustRegistry
        ? {
            registryId: String(payload.trustRegistry.registryId || 'workspace-trust-registry'),
            version: String(payload.trustRegistry.version || '1.0.0'),
            sourcePath: typeof payload.trustRegistry.sourcePath === 'string' ? payload.trustRegistry.sourcePath : undefined,
            loadedAt: typeof payload.trustRegistry.loadedAt === 'string' ? payload.trustRegistry.loadedAt : undefined,
            verification: {
                summary: payload.trustRegistry.verification?.summary === 'warning' ? 'warning' : 'verified',
                checkCount: Array.isArray(payload.trustRegistry.verification?.checks) ? payload.trustRegistry.verification.checks.length : 0,
                warningCount: Array.isArray(payload.trustRegistry.verification?.checks)
                    ? payload.trustRegistry.verification.checks.filter((check: any) => check?.severity === 'warn').length
                    : 0,
                errorCount: Array.isArray(payload.trustRegistry.verification?.checks)
                    ? payload.trustRegistry.verification.checks.filter((check: any) => check?.severity === 'error').length
                    : 0,
                failingMessages: Array.isArray(payload.trustRegistry.verification?.checks)
                    ? payload.trustRegistry.verification.checks
                        .filter((check: any) => check?.ok === false)
                        .map((check: any) => String(check?.message || check?.checkId || 'Verification check failed'))
                    : [],
            },
            keyCount: Array.isArray(payload.trustRegistry.keys) ? payload.trustRegistry.keys.length : 0,
            policyCount: Array.isArray(payload.trustRegistry.signerPolicies) ? payload.trustRegistry.signerPolicies.length : 0,
            scopedKeyCount: Array.isArray(payload.trustRegistry.keys)
                ? payload.trustRegistry.keys.filter((key: any) => Array.isArray(key?.scopes) && key.scopes.length > 0).length
                : 0,
            resolvableKeyCount: Array.isArray(payload.trustRegistry.keys)
                ? payload.trustRegistry.keys.filter((key: any) => key?.hasSecret === true).length
                : 0,
            keys: Array.isArray(payload.trustRegistry.keys)
                ? payload.trustRegistry.keys.map((key: any) => ({
                    keyId: String(key?.keyId || 'trust-key'),
                    issuer: typeof key?.issuer === 'string' ? key.issuer : undefined,
                    envVar: typeof key?.envVar === 'string' ? key.envVar : undefined,
                    scopes: Array.isArray(key?.scopes) ? key.scopes.map((item: any) => String(item)) : [],
                    status: key?.status === 'staged' || key?.status === 'retired' ? key.status : 'active',
                    validFrom: typeof key?.validFrom === 'string' ? key.validFrom : undefined,
                    expiresAt: typeof key?.expiresAt === 'string' ? key.expiresAt : undefined,
                    rotationGroup: typeof key?.rotationGroup === 'string' ? key.rotationGroup : undefined,
                    hasSecret: key?.hasSecret === true,
                }))
                : [],
            signerPolicies: Array.isArray(payload.trustRegistry.signerPolicies)
                ? payload.trustRegistry.signerPolicies.map((policy: any) => ({
                    policyId: String(policy?.policyId || 'policy'),
                    scope: String(policy?.scope || 'unknown'),
                    enabled: policy?.enabled !== false,
                    requireSignature: policy?.requireSignature === true,
                    allowedKeyStatuses: Array.isArray(policy?.allowedKeyStatuses)
                        ? policy.allowedKeyStatuses.map((item: any) => String(item)) as Array<'active' | 'staged' | 'retired'>
                        : ['active'],
                    allowedRotationGroups: Array.isArray(policy?.allowedRotationGroups)
                        ? policy.allowedRotationGroups.map((item: any) => String(item))
                        : [],
                    allowedKeyIds: Array.isArray(policy?.allowedKeyIds) ? policy.allowedKeyIds.map((item: any) => String(item)) : [],
                    allowedIssuers: Array.isArray(policy?.allowedIssuers) ? policy.allowedIssuers.map((item: any) => String(item)) : [],
                    maxSignatureAgeMs: typeof policy?.maxSignatureAgeMs === 'number' ? policy.maxSignatureAgeMs : undefined,
                }))
                : [],
        }
        : null;
    const benchmarkSourceRegistry: BenchmarkSourceRegistryData | null = payload.benchmarkSourceRegistry
        ? {
            registryId: String(payload.benchmarkSourceRegistry.registryId || 'workspace-benchmark-source-registry'),
            version: String(payload.benchmarkSourceRegistry.version || '1.0.0'),
            sourcePath: typeof payload.benchmarkSourceRegistry.sourcePath === 'string' ? payload.benchmarkSourceRegistry.sourcePath : undefined,
            loadedAt: typeof payload.benchmarkSourceRegistry.loadedAt === 'string' ? payload.benchmarkSourceRegistry.loadedAt : undefined,
            trustPolicyId: String(payload.benchmarkSourceRegistry.trustPolicyId || 'default:benchmark-source-registry'),
            digestSha256: typeof payload.benchmarkSourceRegistry.digestSha256 === 'string' ? payload.benchmarkSourceRegistry.digestSha256 : undefined,
            signatureKeyId: typeof payload.benchmarkSourceRegistry.signature?.keyId === 'string' ? payload.benchmarkSourceRegistry.signature.keyId : undefined,
            signatureSignedAt: typeof payload.benchmarkSourceRegistry.signature?.signedAt === 'string' ? payload.benchmarkSourceRegistry.signature.signedAt : undefined,
            verification: {
                summary: payload.benchmarkSourceRegistry.verification?.summary === 'warning' ? 'warning' : 'verified',
                checkCount: Array.isArray(payload.benchmarkSourceRegistry.verification?.checks) ? payload.benchmarkSourceRegistry.verification.checks.length : 0,
                warningCount: Array.isArray(payload.benchmarkSourceRegistry.verification?.checks)
                    ? payload.benchmarkSourceRegistry.verification.checks.filter((check: any) => check?.severity === 'warn').length
                    : 0,
                errorCount: Array.isArray(payload.benchmarkSourceRegistry.verification?.checks)
                    ? payload.benchmarkSourceRegistry.verification.checks.filter((check: any) => check?.severity === 'error').length
                    : 0,
                failingMessages: Array.isArray(payload.benchmarkSourceRegistry.verification?.checks)
                    ? payload.benchmarkSourceRegistry.verification.checks
                        .filter((check: any) => check?.ok === false)
                        .map((check: any) => String(check?.message || check?.checkId || 'Verification check failed'))
                    : [],
            },
            sourceCount: Array.isArray(payload.benchmarkSourceRegistry.sources) ? payload.benchmarkSourceRegistry.sources.length : 0,
            lockedSourceCount: Array.isArray(payload.benchmarkSourceRegistry.sources)
                ? payload.benchmarkSourceRegistry.sources.filter((source: any) => source?.locked === true).length
                : 0,
        }
        : null;
    const remoteWorkers: RemoteWorkerData[] = Array.isArray(payload.remoteWorkers?.workers)
        ? payload.remoteWorkers.workers.map((worker: any) => ({
            id: String(worker?.id || 'remote-worker'),
            name: String(worker?.name || worker?.id || 'Remote Worker'),
            agentCardVersion: String(worker?.agentCardVersion || 'unknown'),
            agentCardSchemaVersion: typeof worker?.agentCardSchemaVersion === 'string' ? worker.agentCardSchemaVersion : undefined,
            agentCardPublishedAt: typeof worker?.agentCardPublishedAt === 'string' ? worker.agentCardPublishedAt : undefined,
            agentCardExpiresAt: typeof worker?.agentCardExpiresAt === 'string' ? worker.agentCardExpiresAt : undefined,
            agentCardAdvertisementSignatureKeyId: typeof worker?.agentCardAdvertisementSignatureKeyId === 'string' ? worker.agentCardAdvertisementSignatureKeyId : undefined,
            agentCardAdvertisementSignatureIssuer: typeof worker?.agentCardAdvertisementSignatureIssuer === 'string' ? worker.agentCardAdvertisementSignatureIssuer : undefined,
            agentCardAdvertisementSignedAt: typeof worker?.agentCardAdvertisementSignedAt === 'string' ? worker.agentCardAdvertisementSignedAt : undefined,
            advertisementTrustPolicyId: String(worker?.advertisementTrustPolicyId || 'default:remote-worker-advertisement'),
            agentCardSha256: typeof worker?.agentCardSha256 === 'string' ? worker.agentCardSha256 : '',
            agentCardEtag: typeof worker?.agentCardEtag === 'string' ? worker.agentCardEtag : undefined,
            agentCardLastModified: typeof worker?.agentCardLastModified === 'string' ? worker.agentCardLastModified : undefined,
            endpoint: String(worker?.endpoint || ''),
            taskEndpoint: String(worker?.taskEndpoint || worker?.endpoint || ''),
            selectedResponseMode: (worker?.selectedResponseMode || 'inline') as RemoteWorkerData['selectedResponseMode'],
            supportedResponseModes: Array.isArray(worker?.supportedResponseModes)
                ? worker.supportedResponseModes.map((item: any) => String(item)) as RemoteWorkerData['supportedResponseModes']
                : [],
            taskProtocolSource: 'agent-card',
            statusEndpointTemplate: typeof worker?.statusEndpointTemplate === 'string' ? worker.statusEndpointTemplate : undefined,
            streamEndpointTemplate: typeof worker?.streamEndpointTemplate === 'string' ? worker.streamEndpointTemplate : undefined,
            callbackUrlTemplate: typeof worker?.callbackUrlTemplate === 'string' ? worker.callbackUrlTemplate : undefined,
            callbackAuthScheme: typeof worker?.callbackAuthScheme === 'string' ? worker.callbackAuthScheme : undefined,
            callbackSignatureHeader: typeof worker?.callbackSignatureHeader === 'string' ? worker.callbackSignatureHeader : undefined,
            callbackTimestampHeader: typeof worker?.callbackTimestampHeader === 'string' ? worker.callbackTimestampHeader : undefined,
            pollIntervalMs: typeof worker?.pollIntervalMs === 'number' ? worker.pollIntervalMs : undefined,
            maxPollAttempts: typeof worker?.maxPollAttempts === 'number' ? worker.maxPollAttempts : undefined,
            callbackTimeoutMs: typeof worker?.callbackTimeoutMs === 'number' ? worker.callbackTimeoutMs : undefined,
            capabilities: Array.isArray(worker?.capabilities) ? worker.capabilities.map((item: any) => String(item)) : [],
            health: (worker?.health || 'unknown') as RemoteWorkerData['health'],
            trustScore: Number(worker?.trustScore || 0),
            source: String(worker?.source || ''),
            preferredNodeIds: Array.isArray(worker?.preferredNodeIds) ? worker.preferredNodeIds.map((item: any) => String(item)) : [],
            verification: {
                summary: worker?.verification?.summary === 'warning' ? 'warning' : 'verified',
                checkCount: Array.isArray(worker?.verification?.checks) ? worker.verification.checks.length : 0,
                warningCount: Array.isArray(worker?.verification?.checks)
                    ? worker.verification.checks.filter((check: any) => check?.severity === 'warn').length
                    : 0,
            },
            lastError: typeof worker?.lastError === 'string' ? worker.lastError : undefined,
        }))
        : [];
    const remoteWorkerIssues: RemoteWorkerDiscoveryIssueData[] = Array.isArray(payload.remoteWorkers?.discoveryIssues)
        ? payload.remoteWorkers.discoveryIssues.map((issue: any) => ({
            id: String(issue?.id || 'remote-worker-issue'),
            issueKind: (issue?.issueKind || 'discovery') as RemoteWorkerDiscoveryIssueData['issueKind'],
            endpoint: String(issue?.endpoint || ''),
            agentCardUrl: String(issue?.agentCardUrl || ''),
            expectedAgentCardSha256: typeof issue?.expectedAgentCardSha256 === 'string' ? issue.expectedAgentCardSha256 : undefined,
            expectedAdvertisementSchemaVersion: typeof issue?.expectedAdvertisementSchemaVersion === 'string'
                ? issue.expectedAdvertisementSchemaVersion
                : undefined,
            advertisementTrustPolicyId: typeof issue?.advertisementTrustPolicyId === 'string'
                ? issue.advertisementTrustPolicyId
                : undefined,
            requiredAdvertisementSignature: issue?.requiredAdvertisementSignature === true,
            allowedAdvertisementKeyStatuses: Array.isArray(issue?.allowedAdvertisementKeyStatuses)
                ? issue.allowedAdvertisementKeyStatuses.map((item: any) => String(item))
                : [],
            allowedAdvertisementRotationGroups: Array.isArray(issue?.allowedAdvertisementRotationGroups)
                ? issue.allowedAdvertisementRotationGroups.map((item: any) => String(item))
                : [],
            allowedAdvertisementKeyIds: Array.isArray(issue?.allowedAdvertisementKeyIds)
                ? issue.allowedAdvertisementKeyIds.map((item: any) => String(item))
                : [],
            allowedAdvertisementIssuers: Array.isArray(issue?.allowedAdvertisementIssuers)
                ? issue.allowedAdvertisementIssuers.map((item: any) => String(item))
                : [],
            error: String(issue?.error || 'Unknown remote worker discovery error'),
            capabilities: Array.isArray(issue?.capabilities) ? issue.capabilities.map((item: any) => String(item)) : [],
            preferredNodeIds: Array.isArray(issue?.preferredNodeIds) ? issue.preferredNodeIds.map((item: any) => String(item)) : [],
            minTrustScore: Number(issue?.minTrustScore || 0),
            detectedAt: String(issue?.detectedAt || ''),
        }))
        : [];
    if (payload.benchmark && Array.isArray(payload.benchmark.suites)) {
        const benchmarkSuites = payload.benchmark.suites.map((suite: any) => {
            const totalCases = Number(suite?.totalCases ?? suite?.totalChecks ?? 0);
            const passed = Number(suite?.passedCases ?? suite?.passedChecks ?? 0);
            const totalChecks = Number(suite?.totalChecks || 0);
            const passedChecks = Number(suite?.passedChecks || 0);
            return {
                id: `benchmark-${String(suite?.suiteId || suite?.name || 'suite')}`,
                suiteName: String(suite?.name || suite?.suiteId || 'Benchmark Suite'),
                totalCases,
                passed,
                passRate: totalCases > 0 ? Math.round((passed / totalCases) * 100) : 0,
                avgDurationMs: Number(suite?.avgDurationMs || 0),
                detail: `${passedChecks}/${totalChecks} checks`,
            };
        });
        benchmarks.unshift(...benchmarkSuites);
    }
    if (payload.interop && Array.isArray(payload.interop.suites)) {
        const interopSuites = payload.interop.suites.map((suite: any) => {
            const totalCases = Number(suite?.totalCases ?? suite?.totalChecks ?? 0);
            const passed = Number(suite?.passedCases ?? suite?.passedChecks ?? 0);
            const totalChecks = Number(suite?.totalChecks || 0);
            const passedChecks = Number(suite?.passedChecks || 0);
            return {
                id: `interop-${String(suite?.suiteId || suite?.name || 'suite')}`,
                suiteName: String(suite?.name || suite?.suiteId || 'Interop Suite'),
                totalCases,
                passed,
                passRate: totalCases > 0 ? Math.round((passed / totalCases) * 100) : 0,
                avgDurationMs: Number(suite?.avgDurationMs || 0),
                detail: `${passedChecks}/${totalChecks} checks`,
            };
        });
        benchmarks.unshift(...interopSuites);
    }

    const hitlState: HITLState =
        payload.phase === 'PAUSED' || payload.phase === 'PAUSED_FOR_HUMAN' ||
        rawNodes.HITL?.status === 'paused' || rawNodes.HITL?.status === 'running' || rawNodes.HITL?.status === 'paused_for_human'
            ? {
                isPaused: true,
                pauseReason: rawNodes.HITL?.output?.gateStatus || rawNodes.HITL?.output?.hostAction || payload.verdict,
                pausedAtNode: 'HITL',
            }
            : { isPaused: false };

    const hasRunState = Boolean(payload.runId || payload.workflow || Object.keys(rawNodes).length > 0);
    const runState: WorkflowRunState | null = hasRunState ? {
        runId: payload.runId || 'antigravity-run',
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
        sourcePath: payload.sourcePath,
        updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : (typeof payload.updatedAt === 'string' ? Date.parse(payload.updatedAt) : undefined),
        authorityOwner: payload.authorityOwner,
        authorityHost: payload.authorityHost,
        hostSessionId: payload.hostSessionId,
        timelineCursor: payload.timelineCursor,
        activeLease: payload.activeLease
            ? {
                leaseId: String(payload.activeLease.leaseId || ''),
                nodeId: String(payload.activeLease.nodeId || ''),
                attempt: Number(payload.activeLease.attempt || 0),
                expiresAt: String(payload.activeLease.expiresAt || ''),
                requiredEvidence: Array.isArray(payload.activeLease.requiredEvidence)
                    ? payload.activeLease.requiredEvidence.map((item: any) => String(item))
                    : [],
                allowedModelPool: Array.isArray(payload.activeLease.allowedModelPool)
                    ? payload.activeLease.allowedModelPool.map((item: any) => String(item))
                    : [],
            }
            : undefined,
        activeHeartbeat: payload.activeHeartbeat
            ? {
                leaseId: String(payload.activeHeartbeat.leaseId || ''),
                nodeId: String(payload.activeHeartbeat.nodeId || ''),
                attempt: Number(payload.activeHeartbeat.attempt || 0),
                heartbeatAt: String(payload.activeHeartbeat.heartbeatAt || ''),
            }
            : undefined,
        pendingCompletionReceipt: payload.pendingCompletionReceipt
            ? {
                leaseId: String(payload.pendingCompletionReceipt.leaseId || ''),
                nodeId: String(payload.pendingCompletionReceipt.nodeId || ''),
                attempt: Number(payload.pendingCompletionReceipt.attempt || 0),
                status: String(payload.pendingCompletionReceipt.status || ''),
                model: typeof payload.pendingCompletionReceipt.model === 'string'
                    ? payload.pendingCompletionReceipt.model
                    : undefined,
                completedAt: String(payload.pendingCompletionReceipt.completedAt || ''),
            }
            : undefined,
        preparedCompletionReceipt: payload.preparedCompletionReceipt
            ? {
                leaseId: String(payload.preparedCompletionReceipt.leaseId || ''),
                nodeId: String(payload.preparedCompletionReceipt.nodeId || ''),
                attempt: Number(payload.preparedCompletionReceipt.attempt || 0),
                status: String(payload.preparedCompletionReceipt.status || ''),
                model: typeof payload.preparedCompletionReceipt.model === 'string'
                    ? payload.preparedCompletionReceipt.model
                    : undefined,
                completedAt: String(payload.preparedCompletionReceipt.completedAt || ''),
                preparedAt: String(payload.preparedCompletionReceipt.preparedAt || ''),
            }
            : undefined,
        acknowledgedCompletionReceipt: payload.acknowledgedCompletionReceipt
            ? {
                leaseId: String(payload.acknowledgedCompletionReceipt.leaseId || ''),
                nodeId: String(payload.acknowledgedCompletionReceipt.nodeId || ''),
                attempt: Number(payload.acknowledgedCompletionReceipt.attempt || 0),
                status: String(payload.acknowledgedCompletionReceipt.status || ''),
                model: typeof payload.acknowledgedCompletionReceipt.model === 'string'
                    ? payload.acknowledgedCompletionReceipt.model
                    : undefined,
                completedAt: String(payload.acknowledgedCompletionReceipt.completedAt || ''),
            }
            : undefined,
        latestTribunalVerdict: payload.latestTribunalVerdict
            ? {
                tribunalId: String(payload.latestTribunalVerdict.tribunalId || ''),
                nodeId: String(payload.latestTribunalVerdict.nodeId || ''),
                mode: String(payload.latestTribunalVerdict.mode || ''),
                verdict: String(payload.latestTribunalVerdict.verdict || ''),
                confidence: Number(payload.latestTribunalVerdict.confidence || 0),
                quorumSatisfied: payload.latestTribunalVerdict.quorumSatisfied === true,
                createdAt: String(payload.latestTribunalVerdict.createdAt || ''),
            }
            : undefined,
        policyReport: payload.policyReport
            ? {
                path: String(payload.policyReport.path || ''),
                verified: payload.policyReport.verified === true ? true : payload.policyReport.verified === false ? false : undefined,
                payloadDigestOk: payload.policyReport.payloadDigestOk === true ? true : payload.policyReport.payloadDigestOk === false ? false : undefined,
                signatureVerified: payload.policyReport.signatureVerified === true ? true : payload.policyReport.signatureVerified === false ? false : undefined,
                signatureRequired: payload.policyReport.signatureRequired === true ? true : payload.policyReport.signatureRequired === false ? false : undefined,
                signaturePolicyId: typeof payload.policyReport.signaturePolicyId === 'string'
                    ? payload.policyReport.signaturePolicyId
                    : undefined,
                signatureKeyId: typeof payload.policyReport.signatureKeyId === 'string'
                    ? payload.policyReport.signatureKeyId
                    : undefined,
                issues: Array.isArray(payload.policyReport.issues)
                    ? payload.policyReport.issues.map((issue: any) => String(issue))
                    : [],
            }
            : undefined,
        releaseArtifacts: payload.releaseArtifacts
            ? {
                traceBundle: payload.releaseArtifacts.traceBundle
                    ? {
                        path: String(payload.releaseArtifacts.traceBundle.path || ''),
                        integrityOk: payload.releaseArtifacts.traceBundle.integrityOk === true ? true : payload.releaseArtifacts.traceBundle.integrityOk === false ? false : undefined,
                        signatureVerified: payload.releaseArtifacts.traceBundle.signatureVerified === true ? true : payload.releaseArtifacts.traceBundle.signatureVerified === false ? false : undefined,
                        signatureRequired: payload.releaseArtifacts.traceBundle.signatureRequired === true ? true : payload.releaseArtifacts.traceBundle.signatureRequired === false ? false : undefined,
                        signaturePolicyId: typeof payload.releaseArtifacts.traceBundle.signaturePolicyId === 'string'
                            ? payload.releaseArtifacts.traceBundle.signaturePolicyId
                            : undefined,
                        signatureKeyId: typeof payload.releaseArtifacts.traceBundle.signatureKeyId === 'string'
                            ? payload.releaseArtifacts.traceBundle.signatureKeyId
                            : undefined,
                        issues: Array.isArray(payload.releaseArtifacts.traceBundle.issues)
                            ? payload.releaseArtifacts.traceBundle.issues.map((issue: any) => String(issue))
                            : [],
                    }
                    : undefined,
                releaseAttestation: payload.releaseArtifacts.releaseAttestation
                    ? {
                        path: String(payload.releaseArtifacts.releaseAttestation.path || ''),
                        verified: payload.releaseArtifacts.releaseAttestation.verified === true ? true : payload.releaseArtifacts.releaseAttestation.verified === false ? false : undefined,
                        payloadDigestOk: payload.releaseArtifacts.releaseAttestation.payloadDigestOk === true ? true : payload.releaseArtifacts.releaseAttestation.payloadDigestOk === false ? false : undefined,
                        signatureVerified: payload.releaseArtifacts.releaseAttestation.signatureVerified === true ? true : payload.releaseArtifacts.releaseAttestation.signatureVerified === false ? false : undefined,
                        signatureRequired: payload.releaseArtifacts.releaseAttestation.signatureRequired === true ? true : payload.releaseArtifacts.releaseAttestation.signatureRequired === false ? false : undefined,
                        signaturePolicyId: typeof payload.releaseArtifacts.releaseAttestation.signaturePolicyId === 'string'
                            ? payload.releaseArtifacts.releaseAttestation.signaturePolicyId
                            : undefined,
                        signatureKeyId: typeof payload.releaseArtifacts.releaseAttestation.signatureKeyId === 'string'
                            ? payload.releaseArtifacts.releaseAttestation.signatureKeyId
                            : undefined,
                        issues: Array.isArray(payload.releaseArtifacts.releaseAttestation.issues)
                            ? payload.releaseArtifacts.releaseAttestation.issues.map((issue: any) => String(issue))
                            : [],
                    }
                    : undefined,
            }
            : undefined,
        invariantReport: payload.invariantReport
            ? {
                path: String(payload.invariantReport.path || ''),
                verified: payload.invariantReport.verified === true ? true : payload.invariantReport.verified === false ? false : undefined,
                payloadDigestOk: payload.invariantReport.payloadDigestOk === true ? true : payload.invariantReport.payloadDigestOk === false ? false : undefined,
                signatureVerified: payload.invariantReport.signatureVerified === true ? true : payload.invariantReport.signatureVerified === false ? false : undefined,
                signatureRequired: payload.invariantReport.signatureRequired === true ? true : payload.invariantReport.signatureRequired === false ? false : undefined,
                signaturePolicyId: typeof payload.invariantReport.signaturePolicyId === 'string'
                    ? payload.invariantReport.signaturePolicyId
                    : undefined,
                signatureKeyId: typeof payload.invariantReport.signatureKeyId === 'string'
                    ? payload.invariantReport.signatureKeyId
                    : undefined,
                issues: Array.isArray(payload.invariantReport.issues)
                    ? payload.invariantReport.issues.map((issue: any) => String(issue))
                    : [],
            }
            : undefined,
        releaseDossier: payload.releaseDossier
            ? {
                path: String(payload.releaseDossier.path || ''),
                verified: payload.releaseDossier.verified === true ? true : payload.releaseDossier.verified === false ? false : undefined,
                payloadDigestOk: payload.releaseDossier.payloadDigestOk === true ? true : payload.releaseDossier.payloadDigestOk === false ? false : undefined,
                signatureVerified: payload.releaseDossier.signatureVerified === true ? true : payload.releaseDossier.signatureVerified === false ? false : undefined,
                signatureRequired: payload.releaseDossier.signatureRequired === true ? true : payload.releaseDossier.signatureRequired === false ? false : undefined,
                signaturePolicyId: typeof payload.releaseDossier.signaturePolicyId === 'string'
                    ? payload.releaseDossier.signaturePolicyId
                    : undefined,
                signatureKeyId: typeof payload.releaseDossier.signatureKeyId === 'string'
                    ? payload.releaseDossier.signatureKeyId
                    : undefined,
                issues: Array.isArray(payload.releaseDossier.issues)
                    ? payload.releaseDossier.issues.map((issue: any) => String(issue))
                    : [],
            }
            : undefined,
        releaseBundle: payload.releaseBundle
            ? {
                path: String(payload.releaseBundle.path || ''),
                verified: payload.releaseBundle.verified === true ? true : payload.releaseBundle.verified === false ? false : undefined,
                payloadDigestOk: payload.releaseBundle.payloadDigestOk === true ? true : payload.releaseBundle.payloadDigestOk === false ? false : undefined,
                signatureVerified: payload.releaseBundle.signatureVerified === true ? true : payload.releaseBundle.signatureVerified === false ? false : undefined,
                signatureRequired: payload.releaseBundle.signatureRequired === true ? true : payload.releaseBundle.signatureRequired === false ? false : undefined,
                signaturePolicyId: typeof payload.releaseBundle.signaturePolicyId === 'string'
                    ? payload.releaseBundle.signaturePolicyId
                    : undefined,
                signatureKeyId: typeof payload.releaseBundle.signatureKeyId === 'string'
                    ? payload.releaseBundle.signatureKeyId
                    : undefined,
                issues: Array.isArray(payload.releaseBundle.issues)
                    ? payload.releaseBundle.issues.map((issue: any) => String(issue))
                    : [],
            }
            : undefined,
        certificationRecord: payload.certificationRecord
            ? {
                path: String(payload.certificationRecord.path || ''),
                verified: payload.certificationRecord.verified === true ? true : payload.certificationRecord.verified === false ? false : undefined,
                payloadDigestOk: payload.certificationRecord.payloadDigestOk === true ? true : payload.certificationRecord.payloadDigestOk === false ? false : undefined,
                signatureVerified: payload.certificationRecord.signatureVerified === true ? true : payload.certificationRecord.signatureVerified === false ? false : undefined,
                signatureRequired: payload.certificationRecord.signatureRequired === true ? true : payload.certificationRecord.signatureRequired === false ? false : undefined,
                signaturePolicyId: typeof payload.certificationRecord.signaturePolicyId === 'string'
                    ? payload.certificationRecord.signaturePolicyId
                    : undefined,
                signatureKeyId: typeof payload.certificationRecord.signatureKeyId === 'string'
                    ? payload.certificationRecord.signatureKeyId
                    : undefined,
                issues: Array.isArray(payload.certificationRecord.issues)
                    ? payload.certificationRecord.issues.map((issue: any) => String(issue))
                    : [],
            }
            : undefined,
    } : null;

    return { runState, benchmarks, trustRegistry, benchmarkSourceRegistry, hitlState, remoteWorkers, remoteWorkerIssues };
}

function normalizeRunStatus(status?: string): WorkflowRunState['status'] {
    switch ((status || '').toLowerCase()) {
        case 'completed': return 'completed';
        case 'failed': return 'failed';
        case 'cancelled': return 'cancelled';
        case 'paused_for_human': return 'paused';
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
    if (normalized === 'policy_skipped') {
        return 'skipped';
    }
    if (normalized === 'pending' || normalized === 'queued' || normalized === 'running' ||
        normalized === 'completed' || normalized === 'failed' || normalized === 'skipped') {
        return normalized;
    }
    if (nodeId === 'HITL' && (phase === 'PAUSED' || phase === 'PAUSED_FOR_HUMAN')) return 'running';
    if (phase === 'COMPLETED' && rawNodes?.[nodeId || '']) return 'completed';
    return 'pending';
}

function inferRisk(rawNodes: Record<string, any>): WorkflowRunState['latestRisk'] {
    const disagreementScore = Number(rawNodes.PARALLEL?.disagreementScore
        ?? rawNodes.PARALLEL?.output?.disagreementScore
        ?? rawNodes.ANALYZE?.drScore
        ?? 0);
    const score = Math.max(0, Math.min(100, disagreementScore * 100));
    const level =
        score >= 90 ? 'critical'
            : score >= 60 ? 'high'
                : score >= 30 ? 'medium'
                    : 'low';
    return { drScore: score, level };
}

function inferLane(phase?: string, rawNodes?: Record<string, any>): string {
    if (!rawNodes) return 'standard';
    const debateStatus = normalizeStatus(rawNodes.DEBATE?.status, phase, 'DEBATE', rawNodes);
    if (debateStatus === 'skipped') return 'adaptive-express';
    if (debateStatus === 'completed' || debateStatus === 'running' || debateStatus === 'queued') {
        return 'deliberative';
    }
    if (normalizeStatus(rawNodes.PARALLEL?.status, phase, 'PARALLEL', rawNodes) !== 'pending') {
        return 'parallel';
    }
    return 'standard';
}

function inferConfidence(rawNodes: Record<string, any>): number {
    const synthOutput = rawNodes.SYNTHESIZE?.output;
    const verifyOutput = rawNodes.VERIFY?.output;
    const debateOutput = rawNodes.DEBATE?.output;

    if (typeof synthOutput?.finalConfidence === 'number') {
        return Math.max(0, Math.min(100, Math.round(synthOutput.finalConfidence)));
    }

    if (typeof verifyOutput?.complianceCheck === 'string' && verifyOutput.complianceCheck.toUpperCase() === 'VIOLATION') {
        return 35;
    }

    if (typeof verifyOutput?.assuranceVerdict === 'string') {
        switch (verifyOutput.assuranceVerdict.toUpperCase()) {
            case 'PASS':
                return 90;
            case 'REVISE':
                return 65;
            case 'ESCALATE':
                return 40;
        }
    }

    if (typeof debateOutput?.convergenceScore === 'number') {
        return Math.max(0, Math.min(100, Math.round(debateOutput.convergenceScore * 100)));
    }

    return 75;
}

function buildTimeline(runState: WorkflowRunState | null, lang: Lang): TimelineEntry[] {
    if (!runState) return [];
    const entries: TimelineEntry[] = [];

    for (const node of WORKFLOW_NODES) {
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

function inferFocusedNode(runState: WorkflowRunState | null): string | undefined {
    if (!runState) return undefined;

    for (const node of WORKFLOW_NODES) {
        const state = runState.nodes[node.id];
        if (state?.status === 'running' || state?.status === 'queued') {
            return node.id;
        }
    }

    for (let i = WORKFLOW_NODES.length - 1; i >= 0; i--) {
        const node = WORKFLOW_NODES[i];
        const state = runState.nodes[node.id];
        if (state?.status === 'failed' || state?.status === 'completed') {
            return node.id;
        }
    }

    return WORKFLOW_NODES[0]?.id;
}

function labelForNode(nodeId: string, lang: Lang): string {
    const match = WORKFLOW_NODES.find((node) => node.id === nodeId);
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

export default WorkflowPanel;
