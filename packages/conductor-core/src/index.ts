/**
 * Conductor AGC — conductor-core 包入口
 *
 * Phase 3: 新增插件系统导出
 */

// 接口契约
export * from './contracts/event-store.js'
export * from './contracts/checkpoint-store.js'
export * from './contracts/logger.js'
export * from './contracts/model-executor.js'

// DAG 引擎
export * from './dag/topology.js'
export * from './dag/dag-engine.js'

// 风险路由
export * from './risk/dr-calculator.js'
export * from './risk/risk-router.js'

// 治理引擎 — AGC v8.0 GaaS (Governance-as-a-Service)
export * from './governance/index.js'

// 策略引擎 (基于 DSL 的策略编译/执行)
export * from './compliance/policy-types.js'
export * from './compliance/policy-compiler.js'
export * from './compliance/policy-runtime.js'

// 插件系统 — Phase 3 新增
export * from './plugin/plugin-types.js'
export * from './plugin/hook-bus.js'
export * from './plugin/plugin-context.js'
export * from './plugin/plugin-manager.js'
export * from './plugin/capability-sandbox.js'

// Event Sourcing — Phase 4 新增
export * from './event-sourcing/upcasting.js'

// Reflexion Actor — Phase 4 新增
export * from './reflexion/actor-loop.js'

// 应用服务
export * from './application/agc-service.js'
export * from './application/conductor-runtime.js'

// 并发控制 — 三模型建议 1 新增
export * from './concurrency/async-mutex.js'
