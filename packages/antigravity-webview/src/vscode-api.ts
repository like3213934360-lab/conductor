declare function acquireVsCodeApi(): any;

class VSCodeAPIWrapper {
    private readonly vsCodeApi: any;

    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        } else {
            this.vsCodeApi = null;
        }
    }

    public postMessage(message: any) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        } else {
            console.log('Mock postMessage:', message);
        }
    }

    /** 持久化 UI 状态 — VS Code 隐藏/销毁 WebView 时保活 */
    public getState<T>(): T | undefined {
        return this.vsCodeApi?.getState?.();
    }

    public setState<T>(state: T): void {
        this.vsCodeApi?.setState?.(state);
    }
}

export const vscode = new VSCodeAPIWrapper();
