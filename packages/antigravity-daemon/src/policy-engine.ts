import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import { z } from 'zod'
import type { GovernanceDecisionRecord } from '@anthropic/antigravity-shared'
import type { ReleaseGateDecision } from './evidence-policy.js'
import type { HumanApprovalRequirement } from './hitl-policy.js'
import type { VerifyTraceBundleReport } from './schema.js'
import {
  PolicyConditionSchema,
  PolicyRuleSchema,
  type PolicyCondition,
  type PolicyPack,
  type PolicyRule,
  type PolicyVerdict,
} from './schema.js'
import { ANTIGRAVITY_AUTHORITY_OWNER } from './runtime-contract.js'

type PolicyEffect = PolicyVerdict['effect']
type PolicyFactValue = unknown

interface PolicyEvaluation {
  effect: PolicyEffect
  rationale: string[]
  evidenceIds?: string[]
}

type PolicyFacts = Record<string, PolicyFactValue>

export interface PreflightPolicyInput {
  runId: string
  governance: GovernanceDecisionRecord
  drScore: number
  evaluatedAt: string
}

export interface ReleasePolicyInput {
  runId: string
  decision: ReleaseGateDecision
  evaluatedAt: string
}

export interface HumanGatePolicyInput {
  runId: string
  requirement: HumanApprovalRequirement
  evaluatedAt: string
}

export interface ApprovalPolicyInput {
  runId: string
  gateId: string
  approvedBy: string
  comment?: string
  evaluatedAt: string
}

export interface ResumePolicyInput {
  runId: string
  approvedBy?: string
  comment?: string
  evaluatedAt: string
}

export interface SkipPolicyInput {
  runId: string
  nodeId: string
  strategyId: string
  triggerCondition: string
  reason: string
  evidenceIds?: string[]
  evaluatedAt: string
}

export interface TraceBundlePolicyInput {
  runId: string
  report: VerifyTraceBundleReport
  evaluatedAt: string
}

export interface ReleaseAttestationPolicyInput {
  runId: string
  attestationPath: string
  ok: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  issues: string[]
  evaluatedAt: string
}

export interface ReleaseDossierPolicyInput {
  runId: string
  dossierPath: string
  ok: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  issues: string[]
  evaluatedAt: string
}

export interface ReleaseBundlePolicyInput {
  runId: string
  bundlePath: string
  ok: boolean
  signatureVerified: boolean
  signatureRequired: boolean
  issues: string[]
  evaluatedAt: string
}

interface EngineConfig {
  packId: string
  version: string
  rules: PolicyRule[]
}

const PolicyRuleOverrideSchema = z.object({
  ruleId: z.string(),
  scope: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  effect: z.enum(['allow', 'warn', 'block']).optional(),
  when: PolicyConditionSchema.optional(),
  message: z.string().optional(),
  evidenceFactKey: z.string().optional(),
})

const PolicyPackFileSchema = z.object({
  packId: z.string().optional(),
  version: z.string().optional(),
  rules: z.array(PolicyRuleOverrideSchema).default([]),
})

type PolicyRuleOverride = z.infer<typeof PolicyRuleOverrideSchema>
type PolicyPackFile = z.infer<typeof PolicyPackFileSchema>

export interface DaemonPolicyEngineOptions {
  policyPackPath?: string
}

function strongestEffect(a: PolicyEffect, b: PolicyEffect): PolicyEffect {
  const rank: Record<PolicyEffect, number> = { allow: 0, warn: 1, block: 2 }
  return rank[a] >= rank[b] ? a : b
}

function createVerdictId(runId: string, scope: string): string {
  return crypto.createHash('sha256').update(`${runId}:${scope}`).digest('hex').slice(0, 24)
}

