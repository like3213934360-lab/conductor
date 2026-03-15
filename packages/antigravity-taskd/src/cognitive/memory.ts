/**
 * memory.ts — 跨任务经验记忆体 (Episodic Memory Store)
 *
 * RFC-026 Phase 1: 本地经验记忆库
 *
 * 核心能力：
 *  - JSONL Append-only 持久化：每条 episode 追加到 .jsonl 文件
 *  - 启动时全量加载 + MiniSearch BM25 索引
 *  - SCOUT 阶段 recall: 检索相关历史 Bug→Fix 轨迹，注入 Few-Shot Prompt
 *  - WRITE 阶段 record: 保存成功的 Bug→Fix 经验
 *
 * 防御红线：
 *  ① 100% 纯 JS — 零原生依赖，JSONL + MiniSearch
 *  ② Token 熔断 — recallRelevant 严格截断，防止历史记忆撑爆 Prompt
 *  ③ 文件系统安全 — Append-only 写入，启动时容错加载
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import MiniSearch from 'minisearch'

// ── 类型定义 ──────────────────────────────────────────────────────────────────

/** 一次完整的"犯错→修复"情景轨迹 */
export interface BugFixEpisode {
  episodeId: string
  runId: string
  /** 原始 LSP 诊断 + Red Team findings */
  diagnostics: Array<{
    source: 'lsp' | 'red_team' | 'property_checker'
    file: string
    line: number
    message: string
  }>
  /** 蓝方的最终正确 Diff */
  correctDiff: string
  /** 涉及的文件路径 */
  filePaths: string[]
  /** 涉及的符号名 */
  symbols: string[]
  /** 关键词（用于 BM25 全文检索） */
  keywords: string[]
  createdAt: string
}

/** 统计信息 */
export interface EpisodicStats {
  totalEpisodes: number
  topErrorFiles: Array<{ file: string; count: number }>
  topErrorPatterns: Array<{ pattern: string; count: number }>
}

// ── MiniSearch 文档类型 ───────────────────────────────────────────────────────

interface SearchDocument {
  id: string
  /** 合并 keywords + filePaths + symbols 的全文检索字段 */
  text: string
  /** 诊断消息汇总 */
  diagnosticText: string
}

// ── 常量 ─────────────────────────────────────────────────────────────────────

/** 默认 Token 估算：1 token ≈ 4 chars（保守估计） */
const CHARS_PER_TOKEN = 4
/** 默认最大返回条目 */
const DEFAULT_TOP_K = 5
/** 默认 Token 预算 */
const DEFAULT_MAX_TOKENS = 4_000
/** 单条 episode 序列化后的最大字符数（防止巨型 diff 撑爆） */
const MAX_EPISODE_CHARS = 8_000
/** JSONL 文件名 */
const EPISODES_FILENAME = 'episodic-memory.jsonl'
/** 归档文件名 */
const EPISODES_ARCHIVE_FILENAME = 'episodic-memory.archive.jsonl'
/** 内存中最多保留的 episode 数（LRU 淘汰上限） */
const MAX_EPISODES = 1_000
/** JSONL 文件大小上限（超过触发日志轮转） */
const MAX_FILE_BYTES = 50 * 1024 * 1024  // 50MB

// ── 实现 ─────────────────────────────────────────────────────────────────────

