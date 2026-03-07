# ArkTS LSP — ace-server Bridge 方案设计

> 日期：2026-02-27
> 状态：已批准

## 背景

DevEco Studio 内置了一个完整的 ArkTS Language Server（`ace-server`），基于 Node.js + webpack 打包，实现了标准 LSP 协议。通过逆向分析，我们已经完整还原了其 `initializationOptions` 的数据结构，包括关键的 `modules` 数组。

本方案将 ace-server 从 DevEco Studio 中"借用"出来，通过一个 bridge 层在 VS Code 中直接运行，获得与 DevEco Studio 一致的语言服务体验。

## 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 项目模型 | 仅 Stage | 覆盖 95%+ 新项目，大幅简化 bridge 逻辑 |
| VS Code 扩展 | 全部重写 | 旧代码面向自研 LSP，不适合复用 |
| ace-server 来源 | 方案 B：引用 DevEco 安装目录 | 版本一致性最好，体积小，自动跟随更新 |
| SDK 定位 | 多平台自动检测 | Mac/Windows/Linux 全覆盖 |

## 删除清单

以下包/文件将被完全删除：

- `packages/language-service/` — 自研语言服务核心
- `packages/lsp-server/` — 自研 LSP server
- `packages/rules/` — 自研规则引擎
- `scripts/` — bridge generator 等构建脚本
- `vitest.config.ts` — 旧测试配置
- `arkts-language-support-0.1.0.vsix` — 旧构建产物

## 新项目结构

```
arkts-lsp/
├── packages/
│   ├── ace-bridge/                  # 核心：项目解析 + ace-server 启动器
│   │   ├── src/
│   │   │   ├── index.ts             # 导出
│   │   │   ├── deveco-detector.ts   # 多平台 DevEco/SDK 路径检测
│   │   │   ├── project-parser.ts    # 解析 build-profile/module/oh-package .json5
│   │   │   ├── module-builder.ts    # 构造 AceModule[] 数组
│   │   │   └── ace-launcher.ts      # 启动 ace-server 子进程 + LSP 消息代理
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── vscode-extension/            # VS Code 扩展（全部重写）
│       ├── src/
│       │   └── extension.ts         # 扩展入口
│       ├── syntaxes/                # tmLanguage（从旧项目迁移）
│       ├── themes/                  # DevEco Darcula 主题（从旧项目迁移）
│       ├── language-configuration.json
│       └── package.json
├── package.json                     # workspace root
├── tsconfig.json
└── README.md
```

## 架构：数据流

```
VS Code 打开 .ets 项目
  → extension.ts 激活
  → deveco-detector 定位 DevEco 安装路径
  → project-parser 解析项目配置文件
  → module-builder 构造 initializationOptions
  → ace-launcher 启动 ace-server/out/index.js 子进程
  → VS Code LanguageClient ←stdio→ ace-server
```

## 核心组件设计

### deveco-detector.ts — 多平台检测

检测链（按优先级）：

**Mac:**
1. 用户配置 `arkts.deveco.path`
2. `/Applications/DevEco-Studio.app/Contents/`
3. `~/Applications/DevEco-Studio.app/Contents/`

**Windows:**
1. 用户配置
2. `%LOCALAPPDATA%/Huawei/DevEco Studio/`
3. `C:/Program Files/Huawei/DevEco Studio/`

**Linux:**
1. 用户配置
2. `/opt/deveco-studio/`

从 DevEco 路径推导所有 SDK 路径：

```typescript
interface DevEcoEnvironment {
  devEcoPath: string          // DevEco 安装根目录
  aceServerEntry: string      // plugins/openharmony/ace-server/out/index.js
  aceServerDir: string        // plugins/openharmony/ace-server/out/
  sdkPath: string             // sdk/default/openharmony/
  sdkJsPath: string           // sdk/default/openharmony/ets/api/
  hosSdkPath: string          // sdk/default/hms/ets/
  aceLoaderPath: string       // sdk/default/openharmony/ets/build-tools/ets-loader/
  nodeExecutable: string      // tools/node/bin/node（DevEco 自带的 Node.js）
}
```

