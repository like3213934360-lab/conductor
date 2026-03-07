# ace-server Bridge 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 删除旧的自研 LSP 代码，新建 ace-bridge 包，重写 vscode-extension，实现从 DevEco Studio 引用 ace-server 的 bridge 方案。

**Architecture:** 两个包：`ace-bridge`（项目解析 + ace-server 启动器）和 `vscode-extension`（全部重写）。ace-bridge 负责检测 DevEco 安装路径、解析项目配置文件、构造 `initializationOptions`、启动 ace-server 子进程。vscode-extension 调用 ace-bridge 并通过 `LanguageClient` 与 ace-server 通信。

**Tech Stack:** TypeScript, vscode-languageclient, json5, esbuild, child_process, VS Code Extension API

**设计文档:** `docs/plans/2026-02-27-ace-server-bridge-design.md`

---

## Task 1: 删除旧代码

**Files:**
- Delete: `packages/language-service/` — 自研语言服务核心
- Delete: `packages/lsp-server/` — 自研 LSP server
- Delete: `packages/rules/` — 自研规则引擎
- Delete: `scripts/` — 旧构建脚本
- Delete: `vitest.config.ts` — 旧测试配置
- Delete: `arkts-language-support-0.1.0.vsix` — 旧构建产物
- Modify: `package.json` — 更新 workspaces 和 scripts
- Modify: `tsconfig.json` — 更新 references

**Step 1: 删除旧包和文件**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
rm -rf packages/language-service packages/lsp-server packages/rules scripts
rm -f vitest.config.ts arkts-language-support-0.1.0.vsix
```

**Step 2: 更新根 `package.json`**

```json
{
  "name": "arkts-lsp",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build -w packages/ace-bridge && npm run build -w packages/vscode-extension",
    "build:bridge": "npm run build -w packages/ace-bridge",
    "build:ext": "npm run build -w packages/vscode-extension"
  }
}
```

**Step 3: 更新根 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "references": [
    { "path": "packages/ace-bridge" },
    { "path": "packages/vscode-extension" }
  ]
}
```

**Step 4: 验证删除结果**

```bash
ls packages/
# 预期只剩: vscode-extension/
```

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: 删除旧的自研 LSP 代码（language-service, lsp-server, rules, scripts）"
```

---

## Task 2: 创建 ace-bridge 包骨架

**Files:**
- Create: `packages/ace-bridge/package.json`
- Create: `packages/ace-bridge/tsconfig.json`
- Create: `packages/ace-bridge/src/index.ts`

**Step 1: 创建目录结构**

```bash
mkdir -p packages/ace-bridge/src
```

**Step 2: 创建 `packages/ace-bridge/package.json`**

```json
{
  "name": "@anthropic/ace-bridge",
  "version": "0.1.0",
  "description": "DevEco Studio ace-server bridge — 项目解析 + ace-server 启动器",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "watch": "tsc -p tsconfig.json --watch"
  },
  "dependencies": {
    "json5": "^2.2.3"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0"
  }
}
```

**Step 3: 创建 `packages/ace-bridge/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  },
  "include": ["src/**/*"]
}
```

**Step 4: 创建 `packages/ace-bridge/src/index.ts`（导出桩）**

```typescript
export { detectDevEco } from './deveco-detector'
export type { DevEcoEnvironment } from './deveco-detector'
export { parseProject } from './project-parser'
export type { ProjectConfig, ModuleConfig } from './project-parser'
export { buildModules } from './module-builder'
export type { AceModule, InitializationOptions } from './module-builder'
export { launchAceServer } from './ace-launcher'
```

**Step 5: Commit**

```bash
git add packages/ace-bridge/
git commit -m "feat: 创建 ace-bridge 包骨架"
```

---

## Task 3: 实现 deveco-detector.ts

**Files:**
- Create: `packages/ace-bridge/src/deveco-detector.ts`

**Step 1: 实现 DevEco 路径检测**

```typescript
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface DevEcoEnvironment {
  devEcoPath: string
  aceServerEntry: string
  aceServerDir: string
  sdkPath: string
  sdkJsPath: string
  hosSdkPath: string
  aceLoaderPath: string
  nodeExecutable: string
}

