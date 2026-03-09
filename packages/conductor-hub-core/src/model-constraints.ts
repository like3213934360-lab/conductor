/**
 * Conductor Hub Core — 模型约束注册表 (Model Constraint Registry)
 *
 * AGC v8.0: 代码级强制 — 调度规则不经过 LLM，而是在类型系统层面拦截。
 *
 * 设计参考:
 * - DSPy Signatures (Stanford): 高层声明式约束
 * - OpenAI Agents SDK: 结构化 Tool Definition
 * - OPA/Rego: 声明式策略即代码
 */

// ── Branded Types (类型安全标识) ──────────────────────────────────────────────

declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type ModelId = Brand<string, 'ModelId'>
export type AbsPath = Brand<string, 'AbsPath'>
export type PromptTemplateId = Brand<string, 'PromptTemplateId'>
export type NonEmptyArray<T> = readonly [T, ...T[]]

export function modelId(id: string): ModelId { return id as ModelId }
export function absPath(path: string): AbsPath { return path as AbsPath }
export function promptTemplateId(id: string): PromptTemplateId { return id as PromptTemplateId }

// ── 子任务执行器类型 ──────────────────────────────────────────────────────────

export type ExecutorKind = 'codex' | 'gemini' | 'ask' | 'multi_ask' | 'consensus'

// ── 模型约束定义 ──────────────────────────────────────────────────────────────

export interface ModelConstraint {
  /** 模型标识 */
  model: ModelId
  /** 执行器类型 */
  executor: ExecutorKind
  /** 最大 prompt token 数 (超过必须分实例) */
  maxPromptTokens: number
  /** 最大输出 token 数 */
  maxOutputTokens?: number
  /** 是否必须提供文件路径 (Codex = true) */
  requiresFilePaths: boolean
  /** 是否支持多实例并行 */
  supportsParallelInstances: boolean
  /** 每实例最大文件数 */
  maxFilesPerInstance?: number
  /** 支持的分区轴 */
  partitionAxes: readonly ('file' | 'directory' | 'token_budget' | 'dimension')[]
  /** 最佳擅长领域 */
  bestFor: readonly string[]
  /** 超时阈值 (ms) */
  timeoutMs: number
}

// ── 预定义约束注册表 ──────────────────────────────────────────────────────────

/**
 * 模型约束注册表 — 硬编码的确定性规则
 *
 * 这些约束不经过 LLM 解释，在 TypeScript 编译时和运行时双重强制。
 */
export const MODEL_CONSTRAINTS: Record<string, ModelConstraint> = {
  codex: {
    model: modelId('codex'),
    executor: 'codex',
    maxPromptTokens: 800,
    requiresFilePaths: true,
    supportsParallelInstances: true,
    maxFilesPerInstance: 5,
    partitionAxes: ['file', 'directory', 'token_budget'],
    bestFor: ['code_analysis', 'file_reading', 'diff_generation', 'refactoring'],
    timeoutMs: 120_000,
  },
  gemini: {
    model: modelId('gemini'),
    executor: 'gemini',
    maxPromptTokens: 4000,
    requiresFilePaths: false,
    supportsParallelInstances: true,
    maxFilesPerInstance: 10,
    partitionAxes: ['dimension', 'token_budget'],
    bestFor: ['reasoning', 'research', 'synthesis', 'architecture'],
    timeoutMs: 180_000,
  },
  deepseek: {
    model: modelId('deepseek'),
    executor: 'ask',
    maxPromptTokens: 2000,
    requiresFilePaths: false,
    supportsParallelInstances: false,
    partitionAxes: ['dimension'],
    bestFor: ['math_reasoning', 'code_review', 'arbitration', 'debate'],
    timeoutMs: 60_000,
  },
}

/**
 * 解析模型约束
 *
 * @param modelKey 模型键名 (codex/gemini/deepseek)
 * @returns 约束对象，或 null (未知模型)
 */
export function resolveConstraint(modelKey: string): ModelConstraint | null {
  return MODEL_CONSTRAINTS[modelKey.toLowerCase()] ?? null
}

/**
 * 判断路径是否为绝对路径
 */
export function isAbsolutePath(path: string): path is string & AbsPath {
  return path.startsWith('/')
}

/**
 * 验证并转换为 AbsPath
 * @throws 如果路径不是绝对路径
 */
export function ensureAbsPath(path: string): AbsPath {
  if (!isAbsolutePath(path)) {
    throw new Error(`路径必须是绝对路径: ${path}`)
  }
  return absPath(path)
}