### project-parser.ts — 项目文件解析

解析三类 JSON5 配置文件：

1. `build-profile.json5`（项目根目录）→ 获取 modules 列表、compatibleSdkVersion
2. `{module}/src/main/module.json5` → 获取 deviceTypes、pages、moduleType
3. `{module}/oh-package.json5` → 获取依赖信息

### module-builder.ts — 构造 AceModule[]

逆向还原的 module 接口（必填字段）：

```typescript
interface AceModule {
  modulePath: string           // 模块绝对路径
  moduleName: string           // 模块名
  deviceType: string[]         // 设备类型数组
  aceLoaderPath: string        // ets-loader 路径
  jsComponentType: string      // "Declaration"（Stage 模型固定值）
  sdkJsPath: string            // SDK ets/api 路径
  compatibleSdkLevel: string   // 兼容 SDK 级别
  apiType: string              // "Stage"（固定）
  hosSdkPath?: string          // HarmonyOS SDK 路径
  runtimeOs?: string           // "OpenHarmony"
  moduleType?: string          // "Entry" | "Har" | "Library"
  compileMode?: string         // "EsmModule"
  syncType?: string            // "Add"
}
```

完整的 initializationOptions：

```typescript
interface InitializationOptions {
  rootUri: string
  lspServerWorkspacePath: string   // ace-server/out/ 目录
  modules: AceModule[]
  clientType?: "vscode"
}
```

### ace-launcher.ts — 启动 ace-server

使用 `child_process.fork()` 启动，参数：
- `--stdio`
- `--max-old-space-size=4096`

返回一个 `ChildProcess`，供 VS Code `LanguageClient` 的 `ServerOptions` 使用。

## 错误处理

| 场景 | 处理 |
|------|------|
| DevEco 未安装 | 状态栏显示错误，弹窗提示下载链接 |
| ace-server 文件不存在（DevEco 版本太旧） | 提示用户升级 DevEco |
| SDK 路径不存在 | 提示用户在 DevEco 中下载 SDK |
| 项目无 `build-profile.json5` | 提示"不是 HarmonyOS 项目" |
| `module.json5` 解析失败 | 跳过该模块，日志警告 |
| ace-server 进程崩溃 | 自动重启一次，失败则通知用户 |

modules 数组中某个 module 字段缺失时，用合理默认值填充而不是跳过。ace-server 的 `checkModule` 只校验 6 个必填字段，其余可缺省。

JSON5 解析使用 `json5` npm 包（~3KB）。

## VS Code 扩展设计

**extension.ts 核心逻辑：**

1. 激活时调用 `deveco-detector` 检测环境
2. 调用 `project-parser` + `module-builder` 构造 `initializationOptions`
3. 用 `LanguageClient` 启动 ace-server，传入 `initializationOptions`
4. 注册状态栏指示器（初始化中 / 就绪 / 错误）
5. 监听 ace-server 自定义通知（`onIndexingProgressUpdate`）显示索引进度

**package.json contributes（从旧项目迁移）：**

- `languages`（arkts / .ets）
- `grammars`（tmLanguage）
- `themes`（DevEco Darcula）
- `semanticTokenTypes` / `semanticTokenScopes`
- `configurationDefaults`（语义高亮颜色）

**新增配置项：**

- `arkts.deveco.path` — 自定义 DevEco Studio 安装路径

**依赖：**

- `vscode-languageclient` — LSP 客户端
- `json5` — 解析 HarmonyOS 配置文件
- `esbuild` — 打包

## 逆向关键发现备忘

ace-server 入口：`{deveco}/plugins/openharmony/ace-server/out/index.js`
Worker：`{deveco}/plugins/openharmony/ace-server/out/worker/index.js`
配置：`{deveco}/plugins/openharmony/ace-server/out/config/`

ace-server 的 `checkModule` 必填字段校验链：
`deviceType → aceLoaderPath → jsComponentType → sdkJsPath → compatibleSdkLevel → apiType`

ace-server LSP capabilities：
`textDocumentSync(Incremental), hover, color, definition, rename, foldingRange, references, signatureHelp`
