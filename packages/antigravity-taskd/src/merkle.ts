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
  const data = salt
    ? `${salt}:${JSON.stringify(item)}`  // 绑定 jobId 防重放
    : JSON.stringify(item)
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
