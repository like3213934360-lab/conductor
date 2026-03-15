export interface WorkflowCommandContract {
  readonly id: string
  readonly title: string
  readonly description: string
}

export const WORKFLOW_COMMAND_IDS = {
  openPanel: 'antigravity.openPanel',
  runTask: 'antigravity.runTask',
  getTask: 'antigravity.getTask',
  streamTask: 'antigravity.streamTask',
  cancelTask: 'antigravity.cancelTask',
  toggleArktsLsp: 'antigravity.toggleArktsLsp',

  // ─── LSO 16-Workflow Tactical Matrix ────────────────────────────────
  // Tier 1: Entry
  lsoQuickstart: 'antigravity.lso.quickstart',
  // Tier 2: Lifecycle (Anws)
  lsoGenesis: 'antigravity.lso.genesis',
  lsoProbe: 'antigravity.lso.probe',
  lsoDesignSystem: 'antigravity.lso.designSystem',
  lsoBlueprint: 'antigravity.lso.blueprint',
  lsoChallenge: 'antigravity.lso.challenge',
  lsoForge: 'antigravity.lso.forge',
  lsoChange: 'antigravity.lso.change',
  lsoExplore: 'antigravity.lso.explore',
  lsoCraft: 'antigravity.lso.craft',
  lsoUpgrade: 'antigravity.lso.upgrade',
  // Tier 3: Engine (Original)
  lsoSwarmAnalyze: 'antigravity.lso.swarmAnalyze',
  lsoRedTeamVerify: 'antigravity.lso.redTeamVerify',
  lsoEloTuning: 'antigravity.lso.eloTuning',
  lsoAirgapDeploy: 'antigravity.lso.airgapDeploy',
  lsoDaemon: 'antigravity.lso.daemon',
} as const

export const WORKFLOW_COMMANDS: readonly WorkflowCommandContract[] = [
  {
    id: WORKFLOW_COMMAND_IDS.openPanel,
    title: 'Antigravity Task Kernel: 打开控制面板',
    description: 'Open the Antigravity task kernel dashboard.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.runTask,
    title: 'Antigravity Task Kernel: 启动任务',
    description: 'Start a long-running antigravity-taskd job.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.getTask,
    title: 'Antigravity Task Kernel: 查看当前任务',
    description: 'Fetch the latest antigravity-taskd job snapshot.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.streamTask,
    title: 'Antigravity Task Kernel: 实时查看任务',
    description: 'Stream antigravity-taskd job events for the active task.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.cancelTask,
    title: 'Antigravity Task Kernel: 取消当前任务',
    description: 'Cancel the active antigravity-taskd job.',
  },
  {
    id: WORKFLOW_COMMAND_IDS.toggleArktsLsp,
    title: 'Antigravity Task Kernel: 切换 ArkTS LSP',
    description: 'Enable or disable the optional ArkTS LSP subsystem.',
  },
]

// ─── LSO QuickPick Items ──────────────────────────────────────────────────────

export interface LsoQuickPickItem {
  readonly label: string
  readonly detail: string
  readonly commandId: string
  readonly kind: 'separator' | 'item'
}

export const LSO_QUICKPICK_ITEMS: readonly LsoQuickPickItem[] = [
  // ── Separator: 规划与设计 ──
  { label: '📐 规划与设计 (Planning & Design)', detail: '', commandId: '', kind: 'separator' },
  { label: '🌅 Genesis — 从零启动', detail: '生成 PRD + Architecture + ADR，建立版本化架构基础', commandId: WORKFLOW_COMMAND_IDS.lsoGenesis, kind: 'item' },
  { label: '🔍 Probe — 系统风险探测', detail: '分析遗留代码的隐藏耦合、Git 热点和架构暗坑', commandId: WORKFLOW_COMMAND_IDS.lsoProbe, kind: 'item' },
  { label: '📐 Design System — 系统详设', detail: '为单个系统生成详细技术文档（Mermaid 图 + 接口 + Trade-offs）', commandId: WORKFLOW_COMMAND_IDS.lsoDesignSystem, kind: 'item' },
  { label: '📋 Blueprint — 任务拆解', detail: '将架构设计拆解为 WBS 任务清单（含验收标准、Sprint 划分）', commandId: WORKFLOW_COMMAND_IDS.lsoBlueprint, kind: 'item' },
  { label: '⚔️ Challenge — 对抗审查', detail: '对项目决策进行系统性挑战（Pre-Mortem + 假设验证）', commandId: WORKFLOW_COMMAND_IDS.lsoChallenge, kind: 'item' },
  { label: '🔨 Forge — 编码执行', detail: '按任务清单将设计锻造为代码（波次执行 + 零降级护栏）', commandId: WORKFLOW_COMMAND_IDS.lsoForge, kind: 'item' },
  { label: '🔧 Change — 微调变更', detail: '修改现有任务描述/验收标准（禁止新增功能）', commandId: WORKFLOW_COMMAND_IDS.lsoChange, kind: 'item' },
  { label: '🧭 Explore — 技术探索', detail: '深度探索复杂问题（技术调研 + 方案选型）', commandId: WORKFLOW_COMMAND_IDS.lsoExplore, kind: 'item' },
  { label: '🛠️ Craft — 元创建', detail: '创建新的工作流 / 技能 / 提示词', commandId: WORKFLOW_COMMAND_IDS.lsoCraft, kind: 'item' },
  { label: '⬆️ Upgrade — 升级编排', detail: '在 anws update 后判断 Minor/Major 并路由到对应工作流', commandId: WORKFLOW_COMMAND_IDS.lsoUpgrade, kind: 'item' },

  // ── Separator: 多智能体引擎 ──
  { label: '🧬 多智能体引擎 (Multi-Agent Engine)', detail: '', commandId: '', kind: 'separator' },
  { label: '🧬 Swarm Analyze — 三态蜂群分析', detail: '在 Frugal/Racing/MoA Fusion 之间自适应选择最优执行拓扑', commandId: WORKFLOW_COMMAND_IDS.lsoSwarmAnalyze, kind: 'item' },
  { label: '🛡️ Red Team Verify — 红队验证', detail: '异源对抗模型审查 + ArkTS LSP 形式化验证 + Reflexion 闭环', commandId: WORKFLOW_COMMAND_IDS.lsoRedTeamVerify, kind: 'item' },
  { label: '🧠 ELO Tuning — 路由排位调优', detail: '查看/调整 Per-Intent ELO 排位（scout/analyze/generate/verify）', commandId: WORKFLOW_COMMAND_IDS.lsoEloTuning, kind: 'item' },
  { label: '🔒 Air-Gap Deploy — 物理隔离部署', detail: '配置 Ollama + 9 种脱敏规则 + 全离线运行模式', commandId: WORKFLOW_COMMAND_IDS.lsoAirgapDeploy, kind: 'item' },
  { label: '⚙️ Daemon — 守护进程管理', detail: '启动/停止/查看 LSO 后台 taskd 守护进程状态', commandId: WORKFLOW_COMMAND_IDS.lsoDaemon, kind: 'item' },
]

