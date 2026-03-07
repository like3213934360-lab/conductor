#!/usr/bin/env node
/**
 * Instrumented test: patches the WORKER's index.js to add hover debug logging
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = '/Users/dreamlike/DreamLike/myToolList'
const DEVECO = '/Applications/DevEco-Studio.app/Contents'
const ACE_DIR = path.join(DEVECO, 'plugins/openharmony/ace-server/out')
const ACE_ENTRY = path.join(ACE_DIR, 'index.js')
const WORKER_DIR = path.join(ACE_DIR, 'worker')
const WORKER_ENTRY = path.join(WORKER_DIR, 'index.js')
const NODE_BIN = path.join(DEVECO, 'tools/node/bin/node')
const SDK = path.join(DEVECO, 'sdk/default/openharmony')
const LOG_PATH = path.join(__dirname, '../logs')
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')

// Read and patch worker source
const workerSrc = fs.readFileSync(WORKER_ENTRY, 'utf-8')

const workerPattern = 'const Xt=(0,wt.getLanguageService)(kt.uri,kt.languageId,Et.initializeHandler.aceLanguageServices),Qt=(0,wt.getContext)(kt);return Xt&&Xt.onHover&&Qt&&(Gt.data.result=Xt.onHover(kt,zt,Qt)),Vt.MsgHandler.forwardingMsgToClient(Gt)'

const workerReplacement = `const Xt=(0,wt.getLanguageService)(kt.uri,kt.languageId,Et.initializeHandler.aceLanguageServices),Qt=(0,wt.getContext)(kt);
console.error("[HOVER-DBG] uri=" + kt.uri + " langId=" + kt.languageId);
console.error("[HOVER-DBG] getLanguageService=" + (Xt ? ("has-onHover=" + !!Xt.onHover + " class=" + (Xt.constructor?.name || "?")) : "NULL"));
console.error("[HOVER-DBG] getContext=" + (Qt ? JSON.stringify(Qt).substring(0,200) : "NULL"));
if(Xt&&Xt.onHover&&Qt){
  try{
    const _hr = Xt.onHover(kt,zt,Qt);
    console.error("[HOVER-DBG] onHover returned: " + JSON.stringify(_hr).substring(0,500));
    Gt.data.result = _hr;
  }catch(e){
    console.error("[HOVER-DBG] onHover ERROR: " + e.message + " " + e.stack?.substring(0,200));
  }
}else{
  console.error("[HOVER-DBG] SKIPPED: Xt=" + !!Xt + " onHover=" + !!(Xt&&Xt.onHover) + " Qt=" + !!Qt);
}
return Vt.MsgHandler.forwardingMsgToClient(Gt)`

const patchedWorker = workerSrc.replace(workerPattern, workerReplacement)
if (patchedWorker === workerSrc) {
    console.log('❌ Worker pattern not found!')
    // Debug: show context
    const idx = workerSrc.indexOf('Xt&&Xt.onHover&&Qt')
    if (idx > -1) {
        console.log('Found at ' + idx + ':')
        console.log(workerSrc.substring(Math.max(0, idx - 200), idx + 200))
    }
    process.exit(1)
}

const patchedPath = path.join(WORKER_DIR, 'patched-index.js')
fs.writeFileSync(patchedPath, patchedWorker)
console.log('✅ Worker patched → ' + patchedPath)

// Also patch the MAIN index.js to load the patched worker
// Find where the main process spawns the worker
const mainSrc = fs.readFileSync(ACE_ENTRY, 'utf-8')
// Worker is typically loaded via: new Worker('./worker/index.js') or similar
// We need to redirect to our patched file
const mainPatched = mainSrc.replace(
    /worker\/index\.js/g,
    'worker/patched-index.js'
)
const mainPatchedPath = path.join(ACE_DIR, 'main-patched-index.js')
fs.writeFileSync(mainPatchedPath, mainPatched)
console.log('✅ Main patched → ' + mainPatchedPath)
console.log('   Worker refs replaced: ' + (mainPatched !== mainSrc))

// Start ace-server with patched main
let proc, buf = '', pending = new Map(), rid = 0
const enc = m => { const j = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(j, 'utf-8')}\r\n\r\n${j}` }
const nrid = () => `t-${++rid}-${Date.now()}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function start() {
    if (!fs.existsSync(LOG_PATH)) fs.mkdirSync(LOG_PATH, { recursive: true })
    proc = spawn(NODE_BIN, ['--max-old-space-size=4096', mainPatchedPath, '--stdio', `--logger-level=DEBUG`, `--logger-path=${LOG_PATH}`], { stdio: ['pipe', 'pipe', 'pipe'], cwd: ACE_DIR })
    proc.stderr.on('data', d => {
        const m = d.toString().trim()
        if (m) {
            // Highlight our debug lines
            for (const line of m.split('\n')) {
                if (line.includes('[HOVER-DBG]')) {
                    console.log(`🔍 ${line}`)
                } else if (line.includes('Error') || line.includes('error')) {
                    console.log(`[err] ${line}`)
                }
            }
        }
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
        if (msg.method === 'aceProject/onIndexingProgressUpdate') console.log(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}`)
        else if (msg.method === 'aceProject/onModuleInitFinish') console.log(`  ✅ 模块初始化完成`)
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) { const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result) }
    }
}

function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 Worker-Instrumented Hover Test')
    start(); await sleep(2000)

    const content = fs.readFileSync(TEST_FILE, 'utf-8')
    const lines = content.split('\n')
    const uri = `file://${TEST_FILE}`

    // Build init
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

    await req('initialize', { processId: process.pid, rootUri: `file://${PROJECT_ROOT}`, capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] } } }, initializationOptions: init, workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: 'myToolList' }] })
    console.log('✅ initialize')

    notify('initialized', { editors: [] })
    console.log('⏳ 等待索引 (30s)...')
    await sleep(30000)

    // didOpen
    console.log('\n📂 didOpen...')
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'ArkTS', version: 1, text: content }
    })
    await sleep(3000)

    // Find Column position
    let tl = -1, tc = -1
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim().startsWith('Column()')) { tl = i; tc = lines[i].indexOf('Column'); break } }

    // Hover test 1
    console.log(`\n--- Hover Column() at L${tl}:${tc} ---`)
    let hr = await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: tl, character: tc } })
    console.log(`Result: ${JSON.stringify(hr).substring(0, 200)}`)

    // Hover test 2 - pageStack
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('this.pageStack')) {
            const c = lines[i].indexOf('pageStack')
            console.log(`\n--- Hover pageStack at L${i}:${c} ---`)
            hr = await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: i, character: c } })
            console.log(`Result: ${JSON.stringify(hr).substring(0, 200)}`)
            break
        }
    }

    // Hover test 3 - @Entry decorator  
    console.log(`\n--- Hover @Entry at L0:1 ---`)
    hr = await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: 0, character: 1 } })
    console.log(`Result: ${JSON.stringify(hr).substring(0, 200)}`)

    cleanup()
}

function cleanup() {
    // Clean up patched files
    try { fs.unlinkSync(patchedPath) } catch (e) { }
    try { fs.unlinkSync(mainPatchedPath) } catch (e) { }
    if (proc && !proc.killed) proc.kill()
    setTimeout(() => process.exit(0), 1000)
}
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