export class EpisodicMemoryStore {
  private readonly filePath: string
  private readonly episodes = new Map<string, BugFixEpisode>()
  private readonly index: MiniSearch<SearchDocument>

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true })
    this.filePath = path.join(dataDir, EPISODES_FILENAME)
    this.index = new MiniSearch<SearchDocument>({
      fields: ['text', 'diagnosticText'],
      storeFields: ['id'],
      searchOptions: {
        boost: { text: 2, diagnosticText: 1 },
        fuzzy: 0.2,
        prefix: true,
      },
    })
    this.loadFromDisk()
  }

  /**
   * WRITE 成功后：保存 Bug→Fix 轨迹。
   * Append-only 写入 JSONL + 更新内存索引。
   */
  recordEpisode(episode: BugFixEpisode): void {
    // 生成 ID（如果没有）
    if (!episode.episodeId) {
      episode.episodeId = crypto.randomUUID()
    }
    if (!episode.createdAt) {
      episode.createdAt = new Date().toISOString()
    }

    // 截断超大 diff（防止 JSONL 单行膨胀）
    if (episode.correctDiff.length > MAX_EPISODE_CHARS) {
      episode.correctDiff = episode.correctDiff.slice(0, MAX_EPISODE_CHARS) + '\n…[TRUNCATED]'
    }

    // 🛡️ LRU 淘汰：内存上限防线
    if (this.episodes.size >= MAX_EPISODES) {
      this.evictOldest()
    }

    // 内存存储
    this.episodes.set(episode.episodeId, episode)

    // MiniSearch 索引
    this.indexEpisode(episode)

    // JSONL Append-only 持久化
    try {
      const line = JSON.stringify(episode) + '\n'
      fs.appendFileSync(this.filePath, line, 'utf8')

      // 🛡️ 文件大小统计（懒加的，仅在写入后检查）
      try {
        const stat = fs.statSync(this.filePath)
        if (stat.size > MAX_FILE_BYTES) {
          this.rotateLogFile()
        }
      } catch { /* 统计失败不阻断 */ }
    } catch (error) {
      // 持久化失败不阻断主流程（内存索引已更新，重启后丢失本条——可接受）
      console.warn(`[memory] Failed to persist episode ${episode.episodeId}: ${error}`)
    }
  }

  /**
   * SCOUT 阶段：检索与当前任务相关的历史修复经验。
   *
   * Token 熔断防线：
   *  1. MiniSearch BM25 排序 → 取 topK
   *  2. 逐条累加 token 估算 → 超过 maxTokens 立即截断
   */
  recallRelevant(
    query: string,
    files: string[] = [],
    topK: number = DEFAULT_TOP_K,
    maxTokens: number = DEFAULT_MAX_TOKENS,
  ): BugFixEpisode[] {
    if (this.episodes.size === 0) return []

    // 构造搜索查询：目标关键词 + 文件路径的 basename
    const searchTerms = [
      query,
      ...files.map(f => path.basename(f, path.extname(f))),
    ].join(' ')

    const results = this.index.search(searchTerms).slice(0, topK * 2) // 多取一些，Token 截断后可能丢弃

    // Token 预算截断
    const matched: BugFixEpisode[] = []
    let usedChars = 0
    const maxChars = maxTokens * CHARS_PER_TOKEN

    for (const hit of results) {
      const episode = this.episodes.get(hit.id)
      if (!episode) continue

      // 估算本条 episode 注入后的 token 消耗
      const episodeChars = this.estimateChars(episode)
      if (usedChars + episodeChars > maxChars && matched.length > 0) {
        // 已超预算且已有至少 1 条结果 → 停止
        break
      }

      matched.push(episode)
      usedChars += episodeChars

      if (matched.length >= topK) break
    }

    return matched
  }

  /** 统计：历史修复成功率、高频易错文件等 */
  stats(): EpisodicStats {
    const fileCounts = new Map<string, number>()
    const patternCounts = new Map<string, number>()

    for (const episode of this.episodes.values()) {
      for (const f of episode.filePaths) {
        fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1)
      }
      for (const d of episode.diagnostics) {
        // 提取错误模式：取消息的前 50 字符作为模式指纹
        const pattern = d.message.slice(0, 50)
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1)
      }
    }

    const topErrorFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }))

    const topErrorPatterns = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }))

    return {
      totalEpisodes: this.episodes.size,
      topErrorFiles,
      topErrorPatterns,
    }
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────────

  /**
   * 启动时从 JSONL 加载 + 重建 MiniSearch 索引。
   *
   * 🛡️ LRU 防 OOM 策略：
   *  1. 先检查文件大小，超过 MAX_FILE_BYTES 先触发日志轮转
   *  2. 只加载最近 MAX_EPISODES 条（尾部截取）
   *  3. 防止 500MB JSONL 擑死 V8 Heap
   */
  private loadFromDisk(): void {
    if (!fs.existsSync(this.filePath)) return

    try {
      // 🛡️ 第一道防线：文件大小检查
      const stat = fs.statSync(this.filePath)
      if (stat.size > MAX_FILE_BYTES) {
        console.warn(`[memory] JSONL file is ${(stat.size / 1024 / 1024).toFixed(1)}MB (> ${MAX_FILE_BYTES / 1024 / 1024}MB), rotating before load`)
        this.rotateLogFile()
      }

      const content = fs.readFileSync(this.filePath, 'utf8')
      const lines = content.split('\n').filter(line => line.trim().length > 0)

      // 🛡️ 第二道防线：只加载最近 MAX_EPISODES 条
      const startIdx = Math.max(0, lines.length - MAX_EPISODES)
      const recentLines = lines.slice(startIdx)
      if (startIdx > 0) {
        console.info(`[memory] Skipped ${startIdx} old episodes, loading only last ${recentLines.length}`)
      }

      const docs: SearchDocument[] = []
      for (const line of recentLines) {
        try {
          const episode = JSON.parse(line) as BugFixEpisode
          if (episode.episodeId) {
            this.episodes.set(episode.episodeId, episode)
            docs.push(this.toSearchDocument(episode))
          }
        } catch {
          // 跳过损坏行（Append-only 天然容错 — 尾部截断只丢最后一条）
          console.warn('[memory] Skipped corrupted JSONL line')
        }
      }

      if (docs.length > 0) {
        this.index.addAll(docs)
      }
      console.info(`[memory] Loaded ${this.episodes.size} episodes from disk`)
    } catch (error) {
      console.warn(`[memory] Failed to load episodes: ${error}`)
    }
  }

  /**
   * 🛡️ 日志轮转：JSONL 超过 50MB 时，归档旧文件，重建新文件。
   * 仅保留最近 MAX_EPISODES 条到新文件。
   */
  private rotateLogFile(): void {
    try {
      const archivePath = this.filePath.replace(EPISODES_FILENAME, EPISODES_ARCHIVE_FILENAME)
      // 归档：覆盖旧归档（只保留一份归档）
      fs.renameSync(this.filePath, archivePath)

      // 重建：将内存中的最近 MAX_EPISODES 条写回新文件
      const recent = [...this.episodes.values()]
        .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
        .slice(-MAX_EPISODES)

      const lines = recent.map(ep => JSON.stringify(ep) + '\n').join('')
      fs.writeFileSync(this.filePath, lines, 'utf8')

      console.info(`[memory] Log rotated: archived old file, kept ${recent.length} recent episodes`)
    } catch (err) {
      console.warn(`[memory] Log rotation failed: ${err}`)
    }
  }

  /**
   * 🛡️ LRU 淘汰：删除最旧的 10% episodes 为新数据腾空间。
   */
  private evictOldest(): void {
    const sorted = [...this.episodes.entries()]
      .sort((a, b) => (a[1].createdAt ?? '').localeCompare(b[1].createdAt ?? ''))
    const evictCount = Math.max(1, Math.floor(MAX_EPISODES * 0.1)) // 淘汰 10%
    const toEvict = sorted.slice(0, evictCount)

    for (const [id] of toEvict) {
      this.episodes.delete(id)
      try { this.index.discard(id) } catch { /* MiniSearch 已删除 */ }
    }
    console.info(`[memory] LRU eviction: removed ${toEvict.length} oldest episodes (remaining: ${this.episodes.size})`)
  }

  /** 将 episode 添加到 MiniSearch 索引 */
  private indexEpisode(episode: BugFixEpisode): void {
    this.index.add(this.toSearchDocument(episode))
  }

  /** 转换为 MiniSearch 搜索文档 */
  private toSearchDocument(episode: BugFixEpisode): SearchDocument {
    return {
      id: episode.episodeId,
      text: [
        ...episode.keywords,
        ...episode.filePaths.map(f => path.basename(f)),
        ...episode.symbols,
      ].join(' '),
      diagnosticText: episode.diagnostics
        .map(d => `${d.file} ${d.message}`)
        .join(' '),
    }
  }

  /** 估算 episode 注入 Prompt 后的字符消耗 */
  private estimateChars(episode: BugFixEpisode): number {
    return (
      episode.correctDiff.length +
      episode.diagnostics.reduce((sum, d) => sum + d.message.length + d.file.length, 0) +
      episode.keywords.join(' ').length +
      100 // XML 包裹开销
    )
  }
}

