/**
 * Conductor AGC — agc.memory_search MCP 工具
 *
 * 搜索历史记忆（Episodic + Semantic），
 * 返回 Reflexion 提示和相关语义事实。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerAgcMemorySearchTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc.memory_search',
    '搜索 AGC 历史记忆 — Reflexion 提示 + 语义知识图',
    {
      query: z.string().describe('搜索查询（目标描述或关键词）'),
      files: z.array(z.string()).optional().describe('相关文件路径'),
      topK: z.number().int().positive().optional().describe('返回结果数量'),
    },
    async (args) => {
      try {
        if (!ctx.memoryManager) {
          return errorContent(new Error('记忆系统未启用（当前为内存模式）'))
        }

        const recall = ctx.memoryManager.recall(args.query, args.files)

        return jsonContent({
          reflexionPrompts: recall.reflexionPrompts,
          relevantFacts: recall.relevantFacts,
          promptCount: recall.reflexionPrompts.length,
          factCount: recall.relevantFacts.length,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
