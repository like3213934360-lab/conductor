declare class VSCodeAPIWrapper {
    private readonly vsCodeApi;
    constructor();
    postMessage(message: any): void;
}
export declare const vscode: VSCodeAPIWrapper;
export {};
