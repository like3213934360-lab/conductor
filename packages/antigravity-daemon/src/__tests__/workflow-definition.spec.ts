import { describe, expect, it } from 'vitest'
import { compileWorkflowDefinition, resolveWorkflowDefinition } from '../workflow-definition.js'

describe('Antigravity workflow definition', () => {
  it('compiles the strict full workflow with durable full-path semantics', () => {
    const definition = resolveWorkflowDefinition({
      workflowId: 'antigravity.strict-full',
      workflowVersion: '1.0.0',
      goal: 'Audit the workspace',
      files: [],
      initiator: 'test',
      workspaceRoot: '/tmp/workspace',
      triggerSource: 'command',
      forceFullPath: true,
      options: {},
      metadata: {},
    })
    const graph = compileWorkflowDefinition(definition)

    expect(definition.authorityMode).toBe('daemon-owned')
    expect(graph.nodes.map(node => node.id)).toEqual([
      'ANALYZE',
      'PARALLEL',
      'DEBATE',
      'VERIFY',
      'SYNTHESIZE',
      'PERSIST',
      'HITL',
    ])
    expect(graph.edges).toHaveLength(6)
    expect(graph.nodes.every(node => node.skippable === false)).toBe(true)
    const analyze = definition.steps.find(step => step.id === 'ANALYZE')
    const parallel = definition.steps.find(step => step.id === 'PARALLEL')
    const verify = definition.steps.find(step => step.id === 'VERIFY')
    expect(analyze?.outputSchemaId).toBe('antigravity.output.analyze.v1')
    expect(parallel?.modelContract?.judgeRequired).toBe(true)
    expect(parallel?.modelContract?.judgeModelHints).toEqual(['judge', 'verifier'])
    expect(verify?.modelContract?.requiresDistinctFromStages).toContain('PARALLEL')
    expect(verify?.modelContract?.judgeModelHints).toEqual(['judge', 'analysis'])
    expect(verify?.qualityPolicy.requireOracleForHighVerifiability).toBe(true)
  })

  it('compiles the adaptive workflow with a policy-authorized DEBATE skip', () => {
    const definition = resolveWorkflowDefinition({
      workflowId: 'antigravity.adaptive',
      workflowVersion: '1.0.0',
      goal: 'Audit the workspace',
      files: [],
      initiator: 'test',
      workspaceRoot: '/tmp/workspace',
      triggerSource: 'command',
      forceFullPath: true,
      options: {},
      metadata: {},
    })
    const graph = compileWorkflowDefinition(definition)
    const debateNode = graph.nodes.find(node => node.id === 'DEBATE')
    const verifyNode = graph.nodes.find(node => node.id === 'VERIFY')

    expect(definition.templateName).toBe('antigravity.adaptive.v1')
    expect(debateNode?.skippable).toBe(true)
    expect(debateNode?.input.skipPolicy).toMatchObject({
      strategyId: 'adaptive.debate-express.v1',
    })
    expect(verifyNode?.input.evidenceRequirements).toEqual([
      'parallel-receipts',
      'judge-signal',
      'verification-receipt',
    ])
  })
})
