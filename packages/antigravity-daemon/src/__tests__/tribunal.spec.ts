import { describe, expect, it } from 'vitest'
import { TribunalService } from '../tribunal.js'
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

describe('tribunal service', () => {
  it('accepts a remote quorum from distinct workers and model families', async () => {
    const service = new TribunalService({
      delegateTribunal: async () => ({
        reports: [
          {
            workerId: 'judge-a',
            model: 'judge-pro',
            modelFamily: 'judge',
            responseMode: 'callback',
            report: {
              judgeReportId: 'r1',
              judge: 'tribunal:remote:judge-a:judge-pro',
              verdict: 'agree',
              confidence: 0.92,
              rationale: 'Remote juror A agrees.',
              evidenceIds: ['a1'],
              createdAt: '2026-03-12T00:00:00.000Z',
            },
          },
          {
            workerId: 'judge-b',
            model: 'verifier-pro',
            modelFamily: 'verifier',
            responseMode: 'poll',
            report: {
              judgeReportId: 'r2',
              judge: 'tribunal:remote:judge-b:verifier-pro',
              verdict: 'agree',
              confidence: 0.88,
              rationale: 'Remote juror B agrees.',
              evidenceIds: ['b1'],
              createdAt: '2026-03-12T00:00:00.000Z',
            },
          },
        ],
        failures: [],
      }),
    } as any)

    const verdict = await service.evaluate({
      runId: 'run-remote',
      nodeId: 'VERIFY',
      output: {
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        oracleResults: [{ tool: 'tsc', passed: true, output: 'ok', exitCode: 0 }],
      },
      state: {
        nodes: {
          PARALLEL: {
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

    expect(verdict?.mode).toBe('remote')
    expect(verdict?.quorumSatisfied).toBe(true)
    expect(verdict?.verdict).toBe('agree')
  })

  it('falls back to hybrid mode and blocks when a remote juror fails', async () => {
    const service = new TribunalService({
      delegateTribunal: async () => ({
        reports: [{
          workerId: 'judge-a',
          model: 'judge-pro',
          modelFamily: 'judge',
          responseMode: 'callback',
          report: {
            judgeReportId: 'r1',
            judge: 'tribunal:remote:judge-a:judge-pro',
            verdict: 'agree',
            confidence: 0.9,
            rationale: 'Only one remote juror completed.',
            evidenceIds: ['a1'],
            createdAt: '2026-03-12T00:00:00.000Z',
          },
        }],
        failures: ['Remote juror callback signature verification failed'],
      }),
    } as any, {
      ask: async () => ({
        text: JSON.stringify({
          verdict: 'agree',
          confidence: 0.91,
          rationale: 'Local fallback agrees.',
          evidenceIds: ['local-1'],
          issues: [],
        }),
        usedModel: 'judge-local',
        warningLines: [],
      }),
      codexTask: async () => '',
      geminiTask: async () => '',
      consensus: async () => ({ judgeText: '', judgeModel: 'judge', candidates: [], totalMs: 0 }),
    } as any)

    const verdict = await service.evaluate({
      runId: 'run-hybrid',
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
    })

    expect(verdict?.mode).toBe('hybrid')
    expect(verdict?.quorumSatisfied).toBe(false)
    expect(verdict?.verdict).toBe('needs_human')
  })

  it('uses local-fallback mode when no remote tribunal worker is available', async () => {
    const service = new TribunalService({
      delegateTribunal: async () => ({
        reports: [],
        failures: [],
      }),
    } as any, {
      ask: async () => ({
        text: JSON.stringify({
          verdict: 'agree',
          confidence: 0.93,
          rationale: 'Local fallback judge agrees.',
          evidenceIds: ['local-2'],
          issues: [],
        }),
        usedModel: 'judge-local',
        warningLines: [],
      }),
      codexTask: async () => '',
      geminiTask: async () => '',
      consensus: async () => ({ judgeText: '', judgeModel: 'judge', candidates: [], totalMs: 0 }),
    } as any)

    const verdict = await service.evaluate({
      runId: 'run-local',
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
    })

    expect(verdict?.mode).toBe('local-fallback')
    expect(verdict?.quorumSatisfied).toBe(false)
    expect(verdict?.fallbackUsed).toBe(true)
  })
})