function mergeEvaluations(
  runId: string,
  scope: string,
  evaluatedAt: string,
  evaluations: readonly PolicyEvaluation[],
): PolicyVerdict {
  const effect = evaluations.reduce<PolicyEffect>(
    (current, evaluation) => strongestEffect(current, evaluation.effect),
    'allow',
  )
  const rationale = evaluations.flatMap(evaluation => evaluation.rationale)
  const evidenceIds = Array.from(new Set(evaluations.flatMap(evaluation => evaluation.evidenceIds ?? [])))

  return {
    verdictId: createVerdictId(runId, scope),
    runId,
    scope,
    effect,
    rationale,
    evidenceIds,
    evaluatedAt,
  }
}

function trimValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function createDefaultRules(): PolicyRule[] {
  return [
    {
      ruleId: 'preflight.governance-block',
      scope: 'preflight',
      description: 'Block daemon-owned workflow starts when governance denies execution.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'governanceAllowed' },
      message: '{{governanceFindingsText}}',
    },
    {
      ruleId: 'preflight.governance-clear',
      scope: 'preflight',
      description: 'Record explicit governance clearance before a daemon-owned run starts.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'governanceAllowed' },
      message: 'Governance preflight cleared.',
    },
    {
      ruleId: 'preflight.high-disagreement-warning',
      scope: 'preflight',
      description: 'Warn when initial disagreement is high enough to warrant deliberation.',
      enabled: true,
      effect: 'warn',
      when: { kind: 'gte', fact: 'drScore', value: 0.75 },
      message: 'Initial disagreement score {{drScore}} reached threshold 0.75.',
    },
    {
      ruleId: 'preflight.normal-disagreement',
      scope: 'preflight',
      description: 'Record that the initial disagreement score stays within the normal operating range.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'lt', fact: 'drScore', value: 0.75 },
      message: 'Initial disagreement score is within the normal operating range.',
    },
    {
      ruleId: 'release.evidence-gate-block',
      scope: 'release',
      description: 'Block run completion when the evidence gate denies release.',
      enabled: true,
      effect: 'block',
      when: { kind: 'ne', fact: 'releaseDecision', value: 'allow' },
      message: '{{releaseRationaleText}}',
      evidenceFactKey: 'releaseEvidenceIds',
    },
    {
      ruleId: 'release.evidence-gate-allow',
      scope: 'release',
      description: 'Record successful evidence-gated release decisions.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'eq', fact: 'releaseDecision', value: 'allow' },
      message: 'Evidence gate satisfied; release allowed.',
      evidenceFactKey: 'releaseEvidenceIds',
    },
    {
      ruleId: 'human-gate.required-approval',
      scope: 'human-gate',
      description: 'Warn when a run still requires human approval.',
      enabled: true,
      effect: 'warn',
      when: { kind: 'truthy', fact: 'humanGateRequired' },
      message: '{{humanGateReason}}',
    },
    {
      ruleId: 'human-gate.cleared',
      scope: 'human-gate',
      description: 'Record when no human approval is required.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'falsy', fact: 'humanGateRequired' },
      message: 'No human approval required after release evaluation.',
    },
    {
      ruleId: 'approval.approver-required',
      scope: 'approval',
      description: 'Require approver identity whenever a human gate is cleared.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'actorPresent' },
      message: 'Approval gate {{gateId}} requires a non-empty approver identity.',
    },
    {
      ruleId: 'approval.recorded',
      scope: 'approval',
      description: 'Record successful approval actions in the policy timeline.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'actorPresent' },
      message: '{{approvalMessage}}',
    },
    {
      ruleId: 'resume.actor-required',
      scope: 'resume',
      description: 'Require reviewer identity whenever a paused run is resumed.',
      enabled: false,
      effect: 'block',
      when: { kind: 'falsy', fact: 'actorPresent' },
      message: 'Resume requires a reviewer identity under the active policy pack.',
    },
    {
      ruleId: 'skip.policy-authorized',
      scope: 'skip',
      description: 'Record policy-authorized skip decisions with explicit strategy and trigger condition.',
      enabled: true,
      effect: 'allow',
      message: '{{skipMessage}}',
      evidenceFactKey: 'evidenceIds',
    },
    {
      ruleId: 'skip.evidence-required',
      scope: 'skip',
      description: 'Require evidence on policy-authorized skips when the active policy pack enables it.',
      enabled: false,
      effect: 'block',
      when: { kind: 'empty', fact: 'evidenceIds' },
      message: 'Policy-authorized skip requires at least one evidence id under the active policy pack.',
    },
    {
      ruleId: 'trace-bundle.integrity-block',
      scope: 'trace-bundle',
      description: 'Block release when exported trace bundle integrity or signature verification fails.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'traceBundleOk' },
      message: '{{traceBundleIssueText}}',
    },
    {
      ruleId: 'trace-bundle.integrity-allow',
      scope: 'trace-bundle',
      description: 'Record successful trace bundle integrity verification.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'traceBundleOk' },
      message: 'Trace bundle integrity and signature checks passed.',
    },
    {
      ruleId: 'release-attestation.block',
      scope: 'release-attestation',
      description: 'Block release when release attestation verification fails.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'releaseAttestationOk' },
      message: '{{releaseAttestationIssueText}}',
    },
    {
      ruleId: 'release-attestation.allow',
      scope: 'release-attestation',
      description: 'Record successful release attestation verification.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'releaseAttestationOk' },
      message: 'Release attestation checks passed.',
    },
    {
      ruleId: 'release-dossier.block',
      scope: 'release-dossier',
      description: 'Block release when release dossier verification fails.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'releaseDossierOk' },
      message: '{{releaseDossierIssueText}}',
    },
    {
      ruleId: 'release-dossier.allow',
      scope: 'release-dossier',
      description: 'Record successful release dossier verification.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'releaseDossierOk' },
      message: 'Release dossier checks passed.',
    },
    {
      ruleId: 'release-bundle.block',
      scope: 'release-bundle',
      description: 'Block release when release bundle verification fails.',
      enabled: true,
      effect: 'block',
      when: { kind: 'falsy', fact: 'releaseBundleOk' },
      message: '{{releaseBundleIssueText}}',
    },
    {
      ruleId: 'release-bundle.allow',
      scope: 'release-bundle',
      description: 'Record successful release bundle verification.',
      enabled: true,
      effect: 'allow',
      when: { kind: 'truthy', fact: 'releaseBundleOk' },
      message: 'Release bundle checks passed.',
    },
  ]
}

