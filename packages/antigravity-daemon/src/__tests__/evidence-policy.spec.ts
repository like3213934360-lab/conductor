import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import {
  createExecutionReceipt,
  createHandoffEnvelopes,
  createSkipDecision,
  createSkipExecutionReceipt,
  evaluateReleaseGate,
} from '../evidence-policy.js'
import { resolveWorkflowDefinition } from '../workflow-definition.js'

const invocation = {
  workflowId: 'antigravity.strict-full',
  workflowVersion: '1.0.0',
  goal: 'Produce a fully evidenced Antigravity answer',
  files: [],
  initiator: 'test',
  workspaceRoot: '/tmp/antigravity-workspace',
  hostSessionId: 'evidence-policy-test',
  triggerSource: 'command' as const,
  forceFullPath: true,
  options: {},
  metadata: {},
}

const definition = resolveWorkflowDefinition(invocation)
const adaptiveInvocation = {
  ...invocation,
  workflowId: 'antigravity.adaptive',
}
const adaptiveDefinition = resolveWorkflowDefinition(adaptiveInvocation)

function receiptFor(
  nodeId: string,
  output: Record<string, unknown>,
  options: {
    tribunal?: Record<string, unknown>
    judgeReports?: Array<Record<string, unknown>>
  } = {},
) {
  const tribunal = ['PARALLEL', 'DEBATE', 'VERIFY'].includes(nodeId)
    ? {
        tribunalId: `tribunal-${nodeId}`,
        runId: 'run-1',
        nodeId,
        mode: 'remote',
        verdict: 'agree',
        confidence: 0.81,
        quorumSatisfied: true,
        remoteJurorCount: 2,
        totalJurorCount: 2,
        rationale: `${nodeId} remote tribunal accepted the result.`,
        evidenceIds: [],
        jurorReportIds: [],
        createdAt: '2026-03-10T00:00:00.000Z',
        ...options.tribunal,
      }
    : undefined
  return createExecutionReceipt({
    runId: 'run-1',
    nodeId,
    result: {
      output,
      durationMs: 10,
      model: 'test-model',
    },
    invocation,
    definition,
    capturedAt: '2026-03-10T00:00:00.000Z',
    traceId: `trace-${nodeId}`,
    tribunal: tribunal as any,
    judgeReports: (options.judgeReports ?? []) as any,
  })
}

function adaptiveReceiptFor(
  nodeId: string,
  output: Record<string, unknown>,
  options: {
    tribunal?: Record<string, unknown>
    judgeReports?: Array<Record<string, unknown>>
  } = {},
) {
  const tribunal = ['PARALLEL', 'DEBATE', 'VERIFY'].includes(nodeId)
    ? {
        tribunalId: `tribunal-adaptive-${nodeId}`,
        runId: 'run-adaptive',
        nodeId,
        mode: 'remote',
        verdict: 'agree',
        confidence: 0.81,
        quorumSatisfied: true,
        remoteJurorCount: 2,
        totalJurorCount: 2,
        rationale: `${nodeId} adaptive remote tribunal accepted the result.`,
        evidenceIds: [],
        jurorReportIds: [],
        createdAt: '2026-03-10T00:00:00.000Z',
        ...options.tribunal,
      }
    : undefined
  return createExecutionReceipt({
    runId: 'run-adaptive',
    nodeId,
    result: {
      output,
      durationMs: 10,
      model: 'test-model',
    },
    invocation: adaptiveInvocation,
    definition: adaptiveDefinition,
    capturedAt: '2026-03-10T00:00:00.000Z',
    traceId: `trace-adaptive-${nodeId}`,
    tribunal: tribunal as any,
    judgeReports: (options.judgeReports ?? []) as any,
  })
}

