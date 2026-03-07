import type { DevEcoEnvironment } from './deveco-detector'
import type { ProjectConfig, ModuleConfig } from './project-parser'

/** 逆向还原的 ace-server module 接口 */
export interface AceModule {
  modulePath: string
  moduleName: string
  deviceType: number[]
  aceLoaderPath: string
  jsComponentType: string
  sdkJsPath: string
  sdkComponentPath: string
  sdkApiPath: string
  compatibleSdkLevel: string
  apiType: string
  hosSdkPath?: string
  runtimeOs?: string
  moduleType?: string
  compileMode?: string
  syncType?: string
  // 模块依赖解析关键字段
  packageManagerType?: string
  compileSdkVersion?: string
  compileSdkLevel?: string
  buildProfileParam?: {
    productName?: string
    targetName?: string
    compatibleSdkVersionStage?: string
    targetESVersion?: string
    skipOhModulesLint?: boolean
  }
}

/**
 * ace-server DeviceType 枚举（逆向还原）。
 * DEVICE_STR_MAP: 数字 → 字符串，convertDeviceTypeStr 用此映射。
 * 我们需要反向映射：module.json5 中的字符串 → 数字。
 */
const DEVICE_TYPE_MAP: Record<string, number> = {
  liteWearable: 1,  // FitnessWatch
  wearable: 2,      // SmartWatch
  tv: 3,            // TV
  car: 4,           // Car
  phone: 5,         // Phone
  smartVision: 6,   // IpCamera
  tablet: 7,        // Tablet
  router: 8,        // Router
  '2in1': 10,       // TwoInOne
  default: 5,       // default → Phone
}

function convertDeviceTypes(types: string[]): number[] {
  return types.map((t) => DEVICE_TYPE_MAP[t] ?? 5)
}

/** 完整的 initializationOptions */
export interface InitializationOptions {
  rootUri: string
  lspServerWorkspacePath: string
  modules: AceModule[]
  clientType?: string
  /** ace-server 在 initConfigService 中读取此字段初始化 completionSetting */
  completionSortSetting?: CompletionSortSetting
}

/** ace-server 补全排序配置（逆向还原） */
export interface CompletionSortSetting {
  matchCase?: number
  sortSuggesting?: number
  enableRecentlyUsed?: boolean
  enableCompletionSortByType?: boolean
  maxValidCompletionItemsCount?: number
  enableCompletionFunctionParameter?: boolean
  enableIndexModuleRootDirEtsFile?: boolean
}

/** 默认的 completionSortSetting */
export const DEFAULT_COMPLETION_SORT_SETTING: CompletionSortSetting = {
  matchCase: 0,
  sortSuggesting: 0,
  enableRecentlyUsed: false,
  enableCompletionSortByType: true,
  maxValidCompletionItemsCount: 50,
  enableCompletionFunctionParameter: false,
  enableIndexModuleRootDirEtsFile: false,
}

/**
 * 将项目配置 + DevEco 环境信息转换为 ace-server 所需的 AceModule[] 数组。
 * 逆向还原的 checkModule 必填字段：
 *   deviceType → aceLoaderPath → jsComponentType → sdkJsPath → compatibleSdkLevel → apiType
 * 模块依赖解析关键字段：
 *   packageManagerType = "ohpm" → 使用 oh_modules 目录解析模块间引用
 */
export function buildModules(project: ProjectConfig, env: DevEcoEnvironment): AceModule[] {
  return project.modules.map((mod) => buildOneModule(mod, env))
}

function buildOneModule(mod: ModuleConfig, env: DevEcoEnvironment): AceModule {
  return {
    // 6 个必填字段（checkModule 校验链）
    // ace-server 内部用数字枚举（DeviceType.Phone=5 等），不是字符串
    deviceType: convertDeviceTypes(mod.deviceTypes),
    aceLoaderPath: env.aceLoaderPath,
    jsComponentType: 'declarative',
    sdkJsPath: env.sdkJsPath,
    sdkComponentPath: env.sdkComponentPath,
    sdkApiPath: env.sdkJsPath,
    compatibleSdkLevel: mod.apiLevel,
    apiType: 'stageMode',
    // 模块依赖解析关键字段
    packageManagerType: 'ohpm',
    compileSdkVersion: mod.compileSdkVersion,
    compileSdkLevel: mod.apiLevel,
    // 其余字段
    modulePath: mod.absolutePath,
    moduleName: mod.name,
    hosSdkPath: env.hosSdkPath,
    runtimeOs: 'OpenHarmony',
    moduleType: mod.moduleType,
    compileMode: 'esmodule',
    syncType: 'add',
    buildProfileParam: {
      productName: 'default',
      targetName: 'default',
    },
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
    completionSortSetting: DEFAULT_COMPLETION_SORT_SETTING,
  }
}
