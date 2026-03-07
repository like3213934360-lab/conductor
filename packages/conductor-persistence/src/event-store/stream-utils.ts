/**
 * Conductor AGC — JSONL 流式读写工具
 *
 * 提供 append-only JSONL 文件的原子写入和流式读取能力。
 *
 * 设计参考:
 * - Kafka log-structured storage: 追加写入 + 偏移读取
 * - Greg Young EventStoreDB: stream-per-aggregate append-only
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

/**
 * 原子追加 JSONL 行到文件
 *
 * 使用 O_APPEND + fsync 保证追加写入的持久性和原子性。
 * POSIX 保证 <= PIPE_BUF (4096) 的追加写入是原子的。
 */
export async function appendJsonlLines(
  filePath: string,
  lines: string[],
): Promise<void> {
  // 确保目录存在
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })

  // 构造追加内容（每行一个 JSON + 换行符）
  const content = lines.map(l => l + '\n').join('')

  // 使用文件描述符: O_WRONLY + O_APPEND + O_CREAT
  const fd = await fs.promises.open(filePath, 'a')
  try {
    await fd.write(content)
    // fsync 确保数据落盘（不仅仅是 OS 缓冲区）
    await fd.datasync()
  } finally {
    await fd.close()
  }
}

/**
 * 流式读取 JSONL 文件，返回 AsyncIterable
 *
 * O(1) 内存消费，逐行解析 JSON。
 * 对损坏的行（崩溃导致的截断写入）跳过并记录警告。
 */
export async function* readJsonlStream<T>(
  filePath: string,
  options?: {
    /** 跳过前 N 行（用于 fromVersion 过滤） */
    skipLines?: number
    /** 可选的解析校验函数 */
    validator?: (parsed: unknown) => T
  },
): AsyncIterable<T> {
  // 检查文件是否存在
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
  } catch {
    return // 文件不存在，空流
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  let lineNumber = 0
  const skipLines = options?.skipLines ?? 0

  for await (const line of rl) {
    lineNumber++
    if (lineNumber <= skipLines) continue
    if (line.trim() === '') continue

    try {
      const parsed = JSON.parse(line) as unknown
      if (options?.validator) {
        yield options.validator(parsed)
      } else {
        yield parsed as T
      }
    } catch {
      // 崩溃恢复: 跳过损坏行（截断写入）
      console.warn(`[JSONL] 第 ${lineNumber} 行解析失败，跳过（可能是截断写入）: ${filePath}`)
    }
  }
}

/**
 * 读取 JSONL 文件的最后一行
 *
 * 用于快速获取当前版本号，无需读取整个文件。
 * 从文件尾部反向搜索最后一个有效 JSON 行。
 *
 * P1 修复: 缓冲区从 8KB 扩大到 64KB，
 * 超过 64KB 时回退到全文件逐行扫描，
 * 避免 RUN_CONTEXT_CAPTURED 超过缓冲区导致版本号误判。
 */
export async function readLastJsonlLine<T>(filePath: string): Promise<T | null> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
  } catch {
    return null
  }

  const stat = await fs.promises.stat(filePath)
  if (stat.size === 0) return null

  // 策略: 先尝试尾部 64KB，失败则回退到全文件扫描
  const TAIL_SIZE = 65536
  const bufSize = Math.min(TAIL_SIZE, stat.size)
  const buffer = Buffer.alloc(bufSize)

  const fd = await fs.promises.open(filePath, 'r')
  try {
    await fd.read(buffer, 0, bufSize, stat.size - bufSize)
    const content = buffer.toString('utf-8')

    // 找到最后一个有效行
    const lines = content.split('\n').filter(l => l.trim() !== '')
    if (lines.length === 0) return null

    // 尝试从尾部解析（最后 3 行，容忍截断写入）
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
      try {
        return JSON.parse(lines[i]!) as T
      } catch {
        // 截断行，尝试前一行
      }
    }

    // 尾部 64KB 内没有有效 JSON 行，回退全文件扫描
    if (stat.size > TAIL_SIZE) {
      return await fallbackFullScan<T>(filePath)
    }

    return null
  } finally {
    await fd.close()
  }
}

/** 全文件扫描回退（仅在尾部快速读取失败时使用） */
async function fallbackFullScan<T>(filePath: string): Promise<T | null> {
  let last: T | null = null
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    if (line.trim() === '') continue
    try {
      last = JSON.parse(line) as T
    } catch {
      // 跳过损坏行
    }
  }
  return last
}

/**
 * 获取 JSONL 文件行数
 */
export async function countJsonlLines(filePath: string): Promise<number> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK)
  } catch {
    return 0
  }

  let count = 0
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    if (line.trim() !== '') count++
  }

  return count
}
