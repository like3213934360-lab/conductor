#!/usr/bin/env node
/**
 * Deep diagnostic test for:
 * 1. Row() chain completion (justifyContent, alignItems, etc.)
 * 2. Diagnostics delivery & format
 * 3. Compare with how DevEco sends requests
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
const allNotifications = []
const diagnosticsReceived = new Map()

const enc = m => { const j = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }
const nrid = () => `t-${++rid}-${Date.now()}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function start() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })
    proc = spawn(NODE_BIN, ['--max-old-space-size=4096', ACE_ENTRY, '--stdio', `--logger-level=DEBUG`, `--logger-path=${LOG_PATH}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ACE_DIR })
    proc.stderr.on('data', d => {
        const s = d.toString()
        if (s.includes('error') || s.includes('Error')) console.log('  [stderr]', s.trim().substring(0, 120))
    })
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
        allNotifications.push({ method: msg.method, time: Date.now() })
        if (msg.method === 'aceProject/onIndexingProgressUpdate')
            process.stdout.write(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}\r`)
        else if (msg.method === 'aceProject/onModuleInitFinish')
            console.log(`  ✅ 模块初始化完成                `)
        else if (msg.method === 'textDocument/publishDiagnostics') {
            const uri = p.uri || ''
            diagnosticsReceived.set(uri, p.diagnostics || [])
            console.log(`  📋 诊断: ${uri.split('/').pop()} → ${(p.diagnostics || []).length} 条`)
        }
        else if (msg.method === 'aceProject/doValidateDocument') {
            console.log(`  🔎 ace诊断: ${JSON.stringify(p).substring(0, 150)}`)
        }
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) {
            const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result)
        }
    }
}

function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 深度诊断：Row补全 + 代码检查')
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
    console.log('⏳ 等待索引...')
    await sleep(30000)

    // ==================== DUAL PATH didOpen ====================
    console.log('\n📂 Standard LSP didOpen...')
    notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'ets', version: 1, text: content }
    })

    console.log('📂 Custom ace didOpen...')
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })

    console.log('⏳ 等待诊断推送...')
    await sleep(8000)

    // ==================== TEST: DIAGNOSTICS ====================
    console.log('\n' + '═'.repeat(60))
    console.log('🔎 诊断 (Diagnostics) 分析')
    console.log('═'.repeat(60))

    console.log(`\n收到诊断的文件数: ${diagnosticsReceived.size}`)
    for (const [dUri, diags] of diagnosticsReceived) {
        console.log(`  ${dUri.split('/').pop()}: ${diags.length} 条`)
        diags.slice(0, 5).forEach(d => {
            console.log(`    L${d.range?.start?.line}: [sev=${d.severity}] ${d.message?.substring(0, 80)}`)
        })
    }

    console.log(`\n所有收到的通知类型:`)
    const methodCounts = {}
    allNotifications.forEach(n => { methodCounts[n.method] = (methodCounts[n.method] || 0) + 1 })
    Object.entries(methodCounts).forEach(([m, c]) => console.log(`  ${m}: ${c}次`))

    // ==================== TEST: ROW COMPLETION ====================
    console.log('\n' + '═'.repeat(60))
    console.log('⌨️  Row() 属性链补全测试')
    console.log('═'.repeat(60))

    // Find a Row in the file, or use a simulated position
    let rowLine = -1, rowChar = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('Row(') || lines[i].trim() === 'Row()' || lines[i].trim().startsWith('Row({')) {
            rowLine = i
            rowChar = lines[i].indexOf('Row')
            break
        }
    }

    // If no Row exists, simulate one by inserting content via didChange
    if (rowLine === -1) {
        console.log('⚠️  文件中无 Row()，模拟插入测试...')
        // Find a good location — after the build() { line
        let insertLine = -1
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('build()') && lines[i].includes('{')) {
                insertLine = i + 1
                break
            }
        }
        if (insertLine === -1) insertLine = 10

        // Create modified content with Row()
        const newLines = [...lines]
        newLines.splice(insertLine, 0, '      Row() {', '      }')
        const newContent = newLines.join('\n')
        rowLine = insertLine
        rowChar = newLines[insertLine].indexOf('Row')

        // Send didChange with full text
        notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: newContent }]
        })
        client_sendAceDidChange(uri, 2, newContent)
        await sleep(3000)

        // Now test completion after Row()
        // The cursor after "Row()" should be at the end of "Row()"
        const afterRowChar = newLines[insertLine].indexOf(')') + 1

        console.log(`\n📌 测试1: Row() 后面点(.)的属性补全  L${rowLine}:${afterRowChar}`)
        let cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: rowLine, character: afterRowChar },
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        analyzeCompletion('Row().', cr)

        // Also test ".justifyContent" explicitly
        console.log(`\n📌 测试2: 在 Row(){} 下一行输入 .j 的补全`)
        // Position after Row() { on the same line
        const dotLine = insertLine  // Same line as Row() {
        cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: rowLine, character: afterRowChar + 1 },
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        analyzeCompletion('Row().j', cr)
    } else {
        console.log(`✅ 找到 Row() at L${rowLine}:${rowChar}`)

        // Test 1: Completion right after Row() — the closing paren
        const afterRowParen = lines[rowLine].indexOf(')') + 1
        console.log(`\n📌 测试1: Row() 后的属性补全  L${rowLine}:${afterRowParen}`)
        let cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: rowLine, character: afterRowParen },
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        analyzeCompletion('Row() 后', cr)
    }

    // Test with Column too for comparison
    let colLine = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('Column()')) {
            colLine = i
            break
        }
    }
    if (colLine > -1) {
        const afterCol = lines[colLine].indexOf(')') + 1
        console.log(`\n📌 测试3: Column() 后的属性补全  L${colLine}:${afterCol}`)
        let cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: colLine, character: afterCol },
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        analyzeCompletion('Column() 后', cr)
    }

    // Test: Completion INSIDE Row({}) — invoke completion
    console.log(`\n📌 测试4: 通用 invoked 补全（triggerKind:1）L${colLine || rowLine || 5}:5`)
    let cr2 = await aceReq('aceProject/onAsyncCompletion', {
        textDocument: { uri }, position: { line: colLine || rowLine || 5, character: 5 },
        context: { triggerKind: 1 }
    })
    analyzeCompletion('invoked', cr2)

    // ==================== TEST: VALIDATE/DIAGNOSTICS TRIGGER ====================
    console.log('\n' + '═'.repeat(60))
    console.log('🔎 手动触发诊断')
    console.log('═'.repeat(60))

    // Try ace-specific validation trigger
    console.log('尝试 aceProject/doValidateDocument...')
    await aceReq('aceProject/doValidateDocument', {
        textDocument: { uri }
    }, 5000)
    await sleep(3000)

    console.log(`\n诊断结果: ${diagnosticsReceived.size} 个文件`)
    for (const [dUri, diags] of diagnosticsReceived) {
        console.log(`  ${dUri.split('/').pop()}: ${diags.length} 条`)
    }

    // ==================== SUMMARY ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📊 总结')
    console.log('═'.repeat(60))
    console.log(`诊断文件数: ${diagnosticsReceived.size}`)
    console.log(`通知类型: ${Object.keys(methodCounts).join(', ')}`)

    cleanup()
}

function analyzeCompletion(label, cr) {
    if (!cr) { console.log(`  ❌ ${label}: null/超时`); return }
    const items = cr.items || cr || []
    if (!Array.isArray(items) || items.length === 0) {
        console.log(`  ❌ ${label}: 0 项`)
        return
    }
    console.log(`  ✅ ${label}: ${items.length} 项`)

    // Check for Row/Column specific attributes
    const attrNames = ['justifyContent', 'alignItems', 'width', 'height', 'backgroundColor', 'padding', 'margin',
        'layoutWeight', 'flexGrow', 'flexShrink', 'alignSelf', 'direction', 'reverse']
    const found = attrNames.filter(a => items.some(i => i.label?.includes?.(a) || i.insertText?.includes?.(a)))
    const missing = attrNames.filter(a => !found.includes(a))

    if (found.length > 0) console.log(`  ✅ 找到属性: ${found.join(', ')}`)
    if (missing.length > 0) console.log(`  ⚠️  缺少属性: ${missing.join(', ')}`)

    // Show first 10 items
    console.log(`  前10项: ${items.slice(0, 10).map(i => typeof i.label === 'string' ? i.label.split('\n')[0] : i.label).join(' | ')}`)
}

function client_sendAceDidChange(uri, version, text) {
    notify('aceProject/onAsyncDidChange', {
        params: {
            textDocument: { uri, version },
            contentChanges: [{ text }],
        },
        requestId: nrid(),
    })
}

function cleanup() { if (proc && !proc.killed) proc.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
