/**
 * Antigravity MCP Model Tools
 *
 * Canonical model-domain tool registrations for interactive model work.
 * These tools stay host-facing, while workflow authority lives in antigravity-daemon.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
    AntigravityModelService,
    runParallelTasks,
    formatParallelResults,
    discoverCliEcosystem,
    formatEcosystem,
    AsyncJobManager,
    formatJobStatus,
} from '@anthropic/antigravity-model-core'
import type { ProgressReporter, SubTask, StartJobOptions, JobType } from '@anthropic/antigravity-model-core'

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const SubTaskTypeSchema = z.enum(['codex', 'gemini', 'ask', 'multi_ask', 'consensus'])

const SubTaskSchema = z.object({
    id: z.string().optional(),
    type: SubTaskTypeSchema,
    prompt: z.string().min(1, '提示词不能为空'),
    model: z.string().optional(),
    working_dir: z.string().optional(),
    model_hint: z.string().optional(),
    system_prompt: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
    file_paths: z.array(z.string()).optional(),
    model_hints: z.array(z.string()).optional(),
    criteria: z.string().optional(),
    judge_model_hint: z.string().optional(),
})

// ── ModelToolContext ─────────────────────────────────────────────────────────

export interface ModelToolContext {
    antigravityService: AntigravityModelService
    jobManager: AsyncJobManager
    progressReporter: ProgressReporter
}

// ── 工具注册 ─────────────────────────────────────────────────────────────────

/** Model-domain core tools */
export function registerCoreModelTools(server: McpServer, ctx: ModelToolContext): void {
    const { antigravityService: service, jobManager } = ctx

    // ai_ask
    server.tool(
        'ai_ask',
        'Ask a question to a specialized AI expert. Antigravity Workflow routes against your configured model catalog. Provide a model hint to steer selection toward a specific model.',
        {
            message: z.string().describe('The question or task.'),
            model_hint: z.string().optional().describe('Optional model hint (id, modelId, label, or base URL fragment) used to bias routing.'),
            system_prompt: z.string().optional().describe('Optional system-level instructions.'),
            file_paths: z.array(z.string()).optional().describe('Optional local file paths whose contents will be injected as context (max 200KB each, 1MB total).'),
        },
        async (args) => {
            service.reloadConfig()
            const result = await service.ask({
                message: args.message,
                modelHint: args.model_hint,
                systemPrompt: args.system_prompt,
                filePaths: args.file_paths,
            })
            const fallbackNote = result.didFallback
                ? `\n\n---\n⚡ *Auto-fallback: responded by **${result.usedModel}** (primary model unavailable)*`
                : ''
            const warningNote = result.warningLines.length > 0
                ? `\n\n> ⚠️ File context warnings: ${result.warningLines.join('; ')}`
                : ''
            return { content: [{ type: 'text' as const, text: result.text + fallbackNote + warningNote }] }
        }
    )

    // ai_codex_task
    server.tool(
        'ai_codex_task',
        'Run an autonomous coding task using Codex CLI. Codex reads/writes local files and executes terminal commands — no API key needed, uses your ChatGPT account. Best for: file rewrites, code review, refactoring.',
        {
            task: z.string().describe('Task description for Codex.'),
            working_dir: z.string().optional().describe('Working directory. Defaults to current directory.'),
            file_paths: z.array(z.string()).optional().describe('Optional local file paths whose contents will be pre-injected into the prompt as context.'),
        },
        async (args) => {
            service.reloadConfig()
            const result = await service.codexTask(args.task, args.working_dir, undefined, args.file_paths)
            return { content: [{ type: 'text' as const, text: result }] }
        }
    )

    // ai_gemini_task
    server.tool(
        'ai_gemini_task',
        'Run an autonomous task using the local Gemini CLI (Google Gemini). Gemini has deep file/tool access via its built-in tools. Best for: reasoning tasks, code generation, file analysis, multi-step agentic workflows. Requires Gemini CLI installed (`npm i -g @google/gemini-cli`).',
        {
            prompt: z.string().describe('The prompt / task to send to Gemini.'),
            model: z.string().optional().describe('Optional Gemini model to use (e.g. "gemini-2.5-pro"). Defaults to CLI default.'),
            working_dir: z.string().optional().describe('Working directory for Gemini CLI. Defaults to current directory.'),
            file_paths: z.array(z.string()).optional().describe('Optional local file paths whose contents will be pre-injected into the prompt as context.'),
        },
        async (args) => {
            service.reloadConfig()
            const result = await service.geminiTask(args.prompt, args.model, args.working_dir, undefined, args.file_paths)
            return { content: [{ type: 'text' as const, text: result }] }
        }
    )

    // ai_parallel_tasks
    server.tool(
        'ai_parallel_tasks',
        'Execute multiple AI tasks (Codex CLI, Gemini CLI, API calls) concurrently in a single request. Use this when you need to run multiple tools in parallel — all sub-tasks execute simultaneously, dramatically reducing total wait time.',
        {
            tasks: z.array(SubTaskSchema).min(1, '至少需要一个任务').max(8, '最多 8 个任务').describe('Array of sub-tasks to execute in parallel'),
            max_concurrency: z.number().int().min(1).max(4).optional().describe('Max concurrent tasks (1-4, default: 2)'),
        },
        async (args) => {
            service.reloadConfig()
            const subTasks: SubTask[] = args.tasks.map((t, i) => ({
                id: t.id ?? `task-${i + 1}`,
                type: t.type,
                prompt: t.prompt,
                model: t.model,
                working_dir: t.working_dir,
                model_hint: t.model_hint,
                model_hints: t.model_hints,
                judge_model_hint: t.judge_model_hint,
                system_prompt: t.system_prompt,
                timeout_ms: t.timeout_ms,
                file_paths: t.file_paths,
            }))
            const summary = await runParallelTasks(subTasks, service, args.max_concurrency)
            return { content: [{ type: 'text' as const, text: formatParallelResults(summary) }] }
        }
    )
}