/**
 * 多平台检测 DevEco Studio 安装路径，并推导所有 SDK 路径。
 * 检测链按优先级排列：用户配置 > 默认安装路径。
 *
 * @param customPath 用户通过 VS Code 配置项 `arkts.deveco.path` 指定的路径
 * @returns DevEcoEnvironment 或 null（未找到）
 */
export function detectDevEco(customPath?: string): DevEcoEnvironment | null {
  const candidates = buildCandidates(customPath)

  for (const devEcoPath of candidates) {
    const env = validateDevEcoPath(devEcoPath)
    if (env) return env
  }

  return null
}

function buildCandidates(customPath?: string): string[] {
  const candidates: string[] = []

  if (customPath) {
    candidates.push(customPath)
  }

  const platform = os.platform()

  if (platform === 'darwin') {
    candidates.push('/Applications/DevEco-Studio.app/Contents')
    candidates.push(path.join(os.homedir(), 'Applications/DevEco-Studio.app/Contents'))
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || ''
    if (localAppData) {
      candidates.push(path.join(localAppData, 'Huawei', 'DevEco Studio'))
    }
    candidates.push('C:\\Program Files\\Huawei\\DevEco Studio')
  } else {
    // Linux
    candidates.push('/opt/deveco-studio')
  }

  return candidates
}

function validateDevEcoPath(devEcoPath: string): DevEcoEnvironment | null {
  const aceServerEntry = path.join(devEcoPath, 'plugins', 'openharmony', 'ace-server', 'out', 'index.js')
  if (!fs.existsSync(aceServerEntry)) return null

  const aceServerDir = path.dirname(aceServerEntry)
  const sdkPath = path.join(devEcoPath, 'sdk', 'default', 'openharmony')
  const sdkJsPath = path.join(sdkPath, 'ets', 'api')
  const hosSdkPath = path.join(devEcoPath, 'sdk', 'default', 'hms', 'ets')
  const aceLoaderPath = path.join(sdkPath, 'ets', 'build-tools', 'ets-loader')

  // DevEco 自带的 Node.js
  let nodeExecutable: string
  const platform = os.platform()
  if (platform === 'darwin') {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'bin', 'node')
  } else if (platform === 'win32') {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'node.exe')
  } else {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'bin', 'node')
  }

  // 至少 ace-server 入口和 SDK 路径必须存在
  if (!fs.existsSync(sdkJsPath)) return null

  return {
    devEcoPath,
    aceServerEntry,
    aceServerDir,
    sdkPath,
    sdkJsPath,
    hosSdkPath,
    aceLoaderPath,
    nodeExecutable,
  }
}
```

**Step 2: 验证编译**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
npx tsc -p packages/ace-bridge/tsconfig.json --noEmit
```

**Step 3: Commit**

```bash
git add packages/ace-bridge/src/deveco-detector.ts
git commit -m "feat(ace-bridge): 实现多平台 DevEco Studio 路径检测"
```

---

## Task 4: 实现 project-parser.ts

**Files:**
- Create: `packages/ace-bridge/src/project-parser.ts`

**Step 1: 实现项目配置文件解析**

