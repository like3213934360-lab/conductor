import { describe, expect, it } from 'vitest'
import { resolveWorkflowDefinition } from '../workflow-definition.js'
import { validateWorkflowStepOutput } from '../workflow-output-contracts.js'

const definition = resolveWorkflowDefinition({
  workflowId: 'antigravity.strict-full',
  workflowVersion: '1.0.0',
  goal: 'Refactor the TypeScript workflow implementation and verify it',
  files: ['/tmp/project/src/index.ts'],
  initiator: 'test',
  workspaceRoot: '/tmp/project',
  triggerSource: 'command',
  forceFullPath: true,
  options: {},
  metadata: {},
})

describe('workflow output contracts', () => {
  it('accepts valid ANALYZE output with task metadata and constraints', () => {
    const analyze = definition.steps.find(step => step.id === 'ANALYZE')
    expect(analyze).toBeDefined()

    const output = validateWorkflowStepOutput(analyze!, {
      taskType: 'implementation',
      taskAnalysis: 'The daemon must preserve authority ownership, collect evidence for every stage, and deliver a verified final answer.',
      riskAssessment: 'high',
      routePath: 'debate',
      tokenBudget: 'M',
      taskClass: 'code',
      verifiabilityClass: 'high',
      fileList: ['/tmp/project/src/index.ts'],
      keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
    }, null)

    expect(output.taskClass).toBe('code')
  })

  it('rejects VERIFY output that reuses a PARALLEL model family', () => {
    const verify = definition.steps.find(step => step.id === 'VERIFY')
    expect(verify).toBeDefined()

    expect(() => validateWorkflowStepOutput(verify!, {
      verdict: 'AGREE',
      assuranceVerdict: 'PASS',
      challengerModelId: 'codex-verifier',
      complianceCheck: 'PASS',
      verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
      findings: [],
      failureReasons: [],
      oracleResults: [],
    }, {
      nodes: {
        PARALLEL: {
          output: {
            codex: { modelId: 'codex' },
            gemini: { modelId: 'gemini' },
          },
        },
      },
    } as any)).toThrow(/must be distinct from PARALLEL workers/)
  })

  it('rejects high-verifiability VERIFY output without a passing oracle', () => {
    const verify = definition.steps.find(step => step.id === 'VERIFY')
    expect(verify).toBeDefined()

    expect(() => validateWorkflowStepOutput(verify!, {
      verdict: 'AGREE',
      assuranceVerdict: 'PASS',
      challengerModelId: 'deepseek',
      complianceCheck: 'PASS',
      verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
      findings: [],
      failureReasons: [],
      oracleResults: [{ tool: 'tsc', passed: false, output: 'failed', exitCode: 1 }],
    }, {
      nodes: {
        ANALYZE: {
          output: { verifiabilityClass: 'high' },
        },
        PARALLEL: {
          output: {
            codex: { modelId: 'codex' },
            gemini: { modelId: 'gemini' },
          },
        },
      },
    } as any)).toThrow(/requires at least one passing objective oracle/)
  })
})
