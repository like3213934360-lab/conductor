"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("vitest/config");
const node_path_1 = __importDefault(require("node:path"));
exports.default = (0, config_1.defineConfig)({
    test: {
        root: node_path_1.default.resolve(__dirname),
        include: ['src/**/__tests__/**/*.spec.ts'],
        globals: true,
        environment: 'node',
    },
});
//# sourceMappingURL=vitest.config.js.map