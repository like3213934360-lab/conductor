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
    type: string
    deviceTypes?: string[]
    pages?: string
  }
}

/** 单个模块的完整配置 */
export interface ModuleConfig {
  name: string
  srcPath: string
  absolutePath: string
  moduleType: string
  deviceTypes: string[]
  /** 纯 SemVer 版本号，如 "6.0.2" */
  compileSdkVersion: string
  /** API 级别数字字符串，如 "22" */
  apiLevel: string
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
        compileSdkVersion: compatibleSdk.version,
        apiLevel: compatibleSdk.apiLevel,
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

/** 解析 "6.0.2(22)" → { version: "6.0.2.0", apiLevel: "22" } */
function parseCompatibleSdk(raw: string): { version: string; apiLevel: string } {
  const match = raw.match(/^([\d.]+)\((\d+)\)$/)
  if (match) {
    return { version: ensureFourPartVersion(match[1]), apiLevel: match[2] }
  }
  // 纯数字当作 API level
  if (/^\d+$/.test(raw)) {
    return { version: raw + '.0.0.0', apiLevel: raw }
  }
  // 纯 SemVer
  return { version: ensureFourPartVersion(raw), apiLevel: '12' }
}

/** ace-server 内部 SDK_VERSION_LENGTH=4，版本号必须是 4 段 */
function ensureFourPartVersion(version: string): string {
  const parts = version.split('.')
  while (parts.length < 4) parts.push('0')
  return parts.slice(0, 4).join('.')
}

function extractCompatibleSdk(profile: BuildProfile): { version: string; apiLevel: string } {
  const products = profile.app?.products
  if (products && products.length > 0) {
    const sdk = products[0].compatibleSdkVersion
    if (sdk !== undefined) return parseCompatibleSdk(String(sdk))
  }
  return { version: '5.0.0.0', apiLevel: '12' }
}

function normalizeModuleType(type: string): string {
  const lower = type.toLowerCase()
  if (lower === 'entry') return 'Entry'
  if (lower === 'har') return 'Har'
  if (lower === 'shared') return 'Library'
  return 'Entry'
}