describe('daemon evidence and release policy', () => {
  it('creates artifact-grounded handoffs from execution receipts', () => {
    const receipt = receiptFor('PARALLEL', {
      codex: {
        modelId: 'codex',
        taskId: 'codex-1',
        summary: 'Codex option',
      },
      gemini: {
        modelId: 'gemini',
        taskId: 'gemini-1',
        summary: 'Gemini option',
      },
    })

    const handoffs = createHandoffEnvelopes({
      runId: 'run-1',
      nodeId: 'PARALLEL',
      definition,
      receipt,
      capturedAt: receipt.capturedAt,
    })

    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]?.targetNodeId).toBe('DEBATE')
    expect(handoffs[0]?.artifactIds.length).toBeGreaterThan(0)
    expect(handoffs[0]?.evidenceIds.length).toBeGreaterThan(0)
  })

  it('allows release when every strict-full evidence requirement is satisfied', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
        bothAvailable: true,
        disagreementScore: 0.4,
        skipAllowed: false,
      }),
      receiptFor('DEBATE', {
        convergenceScore: 0.9,
        finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        disagreementPoints: ['Implementation ordering differs between workers.'],
        candidateOptions: ['CODEX', 'GEMINI'],
        selectedOption: 'CODEX',
      }),
      receiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [],
      }),
      receiptFor('SYNTHESIZE', {
        finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Evidence-backed final recommendation.',
      }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } },
        DEBATE: { output: {
          finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        } },
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
          challengerModelId: 'deepseek',
        } },
        SYNTHESIZE: { output: { finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.', summary: 'Evidence-backed final recommendation.' } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({
      definition,
      receipts,
      state,
    })

    expect(decision.effect).toBe('allow')
    expect(decision.rationale).toEqual([])
    expect(decision.evidenceIds.length).toBeGreaterThan(0)
  })

  it('blocks release when required evidence is missing', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Short', outputHash: 'hash-a', status: 'success' },
      }),
      receiptFor('DEBATE', { convergenceScore: 0.9, finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.', disagreementPoints: ['Implementation ordering differs between workers.'], candidateOptions: ['CODEX', 'GEMINI'], selectedOption: 'CODEX' }),
      receiptFor('VERIFY', { assuranceVerdict: 'PASS', verdict: 'AGREE', verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.', challengerModelId: 'codex', complianceCheck: 'PASS', findings: [], oracleResults: [] }),
      receiptFor('SYNTHESIZE', { finalAnswer: '' }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } },
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
          challengerModelId: 'codex-verifier',
        } },
        SYNTHESIZE: { output: { finalAnswer: '' } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({
      definition,
      receipts,
      state,
    })

    expect(decision.effect).toBe('block')
    expect(decision.rationale).toContain('step PARALLEL is missing evidence requirement "parallel-receipts"')
    expect(decision.rationale).toContain('SYNTHESIZE did not produce a finalAnswer artifact')
  })

  it('blocks release when VERIFY uses the same model family as PARALLEL', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
        bothAvailable: true,
        disagreementScore: 0.4,
        skipAllowed: false,
      }),
      receiptFor('DEBATE', {
        convergenceScore: 0.9,
        finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        disagreementPoints: ['Implementation ordering differs between workers.'],
        candidateOptions: ['CODEX', 'GEMINI'],
        selectedOption: 'CODEX',
      }),
      receiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'codex-verifier',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [],
      }),
      receiptFor('SYNTHESIZE', {
        finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Evidence-backed final recommendation.',
      }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        PARALLEL: { output: receipts[1]?.artifacts ? {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } : undefined },
        VERIFY: { output: { challengerModelId: 'codex-verifier', verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.' } },
        SYNTHESIZE: { output: { finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.', summary: 'Evidence-backed final recommendation.' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({ definition, receipts, state })
    expect(decision.effect).toBe('block')
    expect(decision.rationale).toContain('step VERIFY is missing evidence requirement "verification-receipt"')
  })

  it('blocks release when a high-verifiability VERIFY step has no passing oracle', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'implementation',
        taskAnalysis: 'This task requires a full code migration with explicit compiler, lint, and test validation before release.',
        riskAssessment: 'high',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'code',
        verifiabilityClass: 'high',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
        bothAvailable: true,
        disagreementScore: 0.4,
        skipAllowed: false,
      }),
      receiptFor('DEBATE', {
        convergenceScore: 0.9,
        finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        disagreementPoints: ['Implementation ordering differs between workers.'],
        candidateOptions: ['CODEX', 'GEMINI'],
        selectedOption: 'CODEX',
      }),
      receiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [{ tool: 'tsc', passed: false, output: 'error', exitCode: 1 }],
      }),
      receiptFor('SYNTHESIZE', {
        finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Evidence-backed final recommendation.',
      }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        ANALYZE: { output: { verifiabilityClass: 'high' } },
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } },
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
          challengerModelId: 'deepseek',
          oracleResults: [{ tool: 'tsc', passed: false, output: 'error', exitCode: 1 }],
        } },
        SYNTHESIZE: { output: { finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.', summary: 'Evidence-backed final recommendation.' } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({ definition, receipts, state })
    expect(decision.effect).toBe('block')
    expect(decision.rationale).toContain('step VERIFY is missing evidence requirement "verification-receipt"')
  })

  it('blocks release when independent judge reports disagree on DEBATE', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
        bothAvailable: true,
        disagreementScore: 0.4,
        skipAllowed: false,
      }),
      createExecutionReceipt({
        runId: 'run-1',
        nodeId: 'DEBATE',
        result: {
          output: {
            convergenceScore: 0.9,
            finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
            disagreementPoints: ['Implementation ordering differs between workers.'],
            candidateOptions: ['CODEX', 'GEMINI'],
            selectedOption: 'CODEX',
          },
          durationMs: 10,
          model: 'test-model',
        },
        invocation,
        definition,
        capturedAt: '2026-03-10T00:00:00.000Z',
        traceId: 'trace-DEBATE',
        tribunal: {
          tribunalId: 'tribunal-debate-needs-human',
          runId: 'run-1',
          nodeId: 'DEBATE',
          mode: 'remote',
          verdict: 'needs_human',
          confidence: 0.2,
          quorumSatisfied: true,
          remoteJurorCount: 2,
          totalJurorCount: 2,
          rationale: 'Remote tribunal escalated this debate.',
          evidenceIds: [],
          jurorReportIds: ['judge-1'],
          createdAt: '2026-03-10T00:00:00.000Z',
        },
        judgeReports: [{
          judgeReportId: 'judge-1',
          judge: 'independent-judge',
          verdict: 'needs_human',
          confidence: 0.2,
          rationale: 'overall=0.20',
          evidenceIds: [],
          createdAt: '2026-03-10T00:00:00.000Z',
        }],
      }),
      receiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [],
      }),
      receiptFor('SYNTHESIZE', {
        finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Evidence-backed final recommendation.',
      }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } },
        DEBATE: { output: {
          finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        } },
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
          challengerModelId: 'deepseek',
        } },
        SYNTHESIZE: { output: {
          finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
          summary: 'Evidence-backed final recommendation.',
        } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({ definition, receipts, state })
    expect(decision.effect).toBe('block')
    expect(decision.rationale).toContain('step DEBATE failed tribunal evaluation')
  })

  it('prefers quorum judge reports when evaluating release', () => {
    const receipts = [
      receiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      receiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
        bothAvailable: true,
        disagreementScore: 0.4,
        skipAllowed: false,
      }),
      createExecutionReceipt({
        runId: 'run-1',
        nodeId: 'DEBATE',
        result: {
          output: {
            convergenceScore: 0.9,
            finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
            disagreementPoints: ['Implementation ordering differs between workers.'],
            candidateOptions: ['CODEX', 'GEMINI'],
            selectedOption: 'CODEX',
          },
          durationMs: 10,
          model: 'test-model',
        },
        invocation,
        definition,
        capturedAt: '2026-03-10T00:00:00.000Z',
        traceId: 'trace-DEBATE',
        tribunal: {
          tribunalId: 'tribunal-debate-quorum',
          runId: 'run-1',
          nodeId: 'DEBATE',
          mode: 'remote',
          verdict: 'agree',
          confidence: 0.81,
          quorumSatisfied: true,
          remoteJurorCount: 2,
          totalJurorCount: 2,
          rationale: 'Remote quorum accepted the debate result.',
          evidenceIds: [],
          jurorReportIds: ['judge-quorum', 'judge-noisy'],
          createdAt: '2026-03-10T00:00:00.000Z',
        },
        judgeReports: [
          {
            judgeReportId: 'judge-quorum',
            judge: 'independent-judge:quorum',
            verdict: 'agree',
            confidence: 0.81,
            rationale: 'quorum accepts the debate result',
            evidenceIds: [],
            createdAt: '2026-03-10T00:00:00.000Z',
          },
          {
            judgeReportId: 'judge-noisy',
            judge: 'independent-judge:model:noisy',
            verdict: 'needs_human',
            confidence: 0.1,
            rationale: 'single noisy judge disagreed',
            evidenceIds: [],
            createdAt: '2026-03-10T00:00:00.000Z',
          },
        ],
      }),
      receiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [],
      }),
      receiptFor('SYNTHESIZE', {
        finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Evidence-backed final recommendation.',
      }),
      receiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      receiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex proposes a structured migration with explicit evidence collection.', outputHash: 'hash-a', status: 'success' },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini proposes an independent verification-first workflow with explicit receipts.', outputHash: 'hash-b', status: 'success' },
          bothAvailable: true,
          disagreementScore: 0.4,
          skipAllowed: false,
        } },
        DEBATE: { output: {
          finalSummary: 'Merged summary with explicit rationale, risk notes, and release criteria that is long enough for validation.',
        } },
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the merged plan with no critical defects.',
          challengerModelId: 'deepseek',
        } },
        SYNTHESIZE: { output: { finalAnswer: 'Final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.', summary: 'Evidence-backed final recommendation.' } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({ definition, receipts, state })
    expect(decision.effect).toBe('allow')
  })

  it('allows adaptive release when DEBATE is policy skipped with evidence', () => {
    const skipDecision = createSkipDecision({
      runId: 'run-adaptive',
      nodeId: 'DEBATE',
      strategyId: 'adaptive.debate-express.v1',
      triggerCondition: 'PARALLEL.bothAvailable === true && PARALLEL.disagreementScore <= 0.5',
      approvedBy: 'antigravity-daemon.policy-engine',
      traceId: 'trace-adaptive-skip',
      decidedAt: '2026-03-10T00:00:01.000Z',
      reason: 'Parallel consensus was strong enough to skip DEBATE.',
    })
    const skipReceipt = createSkipExecutionReceipt({
      runId: 'run-adaptive',
      nodeId: 'DEBATE',
      decision: skipDecision,
      capturedAt: '2026-03-10T00:00:01.000Z',
    })
    const handoffs = createHandoffEnvelopes({
      runId: 'run-adaptive',
      nodeId: 'DEBATE',
      definition: adaptiveDefinition,
      receipt: skipReceipt,
      capturedAt: skipReceipt.capturedAt,
    })
    const receipts = [
      adaptiveReceiptFor('ANALYZE', {
        taskType: 'audit',
        taskAnalysis: 'This task requires a full audit of the workspace with explicit evidence collection and final daemon-owned review.',
        riskAssessment: 'medium',
        routePath: 'debate',
        tokenBudget: 'M',
        taskClass: 'text',
        verifiabilityClass: 'medium',
        fileList: ['/tmp/antigravity-workspace/src/index.ts'],
        keyConstraints: ['Keep execution daemon-owned and evidence-backed.'],
      }),
      adaptiveReceiptFor('PARALLEL', {
        executionMode: 'dual_model_parallel',
        codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex option with explicit evidence collection and migration notes.', outputHash: 'hash-a', status: 'success', confidence: 96 },
        gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini option with independent verification-first workflow and receipt coverage.', outputHash: 'hash-b', status: 'success', confidence: 95 },
        bothAvailable: true,
        disagreementScore: 0,
        skipAllowed: false,
      }),
      skipReceipt,
      adaptiveReceiptFor('VERIFY', {
        assuranceVerdict: 'PASS',
        verdict: 'AGREE',
        verificationReceiptSummary: 'Independent verification approved the adaptive plan with no critical defects.',
        challengerModelId: 'deepseek',
        complianceCheck: 'PASS',
        findings: [],
        oracleResults: [],
      }),
      adaptiveReceiptFor('SYNTHESIZE', {
        finalAnswer: 'Adaptive final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.',
        summary: 'Adaptive evidence-backed final recommendation.',
      }),
      adaptiveReceiptFor('PERSIST', { manifestUpdated: true, artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } }),
      adaptiveReceiptFor('HITL', { approvalRequired: false, gateStatus: 'autoCleared', gateId: 'antigravity-final-gate' }),
    ]
    const state = {
      nodes: {
        VERIFY: { output: {
          complianceCheck: 'PASS',
          verificationReceiptSummary: 'Independent verification approved the adaptive plan with no critical defects.',
          challengerModelId: 'deepseek',
        } },
        SYNTHESIZE: { output: { finalAnswer: 'Adaptive final answer with explicit implementation details, evidence-backed reasoning, and a complete release recommendation.', summary: 'Adaptive evidence-backed final recommendation.' } },
        PARALLEL: { output: {
          executionMode: 'dual_model_parallel',
          codex: { modelId: 'codex', taskId: 'codex-1', summary: 'Codex option with explicit evidence collection and migration notes.', outputHash: 'hash-a', status: 'success', confidence: 96 },
          gemini: { modelId: 'gemini', taskId: 'gemini-1', summary: 'Gemini option with independent verification-first workflow and receipt coverage.', outputHash: 'hash-b', status: 'success', confidence: 95 },
          bothAvailable: true,
          disagreementScore: 0,
          skipAllowed: false,
        } },
        PERSIST: { output: { artifactManifest: { artifactCount: 1, artifactKinds: ['run-projection'] } } },
        HITL: { output: { gateStatus: 'autoCleared' } },
      },
    } as unknown as WorkflowState

    const decision = evaluateReleaseGate({
      definition: adaptiveDefinition,
      receipts,
      state,
    })

    expect(handoffs[0]?.targetNodeId).toBe('VERIFY')
    expect(skipReceipt.status).toBe('policy_skipped')
    expect(skipReceipt.evidence.length).toBeGreaterThan(0)
    expect(decision.effect).toBe('allow')
    expect(decision.rationale).toEqual([])
  })
})
