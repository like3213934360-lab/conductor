# 🤝 Contributing to Conductor AGC

欢迎贡献！以下指南帮助你快速参与项目。

## 开发环境

### 前置要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **TypeScript** ≥ 5.3

### 安装

```bash
git clone https://github.com/anthropic/conductor-agc.git
cd conductor-agc
npm install
```

### 构建

```bash
# 构建全部包 (顺序: shared → core → persistence → mcp-server)
npm run build:conductor

# 单独构建
npm run build:shared
npm run build:core
npm run build:persistence

# 类型检查 (不输出文件)
npx tsc -p packages/conductor-core/tsconfig.json --noEmit
```

### 测试

```bash
# 运行全部测试
npx vitest run

# 运行指定文件
npx vitest run packages/conductor-core/src/__tests__/federation.test.ts

# Watch 模式
npx vitest --watch
```

## 项目结构

```
packages/
├── conductor-shared/       # 共享类型、Zod Schema、Event Projector
├── conductor-core/         # 核心引擎 (17 模块)
│   └── src/
│       ├── contracts/      # 接口定义 (依赖倒置)
│       ├── dag/            # DAG 引擎
│       ├── governance/     # 治理网关
│       ├── risk/           # 风险路由
│       ├── plugin/         # 插件系统
│       ├── federation/     # P2P 联邦
│       ├── reflexion/      # 反思循环
│       ├── benchmark/      # 基准评估
│       ├── optimization/   # Prompt 优化
│       ├── observability/  # OTel Tracer
│       ├── cli/            # CLI 工具
│       └── __tests__/      # 测试
├── conductor-persistence/  # 持久化层
├── conductor-mcp-server/   # MCP Server
├── conductor-hub-vscode/   # VS Code 扩展
└── conductor-hub-webview/  # Dashboard UI
```

## 编码规范

### TypeScript

- **严格模式**: `strict: true`, `noUncheckedIndexedAccess: true`
- **模块系统**: `NodeNext` (ESM)
- **导入**: 所有相对导入必须带 `.js` 后缀
- **空值安全**: 使用 `??` 和 `?.`，禁止 `!` 非空断言

### 接口优先

- 所有外部依赖通过 `contracts/` 目录定义接口
- 实现类在各自包中提供
- 依赖倒置: core 不直接依赖 persistence/hub

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 接口 | I + PascalCase | `IEventStore`, `IFederationTransport` |
| 类 | PascalCase | `GovernanceGateway`, `SwarmRouter` |
| 类型 | PascalCase | `AgentCard`, `FederationMessage` |
| 常量 | UPPER_SNAKE | `DEFAULT_CONFIG`, `STATUS_COLORS` |
| 文件 | kebab-case | `agent-card.ts`, `swarm-router.ts` |

## 提交 PR 流程

### 1. 创建分支

```bash
git checkout -b feat/your-feature
```

### 2. 开发

- 编写代码
- 添加/更新测试 (`__tests__/` 目录)
- 确保 TypeScript 编译通过
- 确保所有测试通过

### 3. 验证

```bash
# 必须通过
npx tsc -p packages/conductor-core/tsconfig.json --noEmit
npx vitest run
```

### 4. 提交

```bash
# 使用语义化提交消息
git commit -m "feat(federation): add WebSocket transport"
git commit -m "fix(governance): trust factor NaN edge case"
git commit -m "docs(readme): update SOTA rating table"
```

**提交消息格式**: `type(scope): description`

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构 |
| `docs` | 文档 |
| `test` | 测试 |
| `perf` | 性能优化 |

### 5. 创建 PR

- 标题使用提交消息格式
- 描述变更内容和测试结果
- 关联相关 Issue

## 测试要求

- **新模块**: 必须有对应的 test 文件在 `__tests__/` 目录
- **Bug 修复**: 必须有回归测试
- **覆盖率**: 核心路径 100%，边界情况尽可能覆盖
- **命名**: `describe('模块名')` + `it('应...', ...)` (中文描述)

## 插件开发

参考 [API Cookbook #2](docs/API_COOKBOOK.md#2-编写插件-plugin) 了解如何编写插件。

核心接口:

```typescript
interface ConductorPlugin {
  manifest: PluginManifest  // 插件声明
  hooks?: Partial<ConductorHooks>  // 生命周期钩子
  rules?: GovernanceControlContribution[]  // 治理控制
  activate?(ctx: PluginActivationContext): Promise<void>
  deactivate?(): Promise<void>
}
```

## 架构决策记录

重要的架构决策记录在 [ARCHITECTURE.md](docs/ARCHITECTURE.md) 中。如需修改核心架构，请先创建 Issue 讨论。

---

**感谢你的贡献！🎉**
