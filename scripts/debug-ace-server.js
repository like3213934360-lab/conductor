#!/usr/bin/env node
/**
 * ace-server 调试脚本
 * 模拟 VS Code 扩展的完整通信流程，精确定位 hover/completion/definition 返回空的原因。
 *
 * 用法：
 *   node scripts/debug-ace-server.js [项目路径]
 *   默认项目路径：/Users/dreamlike/DreamLike/myToolList
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const readline = require('readline')

// ============================================================================
// 配置
// ============================================================================

const PROJECT_ROOT = process.argv[2] || '/Users/dreamlike/DreamLike/myToolList'
const DEVECO_PATH = '/Applications/DevEco-Studio.app/Contents'
const ACE_SERVER_ENTRY = path.join(DEVECO_PATH, 'plugins/openharmony/ace-server/out/index.js')
const ACE_SERVER_DIR = path.dirname(ACE_SERVER_ENTRY)
const NODE_EXECUTABLE = path.join(DEVECO_PATH, 'tools/node/bin/node')
const SDK_PATH = path.join(DEVECO_PATH, 'sdk/default/openharmony')
const SDK_JS_PATH = path.join(SDK_PATH, 'ets/api')
const SDK_COMPONENT_PATH = path.join(SDK_PATH, 'ets/component')
const HOS_SDK_PATH = path.join(DEVECO_PATH, 'sdk/default/hms')
const ACE_LOADER_PATH = path.join(SDK_PATH, 'ets/build-tools/ets-loader')
const LOG_PATH = path.join(__dirname, '../logs')

// 测试文件
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')

// ============================================================================
// LSP 消息编解码
// ============================================================================

let requestIdCounter = 0
function nextRequestId() {
  return `debug-${++requestIdCounter}-${Date.now()}`
}

function encodeLspMessage(msg) {
  const json = JSON.stringify(msg)
  const byteLength = Buffer.byteLength(json, 'utf-8')
  return `Content-Length: ${byteLength}\r\n\r\n${json}`
}

// ============================================================================
// ace-server 进程管理
// ============================================================================

let serverProcess = null
let messageBuffer = ''
let pendingResolvers = new Map()

function startAceServer() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(LOG_PATH, { recursive: true })
  }

  console.log('=== ace-server 调试脚本 ===')
  console.log(`项目路径: ${PROJECT_ROOT}`)
  console.log(`DevEco 路径: ${DEVECO_PATH}`)
  console.log(`ace-server: ${ACE_SERVER_ENTRY}`)
  console.log(`Node: ${NODE_EXECUTABLE}`)
  console.log(`测试文件: ${TEST_FILE}`)
  console.log('')

  // 验证路径
  for (const [name, p] of [
    ['ace-server', ACE_SERVER_ENTRY],
    ['Node', NODE_EXECUTABLE],
    ['SDK JS', SDK_JS_PATH],
    ['SDK Component', SDK_COMPONENT_PATH],
    ['测试文件', TEST_FILE],
  ]) {
    if (!fs.existsSync(p)) {
      console.error(`❌ ${name} 不存在: ${p}`)
      process.exit(1)
    }
    console.log(`✅ ${name}: ${p}`)
  }
  console.log('')

  serverProcess = spawn(NODE_EXECUTABLE, [
    '--max-old-space-size=4096',
    ACE_SERVER_ENTRY,
    '--stdio',
    `--logger-level=DEBUG`,
    `--logger-path=${LOG_PATH}`,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: ACE_SERVER_DIR,
  })

  console.log(`ace-server PID: ${serverProcess.pid}`)

  // stderr 日志
  serverProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[stderr] ${msg}`)
  })

  // stdout LSP 消息解析
  serverProcess.stdout.on('data', (chunk) => {
    messageBuffer += chunk.toString()
    parseMessages()
  })

  serverProcess.on('exit', (code, signal) => {
    console.log(`\n❌ ace-server 退出: code=${code} signal=${signal}`)
  })

  serverProcess.on('error', (err) => {
    console.error(`❌ ace-server 启动失败: ${err.message}`)
  })
}

function parseMessages() {
  while (true) {
    const headerEnd = messageBuffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break

    const header = messageBuffer.substring(0, headerEnd)
    const match = header.match(/Content-Length:\s*(\d+)/)
    if (!match) {
      console.error(`❌ 无法解析 header: ${header}`)
      messageBuffer = messageBuffer.substring(headerEnd + 4)
      continue
    }

    const contentLength = parseInt(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + contentLength

    if (messageBuffer.length < bodyEnd) break // 数据不完整

    const body = messageBuffer.substring(bodyStart, bodyEnd)
    messageBuffer = messageBuffer.substring(bodyEnd)

    try {
      const msg = JSON.parse(body)
      handleServerMessage(msg)
    } catch (err) {
      console.error(`❌ JSON 解析失败: ${err.message}`)
      console.error(`  body: ${body.substring(0, 200)}...`)
    }
  }
}

function handleServerMessage(msg) {
  const ts = new Date().toISOString().substring(11, 23)

  if (msg.id !== undefined && msg.result !== undefined) {
    // LSP Response
    console.log(`[${ts}] ← Response id=${msg.id} hasResult=${msg.result !== null}`)
    if (msg.result && typeof msg.result === 'object') {
      console.log(`  result keys: ${Object.keys(msg.result).join(', ')}`)
      if (msg.result.capabilities) {
        console.log(`  capabilities: ${JSON.stringify(msg.result.capabilities).substring(0, 300)}`)
      }
    }
    const resolver = pendingResolvers.get(msg.id)
    if (resolver) {
      pendingResolvers.delete(msg.id)
      resolver(msg.result)
    }
  } else if (msg.method) {
    // Notification from server
    const params = msg.params || {}
    const paramStr = JSON.stringify(params).substring(0, 300)

    if (msg.method === 'aceProject/onIndexingProgressUpdate') {
      console.log(`[${ts}] ← 📊 索引进度: ${JSON.stringify(params)}`)
    } else if (msg.method === 'aceProject/onModuleInitFinish') {
      console.log(`[${ts}] ← 模块初始化完成: ${paramStr}`)
    } else if (msg.method === 'aceProject/onModuleUpdateFinish') {
      console.log(`[${ts}] ← 模块更新完成: ${paramStr}`)
    } else if (msg.method === 'aceProject/onSyncFileFinish') {
      console.log(`[${ts}] ← 文件同步完成: ${paramStr}`)
    } else if (msg.method === 'aceProject/onExitIndexing') {
      console.log(`[${ts}] ← 索引退出: ${paramStr}`)
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = params.uri || '?'
      const count = params.diagnostics ? params.diagnostics.length : 0
      console.log(`[${ts}] ← 🔍 诊断: ${path.basename(uri)} (${count} 条)`)
      if (count > 0) {
        params.diagnostics.slice(0, 3).forEach((d) => {
          console.log(`    L${d.range?.start?.line}: [${d.severity}] ${d.message?.substring(0, 100)}`)
        })
      }
    } else if (msg.method.includes('onAsync')) {
      // ace-server 自定义通知响应
      console.log(`[${ts}] ← 🔔 ${msg.method}`)
      console.log(`  requestId: ${params.requestId || '?'}`)
      console.log(`  hasResult: ${!!params.result}`)
      if (params.result) {
        const resultStr = JSON.stringify(params.result).substring(0, 500)
        console.log(`  result: ${resultStr}`)
      } else {
        console.log(`  ⚠️ result 为空！完整 params:`)
        console.log(`  ${paramStr}`)
      }

      // 解析 pendingResolvers
      if (params.requestId && pendingResolvers.has(params.requestId)) {
        const resolver = pendingResolvers.get(params.requestId)
        pendingResolvers.delete(params.requestId)
        resolver(params.result)
      }
    } else {
      console.log(`[${ts}] ← 📨 ${msg.method}: ${paramStr}`)
    }
  } else if (msg.error) {
    console.log(`[${ts}] ← ❌ Error: ${JSON.stringify(msg.error)}`)
  }
}

// ============================================================================
// 发送消息
// ============================================================================

function sendRequest(method, params) {
  const id = requestIdCounter++
  const msg = { jsonrpc: '2.0', id, method, params }
  console.log(`→ Request [${id}] ${method}`)
  serverProcess.stdin.write(encodeLspMessage(msg))
  return new Promise((resolve) => {
    pendingResolvers.set(id, resolve)
    setTimeout(() => {
      if (pendingResolvers.has(id)) {
        pendingResolvers.delete(id)
        console.log(`⏰ Request [${id}] ${method} 超时`)
        resolve(null)
      }
    }, 30000)
  })
}

function sendNotification(method, params) {
  const msg = { jsonrpc: '2.0', method, params }
  console.log(`→ Notification ${method}`)
  serverProcess.stdin.write(encodeLspMessage(msg))
}

function sendAceRequest(method, params, timeoutMs = 15000) {
  const requestId = nextRequestId()
  console.log(`→ AceRequest ${method} [${requestId}]`)
  sendNotification(method, { params, requestId })
  return new Promise((resolve) => {
    pendingResolvers.set(requestId, resolve)
    setTimeout(() => {
      if (pendingResolvers.has(requestId)) {
        pendingResolvers.delete(requestId)
        console.log(`⏰ AceRequest ${method} [${requestId}] 超时`)
        resolve(null)
      }
    }, timeoutMs)
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// 构造 initializationOptions（与 module-builder.ts 一致）
// ============================================================================

function buildInitOptions() {
  // 读取 build-profile.json5
  const JSON5 = require(path.join(
    '/Users/dreamlike/DreamLike/arkts-lsp/node_modules/json5'
  ))

  const buildProfilePath = path.join(PROJECT_ROOT, 'build-profile.json5')
  const buildProfile = JSON5.parse(fs.readFileSync(buildProfilePath, 'utf-8'))

  // 提取 compatibleSdkVersion
  let sdkVersion = '5.0.0.0'
  let apiLevel = '12'
  const products = buildProfile.app?.products
  if (products && products.length > 0) {
    const raw = String(products[0].compatibleSdkVersion || '')
    const m = raw.match(/^([\d.]+)\((\d+)\)$/)
    if (m) {
      // SDK 版本必须是 4 段格式（ace-server 内部 SDK_VERSION_LENGTH=4）
      const parts = m[1].split('.')
      while (parts.length < 4) parts.push('0')
      sdkVersion = parts.slice(0, 4).join('.')
      apiLevel = m[2]
    }
  }

  const DEVICE_TYPE_MAP = {
    liteWearable: 1, wearable: 2, tv: 3, car: 4, phone: 5,
    smartVision: 6, tablet: 7, router: 8, '2in1': 10, default: 5,
  }

  const modules = (buildProfile.modules || []).map((mod) => {
    const modulePath = path.resolve(PROJECT_ROOT, mod.srcPath)
    const moduleJsonPath = path.join(modulePath, 'src/main/module.json5')

    let deviceTypes = ['default']
    let moduleType = 'Entry'
    if (fs.existsSync(moduleJsonPath)) {
      try {
        const moduleJson = JSON5.parse(fs.readFileSync(moduleJsonPath, 'utf-8'))
        deviceTypes = moduleJson.module?.deviceTypes || ['default']
        const type = (moduleJson.module?.type || 'entry').toLowerCase()
        moduleType = type === 'entry' ? 'Entry' : type === 'har' ? 'Har' : type === 'shared' ? 'Library' : 'Entry'
      } catch (e) {
        console.warn(`  ⚠️ 解析 ${moduleJsonPath} 失败: ${e.message}`)
      }
    }

    return {
      modulePath,
      moduleName: mod.name,
      deviceType: deviceTypes.map((t) => DEVICE_TYPE_MAP[t] || 5),
      aceLoaderPath: ACE_LOADER_PATH,
      jsComponentType: 'declarative',
      sdkJsPath: SDK_JS_PATH,
      sdkComponentPath: SDK_COMPONENT_PATH,
      sdkApiPath: SDK_JS_PATH,
      compatibleSdkLevel: apiLevel,
      apiType: 'stageMode',
      packageManagerType: 'ohpm',
      compileSdkVersion: sdkVersion,
      compileSdkLevel: apiLevel,
      hosSdkPath: HOS_SDK_PATH,
      runtimeOs: 'OpenHarmony',
      moduleType,
      compileMode: 'esmodule',
      syncType: 'add',
      buildProfileParam: {
        productName: 'default',
        targetName: 'default',
      },
    }
  })

  console.log(`\n📦 解析到 ${modules.length} 个模块:`)
  modules.forEach((m) => {
    console.log(`  - ${m.moduleName} (${m.moduleType}) @ ${m.modulePath}`)
  })

  return {
    rootUri: `file://${PROJECT_ROOT}`,
    lspServerWorkspacePath: ACE_SERVER_DIR,
    modules,
    clientType: 'vscode',
    completionSortSetting: {
      matchCase: 0,
      sortSuggesting: 0,
      enableRecentlyUsed: false,
      enableCompletionSortByType: true,
      maxValidCompletionItemsCount: 50,
      enableCompletionFunctionParameter: false,
      enableIndexModuleRootDirEtsFile: false,
    },
  }
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  startAceServer()
  await sleep(2000) // 等待进程启动

  // Step 1: initialize
  console.log('\n' + '='.repeat(60))
  console.log('Step 1: LSP initialize')
  console.log('='.repeat(60))

  const initOptions = buildInitOptions()
  const initResult = await sendRequest('initialize', {
    processId: process.pid,
    rootUri: `file://${PROJECT_ROOT}`,
    capabilities: {
      textDocument: {
        hover: { contentFormat: ['markdown', 'plaintext'] },
        completion: {
          completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] },
        },
        definition: {},
        references: {},
        documentHighlight: {},
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
        codeAction: {},
        documentLink: {},
        rename: { prepareSupport: true },
        publishDiagnostics: { relatedInformation: true },
        synchronization: { didSave: true, willSave: true },
      },
      workspace: {
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: true },
      },
    },
    initializationOptions: initOptions,
    workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: path.basename(PROJECT_ROOT) }],
  })

  if (!initResult) {
    console.error('❌ initialize 失败！')
    cleanup()
    return
  }
  console.log('✅ initialize 成功')

  // Step 2: initialized
  console.log('\n' + '='.repeat(60))
  console.log('Step 2: initialized 通知（含 editors 数组）')
  console.log('='.repeat(60))

  sendNotification('initialized', { editors: [] })
  console.log('✅ initialized 已发送')

  // Step 2.5: 发送 completionSetting（DevEco Studio 在初始化后会发送此通知）
  console.log('\n' + '='.repeat(60))
  console.log('Step 2.5: 发送 onUpdateCompletionSetting')
  console.log('='.repeat(60))

  sendNotification('aceProject/onUpdateCompletionSetting', {
    params: {
      enableIndexModuleRootDirEtsFile: false,
      enableCompletionFunctionParameter: false,
      enableRecentlyUsed: false,
      enableCompletionSortByType: true,
      maxValidCompletionItemsCount: 50,
    },
    requestId: nextRequestId(),
  })
  console.log('✅ completionSetting 已发送')

  // Step 3: 等待模块初始化和索引
  console.log('\n' + '='.repeat(60))
  console.log('Step 3: 等待模块初始化和索引...')
  console.log('='.repeat(60))
  console.log('等待 15 秒让 worker 完成索引...')

  await sleep(30000) // 等待索引完成（增加到 30 秒）

  // Step 4: didOpen
  console.log('\n' + '='.repeat(60))
  console.log('Step 4: 发送 didOpen')
  console.log('='.repeat(60))

  const fileContent = fs.readFileSync(TEST_FILE, 'utf-8')
  // ace-server 的 getFileFsPath 使用 URI.parse(uri).fsPath
  // 所以必须发送 file:/// URI，不能发送纯路径
  const fileUri = `file://${TEST_FILE}`
  console.log(`文件: ${TEST_FILE}`)
  console.log(`URI (纯路径): ${fileUri}`)
  console.log(`内容长度: ${fileContent.length} 字符`)
  console.log(`行数: ${fileContent.split('\n').length}`)

  // 使用 ace-server 自定义 didOpen 协议
  sendNotification('aceProject/onAsyncDidOpen', {
    params: {
      textDocument: {
        uri: fileUri,
        languageId: 'ArkTS',
        version: 1,
        text: fileContent,
      },
    },
    requestId: nextRequestId(),
    editorFiles: [fileUri],
  })
  console.log('✅ didOpen 已发送（纯路径格式）')

  await sleep(5000) // 等待文件处理

  // Step 5: 全面测试 — 基于 Index.ets 的真实位置
  console.log('\n' + '='.repeat(60))
  console.log('Step 5: 全面测试 Hover / Definition / Completion')
  console.log('='.repeat(60))

  const lines = fileContent.split('\n')

  // 定义测试位置（基于 Index.ets 的实际内容）
  const testTargets = []

  // 1. import { common } from '@kit.AbilityKit' — L4, "common"
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("import { common }")) {
      testTargets.push({ name: 'import:common', line: i, char: lines[i].indexOf('common') })
      break
    }
  }

  // 2. NavPathStack 类型 — L25 附近
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/:\s*(NavPathStack)/)
    if (m) {
      testTargets.push({ name: 'type:NavPathStack', line: i, char: lines[i].indexOf('NavPathStack') })
      break
    }
  }

  // 3. Navigation 组件 — build() 内
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('Navigation(')) {
      testTargets.push({ name: 'component:Navigation', line: i, char: lines[i].indexOf('Navigation') })
      break
    }
  }

  // 4. Column() 组件
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('Column()')) {
      testTargets.push({ name: 'component:Column', line: i, char: lines[i].indexOf('Column') })
      break
    }
  }

  // 5. Stack 组件
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('Stack(')) {
      testTargets.push({ name: 'component:Stack', line: i, char: lines[i].indexOf('Stack') })
      break
    }
  }

  // 6. SideBarContainer 组件
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('SideBarContainer(')) {
      testTargets.push({ name: 'component:SideBarContainer', line: i, char: lines[i].indexOf('SideBarContainer') })
      break
    }
  }

  // 7. this.pageStack — 成员访问
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('this.pageStack') && !lines[i].includes('@Provider')) {
      testTargets.push({ name: 'member:this.pageStack', line: i, char: lines[i].indexOf('pageStack', lines[i].indexOf('this.')) })
      break
    }
  }

  // 8. .width('100%') — 链式调用方法
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('.width(')) {
      testTargets.push({ name: 'chain:.width', line: i, char: lines[i].indexOf('width') })
      break
    }
  }

  console.log(`\n找到 ${testTargets.length} 个测试目标:`)
  testTargets.forEach(t => {
    console.log(`  ${t.name}: L${t.line}:${t.char} "${lines[t.line].trim().substring(0, 60)}"`)
  })

  // === Hover 测试 ===
  console.log('\n--- Hover 测试 ---')
  for (const target of testTargets) {
    const result = await sendAceRequest('aceProject/onAsyncHover', {
      textDocument: { uri: fileUri },
      position: { line: target.line, character: target.char },
    })
    const hasContent = result?.contents?.length > 0 || (typeof result?.contents === 'string' && result.contents.length > 0)
    const status = hasContent ? '✅' : '❌'
    const preview = hasContent ? JSON.stringify(result.contents).substring(0, 200) : 'empty'
    console.log(`  ${status} ${target.name}: ${preview}`)
  }

  // === Definition 测试 ===
  console.log('\n--- Definition 测试 ---')
  for (const target of testTargets) {
    const result = await sendAceRequest('aceProject/onAsyncDefinition', {
      textDocument: { uri: fileUri },
      position: { line: target.line, character: target.char },
    })
    const hasResult = Array.isArray(result) ? result.length > 0 : !!result
    const status = hasResult ? '✅' : '❌'
    const preview = hasResult ? JSON.stringify(result).substring(0, 300) : 'empty'
    console.log(`  ${status} ${target.name}: ${preview}`)
  }

  // === Completion 测试 ===
  console.log('\n--- Completion 测试 ---')

  // this. 补全
  for (let i = 0; i < lines.length; i++) {
    const thisMatch = lines[i].match(/this\.(\w*)/)
    if (thisMatch) {
      const compChar = lines[i].indexOf('this.') + 5
      const result = await sendAceRequest('aceProject/onAsyncCompletion', {
        textDocument: { uri: fileUri },
        position: { line: i, character: compChar },
      })
      const count = result?.items?.length || 0
      const status = count > 0 ? '✅' : '❌'
      const items = (result?.items || []).slice(0, 5).map(it => it.label || it.insertText).join(', ')
      console.log(`  ${status} this. (L${i}): ${count} 项 [${items}]`)
      break
    }
  }

  // .width 后的链式补全 — 在 .width('100%') 行末尾加 .
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('.height(') && lines[i].includes("'100%'")) {
      const result = await sendAceRequest('aceProject/onAsyncCompletion', {
        textDocument: { uri: fileUri },
        position: { line: i, character: lines[i].indexOf('.height') + 1 },
      })
      const count = result?.items?.length || 0
      const status = count > 0 ? '✅' : '❌'
      const items = (result?.items || []).slice(0, 8).map(it => it.label || it.insertText).join(', ')
      console.log(`  ${status} 链式.height (L${i}): ${count} 项 [${items}]`)
      break
    }
  }

  // Step 6: 检查日志
  console.log('\n' + '='.repeat(60))
  console.log('Step 6: 检查 ace-server 日志')
  console.log('='.repeat(60))

  await sleep(2000)
  const logFiles = fs.readdirSync(LOG_PATH).filter((f) => f.endsWith('.log'))
  console.log(`日志文件: ${logFiles.join(', ') || '无'}`)
  for (const logFile of logFiles) {
    const logContent = fs.readFileSync(path.join(LOG_PATH, logFile), 'utf-8')
    if (logContent.length > 0) {
      console.log(`\n--- ${logFile} (最后 30 行) ---`)
      const logLines = logContent.split('\n')
      console.log(logLines.slice(-30).join('\n'))
    }
  }

  // 完成
  console.log('\n' + '='.repeat(60))
  console.log('调试完成')
  console.log('='.repeat(60))

  cleanup()
}

function cleanup() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill()
  }
  setTimeout(() => process.exit(0), 1000)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

main().catch((err) => {
  console.error(`❌ 脚本异常: ${err.message}`)
  console.error(err.stack)
  cleanup()
})
