/**
 * Conductor Hub — 共享类型定义
 *
 * 从 Conductor Hub mcp-server.ts / settings.ts 提取的核心接口
 */

// ── 模型配置 (v2) ─────────────────────────────────────────────────────────────

/** 用户配置的模型实例 */
export interface ModelConfig {
    /** 唯一标识 (UUID) */
    id: string;
    /** 模型 ID (对应 MODEL_REGISTRY 的 key，如 "deepseek-chat") */
    modelId: string;
    /** 显示名称 */
    label: string;
    /** API Base URL */
    baseUrl: string;
    /** 分配的任务类型 ID 列表 */
    tasks: string[];
    /** 是否启用 */
    enabled: boolean;
    /** 优先级 (数值越小优先级越高) */
    priority: number;
    /** API Key (仅在运行时注入，不持久化到 JSON) */
    apiKey?: string;
}

// ── Conductor Hub 配置文件 (~/.conductor-hub-keys.json) ─────────────────────────────────────

export interface ConductorHubConfig {
    version?: number;
    models?: ModelConfig[];
    legacy?: Record<string, string>;
    dbPath?: string;
}

// ── 路由结果 ──────────────────────────────────────────────────────────────────

export interface RouteResult {
    label: string;
    apiKey: string;
    baseUrl: string;
    modelId: string;
}

// ── API 调用结果 ──────────────────────────────────────────────────────────────

export interface ProviderCallResult {
    text: string;
    inputTokens: number;
    outputTokens: number;
}

export interface ProviderCallResultWithFallback extends ProviderCallResult {
    usedModel: string;
    didFallback: boolean;
}

// ── 多模型查询结果 ────────────────────────────────────────────────────────────

export interface MultiAskResult {
    provider: string;
    text?: string;
    error?: string;
    duration?: number;
    tokens?: number;
}

// ── 共识引擎 ──────────────────────────────────────────────────────────────────

export interface ConsensusCandidate {
    label: string;
    text: string;
}

export interface ConsensusResult {
    judgeText: string;
    judgeModel: string;
    candidates: ConsensusCandidate[];
    totalMs: number;
}

// ── 请求历史记录 ──────────────────────────────────────────────────────────────

export interface RequestRecord {
    id: string;
    timestamp: number;
    clientName: string;
    clientVersion?: string;
    method: string;
    toolName?: string;
    model?: string;
    duration: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    requestPreview: string;
    responsePreview: string;
    status: 'success' | 'error';
    errorMessage?: string;
}

// ── 文件上下文 ────────────────────────────────────────────────────────────────

export interface FileContextResult {
    context: string;
    warnings: string[];
}

// ── Legacy 兼容 ───────────────────────────────────────────────────────────────

export const LEGACY_PROVIDERS: Record<string, { url: string; model: string }> = {
    glm: { url: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'glm-5' },
    deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-max' },
    minimax: { url: 'https://api.minimax.io/v1', model: 'MiniMax-M2.5-highspeed' },
    kimi: { url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-auto' },
    gpt: { url: 'https://api.openai.com/v1', model: 'gpt-5.3-codex' },
    gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.1-pro-preview' },
    mistral: { url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
};

// ── 关键字路由表 ──────────────────────────────────────────────────────────────

export const TASK_KEYWORDS: Record<string, string[]> = {
    code_gen: ['code', 'write function', 'implement', 'snippet', '代码', '编写', '实现'],
    code_review: ['review', 'debug', 'fix bug', 'refactor', 'lint', '审查', '调试', '重构'],
    architecture: ['architecture', 'design pattern', 'system design', 'diagram', '架构', '设计'],
    documentation: ['document', 'comment', 'readme', 'explain', '注释', '文档'],
    translation: ['translate', 'translation', 'localize', '翻译', '本地化'],
    ui_design: ['ui', 'frontend', 'css', 'component', 'layout', '前端', '组件', '样式'],
    long_context: ['summarize', 'long document', 'file content', '长文本', '总结'],
    math_reasoning: ['math', 'equation', 'calculate', 'proof', 'algorithm', '数学', '计算', '推理'],
    tool_calling: ['function call', 'api integration', 'tool use'],
    creative: ['write story', 'essay', 'creative', '创意', '写作'],
    agentic: ['agent', 'automate', 'autonomous task', '自动化'],
};