```typescript
import * as fs from 'fs'
import * as path from 'path'
import JSON5 from 'json5'

/** build-profile.json5 中的模块条目 */
export interface BuildProfileModule {
  name: string
  srcPath: string
  targets?: Array<{ name: string }>
}

/** build-profile.json5 解析结果 */
export interface BuildProfile {
  modules: BuildProfileModule[]
  app?: {
    products?: Array<{
      name: string
      compatibleSdkVersion?: string | number
    }>
  }
}

/** module.json5 解析结果 */
export interface ModuleJson {
  module: {
    name: string
    type: string                    // "entry" | "har" | "shared"
    deviceTypes?: string[]
    pages?: string                  // "$profile:main_pages"
  }
}

/** 单个模块的完整配置 */
export interface ModuleConfig {
  name: string
  srcPath: string
  absolutePath: string
  moduleType: string               // "Entry" | "Har" | "Library"
  deviceTypes: string[]
  compatibleSdkVersion: string
}

/** 项目整体配置 */
export interface ProjectConfig {
  projectRoot: string
  modules: ModuleConfig[]
}

/**
 * 解析 HarmonyOS Stage 模型项目的配置文件。
 * 读取 build-profile.json5 获取模块列表，再逐个读取 module.json5 获取详细信息。
 */
export function parseProject(projectRoot: string): ProjectConfig {
  const buildProfilePath = path.join(projectRoot, 'build-profile.json5')
  if (!fs.existsSync(buildProfilePath)) {
    throw new Error(`不是 HarmonyOS 项目：找不到 ${buildProfilePath}`)
  }

  const buildProfile = readJson5<BuildProfile>(buildProfilePath)
  const compatibleSdk = extractCompatibleSdk(buildProfile)

  const modules: ModuleConfig[] = []

  for (const mod of buildProfile.modules || []) {
    const modulePath = path.resolve(projectRoot, mod.srcPath)
    const moduleJsonPath = path.join(modulePath, 'src', 'main', 'module.json5')

    if (!fs.existsSync(moduleJsonPath)) {
      // 跳过无法解析的模块，日志警告
      console.warn(`[ace-bridge] 跳过模块 ${mod.name}：找不到 ${moduleJsonPath}`)
      continue
    }

    try {
      const moduleJson = readJson5<ModuleJson>(moduleJsonPath)
      const moduleType = normalizeModuleType(moduleJson.module.type)
      const deviceTypes = moduleJson.module.deviceTypes || ['default']

      modules.push({
        name: mod.name,
        srcPath: mod.srcPath,
        absolutePath: modulePath,
        moduleType,
        deviceTypes,
        compatibleSdkVersion: compatibleSdk,
      })
    } catch (err) {
      console.warn(`[ace-bridge] 解析模块 ${mod.name} 失败:`, err)
    }
  }

  return { projectRoot, modules }
}

function readJson5<T>(filePath: string): T {
  const content = fs.readFileSync(filePath, 'utf-8')
  return JSON5.parse(content) as T
}

function extractCompatibleSdk(profile: BuildProfile): string {
  const products = profile.app?.products
  if (products && products.length > 0) {
    const sdk = products[0].compatibleSdkVersion
    if (sdk !== undefined) return String(sdk)
  }
  return '12'  // 合理默认值
}

function normalizeModuleType(type: string): string {
  const lower = type.toLowerCase()
  if (lower === 'entry') return 'Entry'
  if (lower === 'har') return 'Har'
  if (lower === 'shared') return 'Library'
  return 'Entry'
}
```

**Step 2: 验证编译**

```bash
npx tsc -p packages/ace-bridge/tsconfig.json --noEmit
```

**Step 3: Commit**

```bash
git add packages/ace-bridge/src/project-parser.ts
git commit -m "feat(ace-bridge): 实现项目配置文件解析（build-profile + module.json5）"
```

---

## Task 5: 实现 module-builder.ts

**Files:**
- Create: `packages/ace-bridge/src/module-builder.ts`

**Step 1: 实现 AceModule 构造**