function buildDefaultConfig(): EngineConfig {
  return {
    packId: 'antigravity-daemon-policy-pack',
    version: '2.0.0',
    rules: createDefaultRules(),
  }
}

function mergeRule(base: PolicyRule | undefined, override: PolicyRuleOverride): PolicyRule {
  if (!base) {
    return PolicyRuleSchema.parse(override)
  }
  return PolicyRuleSchema.parse({
    ruleId: base.ruleId,
    scope: override.scope ?? base.scope,
    description: override.description ?? base.description,
    enabled: override.enabled ?? base.enabled,
    effect: override.effect ?? base.effect,
    when: override.when ?? base.when,
    message: override.message ?? base.message,
    evidenceFactKey: override.evidenceFactKey ?? base.evidenceFactKey,
  })
}

function mergeConfig(base: EngineConfig, file: PolicyPackFile): EngineConfig {
  const mergedRules = new Map(base.rules.map(rule => [rule.ruleId, rule]))
  for (const override of file.rules) {
    mergedRules.set(override.ruleId, mergeRule(mergedRules.get(override.ruleId), override))
  }
  return {
    packId: file.packId ?? base.packId,
    version: file.version ?? base.version,
    rules: Array.from(mergedRules.values()),
  }
}

function createPack(
  config: EngineConfig,
  policyPackPath: string | undefined,
  loadedAt: string,
): PolicyPack {
  return {
    packId: config.packId,
    version: config.version,
    authorityOwner: ANTIGRAVITY_AUTHORITY_OWNER,
    sourcePath: policyPackPath,
    loadedAt,
    rules: config.rules,
  }
}

