#!/usr/bin/env node
/**
 * Comprehensive LSP feature verification test
 * Tests: hover, definition, completion, folding, diagnostics
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = '/Users/dreamlike/DreamLike/myToolList'
const DEVECO = '/Applications/DevEco-Studio.app/Contents'
const ACE_DIR = path.join(DEVECO, 'plugins/openharmony/ace-server/out')
const ACE_ENTRY = path.join(ACE_DIR, 'index.js')
const NODE_BIN = path.join(DEVECO, 'tools/node/bin/node')
const SDK = path.join(DEVECO, 'sdk/default/openharmony')
const LOG_PATH = path.join(__dirname, '../logs')
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')

let proc, buf = '', pending = new Map(), rid = 0
const enc = m => { const j = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }
const nrid = () => `t-${++rid}-${Date.now()}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Track diagnostics received
const diagnostics = new Map()

function start() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })
    proc = spawn(NODE_BIN, ['--max-old-space-size=4096', ACE_ENTRY, '--stdio', `--logger-level=DEBUG`, `--logger-path=${LOG_PATH}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ACE_DIR })
    proc.stderr.on('data', () => { })
    proc.stdout.on('data', c => { buf += c.toString(); parse() })
    proc.on('exit', (c, s) => console.log(`exit: ${c} ${s}`))
}

function parse() {
    while (true) {
        const h = buf.indexOf('\r\n\r\n'); if (h === -1) break
        const m = buf.substring(0, h).match(/Content-Length:\s*(\d+)/); if (!m) { buf = buf.substring(h + 4); continue }
        const bs = h + 4, be = bs + parseInt(m[1]); if (buf.length < be) break
        const body = buf.substring(bs, be); buf = buf.substring(be)
        try { handle(JSON.parse(body)) } catch (e) { }
    }
}

function handle(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const r = pending.get(msg.id); if (r) { pending.delete(msg.id); r(msg.error ? { __error: msg.error } : msg.result) }
    } else if (msg.method) {
        const p = msg.params || {}
        if (msg.method === 'aceProject/onIndexingProgressUpdate')
            process.stdout.write(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}\r`)
        else if (msg.method === 'aceProject/onModuleInitFinish')
            console.log(`  ✅ 模块初始化完成                `)
        else if (msg.method === 'textDocument/publishDiagnostics') {
            const uri = p.uri || ''
            const diags = p.diagnostics || []
            diagnostics.set(uri, diags)
        }
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) {
            const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result)
        }
    }
}

function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }
function stdReq(method, params, t = 15000) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 综合 LSP 功能验证测试')
    console.log('═'.repeat(60))
    start(); await sleep(2000)

    const content = fs.readFileSync(TEST_FILE, 'utf-8')
    const lines = content.split('\n')
    const uri = `file://${TEST_FILE}`

    const JSON5 = require(path.join('/Users/dreamlike/DreamLike/arkts-lsp/node_modules/json5'))
    const bp = JSON5.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'build-profile.json5'), 'utf-8'))
    let sv = '5.0.0.0', al = '12'
    const pr = bp.app?.products; if (pr?.length > 0) { const r = String(pr[0].compatibleSdkVersion || ''); const m = r.match(/^([\d.]+)\((\d+)\)$/); if (m) { const p = m[1].split('.'); while (p.length < 4) p.push('0'); sv = p.slice(0, 4).join('.'); al = m[2] } }
    const DT = { liteWearable: 1, wearable: 2, tv: 3, car: 4, phone: 5, smartVision: 6, tablet: 7, router: 8, '2in1': 10, default: 5 }
    const modules = (bp.modules || []).map(mod => {
        const mp = path.resolve(PROJECT_ROOT, mod.srcPath), mjp = path.join(mp, 'src/main/module.json5')
        let dt = ['default'], mt = 'Entry'
        if (fs.existsSync(mjp)) { try { const mj = JSON5.parse(fs.readFileSync(mjp, 'utf-8')); dt = mj.module?.deviceTypes || ['default']; const t = (mj.module?.type || 'entry').toLowerCase(); mt = t === 'entry' ? 'Entry' : t === 'har' ? 'Har' : t === 'shared' ? 'Library' : 'Entry' } catch (e) { } }
        return { modulePath: mp, moduleName: mod.name, deviceType: dt.map(t => DT[t] || 5), aceLoaderPath: path.join(SDK, 'ets/build-tools/ets-loader'), jsComponentType: 'declarative', sdkJsPath: path.join(SDK, 'ets/api'), sdkComponentPath: path.join(SDK, 'ets/component'), sdkApiPath: path.join(SDK, 'ets/api'), compatibleSdkLevel: al, apiType: 'stageMode', packageManagerType: 'ohpm', compileSdkVersion: sv, compileSdkLevel: al, hosSdkPath: path.join(DEVECO, 'sdk/default/hms'), runtimeOs: 'OpenHarmony', moduleType: mt, compileMode: 'esmodule', syncType: 'add', buildProfileParam: { productName: 'default', targetName: 'default' } }
    })
    const init = { rootUri: `file://${PROJECT_ROOT}`, lspServerWorkspacePath: ACE_DIR, modules, clientType: 'vscode', completionSortSetting: { matchCase: 0, sortSuggesting: 0, enableRecentlyUsed: false, enableCompletionSortByType: true, maxValidCompletionItemsCount: 50, enableCompletionFunctionParameter: false, enableIndexModuleRootDirEtsFile: false } }

    // Initialize
    const initResult = await req('initialize', {
        processId: process.pid, rootUri: `file://${PROJECT_ROOT}`, capabilities: {
            textDocument: {
                hover: { contentFormat: ['markdown', 'plaintext'] },
                completion: { completionItem: { snippetSupport: true } },
                definition: {},
                synchronization: { didSave: true, willSave: true },
                foldingRange: { lineFoldingOnly: true },
                publishDiagnostics: { relatedInformation: true },
                formatting: {},
            }
        },
        initializationOptions: init,
        workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: 'myToolList' }]
    })
    console.log('✅ initialize')

    // Check server capabilities
    const caps = initResult?.capabilities || {}
    console.log(`   foldingRangeProvider: ${!!caps.foldingRangeProvider}`)
    console.log(`   hoverProvider: ${!!caps.hoverProvider}`)
    console.log(`   completionProvider: ${!!caps.completionProvider}`)
    console.log(`   definitionProvider: ${!!caps.definitionProvider}`)
    console.log(`   documentFormattingProvider: ${!!caps.documentFormattingProvider}`)

    notify('initialized', { editors: [] })
    console.log('⏳ 等待索引...')
    await sleep(30000)

    // ==================== Standard LSP didOpen ====================
    console.log('\n📂 Standard LSP didOpen...')
    notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'ets', version: 1, text: content }
    })

    // Also send ace custom didOpen
    console.log('📂 Custom ace didOpen...')
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })
    await sleep(5000)

    let passed = 0, failed = 0, total = 0
    function result(name, ok, detail = '') {
        total++
        if (ok) { passed++; console.log(`   ✅ ${name}${detail ? ': ' + detail : ''}`) }
        else { failed++; console.log(`   ❌ ${name}${detail ? ': ' + detail : ''}`) }
    }

    // ==================== TEST 1: FOLDING ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📑 TEST 1: 代码折叠 (Folding Ranges)')
    console.log('═'.repeat(60))

    const foldResult = await stdReq('textDocument/foldingRange', {
        textDocument: { uri }
    })

    if (foldResult && !foldResult.__error) {
        const ranges = Array.isArray(foldResult) ? foldResult : []
        result('Folding ranges', ranges.length > 0, `${ranges.length} 个折叠区域`)
        if (ranges.length > 0) {
            console.log(`   前3个: ${ranges.slice(0, 3).map(r => `L${r.startLine}-${r.endLine}`).join(', ')}`)
        }
    } else {
        result('Folding ranges', false, foldResult?.__error?.message || 'null')
    }

    // ==================== TEST 2: HOVER ====================
    console.log('\n' + '═'.repeat(60))
    console.log('🔍 TEST 2: 悬浮提示 (Hover)')
    console.log('═'.repeat(60))

    // Find Column()
    let colLine = -1, colChar = -1
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim().startsWith('Column()')) { colLine = i; colChar = lines[i].indexOf('Column'); break } }

    let hr = await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: colLine, character: colChar } })
    const hasHoverContent = hr && hr.contents && (typeof hr.contents === 'string' || hr.contents.value || (Array.isArray(hr.contents) && hr.contents.length > 0))
    result('Hover Column()', hasHoverContent, hasHoverContent ? hr.contents.value?.substring(0, 80) || '有内容' : '空')

    // Hover pageStack
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('this.pageStack')) {
            const c = lines[i].indexOf('pageStack')
            hr = await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: i, character: c } })
            const has = hr && hr.contents && (typeof hr.contents === 'string' || hr.contents.value)
            result('Hover pageStack', has, has ? hr.contents.value?.substring(0, 80) || '有内容' : '空')
            break
        }
    }

    // ==================== TEST 3: DEFINITION ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📍 TEST 3: 跳转定义 (Go to Definition)')
    console.log('═'.repeat(60))

    let dr = await aceReq('aceProject/onAsyncDefinition', { textDocument: { uri }, position: { line: colLine, character: colChar } })
    const hasDefLocs = Array.isArray(dr) && dr.length > 0
    result('Definition Column()', hasDefLocs, hasDefLocs ? dr[0].uri?.split('/').pop() + '#L' + dr[0].range?.start?.line : '空')

    // ==================== TEST 4: COMPLETION ====================
    console.log('\n' + '═'.repeat(60))
    console.log('⌨️  TEST 4: 代码补全 (Completion)')
    console.log('═'.repeat(60))

    // After Column — should get Column attributes
    let cr = await aceReq('aceProject/onAsyncCompletion', {
        textDocument: { uri }, position: { line: colLine, character: colChar + 7 },
        context: { triggerKind: 2, triggerCharacter: '.' }
    })
    const compCount = cr?.items?.length || 0
    result('Completion after Column()', compCount > 0, `${compCount} 项`)
    if (cr?.items?.length > 0) {
        console.log(`   前5项: ${cr.items.slice(0, 5).map(i => i.label).join(', ')}`)
    }

    // Also test typing a known component
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('.width(')) {
            const c = lines[i].indexOf('.width')
            cr = await aceReq('aceProject/onAsyncCompletion', {
                textDocument: { uri }, position: { line: i, character: c + 1 },
                context: { triggerKind: 2, triggerCharacter: '.' }
            })
            const cc = cr?.items?.length || 0
            result('Completion 属性链(.)', cc > 0, `${cc} 项`)
            if (cr?.items?.length > 0) {
                console.log(`   前5项: ${cr.items.slice(0, 5).map(i => i.label).join(', ')}`)
            }
            break
        }
    }

    // ==================== TEST 5: DIAGNOSTICS ====================
    console.log('\n' + '═'.repeat(60))
    console.log('🔎 TEST 5: 代码检查 (Diagnostics)')
    console.log('═'.repeat(60))

    // Check if we received any diagnostics for our file
    const fileDiags = diagnostics.get(uri) || []
    result('Diagnostics received', diagnostics.size > 0, `${diagnostics.size} 个文件有诊断`)
    if (fileDiags.length > 0) {
        console.log(`   ${TEST_FILE.split('/').pop()}: ${fileDiags.length} 条诊断`)
        fileDiags.slice(0, 3).forEach(d => {
            console.log(`   L${d.range?.start?.line}: [${d.severity}] ${d.message?.substring(0, 60)}`)
        })
    }

    // ==================== SUMMARY ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📊 测试总结')
    console.log('═'.repeat(60))
    console.log(`   通过: ${passed}/${total}`)
    console.log(`   失败: ${failed}/${total}`)
    if (failed === 0) {
        console.log('\n   🎉 所有测试通过！')
    } else {
        console.log('\n   ⚠️  部分测试失败，请检查上述输出')
    }

    cleanup()
}

function cleanup() { if (proc && !proc.killed) proc.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
