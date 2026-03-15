/**
 * Antigravity Model Shared — barrel export
 */

// 模型注册表
export { TASK_TYPES, MODEL_REGISTRY, MODEL_FAMILIES, getModelsInFamily } from './model-registry.js'
export type { TaskId, ModelDefinition } from './model-registry.js'

// 共享类型
export {
    TASK_KEYWORDS,
} from './types.js'
export type {
    ModelConfig,
    AntigravityModelConfig,
    RouteResult,
    ModelCallResult,
    ModelCallResultWithFallback,
    MultiAskResult,
    ConsensusCandidate,
    ConsensusResult,
    RequestRecord,
    FileContextResult,
} from './types.js'

// Workflow 运行时契约（从 core 下沉至 model-shared，打破反向依赖）
export type {
    WorkflowAgentRuntime,
    WorkflowAskResult,
    WorkflowConsensusResult,
} from './workflow-agent-runtime.js'