function getFactValue(facts: PolicyFacts, factPath: string): unknown {
  return factPath.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, facts)
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function evaluateCondition(condition: PolicyCondition, facts: PolicyFacts): boolean {
  switch (condition.kind) {
    case 'all':
      return condition.conditions.every(item => evaluateCondition(item, facts))
    case 'any':
      return condition.conditions.some(item => evaluateCondition(item, facts))
    case 'not':
      return !evaluateCondition(condition.condition, facts)
    case 'eq':
      return getFactValue(facts, condition.fact) === condition.value
    case 'ne':
      return getFactValue(facts, condition.fact) !== condition.value
    case 'gt':
      return Number(getFactValue(facts, condition.fact)) > condition.value
    case 'gte':
      return Number(getFactValue(facts, condition.fact)) >= condition.value
    case 'lt':
      return Number(getFactValue(facts, condition.fact)) < condition.value
    case 'lte':
      return Number(getFactValue(facts, condition.fact)) <= condition.value
    case 'truthy':
      return Boolean(getFactValue(facts, condition.fact))
    case 'falsy':
      return !Boolean(getFactValue(facts, condition.fact))
    case 'empty':
      return isEmptyValue(getFactValue(facts, condition.fact))
    case 'notEmpty':
      return !isEmptyValue(getFactValue(facts, condition.fact))
    case 'includes': {
      const value = getFactValue(facts, condition.fact)
      if (Array.isArray(value)) {
        return value.includes(condition.value)
      }
      if (typeof value === 'string') {
        return value.includes(String(condition.value))
      }
      return false
    }
  }
}

function formatTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function renderTemplate(template: string, facts: PolicyFacts): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, factPath: string) => {
    const value = getFactValue(facts, factPath)
    return formatTemplateValue(value)
  }).trim()
}

function readEvidenceIds(rule: PolicyRule, facts: PolicyFacts): string[] | undefined {
  if (!rule.evidenceFactKey) return undefined
  const value = getFactValue(facts, rule.evidenceFactKey)
  if (!Array.isArray(value)) return undefined
  return value
    .map(item => typeof item === 'string' ? item : undefined)
    .filter((item): item is string => Boolean(item))
}

function createFactsForPreflight(input: PreflightPolicyInput): PolicyFacts {
  return {
    governanceAllowed: input.governance.allowed,
    governanceWorstStatus: input.governance.worstStatus,
    governanceFindings: input.governance.findings.map(item => item.message),
    governanceFindingsText: input.governance.findings.length > 0
      ? input.governance.findings.map(item => item.message).join('; ')
      : 'Governance preflight blocked workflow start.',
    drScore: Number(input.drScore.toFixed(2)),
  }
}

function createFactsForRelease(input: ReleasePolicyInput): PolicyFacts {
  return {
    releaseDecision: input.decision.effect,
    releaseRationale: input.decision.rationale,
    releaseRationaleText: input.decision.effect === 'allow'
      ? 'Evidence gate satisfied; release allowed.'
      : input.decision.rationale.join('; '),
    releaseEvidenceIds: input.decision.evidenceIds,
    releaseEvidenceCount: input.decision.evidenceIds.length,
  }
}

function createFactsForHumanGate(input: HumanGatePolicyInput): PolicyFacts {
  return {
    humanGateRequired: input.requirement.required,
    humanGateReason: input.requirement.reason ?? 'Human approval required before final release.',
  }
}

function createFactsForApproval(input: ApprovalPolicyInput): PolicyFacts {
  const approvedBy = trimValue(input.approvedBy)
  return {
    gateId: input.gateId,
    approvedBy: approvedBy ?? '',
    actorPresent: Boolean(approvedBy),
    approvalMessage: input.comment ?? `Approval gate ${input.gateId} cleared by ${approvedBy}.`,
  }
}

function createFactsForResume(input: ResumePolicyInput): PolicyFacts {
  const approvedBy = trimValue(input.approvedBy)
  return {
    approvedBy: approvedBy ?? '',
    actorPresent: Boolean(approvedBy),
    resumeMessage: input.comment ?? `Paused run resumed by ${approvedBy ?? 'unknown'}.`,
  }
}

