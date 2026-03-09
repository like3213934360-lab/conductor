/**
 * Conductor AGC — 策略编译器 (Policy Compiler)
 *
 * AGC v8.0: 将 PolicyExpr JSON → 纯 TypeScript 谓词函数
 *
 * 安全设计:
 * - 不使用 eval / new Function — 递归遍历表达式树生成闭包
 * - 路径解析使用安全的 lodash-style get (无原型链遍历)
 * - 所有编译时间 O(|expr|)，运行时间 O(|expr| × |data|)
 */

import type { PolicyExpr, PolicyDefinition, CompiledPolicy, CountOp, PolicyValueRef } from './policy-types.js'

// ── 安全路径解析 ──────────────────────────────────────────────────────────────

/**
 * 安全获取嵌套属性值
 *
 * 支持 dot notation: 'state.version', 'graph.nodes'
 * 支持通配符: 'graph.nodes[*].name' → 返回所有节点 name 的数组
 *
 * 安全限制:
 * - 禁止 __proto__, constructor, prototype 路径
 * - 最大路径深度 10
 */
function safeGet(obj: Record<string, unknown>, path: string): unknown {
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
  const parts = path.split('.')
  if (parts.length > 10) return undefined

  let current: unknown = obj
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return undefined
    const part = parts[i]!
    if (FORBIDDEN.has(part.replace(/\[\*\]$/, ''))) return undefined

    // 通配符展开: 'nodes[*]' → 遍历数组
    if (part.endsWith('[*]')) {
      const key = part.slice(0, -3)
      if (!Object.prototype.hasOwnProperty.call(current, key)) return undefined
      const arr = (current as Record<string, unknown>)[key]
      if (!Array.isArray(arr)) return undefined
      // 收集后续路径的所有值
      const restPath = parts.slice(i + 1).join('.')
      if (restPath) {
        return arr.map(item => safeGet(item as Record<string, unknown>, restPath))
      }
      return arr
    }

    // 安全属性访问: 只访问 own properties
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// ── 表达式编译 ────────────────────────────────────────────────────────────────

type Predicate = (ctx: Record<string, unknown>) => boolean

/**
 * 编译单个 PolicyExpr 为谓词函数
 *
 * 递归遍历表达式树，每个节点生成一个闭包。
 * 编译时间 O(|expr|)，运行时间 O(|expr|)。
 */
export function compileExpr(expr: PolicyExpr): Predicate {
  if ('all' in expr) {
    const subs = expr.all.map(compileExpr)
    return (ctx) => subs.every(fn => fn(ctx))
  }

  if ('any' in expr) {
    const subs = expr.any.map(compileExpr)
    return (ctx) => subs.some(fn => fn(ctx))
  }

  if ('not' in expr) {
    const sub = compileExpr(expr.not)
    return (ctx) => !sub(ctx)
  }

  if ('eq' in expr) {
    const [ref, expected] = expr.eq
    return (ctx) => safeGet(ctx, ref) === expected
  }

  if ('gt' in expr) {
    const [ref, threshold] = expr.gt
    return (ctx) => {
      const v = safeGet(ctx, ref)
      return typeof v === 'number' && v > threshold
    }
  }

  if ('lt' in expr) {
    const [ref, threshold] = expr.lt
    return (ctx) => {
      const v = safeGet(ctx, ref)
      return typeof v === 'number' && v < threshold
    }
  }

  if ('gte' in expr) {
    const [ref, threshold] = expr.gte
    return (ctx) => {
      const v = safeGet(ctx, ref)
      return typeof v === 'number' && v >= threshold
    }
  }

  if ('exists' in expr) {
    const ref = expr.exists
    return (ctx) => safeGet(ctx, ref) !== undefined && safeGet(ctx, ref) !== null
  }

  if ('matches' in expr) {
    const [ref, pattern] = expr.matches
    // 预编译正则（编译时，非运行时）
    const regex = new RegExp(pattern)
    return (ctx) => {
      const v = safeGet(ctx, ref)
      return typeof v === 'string' && regex.test(v)
    }
  }

  if ('count' in expr) {
    const [ref, ops] = expr.count
    return (ctx) => {
      const v = safeGet(ctx, ref)
      if (!Array.isArray(v)) return false
      const len = v.length
      return checkCount(len, ops)
    }
  }

  throw new Error(`Unknown PolicyExpr operator: ${JSON.stringify(Object.keys(expr))}`)
}

function checkCount(len: number, ops: CountOp): boolean {
  if (ops.gt !== undefined && !(len > ops.gt)) return false
  if (ops.lt !== undefined && !(len < ops.lt)) return false
  if (ops.eq !== undefined && !(len === ops.eq)) return false
  if (ops.gte !== undefined && !(len >= ops.gte)) return false
  return true
}

// ── 策略编译 ──────────────────────────────────────────────────────────────────

/**
 * 编译单条策略为 CompiledPolicy
 */
export function compilePolicy(def: PolicyDefinition): CompiledPolicy {
  const whenFn = def.when ? compileExpr(def.when) : () => true
  const assertFn = compileExpr(def.assert)

  return {
    source: def,
    when: whenFn,
    assert: assertFn,
  }
}

/**
 * 批量编译策略 Bundle
 *
 * 按 priority 降序排列（高优先级先执行）。
 * 只编译 enabled 的策略。
 */
export function compilePolicyBundle(policies: PolicyDefinition[]): CompiledPolicy[] {
  return policies
    .filter(p => p.enabled)
    .sort((a, b) => b.priority - a.priority)
    .map(compilePolicy)
}
