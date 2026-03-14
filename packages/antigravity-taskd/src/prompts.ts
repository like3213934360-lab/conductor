import type { AggregateAnalysis, ScoutManifest, ShardAnalysis, TaskJobMode, VerifyAnalysis } from './schema.js'

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

/** 单个 shard 摘要最大字节数（超出则截断 evidence/symbols） */
const MAX_SHARD_SUMMARY_BYTES = 50_000  // ~50KB
/** 全量 shard JSON 最大字节数（超出则退化为 summary-only 模式） */
const MAX_AGGREGATE_PAYLOAD_BYTES = 8_000_000  // 8MB

function truncateShardForPrompt(shard: ShardAnalysis): ShardAnalysis | { shardId: string; summary: string; _truncated: true } {
  const full = JSON.stringify(shard)
  if (full.length <= MAX_SHARD_SUMMARY_BYTES) return shard
  // 截断策略：保留 summary + shardId，丢弃 evidence/symbols/dependencies
  return {
    shardId: shard.shardId,
    summary: shard.summary.slice(0, 2000),
    _truncated: true,
  } as any
}

export function buildAggregatePrompt(goal: string, shardResults: ShardAnalysis[]): string {
  // 阶段 1：逐个截断大型 shard
  const truncated = shardResults.map(truncateShardForPrompt)
  let serialized = JSON.stringify(truncated, null, 2)

  // 阶段 2：如果总量仍超出安全上限，退化为纯 summary 列表
  if (Buffer.byteLength(serialized, 'utf8') > MAX_AGGREGATE_PAYLOAD_BYTES) {
    const summaryOnly = shardResults.map(s => ({
      shardId: s.shardId,
      summary: s.summary.slice(0, 500),
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
