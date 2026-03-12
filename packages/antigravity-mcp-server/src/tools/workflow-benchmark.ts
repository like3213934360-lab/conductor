import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { RunBenchmarkDatasetSourceSchema } from '@anthropic/antigravity-daemon'
import type { ServerContext } from '../context.js'
import { errorContent, jsonContent } from '../presentation/tool-response.js'

export function registerWorkflowBenchmarkTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.benchmark',
    '运行 antigravity-daemon 的 dataset-backed benchmark harness。',
    {
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      suiteIds: z.array(z.string()).optional().describe('可选 suiteId 列表；为空则运行 manifest 中启用的全部套件'),
      caseIds: z.array(z.string()).optional().describe('可选 caseId 列表；为空则运行数据集中的全部 benchmark case'),
      datasetSources: z.array(RunBenchmarkDatasetSourceSchema).optional().describe('可选外部 dataset source 列表；支持字符串 URL/路径或带版本 pin、sha256、缓存策略的 source object'),
    },
    async (args) => {
      try {
        const report = await ctx.daemonBridge.runBenchmark({
          suiteIds: args.suiteIds ?? [],
          caseIds: args.caseIds ?? [],
          datasetSources: args.datasetSources ?? [],
        }, args.repoRoot ?? process.cwd())
        return jsonContent(report)
      } catch (error) {
        return errorContent(error)
      }
    },
  )
}
