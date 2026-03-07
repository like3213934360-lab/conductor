#!/usr/bin/env node
/**
 * v5: Patch the GUARD condition in worker to log which check fails
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const PROJECT_ROOT = '/Users/dreamlike/DreamLike/myToolList'
const DEVECO = '/Applications/DevEco-Studio.app/Contents'
const ACE_DIR = path.join(DEVECO, 'plugins/openharmony/ace-server/out')
const ACE_ENTRY = path.join(ACE_DIR, 'index.js')
const WORKER_FILE = path.join(ACE_DIR, 'worker/index.js')
const WORKER_BAK = WORKER_FILE + '.bak'
const NODE_BIN = path.join(DEVECO, 'tools/node/bin/node')
const SDK = path.join(DEVECO, 'sdk/default/openharmony')
const LOG_PATH = path.join(__dirname, '../logs')
const TEST_FILE = path.join(PROJECT_ROOT, 'products/phone/src/main/ets/pages/Index.ets')
const DBG_LOG = '/tmp/hover-debug.log'

fs.writeFileSync(DBG_LOG, '')

// Backup original worker if not already backed up
if (!fs.existsSync(WORKER_BAK)) {
    fs.copyFileSync(WORKER_FILE, WORKER_BAK)
}
const workerSrc = fs.readFileSync(WORKER_BAK, 'utf-8')

// Patch the guard condition to add logging
const guardPattern = 'if(!(0,wt.isProjectOrAcrossProjectModuleFile)(Ht.uri)||!kt||!(0,wt.isValidateFile)(kt.uri,kt.languageId)||(0,jt.isInvalidResourceFile)(ot))return Vt.MsgHandler.forwardingMsgToClient(Gt)'

const guardReplacement = `{
var _fs=require("fs"),_dlog="/tmp/hover-debug.log";
var _isProjFile=!!(0,wt.isProjectOrAcrossProjectModuleFile)(Ht.uri);
var _hasDoc=!!kt;
var _isValid=_hasDoc?!!(0,wt.isValidateFile)(kt.uri,kt.languageId):false;
var _isInvalidRes=(0,jt.isInvalidResourceFile)(ot);
_fs.appendFileSync(_dlog,"[GUARD] uri="+Ht.uri+" fsPath="+ot+"\\n");
_fs.appendFileSync(_dlog,"[GUARD] isProjectFile="+_isProjFile+" hasDoc="+_hasDoc+" isValidateFile="+_isValid+" isInvalidResource="+_isInvalidRes+"\\n");
if(_hasDoc)_fs.appendFileSync(_dlog,"[GUARD] doc.uri="+kt.uri+" doc.languageId="+kt.languageId+"\\n");
if(!_isProjFile||!_hasDoc||!_isValid||_isInvalidRes){
_fs.appendFileSync(_dlog,"[GUARD] REJECTED!\\n\\n");
return Vt.MsgHandler.forwardingMsgToClient(Gt);
}
_fs.appendFileSync(_dlog,"[GUARD] PASSED\\n");
}`

const patchedWorker = workerSrc.replace(guardPattern, guardReplacement)
if (patchedWorker === workerSrc) {
    console.log('❌ Guard pattern not found!')
    const idx = workerSrc.indexOf('isValidateFile)(kt.uri,kt.languageId)')
    if (idx > -1) {
        console.log('at ' + idx + ':');
        console.log(workerSrc.substring(Math.max(0, idx - 200), idx + 200));
    }
    process.exit(1)
}

// Also patch the getLanguageService/getContext/onHover part
const lsPattern = 'const Xt=(0,wt.getLanguageService)(kt.uri,kt.languageId,Et.initializeHandler.aceLanguageServices),Qt=(0,wt.getContext)(kt);return Xt&&Xt.onHover&&Qt&&(Gt.data.result=Xt.onHover(kt,zt,Qt)),Vt.MsgHandler.forwardingMsgToClient(Gt)'

const lsReplacement = `const Xt=(0,wt.getLanguageService)(kt.uri,kt.languageId,Et.initializeHandler.aceLanguageServices),Qt=(0,wt.getContext)(kt);
{var _fs2=require("fs");
_fs2.appendFileSync("/tmp/hover-debug.log","[LS] getLS="+(Xt?("cls="+Xt.constructor?.name+" onHover="+!!Xt.onHover):"NULL")+"\\n");
_fs2.appendFileSync("/tmp/hover-debug.log","[LS] getCtx="+(Qt?JSON.stringify(Qt).substring(0,200):"NULL")+"\\n");
if(Xt&&Xt.onHover&&Qt){try{var _r=Xt.onHover(kt,zt,Qt);_fs2.appendFileSync("/tmp/hover-debug.log","[LS] onHover="+JSON.stringify(_r).substring(0,500)+"\\n\\n");Gt.data.result=_r}catch(_e){_fs2.appendFileSync("/tmp/hover-debug.log","[LS] ERR="+_e.message+"\\n\\n")}}
else{_fs2.appendFileSync("/tmp/hover-debug.log","[LS] SKIP\\n\\n")}}
return Vt.MsgHandler.forwardingMsgToClient(Gt)`

const fullyPatched = patchedWorker.replace(lsPattern, lsReplacement)
console.log('Guard patched:', patchedWorker !== workerSrc)
console.log('LS patched:', fullyPatched !== patchedWorker)

fs.writeFileSync(WORKER_FILE, fullyPatched)
console.log('✅ Worker patched IN PLACE')

function restore() {
    if (fs.existsSync(WORKER_BAK)) {
        fs.copyFileSync(WORKER_BAK, WORKER_FILE)
        console.log('✅ Worker restored')
    }
}

let proc, buf = '', pending = new Map(), rid = 0
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
        if (msg.method === 'aceProject/onIndexingProgressUpdate') console.log(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}`)
        else if (msg.method === 'aceProject/onModuleInitFinish') console.log(`  ✅ 模块完成`)
        else if (msg.method.includes('onAsync') && p.requestId && pending.has(p.requestId)) { const r = pending.get(p.requestId); pending.delete(p.requestId); r(p.result) }
    }
}

function req(method, params) { const id = rid++; proc.stdin.write(enc({ jsonrpc: '2.0', id, method, params })); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, 30000) }) }
function notify(method, params) { proc.stdin.write(enc({ jsonrpc: '2.0', method, params })) }
function aceReq(method, params, t = 20000) { const id = nrid(); notify(method, { params, requestId: id }); return new Promise(r => { pending.set(id, r); setTimeout(() => { if (pending.has(id)) { pending.delete(id); r(null) } }, t) }) }

async function main() {
    console.log('🔬 Guard-Patched Hover Test v5')
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

    await req('initialize', { processId: process.pid, rootUri: `file://${PROJECT_ROOT}`, capabilities: { textDocument: { hover: { contentFormat: ['markdown', 'plaintext'] } } }, initializationOptions: init, workspaceFolders: [{ uri: `file://${PROJECT_ROOT}`, name: 'myToolList' }] })
    console.log('✅ init')

    notify('initialized', { editors: [] })
    console.log('⏳ 索引...')
    await sleep(30000)

    console.log('📂 didOpen...')
    await aceReq('aceProject/onAsyncDidOpen', { textDocument: { uri, languageId: 'ArkTS', version: 1, text: content } })
    await sleep(3000)

    // Find Column
    let tl = -1, tc = -1
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim().startsWith('Column()')) { tl = i; tc = lines[i].indexOf('Column'); break } }

    console.log(`🔍 Hover Column L${tl}:${tc}`)
    await aceReq('aceProject/onAsyncHover', { textDocument: { uri }, position: { line: tl, character: tc } })

    // Wait and read log
    await sleep(2000)
    console.log('\n' + '='.repeat(60))
    console.log('DEBUG LOG:')
    console.log('='.repeat(60))
    try {
        const dbg = fs.readFileSync(DBG_LOG, 'utf-8')
        console.log(dbg || '(empty)')
    } catch (e) {
        console.log('(not found)')
    }

    cleanup()
}

function cleanup() {
    restore()
    if (proc && !proc.killed) proc.kill()
    setTimeout(() => process.exit(0), 1000)
}
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
