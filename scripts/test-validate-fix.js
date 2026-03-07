#!/usr/bin/env node
/**
 * Quick test: verify editorFiles with fsPath triggers validation after didChange
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = '/Users/dreamlike/DreamLike/myToolList'
const DEVECO = '/Applications/DevEco-Studio.app/Contents'
const ACE_DIR = path.join(DEVECO, 'plugins/openharmony/ace-server/out')
const NODE_BIN = path.join(DEVECO, 'tools/node/bin/node')
const SDK = path.join(DEVECO, 'sdk/default/openharmony')
const LOG_PATH = path.join(__dirname, '../logs')
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')

let proc, buf = '', pending = new Map(), rid = 0
const diagnosticsLog = []
const enc = m => { const j = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }
const nrid = () => `t-${++rid}-${Date.now()}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function start() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })
    proc = spawn(NODE_BIN, ['--max-old-space-size=4096', path.join(ACE_DIR, 'index.js'), '--stdio', `--logger-level=DEBUG`, `--logger-path=${LOG_PATH}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ACE_DIR })
    proc.stderr.on('data', () => { })
    proc.stdout.on('data', c => { buf += c.toString(); parse() })
    proc.on('exit', (c, s) => console.log(`exit: ${c} ${s}`))
}
function parse() { while (true) { const h = buf.indexOf('\r\n\r\n'); if (h === -1) break; const m = buf.substring(0, h).match(/Content-Length:\s*(\d+)/); if (!m) { buf = buf.substring(h + 4); continue }; const bs = h + 4, be = bs + parseInt(m[1]); if (buf.length < be) break; const body = buf.substring(bs, be); buf = buf.substring(be); try { handle(JSON.parse(body)) } catch (e) { } } }
function handle(msg) {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) { const r = pending.get(msg.id); if (r) { pending.delete(msg.id); r(msg.error ? { __error: msg.error } : msg.result) } }
    else if (msg.method) {
        const p = msg.params || {}
        if (msg.method === 'aceProject/onIndexingProgressUpdate') process.stdout.write(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}\r`)
        else if (msg.method === 'aceProject/onModuleInitFinish') console.log(`  ✅ 模块初始化完成                `)
        else if (msg.method === 'textDocument/publishDiagnostics') {
            const n = (p.diagnostics || []).length
            diagnosticsLog.push({ time: Date.now(), count: n, diags: p.diagnostics || [] })
            console.log(`  📋 publishDiagnostics: ${n} 条 ` + (n > 0 ? p.diagnostics.map(d => `L${d.range?.start?.line}:${d.message?.substring(0, 40)}`).join('; ') : ''))
        }
        else if (msg.method === 'aceProject/doValidateDocument') {
            const r = p.result || p; const n = (r.diagnostics || []).length
            diagnosticsLog.push({ time: Date.now(), count: n, custom: true, diags: r.diagnostics || [] })
            console.log(`  🔎 aceValidate: ${n} 条 ver=${r.version} ` + (n > 0 ? r.diagnostics.map(d => `L${d.range?.start?.line}:${d.message?.substring(0, 40)}`).join('; ') : ''))
        }
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) { const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result) }
    }
}
function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 验证 fsPath editorFiles 触发诊断')
    console.log('═'.repeat(60))
    start(); await sleep(2000)

    const content = fs.readFileSync(TEST_FILE, 'utf-8')
    const uri = `file://${TEST_FILE}`
    // editorFiles 使用文件系统路径（不含 file:// 协议）
    const editorFiles = [TEST_FILE] // <-- 关键：使用 fsPath 而非 file:// URI

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

    await req('initialize', { processId: process.pid, rootUri: `file://${PROJECT_ROOT}`, capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true }, synchronization: { didSave: true, willSave: true, didOpen: true, didChange: true } } }, initializationOptions: init, workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: 'myToolList' }] })
    console.log('✅ initialize')
    notify('initialized', { editors: [] })
    console.log('⏳ 等待索引 (30s)...')
    await sleep(30000)

    // didOpen
    console.log('\n📂 didOpen (editorFiles 使用 fsPath)...')
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })
    console.log('⏳ 等待初始诊断 (10s)...')
    await sleep(10000)

    // Insert error via didChange
    console.log('\n✏️ 插入错误代码...')
    const lines = content.split('\n')
    let insertLine = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('build()') && lines[i].includes('{')) { insertLine = i + 1; break }
    }
    const errCode = '      let errVar: string = 12345'
    const newLines = [...lines]
    newLines.splice(insertLine, 0, errCode)
    const errContent = newLines.join('\n')
    console.log(`  L${insertLine}: ${errCode.trim()}`)

    diagnosticsLog.length = 0

    // Send didChange with CORRECT editorFiles (fsPath)
    notify('aceProject/onAsyncDidChange', {
        params: {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: errContent }]
        },
        requestId: nrid(),
        editorFiles, // <-- 使用 fsPath
    })

    console.log('⏳ 等待验证诊断 (15s)...')
    await sleep(15000)

    // Summary
    console.log('\n' + '═'.repeat(60))
    console.log('📊 总结')
    console.log('═'.repeat(60))
    console.log(`总共收到 publishDiagnostics: ${diagnosticsLog.length} 次`)
    const totalDiags = diagnosticsLog.filter(d => d.count > 0).length
    console.log(`其中有诊断的: ${totalDiags} 次`)
    diagnosticsLog.forEach((d, i) => {
        console.log(`  #${i + 1}: ${d.count} 条 ${d.custom ? '(ace custom)' : '(standard)'}`)
        d.diags.forEach(dd => console.log(`     L${dd.range?.start?.line}: ${dd.message?.substring(0, 60)}`))
    })

    if (totalDiags === 0) {
        console.log('\n❌ 仍然没有诊断！请检查 ace-server 日志：')
        console.log(`   cat ${LOG_PATH}/idea-lsp-server.log | grep -i "validate\|focused\|invalid" | tail -10`)
    } else {
        console.log('\n✅ 诊断正常工作！')
    }

    cleanup()
}
function cleanup() { if (proc && !proc.killed) proc.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
