/**
 * Antigravity Workflow Runtime — workflow.run MCP 工具
 *
 * 启动 daemon-owned Antigravity 工作流。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'

export function registerWorkflowRunTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'workflow.run',
    '启动 daemon-owned Antigravity 工作流，工作流 authority 固定在 antigravity-daemon。',
    {
      goal: z.string().describe('任务描述/目标'),
      repoRoot: z.string().optional().describe('项目根目录；默认当前工作目录'),
      files: z.array(z.string()).optional().describe('相关文件路径'),
      workflowId: z.enum(['antigravity.strict-full', 'antigravity.adaptive']).optional()
        .describe('工作流模板；默认 antigravity.strict-full'),
      riskHint: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('预设风险等级'),
      tokenBudget: z.number().positive().optional().describe('Token 预算上限'),
      hostSessionId: z.string().optional().describe('可选的宿主会话 ID'),
    },
    async (args) => {
      try {
        const workspaceRoot = args.repoRoot ?? process.cwd()
        const result = await ctx.daemonBridge.startRun({
          invocation: {
            workflowId: args.workflowId ?? 'antigravity.strict-full',
            workflowVersion: '1.0.0',
            goal: args.goal,
            files: args.files ?? [],
            initiator: 'mcp',
            workspaceRoot,
            hostSessionId: args.hostSessionId,
            triggerSource: 'command',
            forceFullPath: true,
            options: {
              riskHint: args.riskHint,
              tokenBudget: args.tokenBudget,
            },
            metadata: {
              authority: 'antigravity-daemon',
              transport: 'mcp',
            },
          },
        }, workspaceRoot)

        return jsonContent({
          runId: result.runId,
          workflowId: result.definition.workflowId,
          workflowTemplate: result.definition.templateName,
          authorityOwner: result.snapshot.authorityOwner,
          authorityHost: result.snapshot.authorityHost,
          status: result.snapshot.status,
          phase: result.snapshot.phase,
          releaseArtifacts: result.snapshot.releaseArtifacts,
          nodeStatuses: Object.fromEntries(
            Object.entries(result.snapshot.nodes).map(([nodeId, node]) => {
              const snapshotNode = node as { status: string }
              return [nodeId, snapshotNode.status]
            }),
          ),
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