function createFactsForSkip(input: SkipPolicyInput): PolicyFacts {
  return {
    nodeId: input.nodeId,
    strategyId: input.strategyId,
    triggerCondition: input.triggerCondition,
    reason: input.reason,
    evidenceIds: input.evidenceIds ?? [],
    evidenceCount: (input.evidenceIds ?? []).length,
    skipMessage: `${input.strategyId}: ${input.reason}; triggerCondition=${input.triggerCondition}`,
  }
}

function createFactsForTraceBundle(input: TraceBundlePolicyInput): PolicyFacts {
  const issueList = [
    ...input.report.mismatchedEntries.map(item => `mismatch:${item}`),
    ...input.report.missingEntries.map(item => `missing:${item}`),
    ...input.report.failedSignatureChecks.map(item => `signature:${item}`),
  ]
  return {
    traceBundleOk: input.report.ok,
    traceBundlePath: input.report.bundlePath,
    traceBundleAlgorithm: input.report.algorithm,
    traceBundleActualDigest: input.report.actualBundleDigest,
    traceBundleExpectedDigest: input.report.expectedBundleDigest ?? '',
    traceBundleSignatureVerified: input.report.signatureVerified,
    traceBundleSignatureRequired: input.report.signatureRequired,
    traceBundleSignaturePolicyId: input.report.signaturePolicyId ?? '',
    traceBundleSignatureKeyId: input.report.signatureKeyId ?? '',
    traceBundleSignatureIssuer: input.report.signatureIssuer ?? '',
    traceBundleIssues: issueList,
    traceBundleIssueText: issueList.length > 0
      ? `Trace bundle verification failed: ${issueList.join('; ')}`
      : 'Trace bundle verification failed.',
  }
}

function createFactsForReleaseAttestation(input: ReleaseAttestationPolicyInput): PolicyFacts {
  return {
    releaseAttestationOk: input.ok,
    releaseAttestationPath: input.attestationPath,
    releaseAttestationSignatureVerified: input.signatureVerified,
    releaseAttestationSignatureRequired: input.signatureRequired,
    releaseAttestationIssues: input.issues,
    releaseAttestationIssueText: input.issues.length > 0
      ? `Release attestation verification failed: ${input.issues.join('; ')}`
      : 'Release attestation verification failed.',
  }
}

function createFactsForReleaseDossier(input: ReleaseDossierPolicyInput): PolicyFacts {
  return {
    releaseDossierOk: input.ok,
    releaseDossierPath: input.dossierPath,
    releaseDossierSignatureVerified: input.signatureVerified,
    releaseDossierSignatureRequired: input.signatureRequired,
    releaseDossierIssues: input.issues,
    releaseDossierIssueText: input.issues.length > 0
      ? `Release dossier verification failed: ${input.issues.join('; ')}`
      : 'Release dossier verification failed.',
  }
}

function createFactsForReleaseBundle(input: ReleaseBundlePolicyInput): PolicyFacts {
  return {
    releaseBundleOk: input.ok,
    releaseBundlePath: input.bundlePath,
    releaseBundleSignatureVerified: input.signatureVerified,
    releaseBundleSignatureRequired: input.signatureRequired,
    releaseBundleIssues: input.issues,
    releaseBundleIssueText: input.issues.length > 0
      ? `Release bundle verification failed: ${input.issues.join('; ')}`
      : 'Release bundle verification failed.',
  }
}

export class DaemonPolicyEngine {
  private readonly policyPackPath?: string
  private config: EngineConfig
  private pack: PolicyPack

  constructor(options: DaemonPolicyEngineOptions = {}) {
    this.policyPackPath = trimValue(options.policyPackPath)
    this.config = buildDefaultConfig()
    this.pack = createPack(this.config, this.policyPackPath, new Date(0).toISOString())
    this.reload()
  }

