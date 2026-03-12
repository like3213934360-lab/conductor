# 🤝 Contributing to Antigravity Workflow Runtime

欢迎贡献！以下指南帮助你快速参与项目。

## 开发环境

### 前置要求

- **Node.js** ≥ 18
- **npm** ≥ 9
- **TypeScript** ≥ 5.3

### 安装

```bash
git clone https://github.com/like3213934360-lab/conductor.git
cd conductor
npm install
```

### 构建

```bash
# 构建全部包 (顺序: shared → core → persistence → mcp-server)
npm run build:runtime

# 单独构建
npm run build:shared
npm run build:core
npm run build:persistence

# 类型检查 (不输出文件)
npx tsc -p packages/antigravity-core/tsconfig.json --noEmit
```

### 测试

```bash
# 运行全部测试
npx vitest run

# 运行指定文件
npx vitest run packages/antigravity-core/src/__tests__/federation.test.ts

# Watch 模式
npx vitest --watch
```

## 项目结构

```
packages/
├── antigravity-shared/     # 共享类型、Zod Schema、Event Projector
├── antigravity-core/       # 核心运行时
│   └── src/
│       ├── contracts/      # 接口定义 (依赖倒置)
│       ├── dag/            # DAG 引擎
│       ├── governance/     # 治理网关
│       ├── risk/           # 风险路由
│       ├── federation/     # Agent card / handoff primitives
│       ├── observability/  # OTel Tracer
│       └── __tests__/      # 测试
├── antigravity-persistence/ # 持久化层
├── antigravity-model-core/  # Host-facing 模型编排
├── antigravity-daemon/      # 权威 daemon runtime
├── antigravity-mcp-server/ # MCP Server
├── antigravity-vscode/     # VS Code / Antigravity 宿主层
└── antigravity-webview/    # Dashboard UI
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
- 依赖倒置: core 不直接依赖 persistence / model runtime

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 接口 | I + PascalCase | `IEventStoreReader`, `IHistoryStorage` |
| 类 | PascalCase | `GovernanceGateway`, `AntigravityDaemonRuntime` |
| 类型 | PascalCase | `AgentCard`, `FederationMessage` |
| 常量 | UPPER_SNAKE | `DEFAULT_CONFIG`, `STATUS_COLORS` |
| 文件 | kebab-case | `agent-card.ts`, `workflow-orchestrator.ts` |

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
npx tsc -p packages/antigravity-core/tsconfig.json --noEmit
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

## 架构决策记录

重要的架构决策记录在 [ARCHITECTURE.md](docs/ARCHITECTURE.md) 中。如需修改核心架构，请先创建 Issue 讨论。

---

**感谢你的贡献！🎉**
