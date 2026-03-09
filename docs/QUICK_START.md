# 🚀 Quick Start — Conductor AGC

5 分钟快速上手 AGC 多模型治理引擎。

## 1. 安装

```bash
# 克隆项目
git clone https://github.com/anthropic/conductor-agc.git
cd conductor-agc

# 安装依赖
npm install

# 构建核心包
npm run build:shared && npm run build:core
```

## 2. 第一个 AGC 运行

```typescript
import { AGCService } from '@anthropic/conductor-core'
import { InMemoryEventStore } from '@anthropic/conductor-persistence'

// 1. 创建服务
const service = new AGCService({
  eventStore: new InMemoryEventStore(),
  checkpointStore: new InMemoryCheckpointStore(),
})

// 2. 定义 DAG 图
const graph = {
  nodes: [
    { id: 'ANALYZE', name: '分析' },
    { id: 'PARALLEL', name: '并行思考' },
    { id: 'DEBATE', name: '辩论' },
    { id: 'SYNTHESIZE', name: '综合' },
    { id: 'VERIFY', name: '验证' },
    { id: 'PERSIST', name: '持久化' },
  ],
  edges: [
    { from: 'ANALYZE', to: 'PARALLEL' },
    { from: 'PARALLEL', to: 'DEBATE' },
    { from: 'DEBATE', to: 'SYNTHESIZE' },
    { from: 'SYNTHESIZE', to: 'VERIFY' },
    { from: 'VERIFY', to: 'PERSIST' },
  ],
}

// 3. 启动运行
const result = await service.startRun({
  metadata: { goal: '分析代码质量', repoRoot: '.' },
  graph,
})

console.log(`Run ID: ${result.runId}`)
console.log(`Risk: ${result.drScore.level} (${result.drScore.score})`)
console.log(`Route: ${result.route.lane} lane`)
```

## 3. CLI 使用

```bash
# 启动运行
npx ts-node packages/conductor-core/src/cli/conductor-agc-cli.ts run --goal "分析代码" --risk medium

# 查看状态
npx ts-node packages/conductor-core/src/cli/conductor-agc-cli.ts status <runId>

# 运行 Benchmark
npx ts-node packages/conductor-core/src/cli/conductor-agc-cli.ts benchmark

# 验证完整性
npx ts-node packages/conductor-core/src/cli/conductor-agc-cli.ts verify <runId>
```

## 4. 配置模型 Provider

```typescript
// 在 VS Code 中配置 Conductor Hub
// 1. Cmd+Shift+P → "Conductor Hub: Open Dashboard"
// 2. 切换到 "Models" 标签页
// 3. 添加 API Key (DeepSeek, GLM, Qwen 等)
```

## 5. VS Code 面板

1. 安装 Conductor Hub 扩展
2. 打开 Dashboard: `Cmd+Shift+P` → "Open Conductor Hub"
3. 点击 **AGC** 标签查看 DAG 可视化
4. 实时监控节点状态、治理决策、HITL 交互

---

**👉 进阶使用请参考 [API Cookbook](./API_COOKBOOK.md) 和 [Architecture](./ARCHITECTURE.md)**