  reload(): PolicyPack {
    const loadedAt = new Date().toISOString()
    const base = buildDefaultConfig()

    if (!this.policyPackPath || !fs.existsSync(this.policyPackPath)) {
      this.config = base
      this.pack = createPack(this.config, undefined, loadedAt)
      return this.pack
    }

    const raw = fs.readFileSync(this.policyPackPath, 'utf8').trim()
    if (!raw) {
      this.config = base
      this.pack = createPack(this.config, this.policyPackPath, loadedAt)
      return this.pack
    }

    const file = PolicyPackFileSchema.parse(JSON.parse(raw))
    this.config = mergeConfig(base, file)
    this.pack = createPack(this.config, this.policyPackPath, loadedAt)
    return this.pack
  }

  exportPack(): PolicyPack {
    return this.pack
  }

  evaluatePreflight(input: PreflightPolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'preflight',
      verdictScope: 'preflight',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForPreflight(input),
      fallbackMessage: 'Preflight checks passed under the active policy pack.',
    })
  }

  evaluateRelease(input: ReleasePolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'release',
      verdictScope: 'release',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForRelease(input),
      fallbackMessage: 'Release checks passed under the active policy pack.',
    })
  }

  evaluateHumanGate(input: HumanGatePolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'human-gate',
      verdictScope: 'human-gate',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForHumanGate(input),
      fallbackMessage: 'Human gate checks passed under the active policy pack.',
    })
  }

  evaluateApproval(input: ApprovalPolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'approval',
      verdictScope: `approval:${input.gateId}`,
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForApproval(input),
      fallbackMessage: `Approval gate ${input.gateId} passed under the active policy pack.`,
    })
  }

  evaluateResume(input: ResumePolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'resume',
      verdictScope: 'resume',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForResume(input),
      fallbackMessage: 'Resume checks passed under the active policy pack.',
    })
  }

  evaluateSkip(input: SkipPolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'skip',
      verdictScope: `skip:${input.nodeId}`,
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForSkip(input),
      fallbackMessage: `${input.strategyId}: ${input.reason}; triggerCondition=${input.triggerCondition}`,
    })
  }

  evaluateTraceBundle(input: TraceBundlePolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'trace-bundle',
      verdictScope: 'trace-bundle',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForTraceBundle(input),
      fallbackMessage: 'Trace bundle checks passed under the active policy pack.',
    })
  }

  evaluateReleaseAttestation(input: ReleaseAttestationPolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'release-attestation',
      verdictScope: 'release-attestation',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForReleaseAttestation(input),
      fallbackMessage: 'Release attestation checks passed under the active policy pack.',
    })
  }

  evaluateReleaseDossier(input: ReleaseDossierPolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'release-dossier',
      verdictScope: 'release-dossier',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForReleaseDossier(input),
      fallbackMessage: 'Release dossier checks passed under the active policy pack.',
    })
  }

  evaluateReleaseBundle(input: ReleaseBundlePolicyInput): PolicyVerdict {
    return this.evaluateScope({
      runId: input.runId,
      ruleScope: 'release-bundle',
      verdictScope: 'release-bundle',
      evaluatedAt: input.evaluatedAt,
      facts: createFactsForReleaseBundle(input),
      fallbackMessage: 'Release bundle checks passed under the active policy pack.',
    })
  }

  private evaluateScope(params: {
    runId: string
    ruleScope: string
    verdictScope: string
    evaluatedAt: string
    facts: PolicyFacts
    fallbackMessage: string
  }): PolicyVerdict {
    const rules = this.pack.rules.filter(rule => rule.scope === params.ruleScope && rule.enabled !== false)
    const evaluations: PolicyEvaluation[] = []

    for (const rule of rules) {
      if (rule.when && !evaluateCondition(rule.when, params.facts)) {
        continue
      }
      const rationaleText = renderTemplate(rule.message ?? rule.description, params.facts)
      evaluations.push({
        effect: rule.effect,
        rationale: [rationaleText],
        evidenceIds: readEvidenceIds(rule, params.facts),
      })
    }

    if (evaluations.length === 0) {
      evaluations.push({
        effect: 'allow',
        rationale: [params.fallbackMessage],
      })
    }

    return mergeEvaluations(params.runId, params.verdictScope, params.evaluatedAt, evaluations)
  }
}
