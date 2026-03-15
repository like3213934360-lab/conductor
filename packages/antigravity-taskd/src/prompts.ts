import type { AggregateAnalysis, ScoutManifest, ShardAnalysis, TaskJobMode, VerifyAnalysis } from './schema.js'

// ── Unicode 安全截断 (Surrogate-Pair Safe) ────────────────────────────────
//
// JavaScript 字符串基于 UTF-16 Code Units。单个 Emoji（如 👨‍👩‍👧‍👦）可能占 11 个 Code Units。
// 直接 str.slice(0, N) 可能切断属か surrograte pair，产生孤立代理符（U+D800–U+DFFF）。
// 孤立代理符进入 LLM Tokenizer 的 C++ 层会导致崩溃或严重解码幻觉。
//
// 策略：优先用 Intl.Segmenter（按 Grapheme Cluster 切）。
//       降级：如不支持，用 Array.from()（按 Code Point 切）。
//       两者均不会切断 代理对，比 .slice() 安全。
//
// 注意：返回的是字符串片段，长度计数单位不同（Grapheme > CodePoint > CodeUnit）。
// 对于多数常规文本，返回结果小于等于 N 个字符。
export function unicodeSafeSlice(str: string, maxCodeUnits: number): string {
  if (str.length <= maxCodeUnits) return str
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    // Intl.Segmenter 按 grapheme cluster 切（最安全）
    // 籍籍累加 UTF-16 长度直到超过 maxCodeUnits
    const segmenter = new Intl.Segmenter()
    let result = ''
    let codeUnits = 0
    for (const { segment } of segmenter.segment(str)) {
      if (codeUnits + segment.length > maxCodeUnits) break
      result += segment
      codeUnits += segment.length
    }
    return result
  }
  // 降级：按 Unicode Code Point 切（Array.from 识别全部 surrogate pair）
  const codePoints = Array.from(str)
  let result = ''
  let codeUnits = 0
  for (const cp of codePoints) {
    if (codeUnits + cp.length > maxCodeUnits) break
    result += cp
    codeUnits += cp.length
  }
  return result
}

export function buildScoutPrompt(goal: string, mode: TaskJobMode, fileHints: string[], workspaceFiles: string[]): string {
  return [
    'You are the SCOUT stage of a long-running Antigravity task kernel.',
    `Task goal: ${goal}`,
    `Task mode: ${mode}`,
    fileHints.length > 0 ? `User file hints: ${fileHints.join(', ')}` : 'User file hints: none',
    '',
    'Workspace file inventory:',
    workspaceFiles.map(file => `- ${file}`).join('\n'),
    '',
    'Return STRICT JSON only with this shape:',
    '{"goalSummary":"...","relevantPaths":["..."],"shards":[{"shardId":"shard-1","filePaths":["..."],"sharedFiles":["..."]}],"unknowns":["..."],"riskFlags":["..."]}',
    'Rules:',
    '- Choose only relevant files.',
    '- Keep shard filePaths small and cohesive.',
    '- Put shared config roots into sharedFiles, maximum 5 files.',
    '- Do not include prose outside JSON.',
  ].join('\n')
}

export function buildShardPrompt(goal: string, shardId: string, relevantFiles: string[]): string {
  return [
    'You are a SHARD_ANALYZE worker.',
    `Task goal: ${goal}`,
    `Shard ID: ${shardId}`,
    `Files in this shard: ${relevantFiles.join(', ')}`,
    '',
    'Return STRICT JSON only with this shape:',
    '{"summary":"...","evidence":["..."],"symbols":["..."],"dependencies":["..."],"openQuestions":["..."],"confidence":0.0}',
    'Rules:',
    '- Only reason about the provided files.',
    '- Evidence must reference concrete files, functions, classes, commands, or behaviors.',
    '- Confidence must be between 0 and 1.',
    '- No prose outside JSON.',
  ].join('\n')
}

/**
 * 🧬 MoA Fusion Prompt — 终极合成器
 *
 * 接收两个异构模型的分析草稿，让第三个推理模型进行交叉验证和融合。
 * Together AI MoA 论文的核心思想：多个 Proposer 的输出 → 单个 Aggregator 融合。
 */
export function buildFusionPrompt(draftA: string, draftB: string, goal: string): string {
  return [
    'You are an architecture-level Synthesizer AI.',
    'Two independent AI models have analyzed the same codebase task and produced separate drafts.',
    'Your job is to CROSS-VALIDATE and FUSE them into a single, superior analysis.',
    '',
    `## Original Task Goal`,
    goal,
    '',
    '## Draft A (from Model 1)',
    '<draft_a>',
    draftA,
    '</draft_a>',
    '',
    '## Draft B (from Model 2)',
    '<draft_b>',
    draftB,
    '</draft_b>',
    '',
    '## Your Instructions',
    '1. Identify the STRENGTHS of each draft — where its analysis is deeper, more accurate, or covers areas the other missed.',
    '2. Identify LOGICAL FLAWS or GAPS in each draft — incorrect assumptions, missing edge cases, or weak evidence.',
    '3. Produce a FUSED analysis that combines the best of both, resolves conflicts, and fills coverage gaps.',
    '4. If the two drafts CONTRADICT each other on a specific point, include both perspectives and note the disagreement.',
    '',
    'Return STRICT JSON only with this shape:',
    '{"summary":"...","evidence":["..."],"symbols":["..."],"dependencies":["..."],"openQuestions":["..."],"confidence":0.0}',
    '',
    'Rules:',
    '- The fused summary must be MORE comprehensive than either individual draft.',
    '- Evidence must reference concrete files, functions, classes, commands, or behaviors.',
    '- Confidence reflects YOUR assessment of the fused result (0-1). If drafts strongly agree, confidence should be high.',
    '- No prose outside JSON.',
  ].join('\n')
}

