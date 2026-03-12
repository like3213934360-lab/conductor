/**
 * Antigravity Workflow Runtime — antigravity-core 包入口
 */

// 接口契约
export * from './contracts/event-store.js'
export * from './contracts/checkpoint-store.js'
export * from './contracts/logger.js'
export * from './contracts/model-executor.js'
export * from './contracts/workflow-agent-runtime.js'

// DAG 引擎
export * from './dag/topology.js'
export * from './dag/dag-engine.js'
export {
  StateInvariantVerifier,
  InvariantViolationError,
  type TransitionProperty,
} from './dag/formal-verifier.js'
export {
  BoundedModelChecker,
  DEFAULT_MODEL_CHECK_CONFIG,
  type ModelCheckConfig,
  type ModelCheckResult,
  type Violation,
  type StateSnapshot,
} from './dag/model-checker.js'

// 风险路由
export * from './risk/dr-calculator.js'
export * from './risk/risk-router.js'

// 治理引擎 — Workflow Runtime vNext GaaS (Governance-as-a-Service)
export * from './governance/index.js'

// Event Sourcing
export * from './event-sourcing/upcasting.js'

// Reflexion Actor
export * from './reflexion/actor-loop.js'

// Federation — A2A / swarm routing
export * from './federation/agent-card.js'
export * from './federation/handoff-protocol.js'

// 并发控制
export * from './concurrency/async-mutex.js'
