import { describe, expect, it } from 'vitest'
import type { WorkflowState } from '@anthropic/antigravity-shared'
import { deriveHumanApprovalRequirement, resultNeedsHumanApproval } from '../hitl-policy.js'

describe('HITL approval policy', () => {
  it('requires approval when HITL output demands it', () => {
    const state = {
      nodes: {
        HITL: {
          nodeId: 'HITL',
          status: 'completed',
          output: {
            approvalRequired: true,
            gateStatus: 'needsHumanReview',
          },
        },
      },
    } as unknown as WorkflowState

    expect(deriveHumanApprovalRequirement(state)).toEqual({
      required: true,
      reason: 'needsHumanReview',
    })
  })

  it('does not require approval when HITL output is absent', () => {
    const state = {
      nodes: {},
    } as unknown as WorkflowState

    expect(deriveHumanApprovalRequirement(state)).toEqual({
      required: false,
    })
  })

  it('marks HITL result as requiring approval based on output flag', () => {
    expect(resultNeedsHumanApproval({
      output: {
        approvalRequired: true,
      },
    })).toBe(true)

    expect(resultNeedsHumanApproval({
      output: {
        approvalRequired: false,
      },
    })).toBe(false)
  })
})
