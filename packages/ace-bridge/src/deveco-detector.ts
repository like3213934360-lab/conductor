import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface DevEcoEnvironment {
  devEcoPath: string
  aceServerEntry: string
  aceServerDir: string
  sdkPath: string
  sdkJsPath: string
  sdkComponentPath: string
  hosSdkPath: string
  aceLoaderPath: string
  nodeExecutable: string
}

/**
 * 多平台检测 DevEco Studio 安装路径，并推导所有 SDK 路径。
 * 检测链按优先级排列：用户配置 > 默认安装路径。
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
  const sdkComponentPath = path.join(sdkPath, 'ets', 'component')
  const hosSdkPath = path.join(devEcoPath, 'sdk', 'default', 'hms')
  const aceLoaderPath = path.join(sdkPath, 'ets', 'build-tools', 'ets-loader')

  let nodeExecutable: string
  const platform = os.platform()
  if (platform === 'darwin') {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'bin', 'node')
  } else if (platform === 'win32') {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'node.exe')
  } else {
    nodeExecutable = path.join(devEcoPath, 'tools', 'node', 'bin', 'node')
  }

  if (!fs.existsSync(sdkJsPath)) return null

  return {
    devEcoPath,
    aceServerEntry,
    aceServerDir,
    sdkPath,
    sdkJsPath,
    sdkComponentPath,
    hosSdkPath,
    aceLoaderPath,
    nodeExecutable,
  }
}
