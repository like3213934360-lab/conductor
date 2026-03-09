/**
 * Conductor Hub Core — Prompt 模板系统 (Prompt Template System)
 *
 * AGC v8.0: 消除手工 prompt 构造 — 模板强制必填字段 + 自动估算 token。
 *
 * 设计参考:
 * - DSPy Signatures: 声明式 prompt 定义
 * - Anthropic Tool Use: 结构化输入/输出
 */

import type { PromptTemplateId } from './model-constraints.js'
import { promptTemplateId } from './model-constraints.js'

// ── 模板规范 ──────────────────────────────────────────────────────────────────

export interface RenderedPrompt {
  /** 模板 ID */
  templateId: PromptTemplateId
  /** system prompt (可选) */
  system?: string
  /** user prompt */
  user: string
  /** 估算 token 数 */
  estimatedTokens: number
}

export interface TemplateSpec {
  /** 模板 ID */
  id: PromptTemplateId
  /** 必填字段名列表 */
  required: readonly string[]
  /** 渲染函数 */
  render(fields: Record<string, string | string[]>): RenderedPrompt
}

// ── Token 估算 ────────────────────────────────────────────────────────────────

/**
 * 简易 Token 估算 (4 字符 ≈ 1 token, 中文 2 字符 ≈ 1 token)
 *
 * 生产环境应替换为 tiktoken 或模型原生 tokenizer。
 */
export function estimateTokens(text: string): number {
  // ASCII 字符按 4:1, 非 ASCII (中文等) 按 2:1
  let asciiCount = 0
  let nonAsciiCount = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 127) {
      asciiCount++
    } else {
      nonAsciiCount++
    }
  }
  return Math.ceil(asciiCount / 4 + nonAsciiCount / 2)
}

// ── 预定义模板 ────────────────────────────────────────────────────────────────

/**
 * Codex 文件分析模板
 *
 * 必填: role, files, task, format, limit
 */
const codexFileTask: TemplateSpec = {
  id: promptTemplateId('codex_file_task'),
  required: ['role', 'files', 'task', 'limit'],
  render(fields) {
    const role = asString(fields.role)
    const files = asStringArray(fields.files)
    const task = asString(fields.task)
    const format = asString(fields.format ?? 'structured analysis')
    const limit = asString(fields.limit ?? '400')

    const fileList = files.map(f => `- ${f}`).join('\n')
    const user = [
      `${role}`,
      '',
      'Read the following files:',
      fileList,
      '',
      `Task: ${task}`,
      '',
      `Output format: ${format}`,
      `Max words: ${limit}`,
    ].join('\n')

    return {
      templateId: codexFileTask.id,
      user,
      estimatedTokens: estimateTokens(user),
    }
  },
}

/**
 * Gemini 研究分析模板
 *
 * 必填: role, files, task
 */
const geminiReview: TemplateSpec = {
  id: promptTemplateId('gemini_review'),
  required: ['role', 'files', 'task'],
  render(fields) {
    const role = asString(fields.role)
    const files = asStringArray(fields.files)
    const task = asString(fields.task)
    const format = asString(fields.format ?? 'detailed analysis')
    const limit = asString(fields.limit ?? '600')

    const fileList = files.map(f => `- ${f}`).join('\n')
    const user = [
      `${role}`,
      '',
      'Read ALL of the following files:',
      fileList,
      '',
      `Task: ${task}`,
      '',
      `Output format: ${format}`,
      `Max words: ${limit}`,
    ].join('\n')

    return {
      templateId: geminiReview.id,
      user,
      estimatedTokens: estimateTokens(user),
    }
  },
}

/**
 * DeepSeek 仲裁辩论模板
 *
 * 必填: role, context, task
 */
const deepseekArbitration: TemplateSpec = {
  id: promptTemplateId('deepseek_arbitration'),
  required: ['role', 'context', 'task'],
  render(fields) {
    const role = asString(fields.role)
    const context = asString(fields.context)
    const task = asString(fields.task)
    const limit = asString(fields.limit ?? '500')

    const user = [
      `${role}`,
      '',
      context,
      '',
      `Task: ${task}`,
      `Max words: ${limit}`,
    ].join('\n')

    return {
      templateId: deepseekArbitration.id,
      user,
      estimatedTokens: estimateTokens(user),
    }
  },
}

// ── 模板注册表 ────────────────────────────────────────────────────────────────

const TEMPLATE_REGISTRY = new Map<string, TemplateSpec>([
  [codexFileTask.id, codexFileTask],
  [geminiReview.id, geminiReview],
  [deepseekArbitration.id, deepseekArbitration],
])

/**
 * 获取模板
 */
export function getTemplate(templateId: PromptTemplateId): TemplateSpec | undefined {
  return TEMPLATE_REGISTRY.get(templateId)
}

/**
 * 使用模板渲染 prompt
 *
 * @throws 如果缺少必填字段
 */
export function renderPrompt(
  templateId: PromptTemplateId,
  fields: Record<string, string | string[]>,
): RenderedPrompt {
  const template = TEMPLATE_REGISTRY.get(templateId)
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  // 验证必填字段
  const missing = template.required.filter(f => !(f in fields))
  if (missing.length > 0) {
    throw new Error(`Template ${templateId} missing required fields: ${missing.join(', ')}`)
  }

  return template.render(fields)
}

/**
 * 注册自定义模板
 */
export function registerTemplate(template: TemplateSpec): void {
  TEMPLATE_REGISTRY.set(template.id, template)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function asString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join(', ')
  return v ?? ''
}

function asStringArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return [v]
  return []
}
