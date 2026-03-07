/**
 * Conductor AGC — agc.advance MCP 工具
 *
 * 驱动 AGC 运行的核心 MCP 工具。
 * 一次调用 → 全部节点执行完成 → 返回最终状态。
 *
 * 替代原有的 prompt 驱动模式，保证 100% 节点执行率。
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerContext } from '../context.js'
import { jsonContent, errorContent } from '../presentation/tool-response.js'
import { AGCRunDriver } from '@anthropic/conductor-hub-core'
import type { NodeExecutionResult, NodeRuntimeState } from '@anthropic/conductor-hub-core'

export function registerAgcAdvanceTool(server: McpServer, ctx: ServerContext): void {
  server.tool(
    'agc.advance',
    '驱动 AGC 运行的所有节点执行到完成 — 保证 100% 工作流执行率',
    {
      runId: z.string().describe('AGC 运行 ID（来自 agc.run 的返回值）'),
      maxTicks: z.number().int().min(1).max(50).optional()
        .describe('最大推进轮次（默认 20，防止死循环）'),
    },
    async (args) => {
      try {
        const driver = new AGCRunDriver({
          eventStore: ctx.eventStore,
          checkpointStore: ctx.checkpointStore,
          dagEngine: ctx.dagEngine,
          hub: ctx.hubService,
        })

        const executionLog: Array<{ nodeId: string; status: string; durationMs?: number }> = []

        const finalState = await driver.drain(args.runId, {
          maxTicks: args.maxTicks,
          onNodeComplete: (nodeId: string, result: NodeExecutionResult) => {
            executionLog.push({
              nodeId,
              status: 'completed',
              durationMs: result.durationMs,
            })
          },
          onNodeFailed: (nodeId: string, error: Error) => {
            executionLog.push({
              nodeId,
              status: `failed: ${error.message}`,
            })
          },
        })

        // 计算执行统计
        const nodeEntries = Object.values(finalState.nodes) as NodeRuntimeState[]
        const totalNodes = nodeEntries.length
        const completedNodes = nodeEntries.filter(
          (n: NodeRuntimeState) => n.status === 'completed',
        ).length
        const skippedNodes = nodeEntries.filter(
          (n: NodeRuntimeState) => n.status === 'skipped',
        ).length
        const failedNodes = nodeEntries.filter(
          (n: NodeRuntimeState) => n.status === 'failed',
        ).length

        return jsonContent({
          runId: args.runId,
          status: finalState.status,
          stateVersion: finalState.version,
          executionRate: totalNodes > 0
            ? `${Math.round(((completedNodes + skippedNodes) / totalNodes) * 100)}%`
            : '0%',
          stats: {
            total: totalNodes,
            completed: completedNodes,
            skipped: skippedNodes,
            failed: failedNodes,
          },
          executionLog,
          nodeOutputs: Object.fromEntries(
            Object.entries(finalState.nodes).map(([id, ns]) => {
              const nodeState = ns as NodeRuntimeState
              return [
                id,
                {
                  status: nodeState.status,
                  output: nodeState.output ? '(已产出)' : undefined,
                  error: nodeState.error,
                },
              ]
            }),
          ),
        })
      } catch (err) {
        return errorContent(err)
      }
    },
  )
}
