export type ArktsLspLifecycleState = 'disabled' | 'starting' | 'running' | 'error'

export interface ArktsLspStatusSnapshot {
    enabled: boolean
    state: ArktsLspLifecycleState
    message: string
    workspaceRoot?: string
    devecoDetected: boolean
}

export interface ArktsLspControlSurface {
    getStatus(): ArktsLspStatusSnapshot
    setEnabled(enabled: boolean): Promise<ArktsLspStatusSnapshot>
}