/** Model-domain extended tools */
export function registerAdvancedModelTools(server: McpServer, ctx: ModelToolContext): void {
    const { antigravityService: service, jobManager } = ctx

    // ai_list_models
    server.tool(
        'ai_list_models',
        'List configured catalog models and their assigned task types.',
        {},
        async () => {
            service.reloadConfig()
            return { content: [{ type: 'text' as const, text: service.listModels() }] }
        }
    )

    // ai_list_ecosystem
    server.tool(
        'ai_list_ecosystem',
        'Discover all MCP servers and extensions installed in Codex CLI and Gemini CLI. Shows name, description, and configuration for each. No arguments needed.',
        {},
        async () => {
            const eco = await discoverCliEcosystem()
            return { content: [{ type: 'text' as const, text: formatEcosystem(eco) }] }
        }
    )

    // ai_multi_ask
    server.tool(
        'ai_multi_ask',
        'Ask multiple AI models the same question in parallel and compare their responses. Best for getting diverse perspectives, cross-validating answers, or finding the best response.',
        {
            message: z.string().describe('The question or task to send to all models.'),
            model_hints: z.array(z.string()).optional().describe('Optional list of model hints to query in parallel. Omit to use enabled catalog models.'),
            system_prompt: z.string().optional().describe('Optional system-level instructions for all models.'),
            file_paths: z.array(z.string()).optional().describe('Optional local file paths whose contents will be injected as context.'),
        },
        async (args) => {
            service.reloadConfig()
            const result = await service.multiAsk({
                message: args.message,
                modelHints: args.model_hints,
                systemPrompt: args.system_prompt,
                filePaths: args.file_paths,
            })
            return { content: [{ type: 'text' as const, text: result.formatted }] }
        }
    )

    // ai_consensus
    server.tool(
        'ai_consensus',
        'Multi-model voting engine. Asks multiple models the same question, then uses a judge model to score and select the best answer based on preset criteria. Returns the winning answer with scores and reasoning.',
        {
            message: z.string().describe('The question or task to send to all models.'),
            criteria: z.string().optional().describe('Judging criteria: "code_quality", "creativity", "accuracy", "completeness", or custom description. Defaults to "accuracy".'),
            model_hints: z.array(z.string()).optional().describe('Optional list of model hints to query. Omit to use enabled catalog models.'),
            judge_model_hint: z.string().optional().describe('Optional model hint to use as judge. Omit to auto-select the strongest available model.'),
            system_prompt: z.string().optional().describe('Optional system-level instructions for candidate models.'),
            file_paths: z.array(z.string()).optional().describe('Optional local file paths for context.'),
        },
        async (args) => {
            service.reloadConfig()
            const result = await service.consensus({
                message: args.message,
                criteria: args.criteria,
                modelHints: args.model_hints,
                judgeModelHint: args.judge_model_hint,
                systemPrompt: args.system_prompt,
                filePaths: args.file_paths,
            })
            const header = `🏆 **ai_consensus** — ${result.candidates.length} candidates | Judge: ${result.judgeModel} | ${result.totalMs}ms`
            return { content: [{ type: 'text' as const, text: `${header}\n\n${result.judgeText}` }] }
        }
    )

    // ai_start_job
    server.tool(
        'ai_start_job',
        'Start a long-running CLI task asynchronously. Returns a jobId immediately without blocking. Use ai_poll_job to check status. Best for: large refactoring, full codebase analysis, tasks expected to take >2 minutes.',
        {
            type: z.enum(['codex', 'gemini']).describe('CLI agent to use.'),
            prompt: z.string().describe('Task description or prompt.'),
            model: z.string().optional().describe('Gemini model (gemini type only).'),
            working_dir: z.string().optional().describe('Working directory.'),
        },
        async (args) => {
            service.reloadConfig()
            const opts: StartJobOptions = {
                type: args.type as JobType,
                prompt: args.prompt,
                model: args.model,
                workingDir: args.working_dir,
            }
            const jobId = jobManager.start(opts)
            return { content: [{ type: 'text' as const, text: `🚀 异步作业已启动\n\n**Job ID**: \`${jobId}\`\n**类型**: ${args.type}\n\n使用 \`ai_poll_job\` 查询进度和结果。` }] }
        }
    )

    // ai_poll_job
    server.tool(
        'ai_poll_job',
        'Poll the status of an async job started with ai_start_job. Returns current status, progress, and result when completed.',
        {
            job_id: z.string().describe('Job ID returned by ai_start_job.'),
            action: z.enum(['poll', 'cancel', 'list']).optional().describe('Action: poll (default), cancel, or list all jobs.'),
        },
        async (args) => {
            const action = args.action ?? 'poll'

            if (action === 'list') {
                const allJobs = jobManager.list()
                if (allJobs.length === 0) {
                    return { content: [{ type: 'text' as const, text: '暂无作业。' }] }
                }
                const formatted = allJobs.map(j => formatJobStatus(j)).join('\n\n---\n\n')
                return { content: [{ type: 'text' as const, text: `📋 **作业列表** (${allJobs.length} 个)\n\n${formatted}` }] }
            }

            if (action === 'cancel') {
                const cancelled = jobManager.cancel(args.job_id)
                return { content: [{ type: 'text' as const, text: cancelled ? `🚫 作业 ${args.job_id} 已取消` : `❌ 无法取消作业 ${args.job_id} (可能已完成或不存在)` }] }
            }

            // poll
            const job = jobManager.poll(args.job_id)
            if (!job) {
                return { content: [{ type: 'text' as const, text: `❌ 作业 ${args.job_id} 不存在` }], isError: true }
            }
            return { content: [{ type: 'text' as const, text: formatJobStatus(job) }] }
        }
    )
}

/** Register all model-domain tools. */
export function registerModelTools(server: McpServer, ctx: ModelToolContext): void {
    registerCoreModelTools(server, ctx)
    registerAdvancedModelTools(server, ctx)
}
