#!/usr/bin/env node
/**
 * 深度诊断：测试不同 URI 格式和符号位置
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

let serverProcess, messageBuffer = '', pendingResolvers = new Map(), requestIdCounter = 0

function nextRequestId() { return `deep-${++requestIdCounter}-${Date.now()}` }
function encodeLspMessage(msg) { const j = JSON.stringify(msg); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }

function startAceServer() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })
    serverProcess = spawn(NODE_EXECUTABLE, [
        '--max-old-space-size=4096', ACE_SERVER_ENTRY, '--stdio',
        `--logger-level=DEBUG`, `--logger-path=${LOG_PATH}`,
    ], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ACE_SERVER_DIR })
    serverProcess.stderr.on('data', d => { const m = d.toString().trim(); if (m) console.log(`[stderr] ${m}`) })
    serverProcess.stdout.on('data', c => { messageBuffer += c.toString(); parseMessages() })
    serverProcess.on('exit', (code, sig) => console.log(`\nace-server exit: code=${code} signal=${sig}`))
}

function parseMessages() {
    while (true) {
        const h = messageBuffer.indexOf('\r\n\r\n'); if (h === -1) break
        const m = messageBuffer.substring(0, h).match(/Content-Length:\s*(\d+)/)
        if (!m) { messageBuffer = messageBuffer.substring(h + 4); continue }
        const bs = h + 4, be = bs + parseInt(m[1]); if (messageBuffer.length < be) break
        const body = messageBuffer.substring(bs, be); messageBuffer = messageBuffer.substring(be)
        try { handleMsg(JSON.parse(body)) } catch (e) { }
    }
}

function handleMsg(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const r = pendingResolvers.get(msg.id); if (r) { pendingResolvers.delete(msg.id); r(msg.error ? { __error: msg.error } : msg.result) }
    } else if (msg.method) {
        const p = msg.params || {}
        if (msg.method === 'aceProject/onIndexingProgressUpdate') console.log(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}`)
        else if (msg.method === 'aceProject/onModuleInitFinish') console.log(`  ✅ 模块初始化完成`)
        else if (msg.method.includes('onAsync') && p.requestId && pendingResolvers.has(p.requestId)) {
            const r = pendingResolvers.get(p.requestId); pendingResolvers.delete(p.requestId); r(p.result)
        }
    }
}

function sendRequest(method, params) { const id = requestIdCounter++; serverProcess.stdin.write(encodeLspMessage({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pendingResolvers.set(id, r); setTimeout(() => { if (pendingResolvers.has(id)) { pendingResolvers.delete(id); r(null) } }, 30000) }) }
function sendNotification(method, params) { serverProcess.stdin.write(encodeLspMessage({ jsonrpc: '2.0', method, params })) }
function sendAceRequest(method, params, t = 20000) { const rid = nextRequestId(); sendNotification(method, { params, requestId: rid }); return new Promise(r => { pendingResolvers.set(rid, r); setTimeout(() => { if (pendingResolvers.has(rid)) { pendingResolvers.delete(rid); r(null) } }, t) }) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function buildInitOptions() {
    const JSON5 = require(path.join('/Users/dreamlike/DreamLike/arkts-lsp/node_modules/json5'))
    const bp = JSON5.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'build-profile.json5'), 'utf-8'))
    let sv = '5.0.0.0', al = '12'
    const prods = bp.app?.products
    if (prods?.length > 0) { const raw = String(prods[0].compatibleSdkVersion || ''); const m = raw.match(/^([\d.]+)\((\d+)\)$/); if (m) { const p = m[1].split('.'); while (p.length < 4) p.push('0'); sv = p.slice(0, 4).join('.'); al = m[2] } }
    const DT = { liteWearable: 1, wearable: 2, tv: 3, car: 4, phone: 5, smartVision: 6, tablet: 7, router: 8, '2in1': 10, default: 5 }
    const modules = (bp.modules || []).map(mod => {
        const mp = path.resolve(PROJECT_ROOT, mod.srcPath), mjp = path.join(mp, 'src/main/module.json5')
        let dt = ['default'], mt = 'Entry'
        if (fs.existsSync(mjp)) { try { const mj = JSON5.parse(fs.readFileSync(mjp, 'utf-8')); dt = mj.module?.deviceTypes || ['default']; const t = (mj.module?.type || 'entry').toLowerCase(); mt = t === 'entry' ? 'Entry' : t === 'har' ? 'Har' : t === 'shared' ? 'Library' : 'Entry' } catch (e) { } }
        return { modulePath: mp, moduleName: mod.name, deviceType: dt.map(t => DT[t] || 5), aceLoaderPath: ACE_LOADER_PATH, jsComponentType: 'declarative', sdkJsPath: SDK_JS_PATH, sdkComponentPath: SDK_COMPONENT_PATH, sdkApiPath: SDK_JS_PATH, compatibleSdkLevel: al, apiType: 'stageMode', packageManagerType: 'ohpm', compileSdkVersion: sv, compileSdkLevel: al, hosSdkPath: HOS_SDK_PATH, runtimeOs: 'OpenHarmony', moduleType: mt, compileMode: 'esmodule', syncType: 'add', buildProfileParam: { productName: 'default', targetName: 'default' } }
    })
    return { rootUri: `file://${PROJECT_ROOT}`, lspServerWorkspacePath: ACE_SERVER_DIR, modules, clientType: 'vscode', completionSortSetting: { matchCase: 0, sortSuggesting: 0, enableRecentlyUsed: false, enableCompletionSortByType: true, maxValidCompletionItemsCount: 50, enableCompletionFunctionParameter: false, enableIndexModuleRootDirEtsFile: false } }
}

async function main() {
    console.log('🔬 深度诊断 hover/definition')
    console.log('='.repeat(60))
    startAceServer(); await sleep(2000)

    const fileContent = fs.readFileSync(TEST_FILE, 'utf-8')
    const lines = fileContent.split('\n')

    let testLine = -1, testChar = -1
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim().startsWith('Column()')) { testLine = i; testChar = lines[i].indexOf('Column'); break } }
    console.log(`测试: L${testLine}:${testChar} "${lines[testLine].trim()}"`)

    // Initialize
    const initOpts = buildInitOptions()
    const initResult = await sendRequest('initialize', {
        processId: process.pid, rootUri: `file://${PROJECT_ROOT}`,
        capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] }, completion: { completionItem: { snippetSupport: true } }, definition: {}, references: {}, synchronization: { didSave: true, willSave: true, dynamicRegistration: true } }, workspace: { workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: true } } },
        initializationOptions: initOpts,
        workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: path.basename(PROJECT_ROOT) }],
    })
    console.log(`初始化: ${initResult ? 'OK' : 'FAIL'}`)
    sendNotification('initialized', { editors: [] })

    console.log('\n⏳ 等待索引 (30s)...')
    await sleep(30000)

    // ================================================================
    // 测试 1: 不同 URI 格式
    // ================================================================
    const uriFormats = [
        `file://${TEST_FILE}`,
        `file:///${TEST_FILE}`,
    ]

    for (const uri of uriFormats) {
        console.log(`\n${'='.repeat(60)}`)
        console.log(`URI: ${uri}`)
        console.log('='.repeat(60))

        sendNotification('aceProject/onAsyncDidOpen', {
            params: { textDocument: { uri, languageId: 'arkts', version: 1, text: fileContent } },
            requestId: nextRequestId(), editorFiles: [uri],
        })
        await sleep(3000)

        const hr = await sendAceRequest('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: testLine, character: testChar } })
        const hOk = hr?.contents?.length > 0
        console.log(`  Hover: ${hOk ? '✅' : '❌'} ${JSON.stringify(hr).substring(0, 300)}`)

        const dr = await sendAceRequest('aceProject/onAsyncDefinition', { textDocument: { uri }, position: { line: testLine, character: testChar } })
        const dOk = Array.isArray(dr) ? dr.length > 0 : !!dr
        console.log(`  Def: ${dOk ? '✅' : '❌'} ${JSON.stringify(dr).substring(0, 300)}`)

        const cr = await sendAceRequest('aceProject/onAsyncCompletion', { textDocument: { uri }, position: { line: testLine, character: testChar + 6 } })
        console.log(`  Comp: ${(cr?.items?.length || 0) > 0 ? '✅' : '❌'} ${cr?.items?.length || 0} 项`)
    }

    // ================================================================
    // 测试 2: 不同符号
    // ================================================================
    console.log(`\n${'='.repeat(60)}`)
    console.log('测试不同符号')
    console.log('='.repeat(60))

    const fileUri = `file://${TEST_FILE}`
    const syms = []
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('@State') && syms.length < 10) syms.push({ name: '@State', line: i, char: lines[i].indexOf('@State') + 1 })
        if (lines[i].includes('struct ') && syms.length < 10) { const c = lines[i].indexOf('struct') + 7; syms.push({ name: 'structName', line: i, char: c }) }
        if (lines[i].trim() === 'build() {' && syms.length < 10) syms.push({ name: 'build', line: i, char: lines[i].indexOf('build') })
        if (lines[i].includes('.width(') && syms.length < 10) { syms.push({ name: '.width', line: i, char: lines[i].indexOf('width') }); break }
    }

    for (const s of syms) {
        const hr = await sendAceRequest('aceProject/onAsyncHover', { textDocument: { uri: fileUri }, position: { line: s.line, character: s.char } })
        const ok = hr?.contents?.length > 0 || (typeof hr?.contents === 'string' && hr.contents.length > 0)
        console.log(`  ${ok ? '✅' : '❌'} ${s.name} L${s.line}:${s.char}: ${JSON.stringify(hr).substring(0, 200)}`)
    }

    // ================================================================
    // 测试 3: 清除旧日志，重新检查
    // ================================================================
    console.log(`\n${'='.repeat(60)}`)
    console.log('日志分析')
    console.log('='.repeat(60))

    await sleep(1000)
    const logFile = path.join(LOG_PATH, 'idea-lsp-server.log')
    if (fs.existsSync(logFile)) {
        const log = fs.readFileSync(logFile, 'utf-8').split('\n')
        const hLogs = log.filter(l => l.includes('Hover') || l.includes('hover') || l.includes('onAsyncHover'))
        console.log(`\nhover 日志 (最新 15):`)
        hLogs.slice(-15).forEach(l => console.log(`  ${l}`))

        // 找 getFileFsPath/document 相关
        const dLogs = log.filter(l => l.includes('didOpen') || l.includes('DidOpen') || l.includes('openFile') || l.includes('updateAndAdd'))
        console.log(`\ndidOpen 日志 (最新 10):`)
        dLogs.slice(-10).forEach(l => console.log(`  ${l}`))

        // isProjectOrAcrossProjectModuleFile 或 isValidateFile 相关
        const vLogs = log.filter(l => l.includes('isProject') || l.includes('isValidate') || l.includes('validate'))
        console.log(`\nvalidate 日志 (最新 10):`)
        vLogs.slice(-10).forEach(l => console.log(`  ${l}`))
    }

    cleanup()
}

function cleanup() { if (serverProcess && !serverProcess.killed) serverProcess.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(`❌ ${e.message}\n${e.stack}`); cleanup() })