```typescript
import type { DevEcoEnvironment } from './deveco-detector'
import type { ProjectConfig, ModuleConfig } from './project-parser'

/** 逆向还原的 ace-server module 接口 */
export interface AceModule {
  modulePath: string
  moduleName: string
  deviceType: string[]
  aceLoaderPath: string
  jsComponentType: string        // "Declaration"（Stage 模型固定值）
  sdkJsPath: string
  compatibleSdkLevel: string
  apiType: string                // "Stage"
  hosSdkPath?: string
  runtimeOs?: string             // "OpenHarmony"
  moduleType?: string            // "Entry" | "Har" | "Library"
  compileMode?: string           // "EsmModule"
  syncType?: string              // "Add"
}

/** 完整的 initializationOptions */
export interface InitializationOptions {
  rootUri: string
  lspServerWorkspacePath: string
  modules: AceModule[]
  clientType?: string
}

/**
 * 将项目配置 + DevEco 环境信息转换为 ace-server 所需的 AceModule[] 数组。
 * 逆向还原的 checkModule 必填字段：
 *   deviceType → aceLoaderPath → jsComponentType → sdkJsPath → compatibleSdkLevel → apiType
 */
export function buildModules(project: ProjectConfig, env: DevEcoEnvironment): AceModule[] {
  return project.modules.map((mod) => buildOneModule(mod, env))
}

function buildOneModule(mod: ModuleConfig, env: DevEcoEnvironment): AceModule {
  return {
    // 6 个必填字段（checkModule 校验链）
    deviceType: mod.deviceTypes,
    aceLoaderPath: env.aceLoaderPath,
    jsComponentType: 'Declaration',
    sdkJsPath: env.sdkJsPath,
    compatibleSdkLevel: mod.compatibleSdkVersion,
    apiType: 'Stage',
    // 其余字段
    modulePath: mod.absolutePath,
    moduleName: mod.name,
    hosSdkPath: env.hosSdkPath,
    runtimeOs: 'OpenHarmony',
    moduleType: mod.moduleType,
    compileMode: 'EsmModule',
    syncType: 'Add',
  }
}

/**
 * 构造完整的 initializationOptions 对象。
 */
export function buildInitializationOptions(
  project: ProjectConfig,
  env: DevEcoEnvironment,
): InitializationOptions {
  return {
    rootUri: `file://${project.projectRoot}`,
    lspServerWorkspacePath: env.aceServerDir,
    modules: buildModules(project, env),
    clientType: 'vscode',
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc -p packages/ace-bridge/tsconfig.json --noEmit
```

**Step 3: Commit**

```bash
git add packages/ace-bridge/src/module-builder.ts
git commit -m "feat(ace-bridge): 实现 AceModule 构造（逆向还原 initializationOptions）"
```

---

## Task 6: 实现 ace-launcher.ts

**Files:**
- Create: `packages/ace-bridge/src/ace-launcher.ts`

**Step 1: 实现 ace-server 启动器**

```typescript
import { fork, ChildProcess } from 'child_process'
import * as fs from 'fs'
import type { DevEcoEnvironment } from './deveco-detector'

export interface LaunchOptions {
  env: DevEcoEnvironment
  maxOldSpaceSize?: number       // 默认 4096 MB
}

export interface LaunchResult {
  process: ChildProcess
  kill: () => void
}

/**
 * 使用 DevEco 自带的 Node.js 启动 ace-server 子进程。
 * 返回 ChildProcess 供 VS Code LanguageClient 的 ServerOptions 使用。
 */