// ── Prompt 注入辅助函数 ─────────────────────────────────────────────────────

/**
 * 将召回的 episodes 格式化为 XML 标签注入 Prompt。
 * 若无相关历史，返回空字符串（零开销）。
 */
export function formatEpisodesForPrompt(episodes: BugFixEpisode[]): string {
  if (episodes.length === 0) return ''

  const formatted = episodes.map((ep, idx) => {
    const diagLines = ep.diagnostics
      .slice(0, 5) // 最多 5 条诊断
      .map(d => `    [${d.source}] ${d.file}:${d.line} — ${d.message}`)
      .join('\n')

    // Diff 截断到 2000 chars
    const diff = ep.correctDiff.length > 2000
      ? ep.correctDiff.slice(0, 2000) + '\n…[TRUNCATED]'
      : ep.correctDiff

    return [
      `  <episode index="${idx + 1}" runId="${ep.runId}">`,
      `    <diagnostics>`,
      diagLines,
      `    </diagnostics>`,
      `    <fix>`,
      diff,
      `    </fix>`,
      `  </episode>`,
    ].join('\n')
  }).join('\n')

  return [
    '<historical_experience>',
    'The following are past bug-fix experiences relevant to this task.',
    'Use them as reference to avoid repeating the same mistakes.',
    formatted,
    '</historical_experience>',
  ].join('\n')
}
