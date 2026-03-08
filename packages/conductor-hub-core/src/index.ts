/**
 * Conductor Hub Core — barrel export
 */

export { detectTaskType, resolveRoute } from './routing.js';
export { callProvider, callProviderWithFallback, isRetryableError, getCircuitBreakers } from './provider-client.js';
export { CircuitBreakerRegistry } from './circuit-breaker.js';
export type { CircuitState, CircuitBreakerConfig } from './circuit-breaker.js';
export { Logger, createLogger } from './logger.js';
export type { LogLevel } from './logger.js';
export { callCodex, callGemini } from './cli-runners.js';
export { discoverCliEcosystem, formatEcosystem } from './cli-ecosystem.js';
export type { CliEcosystem, McpServerInfo, ExtensionInfo } from './cli-ecosystem.js';
export { buildFileContext } from './file-context.js';
export { multiAsk, formatMultiAskResults } from './multi-ask.js';
export type { MultiAskOptions } from './multi-ask.js';
export { consensus } from './consensus.js';
export type { ConsensusOptions } from './consensus.js';
export { ConductorHubService, FileConfigLoader } from './conductor-hub-service.js';
export type { ConfigLoader } from './conductor-hub-service.js';
export { runParallelTasks, formatParallelResults } from './parallel-executor.js';
export type { SubTask, SubTaskType, SubTaskResult, ParallelExecutionSummary, ExecutorConfig } from './parallel-executor.js';
export { AGCRunDriver } from './agc-run-driver.js';
export type { DriverTickResult, DrainOptions, AGCRunDriverDeps } from './agc-run-driver.js';
export { ProgressReporter, ScopedReporter } from './progress-reporter.js';
export type { ProgressEvent, ProgressCallback, ProgressPhase } from './progress-reporter.js';
export { AsyncJobManager, formatJobStatus } from './async-job-manager.js';
export type { AsyncJob, JobStatus, JobType, StartJobOptions } from './async-job-manager.js';
export {
  NodeExecutorRegistry,
  AnalyzeExecutor,
  ParallelExecutor,
  DebateExecutor,
  VerifyExecutor,
  SynthesizeExecutor,
  PersistExecutor,
  gapCheck,
} from './node-executor.js';
export type {
  AGCNodeId,
  NodeExecutor,
  NodeExecutionContext,
  NodeExecutionResult,
  TransitionDecision,
  GapCheckResult,
} from './node-executor.js';
// 重导出 NodeRuntimeState 以便 agc-advance 使用
export type { NodeRuntimeState } from '@anthropic/conductor-shared';

