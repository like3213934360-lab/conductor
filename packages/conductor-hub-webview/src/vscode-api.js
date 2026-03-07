"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vscode = void 0;
class VSCodeAPIWrapper {
    constructor() {
        if (typeof acquireVsCodeApi === 'function') {
            this.vsCodeApi = acquireVsCodeApi();
        }
        else {
            this.vsCodeApi = null;
        }
    }
    postMessage(message) {
        if (this.vsCodeApi) {
            this.vsCodeApi.postMessage(message);
        }
        else {
            console.log('Mock postMessage:', message);
        }
    }
}
exports.vscode = new VSCodeAPIWrapper();
//# sourceMappingURL=vscode-api.js.map