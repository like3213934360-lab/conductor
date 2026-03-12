import type { WorkflowState } from '@anthropic/antigravity-shared'
import type { NodeExecutionResult } from '@anthropic/antigravity-model-core'

export interface HumanApprovalRequirement {
  required: boolean
  reason?: string
}

export function deriveHumanApprovalRequirement(state: WorkflowState | null): HumanApprovalRequirement {
  const output = state?.nodes.HITL?.output
  if (!output || output.approvalRequired !== true) {
    return { required: false }
  }

  const reason =
    typeof output.gateStatus === 'string' ? output.gateStatus :
    typeof output.hostAction === 'string' ? output.hostAction :
    'HITL gate requires human approval'

  return { required: true, reason }
}

export function resultNeedsHumanApproval(result: Pick<NodeExecutionResult, 'output'>): boolean {
  return result.output.approvalRequired === true
}
