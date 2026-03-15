/**
 * merkle.ts — Shard 完整性证明 (Merkle Tree)
 *
 * 将所有 ShardOutcome 的哈希构建为 Merkle Tree，
 * 在 SHARD→AGGREGATE 转换点用 root 验证无数据被篡改。
 */
import * as crypto from 'node:crypto'

// ── 类型定义 ────────────────────────────────────────────────────

export interface MerkleNode {
  hash: string
  left?: MerkleNode
  right?: MerkleNode
  shardId?: string   // 叶子节点
}

export interface MerkleProof {
  root: string
  leafCount: number
  proof: Array<{ hash: string; position: 'left' | 'right' }>
}

// ── 工具函数 ────────────────────────────────────────────────────

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

// ── 确定性 JSON 序列化 ───────────────────────────────────────────────────────────────
//
// JavaScript 引擎不保证 Object key 迭代顺序，且不同 Node.js 版本枚举顺序可能不同。
// JSON.stringify({"code":"a","id":1}) 和 JSON.stringify({"id":1,"code":"a"})
// 在逻辑上完全等价，但 SHA-256 完全不同。
// 导致：
//  - Merkle 树溭男 "False Cache Miss"（相同数据不同哈希）
//  - SLSA 供应链签名堡垓失败
//
// 输入类型限制：只应该传入可序列化的中间层（不包含 undefined / Function / Symbol）。
// 如果遇到不支持的值，序列化为 null（与JSON.stringify行为一致）。

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function deterministicStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(deterministicStringify).join(',') + ']'
  }
  if (typeof value === 'object') {
    // 排序 keys 保证确定性
    const keys = Object.keys(value as object).sort()
    const pairs = keys.map(k =>
      `${JSON.stringify(k)}:${deterministicStringify((value as Record<string, unknown>)[k])}`
    )
    return '{' + pairs.join(',') + '}'
  }
  // Function / Symbol / undefined → null（与JSON.stringify行为一致）
  return 'null'
}

function hashPair(left: string, right: string): string {
  // 保证拼接顺序一致：小的在前
  const ordered = left < right ? left + right : right + left
  return sha256(ordered)
}

// ── 哈希提取（任何带 shardId 的对象均可） ─────────────────────

export interface Hashable {
  shardId: string
}

function leafHash(item: Hashable, salt?: string): string {
  // 关键：必须用 deterministicStringify 而非 JSON.stringify
  // 确保不同 Node.js版本 / 不同 Worker 返回相同对象时哈希一致
  const serialized = deterministicStringify(item)
  const data = salt ? `${salt}:${serialized}` : serialized
  return sha256(data)
}

// ── Merkle Tree 构建 ────────────────────────────────────────────

/**
 * @param items  带 shardId 的对象数组
 * @param salt   防重放盐值（建议传入 jobId），不同 salt 产生不同的树
 */
export function buildMerkleTree(items: Hashable[], salt?: string): MerkleNode {
  if (items.length === 0) {
    return { hash: sha256('empty') }
  }

  // 构建叶子层
  let nodes: MerkleNode[] = items.map(item => ({
    hash: leafHash(item, salt),
    shardId: item.shardId,
  }))

  // 奇数叶子时复制最后一个
  if (nodes.length % 2 !== 0) {
    nodes.push({ ...nodes[nodes.length - 1] })
  }

  // 自底向上构建
  while (nodes.length > 1) {
    const next: MerkleNode[] = []
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i]
      const right = nodes[i + 1] ?? left
      next.push({
        hash: hashPair(left.hash, right.hash),
        left,
        right,
      })
    }
    nodes = next
  }

  return nodes[0]
}

/**
 * @param salt  防重放盐值（建议传入 jobId）
 */
export function computeMerkleRoot(items: Hashable[], salt?: string): string {
  return buildMerkleTree(items, salt).hash
}

export function generateMerkleProof(
  items: Hashable[],
  targetShardId: string,
  salt?: string,
): MerkleProof | null {
  const tree = buildMerkleTree(items, salt)
  const proof: MerkleProof['proof'] = []

  function walk(node: MerkleNode): boolean {
    if (node.shardId === targetShardId) return true
    if (!node.left || !node.right) return false

    if (walk(node.left)) {
      proof.push({ hash: node.right.hash, position: 'right' })
      return true
    }
    if (walk(node.right)) {
      proof.push({ hash: node.left.hash, position: 'left' })
      return true
    }
    return false
  }

  if (!walk(tree)) return null

  return {
    root: tree.hash,
    leafCount: items.length,
    proof,
  }
}

export function verifyMerkleProof(proof: MerkleProof, leafHashValue: string): boolean {
  let current = leafHashValue
  for (const step of proof.proof) {
    current = step.position === 'right'
      ? hashPair(current, step.hash)
      : hashPair(step.hash, current)
  }
  return current === proof.root
}
