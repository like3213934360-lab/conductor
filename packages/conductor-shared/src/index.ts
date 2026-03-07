/**
 * Conductor AGC — conductor-shared 包入口
 *
 * 统一导出所有类型、Schema 和工具函数。
 */

// 基础类型原语
export * from './types/primitives.js'

// Zod Schema
export * from './schema/graph.js'
export * from './schema/run.js'
export * from './schema/risk.js'
export * from './schema/compliance.js'
export * from './schema/checkpoint.js'
export * from './schema/event.js'

// AGCState 与投影器
export * from './state/agc-state.js'
export * from './state/projector.js'

// 错误处理
export * from './errors/error-codes.js'
export * from './errors/agc-error.js'

// Reflexion 类型 — 架构优化: 消除 core→persistence 循环依赖
export * from './schema/reflexion.js'
