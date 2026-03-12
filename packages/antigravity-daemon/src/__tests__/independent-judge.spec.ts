import { describe, expect, it } from 'vitest'
import { evaluateIndependentJudge } from '../independent-judge.js'
import { resolveWorkflowDefinition } from '../workflow-definition.js'

const invocation = {
  workflowId: 'antigravity.strict-full',
  workflowVersion: '1.0.0',
  goal: 'Refactor the workspace implementation and verify it',
  files: ['/tmp/project/src/index.ts'],
  initiator: 'test',
  workspaceRoot: '/tmp/project',
  triggerSource: 'command' as const,
  forceFullPath: true,
  options: {},
  metadata: {},
}

const definition = resolveWorkflowDefinition(invocation)

describe('independent judge', () => {
  it('penalizes low-diversity PARALLEL outputs', async () => {
    const reports = await evaluateIndependentJudge({
      runId: 'run-1',
      nodeId: 'PARALLEL',
      output: {
        codex: { modelId: 'codex', summary: 'same summary' },
        gemini: { modelId: 'codex-variant', summary: 'same summary' },
      },
      state: null,
      invocation,
      definition,
      capturedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(reports[0]?.verdict === 'disagree' || reports[0]?.verdict === 'needs_human').toBe(true)
    expect((reports[0]?.confidence ?? 1)).toBeLessThan(0.6)
  })

  it('penalizes VERIFY when challenger family overlaps PARALLEL', async () => {
    const reports = await evaluateIndependentJudge({
      runId: 'run-2',
      nodeId: 'VERIFY',
      output: {
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'codex-verifier',
        complianceCheck: 'PASS',
        oracleResults: [],
      },
      state: {
        nodes: {
          PARALLEL: {
            nodeId: 'PARALLEL',
            status: 'completed',
            output: {
              codex: { modelId: 'codex' },
              gemini: { modelId: 'gemini' },
            },
          },
        },
      } as any,
      invocation,
      definition,
      capturedAt: '2026-03-12T00:00:00.000Z',
    })

    expect(reports[0]?.verdict === 'disagree' || reports[0]?.verdict === 'needs_human').toBe(true)
  })

  it('uses a model-backed judge when a structured evaluation is returned', async () => {
    const reports = await evaluateIndependentJudge({
      runId: 'run-3',
      nodeId: 'DEBATE',
      output: {
        finalSummary: 'A sufficiently detailed and stable debate summary that covers the tradeoffs and the chosen plan in depth.',
        disagreementPoints: ['tradeoff one'],
        candidateOptions: ['CODEX', 'GEMINI'],
        selectedOption: 'CODEX',
        stabilityAchieved: true,
        stabilityScore: 0.92,
        compensationRequested: false,
      },
      state: null,
      invocation,
      definition,
      capturedAt: '2026-03-12T00:00:00.000Z',
      agentRuntime: {
        ask: async () => ({
          text: JSON.stringify({
            verdict: 'agree',
            confidence: 0.93,
            rationale: 'The debate is stable and well-supported.',
            evidenceIds: ['debate-1'],
            issues: [],
            scores: {
              coherence: 0.9,
              faithfulness: 0.9,
              relevance: 0.95,
              completeness: 0.9,
              overall: 0.91,
            },
          }),
          usedModel: 'judge-pro',
          warningLines: [],
        }),
        codexTask: async () => '',
        geminiTask: async () => '',
        consensus: async () => ({ judgeText: '', judgeModel: 'judge', candidates: [], totalMs: 0 }),
      },
    })

    expect(reports[0]?.judge).toBe('independent-judge:quorum')
    expect(reports[0]?.verdict).toBe('agree')
    expect((reports[0]?.confidence ?? 0)).toBeGreaterThan(0.8)
    expect(reports.some(report => report.judge === 'independent-judge:model:judge-pro')).toBe(true)
  })

  it('falls back when the model-backed judge uses a forbidden family', async () => {
    const reports = await evaluateIndependentJudge({
      runId: 'run-4',
      nodeId: 'VERIFY',
      output: {
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'judge-verifier',
        complianceCheck: 'PASS',
        oracleResults: [{ tool: 'tsc', passed: true, output: 'ok', exitCode: 0 }],
      },
      state: {
        nodes: {
          PARALLEL: {
            nodeId: 'PARALLEL',
            status: 'completed',
            output: {
              codex: { modelId: 'codex' },
              gemini: { modelId: 'gemini' },
            },
          },
        },
      } as any,
      invocation,
      definition,
      capturedAt: '2026-03-12T00:00:00.000Z',
      agentRuntime: {
        ask: async () => ({
          text: JSON.stringify({
            verdict: 'agree',
            confidence: 0.99,
            rationale: 'Looks good.',
            evidenceIds: [],
            issues: [],
          }),
          usedModel: 'codex-judge',
          warningLines: [],
        }),
        codexTask: async () => '',
        geminiTask: async () => '',
        consensus: async () => ({ judgeText: '', judgeModel: 'judge', candidates: [], totalMs: 0 }),
      },
    })

    expect(reports[0]?.judge).toBe('independent-judge:quorum')
    expect(reports[0]?.verdict).toBe('needs_human')
    expect(reports.some(report => report.judge === 'independent-judge:model-conflict')).toBe(true)
  })

  it('aggregates multiple model judges into a quorum verdict', async () => {
    let askCount = 0
    const reports = await evaluateIndependentJudge({
      runId: 'run-5',
      nodeId: 'DEBATE',
      output: {
        finalSummary: 'A sufficiently detailed and stable debate summary that covers the tradeoffs and the chosen plan in depth.',
        disagreementPoints: ['tradeoff one'],
        candidateOptions: ['CODEX', 'GEMINI'],
        selectedOption: 'CODEX',
        stabilityAchieved: true,
        stabilityScore: 0.92,
        compensationRequested: false,
      },
      state: null,
      invocation,
      definition,
      capturedAt: '2026-03-12T00:00:00.000Z',
      agentRuntime: {
        ask: async () => {
          askCount += 1
          if (askCount === 1) {
            return {
              text: JSON.stringify({
                verdict: 'agree',
                confidence: 0.92,
                rationale: 'Stable and grounded.',
                evidenceIds: ['debate-1'],
                issues: [],
              }),
              usedModel: 'judge-pro',
              warningLines: [],
            }
          }
          return {
            text: JSON.stringify({
              verdict: 'partial',
              confidence: 0.74,
              rationale: 'Mostly stable but could cite more evidence.',
              evidenceIds: ['debate-2'],
              issues: ['citation depth'],
            }),
            usedModel: 'verifier-pro',
            warningLines: [],
          }
        },
        codexTask: async () => '',
        geminiTask: async () => '',
        consensus: async () => ({ judgeText: '', judgeModel: 'judge', candidates: [], totalMs: 0 }),
      },
    })

    expect(askCount).toBe(2)
    expect(reports[0]?.judge).toBe('independent-judge:quorum')
    expect(reports[0]?.verdict).toBe('partial')
    expect(reports.filter(report => report.judge.startsWith('independent-judge:model:'))).toHaveLength(2)
  })
})
