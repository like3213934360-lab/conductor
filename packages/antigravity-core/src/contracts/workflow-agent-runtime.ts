/**
 * Antigravity Workflow Runtime — WorkflowAgentRuntime 契约接口
 *
 * ⚠️ 向后兼容性保留 — 实际定义已下沉至 @anthropic/antigravity-model-shared
 * 打破了 model-core→core 的反向依赖循环。
 *
 * 新代码请直接 import from '@anthropic/antigravity-model-shared'
 */
export type {
  WorkflowAgentRuntime,
  WorkflowAskResult,
  WorkflowConsensusResult,
} from '@anthropic/antigravity-model-shared'
