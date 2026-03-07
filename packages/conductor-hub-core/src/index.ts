/**
 * Conductor Hub Core — barrel export
 */

export { detectTaskType, resolveRoute } from './routing.js';
export { callProvider, callProviderWithFallback, isRetryableError } from './provider-client.js';
export { callCodex, callGemini } from './cli-runners.js';
export { buildFileContext } from './file-context.js';
export { multiAsk, formatMultiAskResults } from './multi-ask.js';
export type { MultiAskOptions } from './multi-ask.js';
export { consensus } from './consensus.js';
export type { ConsensusOptions } from './consensus.js';
export { ConductorHubService } from './conductor-hub-service.js';
export { runParallelTasks, formatParallelResults } from './parallel-executor.js';
export type { SubTask, SubTaskType, SubTaskResult, ParallelExecutionSummary } from './parallel-executor.js';
