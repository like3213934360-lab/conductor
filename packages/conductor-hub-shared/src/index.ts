/**
 * Conductor Hub Shared — barrel export
 */

// 模型注册表
export { TASK_TYPES, MODEL_REGISTRY, PROVIDER_GROUPS, getModelsInGroup } from './model-registry.js'
export type { TaskId, ModelDefinition } from './model-registry.js'

// 共享类型
export {
    LEGACY_PROVIDERS,
    TASK_KEYWORDS,
} from './types.js'
export type {
    ModelConfig,
    ConductorHubConfig,
    RouteResult,
    ProviderCallResult,
    ProviderCallResultWithFallback,
    MultiAskResult,
    ConsensusCandidate,
    ConsensusResult,
    RequestRecord,
    FileContextResult,
} from './types.js'
