/**
 * cognitive/index.ts — 认知架构模块统一导出
 *
 * runtime.ts 通过此文件访问所有认知能力，保持依赖方向清晰：
 *   runtime.ts → cognitive/index.ts → 各实现文件
 */

export type { McpBlackboard, McpResource, McpResourceDescriptor } from './blackboard.js'
export { InMemoryMcpBlackboard, ResourceNotFoundError, ResourceTooLargeError } from './blackboard.js'

export type { TaskIntent, RouterPolicy, RouterDecision, ToolManifest, ModelCapability, RouteConstraints } from './router.js'
export {
  DefaultRouterPolicy,
  DynamicRouterPolicy,
  READ_ONLY_MANIFEST,
  READ_WRITE_MANIFEST,
  READ_ONLY_TOOLS,
  READ_WRITE_TOOLS,
  assertToolAllowed,
  ToolAccessViolationError,
} from './router.js'

export type { RacingCandidate, RacingResult, RacingExecutor, RaceTelemetry, RaceCandidateTelemetry, RaceCandidateOutcome } from './racing.js'
export { DefaultRacingExecutor, AllCandidatesFailedError } from './racing.js'

export type {
  VirtualFileSystem,
  FileDiff,
  LspDiagnostic,
  LspDiagnosticsProvider,
  ReflexionVerdict,
  ReflexionStepRecord,
} from './reflexion.js'
export {
  InMemoryVirtualFileSystem,
  NoopLspDiagnosticsProvider,
  DefaultReflexionStateMachine,
  ReflexionFailedError,
} from './reflexion.js'

export type { ArkTsLspProviderOptions } from './arkts-lsp-provider.js'
export { ArkTsLspProvider, LspInitializationError, LspDisposedError } from './arkts-lsp-provider.js'

export type { BugFixEpisode, EpisodicStats } from './memory.js'
export { EpisodicMemoryStore, formatEpisodesForPrompt } from './memory.js'

export type { RedTeamFinding, RedTeamVerdict, RedTeamCritic, RedTeamWorkerExecutor } from './red-team.js'
export { NoopRedTeamCritic, LlmRedTeamCritic } from './red-team.js'

export type { PeerDescriptor, DraftDescriptor, Draft, SwarmMesh } from './swarm-mesh.js'
export {
  InMemorySwarmMesh,
  NoopSwarmMesh,
  MicroMcpServer,
  MicroMcpClient,
  generateSocketPath,
  buildPeerDiscoveryPrompt,
} from './swarm-mesh.js'
