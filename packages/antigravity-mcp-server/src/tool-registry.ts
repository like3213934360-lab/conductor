import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ServerContext } from './context.js'
import type { ModelToolContext } from './tools/model-tools.js'
import { registerAdvancedModelTools, registerCoreModelTools } from './tools/model-tools.js'
import { registerTaskAdvanceTool } from './tools/task-advance.js'
import { registerTaskCancelTool } from './tools/task-cancel.js'
import { registerTaskGetStateTool } from './tools/task-get-state.js'
import { registerTaskListTool } from './tools/task-list.js'
import { registerTaskRunTool } from './tools/task-run.js'

export type ToolDomain = 'model' | 'task'

const ALL_DOMAINS: readonly ToolDomain[] = ['model', 'task']

export interface ToolCatalogEntry {
  name: string
  domain: ToolDomain
  description: string
  keywords: string[]
}

const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  { name: 'ai_ask', domain: 'model', description: 'Ask a question to a specialized AI expert.', keywords: ['ask', 'chat', 'question', '模型'] },
  { name: 'ai_codex_task', domain: 'model', description: 'Run an autonomous coding task using Codex CLI.', keywords: ['codex', 'coding', 'refactor', '代码'] },
  { name: 'ai_gemini_task', domain: 'model', description: 'Run an autonomous task using the local Gemini CLI.', keywords: ['gemini', 'reasoning', 'agent', '推理'] },
  { name: 'ai_parallel_tasks', domain: 'model', description: 'Execute multiple AI tasks concurrently in a single request.', keywords: ['parallel', 'concurrent', 'batch', '并行'] },
  { name: 'ai_list_models', domain: 'model', description: 'List configured catalog models and their assigned task types.', keywords: ['models', 'catalog', 'list'] },
  { name: 'ai_list_ecosystem', domain: 'model', description: 'Discover MCP servers and CLI ecosystem integrations.', keywords: ['ecosystem', 'extensions', 'mcp'] },
  { name: 'ai_multi_ask', domain: 'model', description: 'Ask multiple AI models the same question in parallel.', keywords: ['multi', 'parallel', 'compare'] },
  { name: 'ai_consensus', domain: 'model', description: 'Run multi-model consensus and judge selection.', keywords: ['consensus', 'vote', 'judge'] },
  { name: 'ai_start_job', domain: 'model', description: 'Start a long-running CLI task asynchronously.', keywords: ['async', 'job', 'background'] },
  { name: 'ai_poll_job', domain: 'model', description: 'Poll the status of an async CLI job.', keywords: ['poll', 'job', 'status'] },
  { name: 'task.run', domain: 'task', description: 'Start a long-running antigravity-taskd job.', keywords: ['task', 'run', 'job', 'taskd'] },
  { name: 'task.getState', domain: 'task', description: 'Read the latest antigravity-taskd job snapshot.', keywords: ['task', 'snapshot', 'state'] },
  { name: 'task.advance', domain: 'task', description: 'Read recent events for a taskd job.', keywords: ['task', 'events', 'advance', 'stream'] },
  { name: 'task.list', domain: 'task', description: 'List recent antigravity-taskd jobs.', keywords: ['task', 'list', 'jobs'] },
  { name: 'task.cancel', domain: 'task', description: 'Cancel an antigravity-taskd job.', keywords: ['task', 'cancel', 'jobs'] },
]

export function isToolDomain(value: string): value is ToolDomain {
  return (ALL_DOMAINS as readonly string[]).includes(value)
}

export function resolveEnabledDomains(raw = process.env['ANTIGRAVITY_TOOL_DOMAINS']): ToolDomain[] {
  if (!raw) {
    return [...ALL_DOMAINS]
  }

  const domains = raw.split(',')
    .map(item => item.trim())
    .filter(isToolDomain)

  return domains.length > 0 ? domains : [...ALL_DOMAINS]
}

export function listToolCatalog(domains: readonly ToolDomain[] = ALL_DOMAINS): ToolCatalogEntry[] {
  const enabled = new Set(domains)
  return TOOL_CATALOG.filter(tool => enabled.has(tool.domain))
}

export function registerToolCatalog(
  server: McpServer,
  ctx: ServerContext,
  modelCtx: ModelToolContext,
  domains: readonly ToolDomain[] = ALL_DOMAINS,
): void {
  const enabled = new Set(domains)

  if (enabled.has('model')) {
    registerCoreModelTools(server, modelCtx)
    registerAdvancedModelTools(server, modelCtx)
  }

  if (enabled.has('task')) {
    registerTaskRunTool(server, ctx)
    registerTaskGetStateTool(server, ctx)
    registerTaskAdvanceTool(server, ctx)
    registerTaskListTool(server, ctx)
    registerTaskCancelTool(server, ctx)
  }
}

export function registerSearchTool(
  server: McpServer,
  domains: readonly ToolDomain[] = ALL_DOMAINS,
): void {
  server.tool(
        'search_tools',
        'Search the registered Antigravity MCP tool catalog by name, domain, or keyword.',
        {
          query: z.string().min(1).describe('Search query'),
      domain: z.enum(['model', 'task']).optional().describe('Optional domain filter'),
      limit: z.number().int().positive().max(20).optional().describe('Maximum number of results'),
    },
    async (args) => {
      const normalizedQuery = args.query.trim().toLowerCase()
      const enabledDomains = args.domain ? [args.domain] : domains
      const matches = listToolCatalog(enabledDomains)
        .filter(tool =>
          tool.name.toLowerCase().includes(normalizedQuery) ||
          tool.description.toLowerCase().includes(normalizedQuery) ||
          tool.keywords.some(keyword => keyword.toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, args.limit ?? 8)

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query: args.query,
            domains: enabledDomains,
            totalMatches: matches.length,
            matches,
          }, null, 2),
        }],
      }
    },
  )
}