/** 单个 shard 摘要最大字节数（超出则截断 evidence/symbols） */
const MAX_SHARD_SUMMARY_BYTES = 50_000  // ~50KB
/** 全量 shard JSON 最大字节数（超出则退化为 summary-only 模式） */
const MAX_AGGREGATE_PAYLOAD_BYTES = 8_000_000  // 8MB

function truncateShardForPrompt(shard: ShardAnalysis): ShardAnalysis | { shardId: string; summary: string; _truncated: true } {
  const full = JSON.stringify(shard)
  if (full.length <= MAX_SHARD_SUMMARY_BYTES) return shard
  // 截断策略：保留 summary + shardId，丢弃 evidence/symbols/dependencies
  // 在截断点追加 [TRUNCATED] 标记，防止下游 LLM 语义幻觉
  const safeSummary = shard.summary.length > 2000
    ? unicodeSafeSlice(shard.summary, 2000) + '\n…[TRUNCATED: full shard data exceeded 50KB]'
    : shard.summary
  return {
    shardId: shard.shardId,
    summary: safeSummary,
    _truncated: true,
  } as any
}

export function buildAggregatePrompt(goal: string, shardResults: ShardAnalysis[]): string {
  // 阶段 1：逐个截断大型 shard
  const truncated = shardResults.map(truncateShardForPrompt)
  let serialized = JSON.stringify(truncated, null, 2)

  // 阶段 2：如果总量仍超出安全上限，退化为纯 summary 列表（附截断标记）
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGGREGATE_PAYLOAD_BYTES) {
    const summaryOnly = shardResults.map(s => ({
      shardId: s.shardId,
      summary: s.summary.length > 500
        ? s.summary.slice(0, 500) + '…[TRUNCATED]'
        : s.summary,
    }))
    serialized = JSON.stringify(summaryOnly, null, 2)
  }

  return [
    'You are the AGGREGATE stage.',
    `Task goal: ${goal}`,
    '',
    `Shard results JSON (${shardResults.length} shards):`,
    serialized,
    '',
    'Return STRICT JSON only with this shape:',
    '{"globalSummary":"...","agreements":["..."],"conflicts":["..."],"missingCoverage":["..."]}',
    'Rules:',
    '- Merge the shard evidence into one global summary.',
    '- Conflicts should be explicit disagreements or unresolved ambiguity.',
    '- missingCoverage should list missing files, unresolved dependency paths, or unknown runtime assumptions.',
    '- No prose outside JSON.',
  ].join('\n')
}

export function buildVerifyPrompt(goal: string, aggregate: AggregateAnalysis, shardResults: ShardAnalysis[]): string {
  return [
    'You are the VERIFY stage.',
    `Task goal: ${goal}`,
    '',
    'Aggregate JSON:',
    JSON.stringify(aggregate, null, 2),
    '',
    'Shard results JSON:',
    JSON.stringify(shardResults, null, 2),
    '',
    'Return STRICT JSON only with this shape:',
    '{"verdict":"pass|warn|fail","coverageGaps":["..."],"riskFindings":["..."],"followups":["..."]}',
    'Rules:',
    '- Check coverage gaps, weak assumptions, and missing evidence.',
    '- If there are material gaps, verdict should be warn or fail.',
    '- No prose outside JSON.',
  ].join('\n')
}

export function buildWritePrompt(
  goal: string,
  aggregate: AggregateAnalysis,
  verify: VerifyAnalysis,
  targetFiles: string[],
): string {
  return [
    'You are the WRITE stage.',
    `Task goal: ${goal}`,
    '',
    'Aggregate JSON:',
    JSON.stringify(aggregate, null, 2),
    '',
    'Verify JSON:',
    JSON.stringify(verify, null, 2),
    '',
    `Preferred target files: ${targetFiles.join(', ') || 'derive from context'}`,
    '',
    'Apply the required changes in the workspace.',
    'Return STRICT JSON only with this shape:',
    '{"changePlan":"...","targetFiles":["..."],"executionLog":["..."],"diffSummary":"..."}',
    'Rules:',
    '- Actually edit files when needed.',
    '- targetFiles must list the files you changed or intended to change.',
    '- executionLog should summarize major edits or command executions.',
    '- No prose outside JSON.',
  ].join('\n')
}

export function buildFinalAnswer(
  manifest: ScoutManifest,
  aggregate: AggregateAnalysis,
  verify: VerifyAnalysis,
  writeSummary?: { targetFiles: string[]; diffSummary: string },
): string {
  const sections = [
    `Goal Summary: ${manifest.goalSummary}`,
    '',
    `Global Summary: ${aggregate.globalSummary}`,
  ]
  if (aggregate.conflicts.length > 0) {
    sections.push('', `Conflicts: ${aggregate.conflicts.join(' | ')}`)
  }
  if (verify.coverageGaps.length > 0) {
    sections.push('', `Coverage Gaps: ${verify.coverageGaps.join(' | ')}`)
  }
  if (verify.riskFindings.length > 0) {
    sections.push('', `Risks: ${verify.riskFindings.join(' | ')}`)
  }
  if (writeSummary) {
    sections.push('', `Changed Files: ${writeSummary.targetFiles.join(', ') || 'none'}`)
    sections.push(`Diff Summary: ${writeSummary.diffSummary}`)
  }
  return sections.join('\n')
}
