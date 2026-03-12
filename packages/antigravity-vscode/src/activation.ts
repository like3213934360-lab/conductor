/**
 * Antigravity Workflow VS Code — 激活入口
 *
 * 组装 SettingsManager / DashboardPanel / StatusBar / AutoConfig / daemon bridge。
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SettingsManager } from './settings-manager.js';
import { DashboardPanel } from './dashboard-panel.js';
import type { IHistoryStorage } from './dashboard-panel.js';
import type { ArktsLspControlSurface } from './arkts-lsp-surface.js';
import { AntigravityStatusBar } from './status-bar.js';
import { syncModelCatalogToFile, autoRegisterMcpConfig, autoInstallSkill, autoInjectRoutingRules } from './auto-config.js';
import { WorkflowOrchestrator } from './workflow-orchestrator.js';
import { WORKFLOW_COMMAND_IDS } from './workflow-contract.js';

let statusBar: AntigravityStatusBar | undefined;
let workflowOrchestrator: WorkflowOrchestrator | undefined;

/**
 * 在宿主扩展的 activate() 中调用此函数以初始化 Antigravity Workflow 全部功能。
 *
 * @param context VS Code 扩展上下文
 * @param extensionUri 扩展根 URI (用于定位 webview 资源)
 * @param storage 可选的历史存储实例 (由宿主 extension 初始化)
 */
