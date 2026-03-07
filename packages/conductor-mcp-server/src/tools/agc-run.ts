/**
 * Conductor AGC — agc.run MCP 工具
 *
 * 启动 AGC 完整运行流程。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerAgcRunTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc.run',
    '启动 AGC 多模型治理流程 — 自动执行 DAG 编排、风险评估、合规检查',
    {
      goal: z.string().describe('任务描述/目标'),
      repoRoot: z.string().optional().describe('项目根目录'),
      files: z.array(z.string()).optional().describe('相关文件路径'),
      riskHint: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('预设风险等级'),
      tokenBudget: z.number().positive().optional().describe('Token 预算上限'),
      debug: z.boolean().optional().describe('是否启用调试模式'),
    },
    async (args) => {
      try {
        const result = await ctx.agcService.startRun({
          graph: {
            nodes: [
              { id: 'ANALYZE', name: 'ANALYZE', dependsOn: [], input: {}, skippable: false },
              { id: 'PARALLEL', name: 'PARALLEL', dependsOn: ['ANALYZE'], input: {}, skippable: false },
              { id: 'DEBATE', name: 'DEBATE', dependsOn: ['PARALLEL'], input: {}, skippable: true },
              { id: 'VERIFY', name: 'VERIFY', dependsOn: ['DEBATE'], input: {}, skippable: false },
              { id: 'SYNTHESIZE', name: 'SYNTHESIZE', dependsOn: ['VERIFY'], input: {}, skippable: false },
              { id: 'PERSIST', name: 'PERSIST', dependsOn: ['SYNTHESIZE'], input: {}, skippable: false },
              { id: 'HITL', name: 'HITL', dependsOn: ['PERSIST'], input: {}, skippable: true },
            ],
            edges: [],
          },
          metadata: {
            goal: args.goal,
            repoRoot: args.repoRoot,
            files: args.files ?? [],
            initiator: 'mcp',
          },
          options: {
            riskHint: args.riskHint,
            tokenBudget: args.tokenBudget,
            debug: args.debug ?? false,
            plugins: [],
          },
        })

        return jsonContent({
          runId: result.runId,
          lane: result.route.lane,
          drScore: result.drScore.score,
          riskLevel: result.drScore.level,
          complianceAllowed: result.compliance.allowed,
          nodePath: result.route.nodePath,
          skippedNodes: result.route.skippedNodes,
          checkpointId: result.checkpoint?.checkpointId,
          stateVersion: result.state.version,
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
