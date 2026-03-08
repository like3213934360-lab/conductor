#!/usr/bin/env node
/**
 * Conductor Hub MCP Server — 独立 stdio 进程
 *
 * 注册 7 个 MCP 工具，委派给 ConductorHubService 处理。
 * 从 Conductor Hub mcp-server.ts L682-1177 重构。
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
    ConductorHubService,
    runParallelTasks,
    formatParallelResults,
    discoverCliEcosystem,
    formatEcosystem,
    ProgressReporter,
    AsyncJobManager,
    formatJobStatus,
} from '@anthropic/conductor-hub-core';
import type { SubTask, SubTaskType, StartJobOptions, JobType } from '@anthropic/conductor-hub-core';

// ── 工具 Schema 定义 ─────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
    {
        name: 'ai_ask',
        description: 'Ask a question to a specialized AI expert. Conductor Hub auto-routes to the best model based on your configured models and task types. Specify a provider to force a specific one.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                message: { type: 'string', description: 'The question or task.' },
                provider: { type: 'string', description: 'Force a specific provider (e.g. "deepseek", "glm"). Omit for smart auto-routing.' },
                system_prompt: { type: 'string', description: 'Optional system-level instructions.' },
                file_paths: {
                    type: 'array', items: { type: 'string' },
                    description: 'Optional local file paths whose contents will be injected as context (max 200KB each, 1MB total). Supports absolute paths and ~ expansion.',
                },
            },
            required: ['message'],
        },
    },
    {
        name: 'ai_list_providers',
        description: 'List configured AI models and their assigned task types.',
        inputSchema: { type: 'object' as const, properties: {} },
    },
    {
        name: 'ai_codex_task',
        description: 'Run an autonomous coding task using Codex CLI. Codex reads/writes local files and executes terminal commands — no API key needed, uses your ChatGPT account. Best for: file rewrites, code review, refactoring.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                task: { type: 'string', description: 'Task description for Codex.' },
                working_dir: { type: 'string', description: 'Working directory. Defaults to current directory.' },
            },
            required: ['task'],
        },
    },
    {
        name: 'ai_gemini_task',
        description: 'Run an autonomous task using the local Gemini CLI (Google Gemini). Gemini has deep file/tool access via its built-in tools. Best for: reasoning tasks, code generation, file analysis, multi-step agentic workflows. Requires Gemini CLI installed (`npm i -g @google/gemini-cli`).',
        inputSchema: {
            type: 'object' as const,
            properties: {
                prompt: { type: 'string', description: 'The prompt / task to send to Gemini.' },
                model: { type: 'string', description: 'Optional Gemini model to use (e.g. "gemini-2.5-pro"). Defaults to CLI default.' },
                working_dir: { type: 'string', description: 'Working directory for Gemini CLI. Defaults to current directory.' },
            },
            required: ['prompt'],
        },
    },
    {
        name: 'ai_multi_ask',
        description: 'Ask multiple AI models the same question in parallel and compare their responses. Best for getting diverse perspectives, cross-validating answers, or finding the best response.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                message: { type: 'string', description: 'The question or task to send to all models.' },
                providers: { type: 'array', items: { type: 'string' }, description: 'List of provider names to query in parallel (e.g. ["deepseek", "glm", "qwen"]). Omit to use all enabled models.' },
                system_prompt: { type: 'string', description: 'Optional system-level instructions for all models.' },
                file_paths: { type: 'array', items: { type: 'string' }, description: 'Optional local file paths whose contents will be injected as context.' },
            },
            required: ['message'],
        },
    },
    {
        name: 'ai_consensus',
        description: 'Multi-model voting engine. Asks multiple models the same question, then uses a judge model to score and select the best answer based on preset criteria. Returns the winning answer with scores and reasoning.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                message: { type: 'string', description: 'The question or task to send to all models.' },
                criteria: { type: 'string', description: 'Judging criteria: "code_quality", "creativity", "accuracy", "completeness", or custom description. Defaults to "accuracy".' },
                providers: { type: 'array', items: { type: 'string' }, description: 'List of provider names to query. Omit to use all enabled models.' },
                judge: { type: 'string', description: 'Provider to use as judge. Omit to auto-select the strongest available model.' },
                system_prompt: { type: 'string', description: 'Optional system-level instructions for candidate models.' },
                file_paths: { type: 'array', items: { type: 'string' }, description: 'Optional local file paths for context.' },
            },
            required: ['message'],
        },
    },
    {
        name: 'ai_parallel_tasks',
        description: 'Execute multiple AI tasks (Codex CLI, Gemini CLI, API calls) concurrently in a single request. Use this when you need to run multiple tools in parallel — all sub-tasks execute simultaneously, dramatically reducing total wait time.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                tasks: {
                    type: 'array',
                    description: 'Array of sub-tasks to execute in parallel',
                    minItems: 1,
                    maxItems: 8,
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Unique label for this sub-task (e.g. "codex-review", "gemini-audit")' },
                            type: { type: 'string', enum: ['codex', 'gemini', 'ask', 'multi_ask', 'consensus'], description: 'Which AI tool to use' },
                            prompt: { type: 'string', description: 'The prompt/task/question for the AI' },
                            model: { type: 'string', description: 'Specific model (gemini type only)' },
                            working_dir: { type: 'string', description: 'Working directory (codex/gemini types)' },
                            provider: { type: 'string', description: 'Force provider (ask type only)' },
                            system_prompt: { type: 'string', description: 'System prompt (ask/multi_ask/consensus)' },
                            timeout_ms: { type: 'number', description: 'Per-task timeout in ms (default: 300000)' },
                            file_paths: { type: 'array', items: { type: 'string' }, description: 'Local file paths for context injection (ask/multi_ask/consensus)' },
                        },
                        required: ['type', 'prompt'],
                    },
                },
                max_concurrency: { type: 'number', description: 'Max concurrent tasks (1-4, default: 2)', minimum: 1, maximum: 4 },
            },
            required: ['tasks'],
        },
    },
    {
        name: 'ai_start_job',
        description: 'Start a long-running CLI task asynchronously. Returns a jobId immediately without blocking. Use ai_poll_job to check status. Best for: large refactoring, full codebase analysis, tasks expected to take >2 minutes.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                type: { type: 'string', enum: ['codex', 'gemini'], description: 'CLI agent to use.' },
                prompt: { type: 'string', description: 'Task description or prompt.' },
                model: { type: 'string', description: 'Gemini model (gemini type only).' },
                working_dir: { type: 'string', description: 'Working directory.' },
            },
            required: ['type', 'prompt'],
        },
    },
    {
        name: 'ai_poll_job',
        description: 'Poll the status of an async job started with ai_start_job. Returns current status, progress, and result when completed.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                job_id: { type: 'string', description: 'Job ID returned by ai_start_job.' },
                action: { type: 'string', enum: ['poll', 'cancel', 'list'], description: 'Action: poll (default), cancel, or list all jobs.' },
            },
            required: ['job_id'],
        },
    },
    {
        name: 'ai_list_ecosystem',
        description: 'Discover all MCP servers and extensions installed in Codex CLI and Gemini CLI. Shows name, description, and configuration for each. No arguments needed.',
        inputSchema: {
            type: 'object' as const,
            properties: {},
        },
    },
];

// ── MCP Server Main ──────────────────────────────────────────────────────────

async function main() {
    const server = new Server(
        { name: 'conductor-hub', version: '0.4.0' },
        { capabilities: { tools: {} } }
    );

    const service = new ConductorHubService();

    // 进度报告器: CLI 事件 → MCP Progress 通知
    const progressReporter = new ProgressReporter();
    let progressCounter = 0;
    progressReporter.on((event) => {
        progressCounter++;
        try {
            server.notification({
                method: 'notifications/progress',
                params: {
                    progressToken: event.taskId,
                    progress: progressCounter,
                    total: event.progress >= 0 ? Math.ceil(event.progress * 100) : undefined,
                    message: `[${event.phase}] ${event.message}`,
                },
            });
        } catch {
            // 通知发送失败不影响主流程
        }
    });

    // 异步作业管理器
    const jobManager = new AsyncJobManager(service, progressReporter);

    // 注册工具列表
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: TOOL_DEFINITIONS,
    }));

    // 处理工具调用
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        // 每次调用时热重载配置
        service.reloadConfig();

        const toolName = request.params.name;
        const args = request.params.arguments as Record<string, unknown>;

        try {
            switch (toolName) {
                case 'ai_ask': {
                    const result = await service.ask({
                        message: args.message as string,
                        provider: args.provider as string | undefined,
                        systemPrompt: args.system_prompt as string | undefined,
                        filePaths: args.file_paths as string[] | undefined,
                    });
                    const fallbackNote = result.didFallback
                        ? `\n\n---\n⚡ *Auto-fallback: responded by **${result.usedModel}** (primary model unavailable)*`
                        : '';
                    const warningNote = result.warningLines.length > 0
                        ? `\n\n> ⚠️ File context warnings: ${result.warningLines.join('; ')}`
                        : '';
                    return { content: [{ type: 'text', text: result.text + fallbackNote + warningNote }] };
                }

                case 'ai_list_providers': {
                    return { content: [{ type: 'text', text: service.listProviders() }] };
                }

                case 'ai_list_ecosystem': {
                    const eco = await discoverCliEcosystem();
                    return { content: [{ type: 'text', text: formatEcosystem(eco) }] };
                }

                case 'ai_codex_task': {
                    const result = await service.codexTask(
                        args.task as string,
                        args.working_dir as string | undefined,
                    );
                    return { content: [{ type: 'text', text: result }] };
                }

                case 'ai_gemini_task': {
                    const result = await service.geminiTask(
                        args.prompt as string,
                        args.model as string | undefined,
                        args.working_dir as string | undefined,
                    );
                    return { content: [{ type: 'text', text: result }] };
                }

                case 'ai_multi_ask': {
                    const result = await service.multiAsk({
                        message: args.message as string,
                        providers: args.providers as string[] | undefined,
                        systemPrompt: args.system_prompt as string | undefined,
                        filePaths: args.file_paths as string[] | undefined,
                    });
                    return { content: [{ type: 'text', text: result.formatted }] };
                }

                case 'ai_consensus': {
                    const result = await service.consensus({
                        message: args.message as string,
                        criteria: args.criteria as string | undefined,
                        providers: args.providers as string[] | undefined,
                        judge: args.judge as string | undefined,
                        systemPrompt: args.system_prompt as string | undefined,
                        filePaths: args.file_paths as string[] | undefined,
                    });
                    const header = `🏆 **ai_consensus** — ${result.candidates.length} candidates | Judge: ${result.judgeModel} | ${result.totalMs}ms`;
                    return { content: [{ type: 'text', text: `${header}\n\n${result.judgeText}` }] };
                }


                case 'ai_parallel_tasks': {
                    // zod 运行时校验 — 替代 as 强转
                    const { ParallelTasksInputSchema } = await import('./schemas.js');
                    const parsed = ParallelTasksInputSchema.safeParse(args);
                    if (!parsed.success) {
                        const errors = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
                        return { content: [{ type: 'text', text: `输入校验失败: ${errors}` }], isError: true };
                    }
                    const { tasks, max_concurrency } = parsed.data;
                    const subTasks: SubTask[] = tasks.map((t, i) => ({
                        id: t.id ?? `task-${i + 1}`,
                        type: t.type,
                        prompt: t.prompt,
                        model: t.model,
                        working_dir: t.working_dir,
                        provider: t.provider,
                        system_prompt: t.system_prompt,
                        timeout_ms: t.timeout_ms,
                        file_paths: t.file_paths as string[] | undefined,
                    }));
                    const summary = await runParallelTasks(
                        subTasks,
                        service,
                        max_concurrency,
                    );
                    return { content: [{ type: 'text', text: formatParallelResults(summary) }] };
                }

                case 'ai_start_job': {
                    const jobType = args.type as JobType;
                    if (jobType !== 'codex' && jobType !== 'gemini') {
                        return { content: [{ type: 'text', text: `不支持的作业类型: ${jobType}, 仅支持 codex/gemini` }], isError: true };
                    }
                    const opts: StartJobOptions = {
                        type: jobType,
                        prompt: args.prompt as string,
                        model: args.model as string | undefined,
                        workingDir: args.working_dir as string | undefined,
                    };
                    const jobId = jobManager.start(opts);
                    return { content: [{ type: 'text', text: `🚀 异步作业已启动\n\n**Job ID**: \`${jobId}\`\n**类型**: ${jobType}\n\n使用 \`ai_poll_job\` 查询进度和结果。` }] };
                }

                case 'ai_poll_job': {
                    const action = (args.action as string | undefined) ?? 'poll';
                    const jobId = args.job_id as string;

                    if (action === 'list') {
                        const allJobs = jobManager.list();
                        if (allJobs.length === 0) {
                            return { content: [{ type: 'text', text: '暂无作业。' }] };
                        }
                        const formatted = allJobs.map(j => formatJobStatus(j)).join('\n\n---\n\n');
                        return { content: [{ type: 'text', text: `📋 **作业列表** (${allJobs.length} 个)\n\n${formatted}` }] };
                    }

                    if (action === 'cancel') {
                        const cancelled = jobManager.cancel(jobId);
                        return { content: [{ type: 'text', text: cancelled ? `🚫 作业 ${jobId} 已取消` : `❌ 无法取消作业 ${jobId} (可能已完成或不存在)` }] };
                    }

                    // poll
                    const job = jobManager.poll(jobId);
                    if (!job) {
                        return { content: [{ type: 'text', text: `❌ 作业 ${jobId} 不存在` }], isError: true };
                    }
                    return { content: [{ type: 'text', text: formatJobStatus(job) }] };
                }

                default:
                    return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true };
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Conductor Hub MCP server fatal error: ${msg}\n`);
    process.exit(1);
});
