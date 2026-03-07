"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const parallel_executor_js_1 = require("../src/parallel-executor.js");
// Mock ConductorHubService — 最小接口实现
function createMockService(overrides = {}) {
    return {
        codexTask: overrides.codex ?? (async () => 'codex-output'),
        geminiTask: overrides.gemini ?? (async () => 'gemini-output'),
        ask: overrides.ask ?? (async () => ({ text: 'ask-output' })),
        multiAsk: overrides.multi_ask ?? (async () => ({ formatted: 'multi-output' })),
        consensus: overrides.consensus ?? (async () => ({ judgeText: 'consensus-output' })),
        reloadConfig: () => { },
        ...overrides,
    };
}
(0, vitest_1.describe)('runParallelTasks', () => {
    (0, vitest_1.it)('空任务列表抛出错误', async () => {
        const service = createMockService();
        await (0, vitest_1.expect)((0, parallel_executor_js_1.runParallelTasks)([], service)).rejects.toThrow('不能为空');
    });
    (0, vitest_1.it)('单个 ask 任务成功执行', async () => {
        const service = createMockService();
        const result = await (0, parallel_executor_js_1.runParallelTasks)([
            { type: 'ask', prompt: 'hello', id: 'test-1' },
        ], service);
        (0, vitest_1.expect)(result.results).toHaveLength(1);
        (0, vitest_1.expect)(result.results[0].status).toBe('success');
        (0, vitest_1.expect)(result.results[0].output).toBe('ask-output');
        (0, vitest_1.expect)(result.succeeded).toBe(1);
    });
    (0, vitest_1.it)('故障隔离 — 一个失败不影响其他', async () => {
        const service = createMockService({
            ask: async () => {
                throw new Error('模拟失败');
            },
            gemini: async () => 'ok',
        });
        const result = await (0, parallel_executor_js_1.runParallelTasks)([
            { type: 'ask', prompt: 'will-fail', id: 'fail-task' },
            { type: 'gemini', prompt: 'will-succeed', id: 'ok-task' },
        ], service);
        (0, vitest_1.expect)(result.results).toHaveLength(2);
        const failTask = result.results.find(r => r.id === 'fail-task');
        const okTask = result.results.find(r => r.id === 'ok-task');
        (0, vitest_1.expect)(failTask.status).toBe('error');
        (0, vitest_1.expect)(okTask.status).toBe('success');
        (0, vitest_1.expect)(result.succeeded).toBe(1);
        (0, vitest_1.expect)(result.failed).toBe(1);
    });
    (0, vitest_1.it)('超时任务标记为 timeout', async () => {
        const service = createMockService({
            ask: async () => {
                await new Promise(resolve => setTimeout(resolve, 5000));
                return { text: 'too-late' };
            },
        });
        const result = await (0, parallel_executor_js_1.runParallelTasks)([
            { type: 'ask', prompt: 'slow', id: 'slow-task', timeout_ms: 100 },
        ], service);
        (0, vitest_1.expect)(result.results).toHaveLength(1);
        (0, vitest_1.expect)(result.results[0].status).toBe('timeout');
        (0, vitest_1.expect)(result.timedOut).toBe(1);
    }, 10000);
    (0, vitest_1.it)('并发限制 — maxConcurrency 生效', async () => {
        let maxConcurrent = 0;
        let currentConcurrent = 0;
        const service = createMockService({
            ask: async () => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
                await new Promise(resolve => setTimeout(resolve, 50));
                currentConcurrent--;
                return { text: 'ok' };
            },
        });
        const tasks = Array.from({ length: 6 }, (_, i) => ({
            type: 'ask',
            prompt: `task-${i}`,
            id: `task-${i}`,
        }));
        const result = await (0, parallel_executor_js_1.runParallelTasks)(tasks, service, 2);
        (0, vitest_1.expect)(result.succeeded).toBe(6);
        (0, vitest_1.expect)(maxConcurrent).toBeLessThanOrEqual(2);
    }, 10000);
    (0, vitest_1.it)('结果顺序与输入顺序一致', async () => {
        const service = createMockService({
            ask: async () => {
                // 随机延迟模拟不同完成顺序
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
                return { text: 'ok' };
            },
        });
        const tasks = Array.from({ length: 4 }, (_, i) => ({
            type: 'ask',
            prompt: `task-${i}`,
            id: `ordered-${i}`,
        }));
        const result = await (0, parallel_executor_js_1.runParallelTasks)(tasks, service);
        (0, vitest_1.expect)(result.results.map(r => r.id)).toEqual(['ordered-0', 'ordered-1', 'ordered-2', 'ordered-3']);
    });
});
(0, vitest_1.describe)('formatParallelResults', () => {
    (0, vitest_1.it)('格式化成功结果包含正确标签', () => {
        const output = (0, parallel_executor_js_1.formatParallelResults)({
            results: [
                { id: 'test', type: 'ask', status: 'success', output: 'hello world', durationMs: 100 },
            ],
            succeeded: 1,
            failed: 0,
            timedOut: 0,
            concurrency: 2,
            totalMs: 100,
        });
        (0, vitest_1.expect)(output).toContain('✅');
        (0, vitest_1.expect)(output).toContain('test');
        (0, vitest_1.expect)(output).toContain('hello world');
        (0, vitest_1.expect)(output).toContain('100ms');
    });
    (0, vitest_1.it)('超长输出被截断', () => {
        const longOutput = 'x'.repeat(60000);
        const output = (0, parallel_executor_js_1.formatParallelResults)({
            results: [
                { id: 'big', type: 'codex', status: 'success', output: longOutput, durationMs: 1000 },
            ],
            succeeded: 1,
            failed: 0,
            timedOut: 0,
            concurrency: 1,
            totalMs: 1000,
        });
        (0, vitest_1.expect)(output.length).toBeLessThan(55000); // 50K + header
        (0, vitest_1.expect)(output).toContain('截断');
    });
});
//# sourceMappingURL=parallel-executor.test.js.map