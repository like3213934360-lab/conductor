import type { RunSnapshot, TimelineEntry } from './schema.js'

function hasTimelineKind(timeline: readonly TimelineEntry[], kind: string): boolean {
  return timeline.some(entry => entry.kind === kind)
}

export function evaluateRunInvariants(input: {
  snapshot: RunSnapshot
  timeline: readonly TimelineEntry[]
}): string[] {
  const failures: string[] = []
  const { snapshot, timeline } = input

  if (
    (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') &&
    !snapshot.completedAt
  ) {
    failures.push('terminal.completedAt')
  }

  if (snapshot.status === 'completed' && !hasTimelineKind(timeline, 'run.completed')) {
    failures.push('completed.timeline')
  }
  if (snapshot.status === 'failed' && !hasTimelineKind(timeline, 'run.failed')) {
    failures.push('failed.timeline')
  }
  if (snapshot.status === 'cancelled' && !hasTimelineKind(timeline, 'run.cancelled')) {
    failures.push('cancelled.timeline')
  }
  if (
    snapshot.status === 'paused_for_human' &&
    !hasTimelineKind(timeline, 'run.paused_for_human') &&
    !hasTimelineKind(timeline, 'run.blocked_for_human')
  ) {
    failures.push('paused_for_human.timeline')
  }

  if (snapshot.status === 'completed' && !snapshot.releaseArtifacts.traceBundle?.path) {
    failures.push('completed.traceBundle')
  }
  if (snapshot.status === 'completed' && !snapshot.releaseArtifacts.releaseAttestation?.path) {
    failures.push('completed.releaseAttestation')
  }
  if (snapshot.status === 'completed' && !snapshot.policyReport?.path) {
    failures.push('completed.policyReport')
  }
  if (snapshot.status === 'completed' && !snapshot.invariantReport?.path) {
    failures.push('completed.invariantReport')
  }
  if (snapshot.status === 'completed' && !snapshot.releaseDossier?.path) {
    failures.push('completed.releaseDossier')
  }
  if (snapshot.status === 'completed' && !snapshot.releaseBundle?.path) {
    failures.push('completed.releaseBundle')
  }
  if (snapshot.status === 'completed' && !snapshot.certificationRecord?.path) {
    failures.push('completed.certificationRecord')
  }
  if (snapshot.status === 'completed' && snapshot.activeLease) {
    failures.push('completed.activeLease')
  }
  if (snapshot.status === 'completed' && snapshot.activeHeartbeat) {
    failures.push('completed.activeHeartbeat')
  }
  if (snapshot.status === 'completed' && snapshot.pendingCompletionReceipt) {
    failures.push('completed.pendingCompletionReceipt')
  }
  if (snapshot.status === 'completed' && snapshot.preparedCompletionReceipt) {
    failures.push('completed.preparedCompletionReceipt')
  }

  if (snapshot.releaseArtifacts.traceBundle && snapshot.releaseArtifacts.traceBundle.issues.length > 0) {
    failures.push('traceBundle.issues')
  }
  if (snapshot.releaseArtifacts.releaseAttestation && snapshot.releaseArtifacts.releaseAttestation.issues.length > 0) {
    failures.push('releaseAttestation.issues')
  }
  if (snapshot.policyReport && snapshot.policyReport.issues.length > 0) {
    failures.push('policyReport.issues')
  }
  if (snapshot.invariantReport && snapshot.invariantReport.issues.length > 0) {
    failures.push('invariantReport.issues')
  }
  if (snapshot.releaseDossier && snapshot.releaseDossier.issues.length > 0) {
    failures.push('releaseDossier.issues')
  }
  if (snapshot.releaseBundle && snapshot.releaseBundle.issues.length > 0) {
    failures.push('releaseBundle.issues')
  }
  if (snapshot.certificationRecord && snapshot.certificationRecord.issues.length > 0) {
    failures.push('certificationRecord.issues')
  }

  if (
    snapshot.releaseArtifacts.releaseAttestation?.path &&
    !snapshot.releaseArtifacts.traceBundle?.path
  ) {
    failures.push('releaseAttestation.requiresTraceBundle')
  }
  if (
    snapshot.releaseBundle?.path &&
    !snapshot.releaseDossier?.path
  ) {
    failures.push('releaseBundle.requiresReleaseDossier')
  }
  if (
    snapshot.certificationRecord?.path &&
    !snapshot.releaseBundle?.path
  ) {
    failures.push('certificationRecord.requiresReleaseBundle')
  }

  return failures
}