export async function activateAntigravityRuntime(
    context: vscode.ExtensionContext,
    extensionUri: vscode.Uri,
    storage?: IHistoryStorage,
    arktsLspController?: ArktsLspControlSurface,
) {
    console.log('[Antigravity Workflow] Activating...');

    const settings = new SettingsManager(context);

    // ── STEP 1: 注册 Dashboard 命令 ──────────────────────────────────────────
    const openPanelCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.openPanel, () => {
        if (!storage) {
            console.log('[Antigravity Workflow] History storage not provided — history features disabled.');
        }
        DashboardPanel.createOrShow(extensionUri, storage || null, settings, workflowOrchestrator!, arktsLspController, () => statusBar?.refresh());
    });
    context.subscriptions.push(openPanelCmd);
    console.log('[Antigravity Workflow] Command antigravity.openPanel registered');

    workflowOrchestrator = new WorkflowOrchestrator(extensionUri.fsPath);
    context.subscriptions.push(workflowOrchestrator);

    const promptWorkflowGoal = async (): Promise<string | undefined> => {
        return vscode.window.showInputBox({
            title: 'Run Antigravity Workflow',
            prompt: 'Describe the daemon-owned Antigravity workflow goal',
            placeHolder: 'Audit this workspace against global SOTA and identify gaps',
            ignoreFocusOut: true,
            validateInput: (value) => value.trim().length === 0 ? 'Goal is required' : undefined,
        });
    };

    const pickWorkflowTemplate = async (): Promise<'antigravity.strict-full' | 'antigravity.adaptive' | undefined> => {
        const selection = await vscode.window.showQuickPick([
            {
                label: 'Strict Full',
                description: '7-step full-path execution. Debate is mandatory.',
                value: 'antigravity.strict-full' as const,
            },
            {
                label: 'Adaptive',
                description: 'Policy-authorized debate skipping when parallel evidence is strong.',
                value: 'antigravity.adaptive' as const,
            },
        ], {
            title: 'Select Antigravity Workflow Template',
            ignoreFocusOut: true,
        });

        return selection?.value;
    };

    const runWorkflow = async () => {
        const workflowId = await pickWorkflowTemplate();
        if (!workflowId) {
            return;
        }

        const goal = await promptWorkflowGoal();
        if (!goal) {
            return;
        }

        DashboardPanel.createOrShow(extensionUri, storage || null, settings, workflowOrchestrator!, arktsLspController, () => statusBar?.refresh());

        try {
            const result = await workflowOrchestrator!.startRun({ goal, workflowId });
            vscode.window.showInformationMessage(`Antigravity workflow started (${workflowId}): ${result.runId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start Antigravity workflow: ${message}`);
        }
    };

    const runWorkflowCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.runWorkflow, runWorkflow);
    context.subscriptions.push(runWorkflowCmd);
    console.log('[Antigravity Workflow] Command antigravity.runWorkflow registered');

    const getRunCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getRun, async () => {
        try {
            const run = await workflowOrchestrator!.getRun();
            const summary = JSON.stringify({
                runId: run.snapshot.runId,
                status: run.snapshot.status,
                phase: run.snapshot.phase,
                nodes: Object.fromEntries(
                    Object.entries(run.snapshot.nodes).map(([nodeId, node]) => [nodeId, (node as { status: string }).status]),
                ),
            }, null, 2);
            const channel = vscode.window.createOutputChannel('Antigravity Workflow Run');
            channel.clear();
            channel.appendLine(summary);
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to get workflow state: ${message}`);
        }
    });
    context.subscriptions.push(getRunCmd);

    const getRunSessionCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getRunSession, async () => {
        try {
            const session = await workflowOrchestrator!.getRunSession();
            const channel = vscode.window.createOutputChannel('Antigravity Run Session');
            channel.clear();
            channel.appendLine(JSON.stringify(session, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to get run session: ${message}`);
        }
    });
    context.subscriptions.push(getRunSessionCmd);

    const streamRunCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.streamRun, async () => {
        try {
            const run = await workflowOrchestrator!.getRun();
            const channel = vscode.window.createOutputChannel(`Antigravity Run Stream ${run.snapshot.runId}`);
            channel.show(true);
            const disposable = await workflowOrchestrator!.streamRun(run.snapshot.runId, (event) => {
                channel.clear();
                channel.appendLine(`runId: ${event.snapshot.runId}`);
                channel.appendLine(`status: ${event.snapshot.status}`);
                channel.appendLine(`phase: ${event.snapshot.phase}`);
                channel.appendLine('');
                for (const entry of event.entries) {
                    channel.appendLine(`[${entry.sequence}] ${entry.createdAt} ${entry.kind}${entry.nodeId ? ` (${entry.nodeId})` : ''}`);
                }
            });
            context.subscriptions.push(disposable);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to stream workflow state: ${message}`);
        }
    });
    context.subscriptions.push(streamRunCmd);

    const approveGateCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.approveGate, async () => {
        try {
            const gateId = await vscode.window.showInputBox({
                title: 'Approve Antigravity Gate',
                prompt: 'Gate ID',
                value: 'antigravity-final-gate',
                ignoreFocusOut: true,
            });
            if (!gateId) {
                return;
            }
            await workflowOrchestrator!.approveGate({
                gateId,
                approvedBy: 'antigravity-user',
                comment: 'Approved from command palette',
            });
            vscode.window.showInformationMessage(`Approved gate: ${gateId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to approve gate: ${message}`);
        }
    });
    context.subscriptions.push(approveGateCmd);

    const cancelRunCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.cancelRun, async () => {
        try {
            const run = await workflowOrchestrator!.cancelRun();
            vscode.window.showInformationMessage(`Cancellation requested: ${run.snapshot.runId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to cancel workflow: ${message}`);
        }
    });
    context.subscriptions.push(cancelRunCmd);

    const replayRunCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.replayRun, async () => {
        try {
            const replayed = await workflowOrchestrator!.replayRun();
            vscode.window.showInformationMessage(`Replay started: ${replayed.runId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to replay workflow: ${message}`);
        }
    });
    context.subscriptions.push(replayRunCmd);

    const reloadPolicyPackCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.reloadPolicyPack, async () => {
        try {
            const pack = await workflowOrchestrator!.reloadPolicyPack();
            vscode.window.showInformationMessage(`Policy pack reloaded: ${pack.packId}@${pack.version}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to reload policy pack: ${message}`);
        }
    });
    context.subscriptions.push(reloadPolicyPackCmd);

    const reloadTrustRegistryCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.reloadTrustRegistry, async () => {
        try {
            const registry = await workflowOrchestrator!.reloadTrustRegistry();
            vscode.window.showInformationMessage(`Trust registry reloaded: ${registry.registryId}@${registry.version}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to reload trust registry: ${message}`);
        }
    });
    context.subscriptions.push(reloadTrustRegistryCmd);

    const exportTraceCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.exportTraceBundle, async () => {
        try {
            const bundle = await workflowOrchestrator!.exportTraceBundle();
            await vscode.env.clipboard.writeText(bundle.bundlePath);
            vscode.window.showInformationMessage(`Trace bundle exported: ${bundle.bundlePath}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export trace bundle: ${message}`);
        }
    });
    context.subscriptions.push(exportTraceCmd);

    const getReleaseArtifactsCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getReleaseArtifacts, async () => {
        try {
            const artifacts = await workflowOrchestrator!.getReleaseArtifacts();
            const channel = vscode.window.createOutputChannel('Antigravity Release Artifacts');
            channel.clear();
            channel.appendLine(JSON.stringify(artifacts, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load release artifacts: ${message}`);
        }
    });
    context.subscriptions.push(getReleaseArtifactsCmd);

    const getPolicyReportCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getPolicyReport, async () => {
        try {
            const report = await workflowOrchestrator!.getPolicyReport();
            await vscode.env.clipboard.writeText(report.reportPath);
            const channel = vscode.window.createOutputChannel('Antigravity Policy Report');
            channel.clear();
            channel.appendLine(JSON.stringify(report, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load policy report: ${message}`);
        }
    });
    context.subscriptions.push(getPolicyReportCmd);

    const verifyReleaseArtifactsCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyReleaseArtifacts, async () => {
        try {
            const report = await workflowOrchestrator!.verifyReleaseArtifacts();
            vscode.window.showInformationMessage(
                `Release artifacts ${report.ok ? 'verified' : 'failed'} (${report.issues.length} issue${report.issues.length === 1 ? '' : 's'})`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify release artifacts: ${message}`);
        }
    });
    context.subscriptions.push(verifyReleaseArtifactsCmd);

    const verifyPolicyReportCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyPolicyReport, async () => {
        try {
            const report = await workflowOrchestrator!.verifyPolicyReport();
            vscode.window.showInformationMessage(
                `Policy report ${report.ok ? 'verified' : 'failed'}: ${report.reportPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify policy report: ${message}`);
        }
    });
    context.subscriptions.push(verifyPolicyReportCmd);

    const getInvariantReportCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getInvariantReport, async () => {
        try {
            const report = await workflowOrchestrator!.getInvariantReport();
            await vscode.env.clipboard.writeText(report.reportPath);
            const channel = vscode.window.createOutputChannel('Antigravity Invariant Report');
            channel.clear();
            channel.appendLine(JSON.stringify(report, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load invariant report: ${message}`);
        }
    });
    context.subscriptions.push(getInvariantReportCmd);

    const verifyInvariantReportCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyInvariantReport, async () => {
        try {
            const report = await workflowOrchestrator!.verifyInvariantReport();
            vscode.window.showInformationMessage(
                `Invariant report ${report.ok ? 'verified' : 'failed'}: ${report.reportPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify invariant report: ${message}`);
        }
    });
    context.subscriptions.push(verifyInvariantReportCmd);

    const getReleaseAttestationCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getReleaseAttestation, async () => {
        try {
            const attestation = await workflowOrchestrator!.getReleaseAttestation();
            await vscode.env.clipboard.writeText(attestation.attestationPath);
            const channel = vscode.window.createOutputChannel('Antigravity Release Attestation');
            channel.clear();
            channel.appendLine(JSON.stringify(attestation, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load release attestation: ${message}`);
        }
    });
    context.subscriptions.push(getReleaseAttestationCmd);

    const verifyReleaseAttestationCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyReleaseAttestation, async () => {
        try {
            const report = await workflowOrchestrator!.verifyReleaseAttestation();
            vscode.window.showInformationMessage(
                `Release attestation ${report.ok ? 'verified' : 'failed'}: ${report.attestationPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify release attestation: ${message}`);
        }
    });
    context.subscriptions.push(verifyReleaseAttestationCmd);

    const getReleaseBundleCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getReleaseBundle, async () => {
        try {
            const bundle = await workflowOrchestrator!.getReleaseBundle();
            await vscode.env.clipboard.writeText(bundle.bundlePath);
            const channel = vscode.window.createOutputChannel('Antigravity Release Bundle');
            channel.clear();
            channel.appendLine(JSON.stringify(bundle, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load release bundle: ${message}`);
        }
    });
    context.subscriptions.push(getReleaseBundleCmd);

    const verifyReleaseBundleCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyReleaseBundle, async () => {
        try {
            const report = await workflowOrchestrator!.verifyReleaseBundle();
            vscode.window.showInformationMessage(
                `Release bundle ${report.ok ? 'verified' : 'failed'}: ${report.bundlePath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify release bundle: ${message}`);
        }
    });
    context.subscriptions.push(verifyReleaseBundleCmd);

    const getReleaseDossierCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getReleaseDossier, async () => {
        try {
            const dossier = await workflowOrchestrator!.getReleaseDossier();
            await vscode.env.clipboard.writeText(dossier.dossierPath);
            const channel = vscode.window.createOutputChannel('Antigravity Release Dossier');
            channel.clear();
            channel.appendLine(JSON.stringify(dossier, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load release dossier: ${message}`);
        }
    });
    context.subscriptions.push(getReleaseDossierCmd);

    const verifyReleaseDossierCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyReleaseDossier, async () => {
        try {
            const report = await workflowOrchestrator!.verifyReleaseDossier();
            vscode.window.showInformationMessage(
                `Release dossier ${report.ok ? 'verified' : 'failed'}: ${report.dossierPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify release dossier: ${message}`);
        }
    });
    context.subscriptions.push(verifyReleaseDossierCmd);

    const getCertificationRecordCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getCertificationRecord, async () => {
        try {
            const record = await workflowOrchestrator!.getCertificationRecord();
            await vscode.env.clipboard.writeText(record.recordPath);
            const channel = vscode.window.createOutputChannel('Antigravity Certification Record');
            channel.clear();
            channel.appendLine(JSON.stringify(record, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load certification record: ${message}`);
        }
    });
    context.subscriptions.push(getCertificationRecordCmd);

    const verifyCertificationRecordCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyCertificationRecord, async () => {
        try {
            const report = await workflowOrchestrator!.verifyCertificationRecord();
            vscode.window.showInformationMessage(
                `Certification record ${report.ok ? 'verified' : 'failed'}: ${report.recordPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify certification record: ${message}`);
        }
    });
    context.subscriptions.push(verifyCertificationRecordCmd);

    const getTransparencyLedgerCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.getTransparencyLedger, async () => {
        try {
            const ledger = await workflowOrchestrator!.getTransparencyLedger();
            const channel = vscode.window.createOutputChannel('Antigravity Transparency Ledger');
            channel.clear();
            channel.appendLine(JSON.stringify(ledger, null, 2));
            channel.show(true);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to load transparency ledger: ${message}`);
        }
    });
    context.subscriptions.push(getTransparencyLedgerCmd);

    const verifyTransparencyLedgerCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.verifyTransparencyLedger, async () => {
        try {
            const report = await workflowOrchestrator!.verifyTransparencyLedger();
            vscode.window.showInformationMessage(
                `Transparency ledger ${report.ok ? 'verified' : 'failed'}: ${report.ledgerPath}`,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to verify transparency ledger: ${message}`);
        }
    });
    context.subscriptions.push(verifyTransparencyLedgerCmd);

    const benchmarkCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.runBenchmark, async () => {
        try {
            const report = await workflowOrchestrator!.runBenchmark();
            vscode.window.showInformationMessage(`${report.harnessId}: ${report.ok ? 'passed' : 'failed'} (${report.passedCases}/${report.totalCases} cases, ${report.passedChecks}/${report.totalChecks} checks)`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to run benchmark: ${message}`);
        }
    });
    context.subscriptions.push(benchmarkCmd);

    const interopCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.runInteropHarness, async () => {
        try {
            const result = await workflowOrchestrator!.runInteropHarness();
            vscode.window.showInformationMessage(`${result.harnessId}: ${result.ok ? 'passed' : 'failed'} (${result.passedChecks}/${result.totalChecks})`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Interop harness failed: ${message}`);
        }
    });
    context.subscriptions.push(interopCmd);

    const toggleArktsLspCmd = vscode.commands.registerCommand(WORKFLOW_COMMAND_IDS.toggleArktsLsp, async () => {
        if (!arktsLspController) {
            vscode.window.showWarningMessage('ArkTS LSP controller is unavailable.');
            return;
        }

        const current = arktsLspController.getStatus();
        const next = await arktsLspController.setEnabled(!current.enabled);
        await settings.setArktsLspEnabled(next.enabled);
        vscode.window.showInformationMessage(
            next.enabled
                ? `ArkTS LSP enabled: ${next.message}`
                : 'ArkTS LSP disabled.',
        );
    });
    context.subscriptions.push(toggleArktsLspCmd);

    // ── STEP 2: 状态栏（最优先，确保始终可见）──────────────────────────────
    statusBar = new AntigravityStatusBar(settings);
    context.subscriptions.push(statusBar.getItem());
    try {
        await statusBar.initialize();
    } catch (e) {
        console.error('[Antigravity Workflow] StatusBar initialize failed:', e);
    }
    console.log('[Antigravity Workflow] StatusBar created');

    if (arktsLspController) {
        try {
            const enabled = await settings.getArktsLspEnabled();
            await arktsLspController.setEnabled(enabled);
        } catch (e) {
            console.error('[Antigravity Workflow] ArkTS LSP controller initialize failed:', e);
        }
    }

    // ── STEP 3: 同步密钥 + 自动配置（每步独立 try-catch，不影响核心功能）──
    const dbFilePath = storage
        ? (storage as any).getDbPath?.() || ''
        : path.join(context.globalStorageUri.fsPath, 'history.db');
    try { await syncModelCatalogToFile(settings, dbFilePath); } catch (e) { console.error('[Antigravity Workflow] syncModelCatalogToFile failed:', e); }
    try { autoRegisterMcpConfig(context.extensionPath); } catch (e) { console.error('[Antigravity Workflow] autoRegisterMcpConfig failed:', e); }
    try { autoInstallSkill(context.extensionPath); } catch (e) { console.error('[Antigravity Workflow] autoInstallSkill failed:', e); }
    try { await autoInjectRoutingRules(settings); } catch (e) { console.error('[Antigravity Workflow] autoInjectRoutingRules failed:', e); }

    console.log('[Antigravity Workflow] Activation complete');
}

/**
 * 在宿主扩展的 deactivate() 中调用
 */
export function deactivateAntigravityRuntime() {
    statusBar?.dispose();
    workflowOrchestrator?.dispose();
}
