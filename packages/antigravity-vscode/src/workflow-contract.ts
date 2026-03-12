export interface WorkflowCommandContract {
  readonly id: string
  readonly title: string
  readonly description: string
}

export const WORKFLOW_COMMAND_IDS = {
  openPanel: 'antigravity.openPanel',
  runWorkflow: 'antigravity.runWorkflow',
  getRunSession: 'antigravity.getRunSession',
  getRun: 'antigravity.getRun',
  streamRun: 'antigravity.streamRun',
  approveGate: 'antigravity.approveGate',
  cancelRun: 'antigravity.cancelRun',
  replayRun: 'antigravity.replayRun',
  reloadPolicyPack: 'antigravity.reloadPolicyPack',
  reloadTrustRegistry: 'antigravity.reloadTrustRegistry',
  exportTraceBundle: 'antigravity.exportTraceBundle',
  getReleaseArtifacts: 'antigravity.getReleaseArtifacts',
  getPolicyReport: 'antigravity.getPolicyReport',
  verifyReleaseArtifacts: 'antigravity.verifyReleaseArtifacts',
  verifyPolicyReport: 'antigravity.verifyPolicyReport',
  getInvariantReport: 'antigravity.getInvariantReport',
  verifyInvariantReport: 'antigravity.verifyInvariantReport',
  getReleaseAttestation: 'antigravity.getReleaseAttestation',
  verifyReleaseAttestation: 'antigravity.verifyReleaseAttestation',
  getReleaseBundle: 'antigravity.getReleaseBundle',
  verifyReleaseBundle: 'antigravity.verifyReleaseBundle',
  getReleaseDossier: 'antigravity.getReleaseDossier',
  verifyReleaseDossier: 'antigravity.verifyReleaseDossier',
  getCertificationRecord: 'antigravity.getCertificationRecord',
  verifyCertificationRecord: 'antigravity.verifyCertificationRecord',
  getTransparencyLedger: 'antigravity.getTransparencyLedger',
  verifyTransparencyLedger: 'antigravity.verifyTransparencyLedger',
  runBenchmark: 'antigravity.runBenchmark',
  runInteropHarness: 'antigravity.runInteropHarness',
  toggleArktsLsp: 'antigravity.toggleArktsLsp',
} as const

export const WORKFLOW_COMMANDS: readonly WorkflowCommandContract[] = [
  {
    id: WORKFLOW_COMMAND_IDS.openPanel,
    title: 'Antigravity Workflow: 打开控制面板',
    description: 'Open the Antigravity dashboard control plane.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.runWorkflow,
    title: 'Antigravity Workflow: 运行 Antigravity 工作流',
    description: 'Start a daemon-owned Antigravity workflow run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getRunSession,
    title: 'Antigravity Workflow: 查看 Run Session',
    description: 'Read the active daemon-issued step lease and session state.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getRun,
    title: 'Antigravity Workflow: 查看当前工作流',
    description: 'Fetch the latest daemon-owned run snapshot.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.streamRun,
    title: 'Antigravity Workflow: 实时查看工作流',
    description: 'Stream daemon timeline updates for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.approveGate,
    title: 'Antigravity Workflow: 审批工作流门禁',
    description: 'Approve the active human gate and resume if needed.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.cancelRun,
    title: 'Antigravity Workflow: 取消当前工作流',
    description: 'Cancel the active daemon-owned run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.replayRun,
    title: 'Antigravity Workflow: 重放当前工作流',
    description: 'Replay the active run with the same workflow invocation.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.reloadPolicyPack,
    title: 'Antigravity Workflow: 重载 Policy Pack',
    description: 'Reload the daemon policy-as-code pack from the workspace file.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.reloadTrustRegistry,
    title: 'Antigravity Workflow: 重载 Trust Registry',
    description: 'Reload the daemon trust registry from the workspace file.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.exportTraceBundle,
    title: 'Antigravity Workflow: 导出 Trace Bundle',
    description: 'Export the replayable trace bundle for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getReleaseArtifacts,
    title: 'Antigravity Workflow: 查看 Release Artifacts',
    description: 'Read the aggregated release artifact surface for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getPolicyReport,
    title: 'Antigravity Workflow: 查看 Policy Report',
    description: 'Read the exported policy report for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyReleaseArtifacts,
    title: 'Antigravity Workflow: 校验 Release Artifacts',
    description: 'Verify the aggregated release artifact surface for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyPolicyReport,
    title: 'Antigravity Workflow: 校验 Policy Report',
    description: 'Verify the policy report payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getInvariantReport,
    title: 'Antigravity Workflow: 查看 Invariant Report',
    description: 'Read the exported invariant report for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyInvariantReport,
    title: 'Antigravity Workflow: 校验 Invariant Report',
    description: 'Verify the invariant report payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getReleaseAttestation,
    title: 'Antigravity Workflow: 查看 Release Attestation',
    description: 'Read the exported release attestation for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyReleaseAttestation,
    title: 'Antigravity Workflow: 校验 Release Attestation',
    description: 'Verify the release attestation payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getReleaseBundle,
    title: 'Antigravity Workflow: 查看 Release Bundle',
    description: 'Read the exported release bundle for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyReleaseBundle,
    title: 'Antigravity Workflow: 校验 Release Bundle',
    description: 'Verify the release bundle payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getReleaseDossier,
    title: 'Antigravity Workflow: 查看 Release Dossier',
    description: 'Read the exported release dossier for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyReleaseDossier,
    title: 'Antigravity Workflow: 校验 Release Dossier',
    description: 'Verify the release dossier payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getCertificationRecord,
    title: 'Antigravity Workflow: 查看 Certification Record',
    description: 'Read the exported certification record for the active run.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyCertificationRecord,
    title: 'Antigravity Workflow: 校验 Certification Record',
    description: 'Verify the certification record payload digest and signature provenance.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getTransparencyLedger,
    title: 'Antigravity Workflow: 查看 Transparency Ledger',
    description: 'Read the append-only transparency ledger for the active workspace.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.verifyTransparencyLedger,
    title: 'Antigravity Workflow: 校验 Transparency Ledger',
    description: 'Verify the transparency ledger hash chain for the active workspace.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.runBenchmark,
    title: 'Antigravity Workflow: 运行 Antigravity Benchmark',
    description: 'Run the dataset-backed daemon benchmark harness.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.runInteropHarness,
    title: 'Antigravity Workflow: 运行互操作 Harness',
    description: 'Run the Antigravity interoperability harness.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.toggleArktsLsp,
    title: 'Antigravity Workflow: 切换 ArkTS LSP',
    description: 'Enable or disable the optional ArkTS LSP subsystem.',
  },
]
