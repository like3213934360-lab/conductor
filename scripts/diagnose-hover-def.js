#!/usr/bin/env node
/**
 * 精确诊断 hover/definition 不工作的原因
 * 
 * 关键假设：completion 正常但 hover/definition 返回空，
 * 可能原因：
 *   1. 需要同时发送标准 textDocument/didOpen + ace 自定义 didOpen
 *   2. hover/definition 需要等待文件索引完成后才能工作
 *   3. ace-server 的 hover/definition worker 需要特殊的初始化
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

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
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')

let serverProcess = null
let messageBuffer = ''
let pendingResolvers = new Map()
let requestIdCounter = 0
let allServerMessages = []  // 记录所有服务器消息用于分析

function nextRequestId() { return `diag-${++requestIdCounter}-${Date.now()}` }

function encodeLspMessage(msg) {
  const json = JSON.stringify(msg)
  const byteLength = Buffer.byteLength(json, 'utf-8')
  return `Content-Length: ${byteLength}\r\n\r\n${json}`
}

function startAceServer() {
  if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })

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

  serverProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim()
    if (msg) console.log(`[stderr] ${msg}`)
  })

  serverProcess.stdout.on('data', (chunk) => {
    messageBuffer += chunk.toString()
    parseMessages()
  })

  serverProcess.on('exit', (code, signal) => {
    console.log(`\n❌ ace-server 退出: code=${code} signal=${signal}`)
  })

  return serverProcess
}

function parseMessages() {
  while (true) {
    const headerEnd = messageBuffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) break
    const header = messageBuffer.substring(0, headerEnd)
    const match = header.match(/Content-Length:\s*(\d+)/)
    if (!match) { messageBuffer = messageBuffer.substring(headerEnd + 4); continue }
    const contentLength = parseInt(match[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + contentLength
    if (messageBuffer.length < bodyEnd) break
    const body = messageBuffer.substring(bodyStart, bodyEnd)
    messageBuffer = messageBuffer.substring(bodyEnd)
    try {
      const msg = JSON.parse(body)
      handleServerMessage(msg)
    } catch (err) {
      console.error(`❌ JSON 解析失败: ${err.message}`)
    }
  }
}

function handleServerMessage(msg) {
  allServerMessages.push(msg)
  
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    if (msg.error) {
      console.log(`  ← Response id=${msg.id} ERROR: ${JSON.stringify(msg.error)}`)
    }
    const resolver = pendingResolvers.get(msg.id)
    if (resolver) {
      pendingResolvers.delete(msg.id)
      resolver(msg.error ? { __error: msg.error } : msg.result)
    }
  } else if (msg.method) {
    const params = msg.params || {}
    
    if (msg.method === 'aceProject/onIndexingProgressUpdate') {
      const total = params.total || '?'
      const current = params.current || '?'
      const mod = params.moduleName || ''
      console.log(`  📊 索引 ${current}/${total} ${mod}`)
    } else if (msg.method === 'aceProject/onModuleInitFinish') {
      console.log(`  ✅ 模块初始化完成`)
    } else if (msg.method.includes('onAsync')) {
      const reqId = params.requestId
      const hasResult = !!params.result
      if (reqId && pendingResolvers.has(reqId)) {
        const resolver = pendingResolvers.get(reqId)
        pendingResolvers.delete(reqId)
        resolver(params.result)
      }
    } else if (msg.method === 'textDocument/publishDiagnostics') {
      const count = params.diagnostics ? params.diagnostics.length : 0
      if (count > 0) {
        console.log(`  🔍 诊断: ${path.basename(params.uri || '')} (${count} 条)`)
      }
    }
    // 其他消息静默处理
  }
}

function sendRequest(method, params) {
  const id = requestIdCounter++
  const msg = { jsonrpc: '2.0', id, method, params }
  serverProcess.stdin.write(encodeLspMessage(msg))
  return new Promise((resolve) => {
    pendingResolvers.set(id, resolve)
    setTimeout(() => {
      if (pendingResolvers.has(id)) {
        pendingResolvers.delete(id)
        resolve(null)
      }
    }, 30000)
  })
}

function sendNotification(method, params) {
  const msg = { jsonrpc: '2.0', method, params }
  serverProcess.stdin.write(encodeLspMessage(msg))
}

function sendAceRequest(method, params, timeoutMs = 20000) {
  const requestId = nextRequestId()
  sendNotification(method, { params, requestId })
  return new Promise((resolve) => {
    pendingResolvers.set(requestId, resolve)
    setTimeout(() => {
      if (pendingResolvers.has(requestId)) {
        pendingResolvers.delete(requestId)
        resolve(null)
      }
    }, timeoutMs)
  })
}

// 尝试用标准 LSP request 发送 hover/definition
function sendStdRequest(method, params, timeoutMs = 15000) {
  const id = requestIdCounter++
  const msg = { jsonrpc: '2.0', id, method, params }
  serverProcess.stdin.write(encodeLspMessage(msg))
  return new Promise((resolve) => {
    pendingResolvers.set(id, resolve)
    setTimeout(() => {
      if (pendingResolvers.has(id)) {
        pendingResolvers.delete(id)
        resolve(null)
      }
    }, timeoutMs)
  })
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function buildInitOptions() {
  const JSON5 = require(path.join('/Users/dreamlike/DreamLike/arkts-lsp/node_modules/json5'))
  const buildProfilePath = path.join(PROJECT_ROOT, 'build-profile.json5')
  const buildProfile = JSON5.parse(fs.readFileSync(buildProfilePath, 'utf-8'))

  let sdkVersion = '5.0.0.0'
  let apiLevel = '12'
  const products = buildProfile.app?.products
  if (products && products.length > 0) {
    const raw = String(products[0].compatibleSdkVersion || '')
    const m = raw.match(/^([\d.]+)\((\d+)\)$/)
    if (m) {
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
      } catch (e) { }
    }

    return {
      modulePath, moduleName: mod.name,
      deviceType: deviceTypes.map((t) => DEVICE_TYPE_MAP[t] || 5),
      aceLoaderPath: ACE_LOADER_PATH, jsComponentType: 'declarative',
      sdkJsPath: SDK_JS_PATH, sdkComponentPath: SDK_COMPONENT_PATH,
      sdkApiPath: SDK_JS_PATH, compatibleSdkLevel: apiLevel,
      apiType: 'stageMode', packageManagerType: 'ohpm',
      compileSdkVersion: sdkVersion, compileSdkLevel: apiLevel,
      hosSdkPath: HOS_SDK_PATH, runtimeOs: 'OpenHarmony',
      moduleType, compileMode: 'esmodule', syncType: 'add',
      buildProfileParam: { productName: 'default', targetName: 'default' },
    }
  })

  return {
    rootUri: `file://${PROJECT_ROOT}`,
    lspServerWorkspacePath: ACE_SERVER_DIR,
    modules,
    clientType: 'vscode',
    completionSortSetting: {
      matchCase: 0, sortSuggesting: 0, enableRecentlyUsed: false,
      enableCompletionSortByType: true, maxValidCompletionItemsCount: 50,
      enableCompletionFunctionParameter: false, enableIndexModuleRootDirEtsFile: false,
    },
  }
}

async function main() {
  console.log('🔬 ace-server hover/definition 精确诊断')
  console.log('='.repeat(60))

  startAceServer()
  await sleep(2000)

  const fileUri = `file://${TEST_FILE}`
  const fileContent = fs.readFileSync(TEST_FILE, 'utf-8')
  const lines = fileContent.split('\n')

  // 找一个测试位置：Column 组件
  let testLine = -1, testChar = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('Column()')) {
      testLine = i
      testChar = lines[i].indexOf('Column')
      break
    }
  }
  if (testLine === -1) {
    // fallback: 找 Navigation
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('Navigation(')) {
        testLine = i
        testChar = lines[i].indexOf('Navigation')
        break
      }
    }
  }
  console.log(`测试位置: L${testLine}:${testChar} "${lines[testLine].trim().substring(0, 50)}"`)

  // === 步骤 1: Initialize ===
  console.log('\n📋 Step 1: Initialize')
  const initOptions = buildInitOptions()
  const initResult = await sendRequest('initialize', {
    processId: process.pid,
    rootUri: `file://${PROJECT_ROOT}`,
    capabilities: {
      textDocument: {
        hover: { contentFormat: ['markdown', 'plaintext'] },
        completion: { completionItem: { snippetSupport: true } },
        definition: {},
        references: {},
        synchronization: { didSave: true, willSave: true, dynamicRegistration: true },
      },
      workspace: { workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: true } },
    },
    initializationOptions: initOptions,
    workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: path.basename(PROJECT_ROOT) }],
  })
  console.log(`  ✅ initialize: ${initResult ? 'OK' : 'FAIL'}`)

  // === 步骤 2: initialized ===
  sendNotification('initialized', { editors: [] })
  console.log('  ✅ initialized 发送')
  
  // 等待模块初始化
  console.log('\n⏳ 等待模块初始化和索引 (30s)...')
  await sleep(30000)

  // ================================================================
  // 测试 A: 只用 ace 自定义 didOpen，然后测试 hover/definition
  // ================================================================
  console.log('\n' + '='.repeat(60))
  console.log('测试 A: 仅用 ace 自定义 didOpen')
  console.log('='.repeat(60))

  sendNotification('aceProject/onAsyncDidOpen', {
    params: {
      textDocument: { uri: fileUri, languageId: 'arkts', version: 1, text: fileContent },
    },
    requestId: nextRequestId(),
    editorFiles: [fileUri],
  })
  await sleep(3000)

  // A1: ace hover
  console.log('\n  A1: aceProject/onAsyncHover')
  let result = await sendAceRequest('aceProject/onAsyncHover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // A2: ace definition
  console.log('\n  A2: aceProject/onAsyncDefinition')
  result = await sendAceRequest('aceProject/onAsyncDefinition', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // A3: 标准 LSP hover
  console.log('\n  A3: 标准 LSP textDocument/hover')
  result = await sendStdRequest('textDocument/hover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // A4: 标准 LSP definition
  console.log('\n  A4: 标准 LSP textDocument/definition')
  result = await sendStdRequest('textDocument/definition', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // A5: ace completion（对照，应该正常）
  console.log('\n  A5: aceProject/onAsyncCompletion (对照)')
  result = await sendAceRequest('aceProject/onAsyncCompletion', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar + 6 }, // Column 后面
  })
  const compCount = result?.items?.length || 0
  console.log(`    结果: ${compCount} 项 ${compCount > 0 ? '✅' : '❌'}`)

  // ================================================================
  // 测试 B: 先发送标准 textDocument/didOpen，再测试
  // ================================================================
  console.log('\n' + '='.repeat(60))
  console.log('测试 B: 标准 textDocument/didOpen + ace 自定义 didOpen')
  console.log('='.repeat(60))

  // 发送标准 textDocument/didOpen
  sendNotification('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: 'arkts', version: 1, text: fileContent },
  })
  console.log('  标准 didOpen 已发送')
  await sleep(3000)

  // B1: ace hover
  console.log('\n  B1: aceProject/onAsyncHover (标准 didOpen 后)')
  result = await sendAceRequest('aceProject/onAsyncHover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // B2: ace definition
  console.log('\n  B2: aceProject/onAsyncDefinition (标准 didOpen 后)')
  result = await sendAceRequest('aceProject/onAsyncDefinition', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // B3: 标准 LSP hover
  console.log('\n  B3: 标准 LSP textDocument/hover (标准 didOpen 后)')
  result = await sendStdRequest('textDocument/hover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // B4: 标准 LSP definition
  console.log('\n  B4: 标准 LSP textDocument/definition (标准 didOpen 后)')
  result = await sendStdRequest('textDocument/definition', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // ================================================================
  // 测试 C: 等待更长时间再测试
  // ================================================================
  console.log('\n' + '='.repeat(60))
  console.log('测试 C: 额外等待 10 秒后再测试')
  console.log('='.repeat(60))
  await sleep(10000)

  console.log('\n  C1: aceProject/onAsyncHover')
  result = await sendAceRequest('aceProject/onAsyncHover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  console.log('\n  C2: 标准 LSP textDocument/hover')
  result = await sendStdRequest('textDocument/hover', {
    textDocument: { uri: fileUri },
    position: { line: testLine, character: testChar },
  })
  console.log(`    结果: ${result ? JSON.stringify(result).substring(0, 300) : 'null/empty'}`)

  // ================================================================
  // 检查日志
  // ================================================================
  console.log('\n' + '='.repeat(60))
  console.log('ace-server 日志分析')
  console.log('='.repeat(60))

  await sleep(1000)
  const serverLogFile = path.join(LOG_PATH, 'idea-lsp-server.log')
  if (fs.existsSync(serverLogFile)) {
    const logContent = fs.readFileSync(serverLogFile, 'utf-8')
    const logLines = logContent.split('\n')
    
    // 查找 hover/definition 相关日志
    const hoverLines = logLines.filter(l => l.toLowerCase().includes('hover') || l.toLowerCase().includes('definition'))
    console.log(`\n找到 ${hoverLines.length} 条 hover/definition 相关日志:`)
    hoverLines.slice(-20).forEach(l => console.log(`  ${l}`))

    // 查找 error/warn 日志
    const errorLines = logLines.filter(l => l.includes('[ERROR]') || l.includes('[WARN]'))
    console.log(`\n找到 ${errorLines.length} 条 ERROR/WARN 日志:`)
    errorLines.slice(-15).forEach(l => console.log(`  ${l}`))
  }

  console.log('\n' + '='.repeat(60))
  console.log('诊断完成')
  console.log('='.repeat(60))

  cleanup()
}

function cleanup() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill()
  setTimeout(() => process.exit(0), 1000)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

main().catch((err) => {
  console.error(`❌ 脚本异常: ${err.message}`)
  console.error(err.stack)
  cleanup()
})