export function launchAceServer(options: LaunchOptions): LaunchResult {
  const { env, maxOldSpaceSize = 4096 } = options

  if (!fs.existsSync(env.aceServerEntry)) {
    throw new Error(
      `ace-server 入口不存在: ${env.aceServerEntry}\n` +
      '请确认 DevEco Studio 已正确安装且版本支持 ace-server。'
    )
  }

  if (!fs.existsSync(env.nodeExecutable)) {
    throw new Error(
      `DevEco 自带的 Node.js 不存在: ${env.nodeExecutable}\n` +
      '请确认 DevEco Studio 安装完整。'
    )
  }

  const child = fork(env.aceServerEntry, ['--stdio'], {
    execPath: env.nodeExecutable,
    execArgv: [`--max-old-space-size=${maxOldSpaceSize}`],
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    silent: true,
  })

  return {
    process: child,
    kill: () => {
      if (!child.killed) {
        child.kill()
      }
    },
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc -p packages/ace-bridge/tsconfig.json --noEmit
```

**Step 3: Commit**

```bash
git add packages/ace-bridge/src/ace-launcher.ts
git commit -m "feat(ace-bridge): 实现 ace-server 子进程启动器"
```

---

## Task 7: 重写 vscode-extension

**Files:**
- Rewrite: `packages/vscode-extension/src/extension.ts`
- Modify: `packages/vscode-extension/package.json`
- Keep: `packages/vscode-extension/syntaxes/ets.tmLanguage.json`（不动）
- Keep: `packages/vscode-extension/themes/deveco-darcula-color-theme.json`（不动）
- Keep: `packages/vscode-extension/language-configuration.json`（不动）

**Step 1: 更新 `packages/vscode-extension/package.json`**

关键改动：
- 删除 `build:server` 和 `copy:sdk` 脚本
- 添加 `@anthropic/ace-bridge` 依赖
- 添加 `json5` 依赖
- 添加 `arkts.deveco.path` 配置项
- 删除旧的 `arkts.server.path` 和 `arkts.sdk.path` 配置项

```json
{
  "name": "arkts-language-support",
  "displayName": "ArkTS Language Support",
  "description": "HarmonyOS ArkTS 语言智能支持 — 基于 DevEco Studio ace-server",
  "version": "0.2.0",
  "publisher": "like3213934360-lab",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Programming Languages",
    "Linters",
    "Formatters"
  ],
  "keywords": [
    "arkts",
    "harmonyos",
    "ets",
    "huawei",
    "openharmony"
  ],
  "activationEvents": [
    "onLanguage:arkts",
    "workspaceContains:**/*.ets"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "languages": [
      {
        "id": "arkts",
        "aliases": ["ArkTS", "arkts", "ets"],
        "extensions": [".ets"],
        "configuration": "./language-configuration.json"
      }
    ],
    "grammars": [
      {
        "language": "arkts",
        "scopeName": "source.ets",
        "path": "./syntaxes/ets.tmLanguage.json"
      }
    ],
    "themes": [
      {
        "label": "ArkTS DevEco (Darcula)",
        "uiTheme": "vs-dark",
        "path": "./themes/deveco-darcula-color-theme.json"
      }
    ],
    "configuration": {
      "title": "ArkTS",
      "properties": {
        "arkts.deveco.path": {
          "type": "string",
          "default": "",
          "description": "自定义 DevEco Studio 安装路径（留空则自动检测）"
        },
        "arkts.trace.server": {
          "type": "string",
          "enum": ["off", "messages", "verbose"],
          "default": "off",
          "description": "LSP 通信日志级别（调试用）"
        }
      }
    },
    "semanticTokenTypes": [
      {
        "id": "decorator",
        "superType": "type",
        "description": "ArkTS decorator name (e.g. @Component, @State)"
      }
    ],
    "semanticTokenScopes": [
      {
        "language": "arkts",
        "scopes": {
          "decorator": [
            "entity.name.function.decorator",
            "support.type",
            "entity.name.type"
          ]
        }
      }
    ],
    "configurationDefaults": {
      "[arkts]": {
        "editor.semanticHighlighting.enabled": true
      },
      "editor.semanticTokenColorCustomizations": {
        "enabled": true,
        "rules": {
          "namespace:arkts": "#A9B7C6",
          "type:arkts": "#A9B7C6",
          "class:arkts": "#A9B7C6",
          "enum:arkts": "#A9B7C6",
          "interface:arkts": "#A9B7C6",
          "struct:arkts": "#A9B7C6",
          "typeParameter:arkts": "#A9B7C6",
          "parameter:arkts": "#A9B7C6",
          "variable:arkts": "#A9B7C6",
          "property:arkts": "#9876AA",
          "enumMember:arkts": "#9876AA",
          "function:arkts": "#FFC66D",
          "method:arkts": "#FFC66D",
          "keyword:arkts": "#CC7832",
          "string:arkts": "#6A8759",
          "number:arkts": "#6897BB",
          "comment:arkts": "#808080",
          "operator:arkts": "#A9B7C6",
          "decorator:arkts": "#BBB529",
          "variable.readonly:arkts": "#A9B7C6",
          "property.static:arkts": {
            "foreground": "#9876AA",
            "fontStyle": "italic"
          },
          "method.static:arkts": {
            "foreground": "#FFC66D",
            "fontStyle": "italic"
          }
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run build",
    "build": "esbuild ./src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --minify",
    "watch": "esbuild ./src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --watch",
    "package": "npx vsce package --no-dependencies",
    "install-ext": "npx vsce package --no-dependencies -o arkts.vsix && code --install-extension arkts.vsix && rm arkts.vsix"
  },
  "dependencies": {
    "vscode-languageclient": "^9.0.0",
    "json5": "^2.2.3"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.24.0"
  }
}
```

**Step 2: 重写 `packages/vscode-extension/src/extension.ts`**

```typescript
import * as path from 'path'
import {
  workspace,
  ExtensionContext,
  window,
  ConfigurationTarget,
  StatusBarAlignment,
} from 'vscode'
import {
  LanguageClient,
  LanguageClientOptions,
  StreamInfo,
} from 'vscode-languageclient/node'
import { detectDevEco } from '../../ace-bridge/src/deveco-detector'
import { parseProject } from '../../ace-bridge/src/project-parser'
import { buildInitializationOptions } from '../../ace-bridge/src/module-builder'
import { launchAceServer } from '../../ace-bridge/src/ace-launcher'

let client: LanguageClient | undefined

// ============================================================================
// DevEco Studio (IntelliJ Darcula) color scheme — Two-layer coloring
// ============================================================================

const DEVECO_TEXTMATE_RULES = [
  { scope: 'keyword.control.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.operator.ets', settings: { foreground: '#CC7832' } },
  { scope: 'keyword.control.import.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.ets', settings: { foreground: '#CC7832' } },
  { scope: 'storage.type.struct.ets', settings: { foreground: '#CC7832' } },
  { scope: 'string.quoted.single.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.quoted.double.ets', settings: { foreground: '#6A8759' } },
  { scope: 'string.template.ets', settings: { foreground: '#6A8759' } },
  { scope: 'comment.line.double-slash.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.ets', settings: { foreground: '#808080' } },
  { scope: 'comment.block.documentation.ets', settings: { foreground: '#629755' } },
  { scope: 'keyword.other.documentation.ets', settings: { foreground: '#629755', fontStyle: 'bold' } },
  { scope: 'constant.numeric.ets', settings: { foreground: '#6897BB' } },
  { scope: 'constant.language.ets', settings: { foreground: '#CC7832' } },
  { scope: 'constant.character.escape.ets', settings: { foreground: '#CC7832' } },
  { scope: 'entity.name.function.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.method.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.function.component.ets', settings: { foreground: '#FFC66D' } },
  { scope: 'entity.name.type.class.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'variable.other.property.ets', settings: { foreground: '#9876AA' } },
  { scope: 'variable.language.this.ets', settings: { foreground: '#CC7832' } },
  { scope: 'meta.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'punctuation.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'entity.name.tag.decorator.ets', settings: { foreground: '#BBB529' } },
  { scope: 'support.type.primitive.ets', settings: { foreground: '#CC7832' } },
  { scope: 'support.type.arkts.ets', settings: { foreground: '#A9B7C6' } },
  { scope: 'punctuation.definition.template-expression.begin.ets', settings: { foreground: '#CC7832' } },
  { scope: 'punctuation.definition.template-expression.end.ets', settings: { foreground: '#CC7832' } },
]

const TEXTMATE_SENTINEL_SCOPE = 'keyword.control.ets'

const DEVECO_SEMANTIC_RULES: Record<string, string | { foreground: string; fontStyle: string }> = {
  'namespace:arkts': '#A9B7C6',
  'type:arkts': '#A9B7C6',
  'class:arkts': '#A9B7C6',
  'enum:arkts': '#A9B7C6',
  'interface:arkts': '#A9B7C6',
  'struct:arkts': '#A9B7C6',
  'typeParameter:arkts': '#A9B7C6',
  'parameter:arkts': '#A9B7C6',
  'variable:arkts': '#A9B7C6',
  'property:arkts': '#9876AA',
  'enumMember:arkts': '#9876AA',
  'function:arkts': '#FFC66D',
  'method:arkts': '#FFC66D',
  'keyword:arkts': '#CC7832',
  'string:arkts': '#6A8759',
  'number:arkts': '#6897BB',
  'comment:arkts': '#808080',
  'operator:arkts': '#A9B7C6',
  'decorator:arkts': '#BBB529',
  'variable.readonly:arkts': '#A9B7C6',
  'property.static:arkts': { foreground: '#9876AA', fontStyle: 'italic' },
  'method.static:arkts': { foreground: '#FFC66D', fontStyle: 'italic' },
}

function applyDevEcoColors(): void {
  const config = workspace.getConfiguration('editor')
  applyTextMateColors(config)
  applySemanticColors(config)
}

function applyTextMateColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('tokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const existingRules = (userGlobal?.textMateRules || []) as Array<{ scope: string; settings: Record<string, string> }>

  const hasSentinel = existingRules.some(
    (r) => r.scope === TEXTMATE_SENTINEL_SCOPE && r.settings?.foreground === '#CC7832',
  )
  if (hasSentinel) return

  const filteredRules = existingRules.filter(
    (r) => typeof r.scope !== 'string' || !r.scope.endsWith('.ets'),
  )
  const mergedRules = [...filteredRules, ...DEVECO_TEXTMATE_RULES]

  config.update(
    'tokenColorCustomizations',
    { ...(userGlobal || {}), textMateRules: mergedRules },
    ConfigurationTarget.Global,
  ).then(undefined, () => {})
}

function applySemanticColors(config: ReturnType<typeof workspace.getConfiguration>): void {
  const inspection = config.inspect<Record<string, unknown>>('semanticTokenColorCustomizations')
  const userGlobal = inspection?.globalValue as Record<string, unknown> | undefined
  const currentRules = (userGlobal?.rules || {}) as Record<string, unknown>

  const hasEnabled = userGlobal?.enabled === true
  const allPresent = hasEnabled && Object.keys(DEVECO_SEMANTIC_RULES).every((key) => key in currentRules)
  if (allPresent) return

  const mergedRules = { ...currentRules, ...DEVECO_SEMANTIC_RULES }

  config.update(
    'semanticTokenColorCustomizations',
    { ...(userGlobal || {}), enabled: true, rules: mergedRules },
    ConfigurationTarget.Global,
  ).then(
    () => { config.update('semanticHighlighting.enabled', true, ConfigurationTarget.Global) },
    () => {},
  )
}

export function activate(context: ExtensionContext): void {
  applyDevEcoColors()

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('workbench.colorTheme')) {
        applyDevEcoColors()
      }
    }),
  )

  // 状态栏
  const statusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100)
  statusBar.text = '$(loading~spin) ArkTS'
  statusBar.tooltip = 'ArkTS Language Server 正在初始化...'
  statusBar.show()
  context.subscriptions.push(statusBar)

  // 检测 DevEco
  const config = workspace.getConfiguration('arkts')
  const customDevEcoPath = config.get<string>('deveco.path', '')
  const env = detectDevEco(customDevEcoPath || undefined)

  if (!env) {
    statusBar.text = '$(error) ArkTS'
    statusBar.tooltip = '未找到 DevEco Studio'
    window.showErrorMessage(
      '未找到 DevEco Studio 安装。\n\n' +
      '请安装 DevEco Studio 或在设置中配置 arkts.deveco.path。'
    )
    return
  }

  // 解析项目
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) {
    statusBar.text = '$(warning) ArkTS'
    statusBar.tooltip = '未打开工作区'
    return
  }

  let initOptions: ReturnType<typeof buildInitializationOptions>
  try {
    const project = parseProject(workspaceRoot)
    initOptions = buildInitializationOptions(project, env)
  } catch (err: any) {
    statusBar.text = '$(error) ArkTS'
    statusBar.tooltip = `项目解析失败: ${err.message}`
    window.showErrorMessage(`ArkTS 项目解析失败: ${err.message}`)
    return
  }

  // 启动 ace-server
  const launch = launchAceServer({ env })
  const serverProcess = launch.process

  const serverOptions = (): Promise<StreamInfo> => {
    return Promise.resolve({
      reader: serverProcess.stdout!,
      writer: serverProcess.stdin!,
    })
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'arkts' },
      { scheme: 'file', pattern: '**/*.ets' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.ets'),
    },
    initializationOptions: initOptions,
    outputChannelName: 'ArkTS Language Server (ace-server)',
  }

  client = new LanguageClient(
    'arkts-lsp',
    'ArkTS Language Server',
    serverOptions,
    clientOptions,
  )

  // 监听 ace-server 自定义通知（索引进度）
  client.onReady().then(() => {
    client!.onNotification('onIndexingProgressUpdate', (params: any) => {
      if (params && typeof params.progress === 'number') {
        const pct = Math.round(params.progress * 100)
        statusBar.text = `$(sync~spin) ArkTS ${pct}%`
        statusBar.tooltip = `ArkTS 索引中... ${pct}%`
        if (pct >= 100) {
          statusBar.text = '$(check) ArkTS'
          statusBar.tooltip = 'ArkTS Language Server 已就绪'
        }
      }
    })
  })

  client.start().then(
    () => {
      statusBar.text = '$(check) ArkTS'
      statusBar.tooltip = 'ArkTS Language Server 已就绪'
    },
    (err) => {
      statusBar.text = '$(error) ArkTS'
      statusBar.tooltip = `ArkTS LSP 启动失败: ${err.message}`
      window.showErrorMessage(
        `ArkTS LSP 启动失败: ${err.message}\n\n` +
        '请确认 DevEco Studio 已正确安装。'
      )
    },
  )

  // ace-server 崩溃自动重启一次
  let hasRestarted = false
  serverProcess.on('exit', (code) => {
    if (code !== 0 && !hasRestarted) {
      hasRestarted = true
      statusBar.text = '$(sync~spin) ArkTS'
      statusBar.tooltip = 'ace-server 崩溃，正在重启...'
      // 重启逻辑：停止旧 client，重新启动
      if (client) {
        client.stop().then(() => {
          activate(context)
        })
      }
    }
  })

  context.subscriptions.push({
    dispose: () => {
      launch.kill()
      if (client) {
        client.stop()
      }
    },
  })
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined
  return client.stop()
}
```

注意：esbuild 打包时会将 `../../ace-bridge/src/` 的导入内联到 `dist/extension.js` 中，所以运行时不需要单独的 ace-bridge 包。

**Step 3: 删除旧的 extension.ts 中不再需要的 server 相关代码**

旧文件完全替换，无需增量修改。

**Step 4: 验证编译**

```bash
npx tsc -p packages/vscode-extension/tsconfig.json --noEmit
```

**Step 5: Commit**

```bash
git add packages/vscode-extension/
git commit -m "feat(vscode-extension): 重写扩展，接入 ace-server bridge"
```

---

## Task 8: 更新构建配置 & 安装依赖 & 端到端验证

**Files:**
- Modify: `packages/vscode-extension/tsconfig.json` — 添加对 ace-bridge 的引用
- Modify: root `package.json` — 确认 workspaces 正确

**Step 1: 更新 `packages/vscode-extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../ace-bridge" }
  ]
}
```

**Step 2: 安装依赖**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
npm install
```

