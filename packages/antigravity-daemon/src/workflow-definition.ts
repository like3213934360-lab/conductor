import type { RunGraph, RunRequest } from '@anthropic/antigravity-shared'
import { createISODateTime } from '@anthropic/antigravity-shared'
import type { WorkflowDefinition, WorkflowInvocation, WorkflowStepDefinition } from './schema.js'
import { ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

const STRICT_FULL_STEPS: WorkflowStepDefinition[] = [
  {
    id: 'ANALYZE',
    name: 'ANALYZE',
    dependsOn: [],
    capability: 'planner',
    description: 'Normalize user intent before worker delegation.',
    taskClass: 'analysis',
    verifiabilityClass: 'medium',
    outputSchemaId: 'antigravity.output.analyze.v1',
    qualityPolicy: {
      minTextLength: 50,
      minEvidenceCount: 2,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: false,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['goal', 'workspace-root'],
    budgetClass: 'S',
    skippable: false,
    modelContract: {
      role: 'task-analysis',
      modelPool: ['analysis'],
      judgeModelHints: [],
      requiresDistinctFromStages: [],
      forbidModelIds: [],
      judgeRequired: false,
    },
  },
  {
    id: 'PARALLEL',
    name: 'PARALLEL',
    dependsOn: ['ANALYZE'],
    capability: 'worker-swarm',
    description: 'Run codex and gemini in parallel for independent solution search.',
    taskClass: 'analysis',
    verifiabilityClass: 'medium',
    outputSchemaId: 'antigravity.output.parallel.v1',
    qualityPolicy: {
      minTextLength: 20,
      minEvidenceCount: 2,
      requireDistinctModelFamilies: true,
      requireJudgeSignal: false,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['analysis-receipt', 'parallel-receipts'],
    budgetClass: 'M',
    skippable: false,
    modelContract: {
      role: 'parallel-workers',
      modelPool: ['codex', 'gemini'],
      judgeModelHints: ['judge', 'verifier'],
      requiresDistinctFromStages: [],
      forbidModelIds: [],
      judgeRequired: true,
    },
  },
  {
    id: 'DEBATE',
    name: 'DEBATE',
    dependsOn: ['PARALLEL'],
    capability: 'deliberation',
    description: 'Resolve disagreement with critic-backed synthesis.',
    taskClass: 'analysis',
    verifiabilityClass: 'medium',
    outputSchemaId: 'antigravity.output.debate.v1',
    qualityPolicy: {
      minTextLength: 80,
      minEvidenceCount: 1,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: true,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['parallel-receipts', 'judge-signal'],
    budgetClass: 'M',
    skippable: false,
    modelContract: {
      role: 'critic-verifier',
      modelPool: ['judge'],
      judgeModelHints: ['judge', 'verifier'],
      requiresDistinctFromStages: ['PARALLEL'],
      forbidModelIds: [],
      judgeRequired: true,
    },
  },
  {
    id: 'VERIFY',
    name: 'VERIFY',
    dependsOn: ['DEBATE'],
    capability: 'verification',
    description: 'Independently challenge the selected plan.',
    taskClass: 'analysis',
    verifiabilityClass: 'high',
    outputSchemaId: 'antigravity.output.verify.v1',
    qualityPolicy: {
      minTextLength: 40,
      minEvidenceCount: 1,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: true,
      requireOracleForHighVerifiability: true,
    },
    evidenceRequirements: ['debate-summary', 'verification-receipt'],
    budgetClass: 'S',
    skippable: false,
    modelContract: {
      role: 'independent-verifier',
      modelPool: ['verifier'],
      judgeModelHints: ['judge', 'analysis'],
      requiresDistinctFromStages: ['PARALLEL', 'DEBATE'],
      forbidModelIds: [],
      judgeRequired: true,
    },
  },
  {
    id: 'SYNTHESIZE',
    name: 'SYNTHESIZE',
    dependsOn: ['VERIFY'],
    capability: 'report-synthesis',
    description: 'Produce the artifact-backed final answer.',
    taskClass: 'text',
    verifiabilityClass: 'medium',
    outputSchemaId: 'antigravity.output.synthesize.v1',
    qualityPolicy: {
      minTextLength: 80,
      minEvidenceCount: 1,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: false,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['verification-receipt', 'final-answer'],
    budgetClass: 'M',
    skippable: false,
    modelContract: {
      role: 'synthesizer',
      modelPool: ['synthesizer'],
      judgeModelHints: [],
      requiresDistinctFromStages: [],
      forbidModelIds: [],
      judgeRequired: false,
    },
  },
  {
    id: 'PERSIST',
    name: 'PERSIST',
    dependsOn: ['SYNTHESIZE'],
    capability: 'persistence',
    description: 'Persist artifacts, manifests, and run projections.',
    taskClass: 'governance',
    verifiabilityClass: 'high',
    outputSchemaId: 'antigravity.output.persist.v1',
    qualityPolicy: {
      minEvidenceCount: 1,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: false,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['artifact-manifest'],
    budgetClass: 'S',
    skippable: false,
  },
  {
    id: 'HITL',
    name: 'HITL',
    dependsOn: ['PERSIST'],
    capability: 'human-gate',
    description: 'Record final human approval state for Antigravity.',
    taskClass: 'governance',
    verifiabilityClass: 'high',
    outputSchemaId: 'antigravity.output.hitl.v1',
    qualityPolicy: {
      minEvidenceCount: 1,
      requireDistinctModelFamilies: false,
      requireJudgeSignal: false,
      requireOracleForHighVerifiability: false,
    },
    evidenceRequirements: ['release-gate'],
    budgetClass: 'S',
    skippable: false,
    approvalGate: {
      gateId: 'antigravity-final-gate',
      approverRole: 'antigravity-user',
      required: false,
    },
  },
]

const ADAPTIVE_STEPS: WorkflowStepDefinition[] = [
  STRICT_FULL_STEPS[0]!,
  STRICT_FULL_STEPS[1]!,
  {
    ...STRICT_FULL_STEPS[2]!,
    description: 'Resolve disagreement only when the daemon policy determines that parallel evidence is insufficient.',
    skippable: true,
    skipPolicy: {
      strategyId: 'adaptive.debate-express.v1',
      when: [
        'PARALLEL.bothAvailable === true',
        'PARALLEL.disagreementScore <= 0.5',
        'PARALLEL.minConfidence >= 85',
      ],
      approvalRequired: false,
    },
  },
  {
    ...STRICT_FULL_STEPS[3]!,
    evidenceRequirements: ['parallel-receipts', 'judge-signal', 'verification-receipt'],
  },
  STRICT_FULL_STEPS[4]!,
  STRICT_FULL_STEPS[5]!,
  STRICT_FULL_STEPS[6]!,
]

export function resolveWorkflowDefinition(invocation: WorkflowInvocation): WorkflowDefinition {
  if (invocation.workflowId === 'antigravity.adaptive') {
    return {
      workflowId: invocation.workflowId,
      version: invocation.workflowVersion,
      templateName: 'antigravity.adaptive.v1',
      authorityMode: 'daemon-owned',
      generatedAt: createISODateTime(),
      description: 'Antigravity adaptive workflow with policy-authorized debate skipping and daemon-enforced authority.',
      steps: ADAPTIVE_STEPS,
    }
  }

  if (invocation.workflowId !== 'antigravity.strict-full') {
    throw new Error(`Unsupported Antigravity workflowId: ${invocation.workflowId}`)
  }

  return {
    workflowId: invocation.workflowId,
    version: invocation.workflowVersion,
    templateName: 'antigravity.strict-full.v1',
    authorityMode: 'daemon-owned',
    generatedAt: createISODateTime(),
    description: 'Antigravity-specific full-path workflow with daemon-enforced execution authority.',
    steps: STRICT_FULL_STEPS,
  }
}

export function compileWorkflowDefinition(definition: WorkflowDefinition): RunGraph {
  return {
    nodes: definition.steps.map(step => ({
      id: step.id,
      name: step.name,
      dependsOn: step.dependsOn,
      input: {
        capability: step.capability,
        description: step.description,
        taskClass: step.taskClass,
        verifiabilityClass: step.verifiabilityClass,
        outputSchemaId: step.outputSchemaId,
        qualityPolicy: step.qualityPolicy,
        evidenceRequirements: step.evidenceRequirements,
        budgetClass: step.budgetClass,
        approvalGate: step.approvalGate,
        skipPolicy: step.skipPolicy,
        modelContract: step.modelContract,
      },
      skippable: step.skippable,
      priority: 0,
      model: step.modelContract?.modelHint,
    })),
    edges: definition.steps.flatMap(step => step.dependsOn.map(dep => ({ from: dep, to: step.id }))),
  }
}

export function createRunRequest(
  invocation: WorkflowInvocation,
  graph: RunGraph,
): RunRequest {
  return {
    graph,
    metadata: {
      goal: invocation.goal,
      repoRoot: invocation.workspaceRoot,
      files: invocation.files,
      initiator: invocation.initiator,
      createdAt: createISODateTime(),
    },
    options: {
      debug: false,
      forceFullPath: invocation.forceFullPath,
      plugins: [ANTIGRAVITY_AUTHORITY_OWNER, 'antigravity-bridge'],
      riskHint: invocation.options.riskHint,
      tokenBudget: invocation.options.tokenBudget,
    },
  }
}

export function getWorkflowDisplayName(definition: WorkflowDefinition): string {
  return `${definition.workflowId}@${definition.version}`
}
