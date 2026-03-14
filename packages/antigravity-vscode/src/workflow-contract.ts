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
