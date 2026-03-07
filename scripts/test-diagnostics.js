#!/usr/bin/env node
/**
 * Focused diagnostics test — inject errors and monitor ALL notifications
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
const allMessages = [] // Track ALL messages

const enc = m => { const j = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }
const nrid = () => `t-${++rid}-${Date.now()}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

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
        allMessages.push({ method: msg.method, params: p, time: Date.now() })

        if (msg.method === 'aceProject/onIndexingProgressUpdate')
            process.stdout.write(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}\r`)
        else if (msg.method === 'aceProject/onModuleInitFinish')
            console.log(`  ✅ 模块初始化完成                `)
        else if (msg.method === 'textDocument/publishDiagnostics') {
            const diags = p.diagnostics || []
            console.log(`  📋 publishDiagnostics: ${(p.uri || '').split('/').pop()} → ${diags.length} 条`)
            diags.forEach(d => console.log(`     L${d.range?.start?.line}: [sev=${d.severity}] ${d.message?.substring(0, 80)}`))
        }
        else if (msg.method === 'aceProject/doValidateDocument') {
            const r = p.result || p
            console.log(`  🔎 aceValidate: uri=${(r.uri || '').split('/').pop()} diags=${(r.diagnostics || []).length} ver=${r.version}`)
            if (r.diagnostics?.length > 0) {
                r.diagnostics.forEach(d => console.log(`     L${d.range?.start?.line}: ${d.message?.substring(0, 80)}`))
            }
        }
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) {
            const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result)
        }
        else {
            // Log other notifications
            if (!msg.method.includes('Indexing') && !msg.method.includes('registerCapability'))
                console.log(`  📨 ${msg.method}: ${JSON.stringify(p).substring(0, 120)}`)
        }
    }
}

function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 诊断专项测试')
    console.log('═'.repeat(60))
    start(); await sleep(2000)

    const content = fs.readFileSync(TEST_FILE, 'utf-8')
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
    const init = { rootUri: `file://${PROJECT_ROOT}`, lspServerWorkspacePath: ACE_DIR, modules, clientType: 'vscode', completionSortSetting: { matchCase: 0, sortSuggesting: 0, enableRecentlyUsed: false, enableCompletionSortByType: true, maxValidCompletionItemsCount: 200, enableCompletionFunctionParameter: false, enableIndexModuleRootDirEtsFile: false } }

    await req('initialize', {
        processId: process.pid, rootUri: `file://${PROJECT_ROOT}`, capabilities: {
            textDocument: {
                hover: { contentFormat: ['markdown', 'plaintext'] },
                completion: { completionItem: { snippetSupport: true }, contextSupport: true },
                definition: {},
                synchronization: { didSave: true, willSave: true, didOpen: true, didChange: true },
                publishDiagnostics: { relatedInformation: true },
            }
        },
        initializationOptions: init,
        workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: 'myToolList' }]
    })
    console.log('✅ initialize')
    notify('initialized', { editors: [] })
    console.log('⏳ 等待索引 (30s)...')
    await sleep(30000)

    // ==================== STEP 1: Open with correct file ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📂 STEP 1: didOpen (standard + ace)')
    console.log('═'.repeat(60))

    // Standard LSP didOpen with deveco languageId
    notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })
    // Ace custom didOpen
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })

    console.log('⏳ 等待初始诊断 (10s)...')
    await sleep(10000)

    // ==================== STEP 2: Insert error and didChange ====================
    console.log('\n' + '═'.repeat(60))
    console.log('✏️  STEP 2: 插入错误代码')
    console.log('═'.repeat(60))

    const lines = content.split('\n')
    // Find build() and insert error after it
    let insertLine = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('build()') && lines[i].includes('{')) { insertLine = i + 1; break }
    }

    // Insert obvious ArkTS errors
    const errorCode = '      let errVar: string = 12345\n      let errVar2: number = true'
    const newLines = [...lines]
    newLines.splice(insertLine, 0, errorCode)
    const errContent = newLines.join('\n')

    console.log(`  插入位置: L${insertLine}`)
    console.log(`  错误代码: let errVar: string = 12345`)

    // Send incremental change
    const changeStart = { line: insertLine, character: 0 }
    const changeEnd = { line: insertLine, character: 0 }

    // Standard LSP didChange (incremental)
    notify('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{
            range: { start: changeStart, end: changeEnd },
            rangeLength: 0,
            text: errorCode + '\n'
        }]
    })

    // Ace custom didChange
    notify('aceProject/onAsyncDidChange', {
        params: {
            textDocument: { uri, version: 2 },
            contentChanges: [{
                range: { start: changeStart, end: changeEnd },
                rangeLength: 0,
                text: errorCode + '\n'
            }]
        },
        requestId: nrid(),
        editorFiles: [uri],
    })

    console.log('⏳ 等待错误诊断 (15s)...')
    await sleep(15000)

    // ==================== STEP 3: Full text replacement ====================
    console.log('\n' + '═'.repeat(60))
    console.log('✏️  STEP 3: 全文替换 (full text didChange)')
    console.log('═'.repeat(60))

    // Maybe ace-server needs full text changes
    notify('textDocument/didChange', {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: errContent }]
    })

    notify('aceProject/onAsyncDidChange', {
        params: {
            textDocument: { uri, version: 3 },
            contentChanges: [{ text: errContent }]
        },
        requestId: nrid(),
        editorFiles: [uri],
    })

    console.log('⏳ 等待诊断 (10s)...')
    await sleep(10000)

    // ==================== STEP 4: Try explicit validate =====================
    console.log('\n' + '═'.repeat(60))
    console.log('🔎 STEP 4: 显式触发验证')
    console.log('═'.repeat(60))

    // Try various validation trigger methods
    console.log('  尝试 aceProject/doValidateDocument...')
    const valResult = await aceReq('aceProject/doValidateDocument', {
        textDocument: { uri, version: 3 }
    }, 10000)
    console.log(`  结果: ${JSON.stringify(valResult)?.substring(0, 200)}`)

    // Try standard textDocument/didSave which might trigger validation
    console.log('  尝试 textDocument/didSave...')
    notify('textDocument/didSave', {
        textDocument: { uri, version: 3 },
        text: errContent
    })

    console.log('⏳ 等待 (10s)...')
    await sleep(10000)

    // ==================== SUMMARY ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📊 通知统计')
    console.log('═'.repeat(60))

    const methodCounts = {}
    allMessages.forEach(m => { methodCounts[m.method] = (methodCounts[m.method] || 0) + 1 })
    Object.entries(methodCounts).sort((a, b) => b[1] - a[1]).forEach(([m, c]) => console.log(`  ${m}: ${c}次`))

    // Show all diagnostics-related messages
    console.log('\n所有诊断相关消息:')
    allMessages.filter(m => m.method.includes('Diagnostic') || m.method.includes('diagnostic') || m.method.includes('Validate') || m.method.includes('validate')).forEach(m => {
        const diags = m.params?.diagnostics || m.params?.result?.diagnostics || []
        console.log(`  ${m.method}: ${diags.length} 条诊断`)
    })

    cleanup()
}

function cleanup() { if (proc && !proc.killed) proc.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