**Step 3: 编译 ace-bridge**

```bash
npm run build:bridge
```
预期：`packages/ace-bridge/dist/` 下生成 `.js` + `.d.ts` 文件

**Step 4: 编译 vscode-extension**

```bash
npm run build:ext
```
预期：`packages/vscode-extension/dist/extension.js` 生成

**Step 5: 打包 VSIX 验证**

```bash
cd packages/vscode-extension
npx vsce package --no-dependencies -o arkts.vsix
ls -la arkts.vsix
```
预期：生成 `.vsix` 文件，大小合理（< 1MB，不含 ace-server 本身）

**Step 6: Commit**

```bash
cd /Users/dreamlike/DreamLike/arkts-lsp
git add -A
git commit -m "chore: 更新构建配置，完成 ace-server bridge 集成"
```

---

## 执行顺序总结

| Task | 内容 | 依赖 |
|------|------|------|
| 1 | 删除旧代码 | 无 |
| 2 | 创建 ace-bridge 包骨架 | Task 1 |
| 3 | 实现 deveco-detector | Task 2 |
| 4 | 实现 project-parser | Task 2 |
| 5 | 实现 module-builder | Task 3, 4 |
| 6 | 实现 ace-launcher | Task 3 |
| 7 | 重写 vscode-extension | Task 3, 4, 5, 6 |
| 8 | 构建配置 & 端到端验证 | Task 7 |

Task 3 和 Task 4 可以并行执行。Task 5 和 Task 6 可以并行执行。
