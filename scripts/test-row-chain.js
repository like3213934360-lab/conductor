#!/usr/bin/env node
/**
 * Test Row() chain completion at correct ArkTS positions
 * ArkTS pattern: Row() { children }.justifyContent(...)
 * Completion should trigger on "." after "}"
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
const diagnosticsReceived = new Map()

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
        if (msg.method === 'aceProject/onIndexingProgressUpdate')
            process.stdout.write(`  📊 ${p.current}/${p.total} ${p.moduleName || ''}\r`)
        else if (msg.method === 'aceProject/onModuleInitFinish')
            console.log(`  ✅ 模块初始化完成                `)
        else if (msg.method === 'textDocument/publishDiagnostics') {
            diagnosticsReceived.set(p.uri, p.diagnostics || [])
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
    console.log('🔬 Row 属性链补全 + 诊断触发测试')
    console.log('═'.repeat(60))
    start(); await sleep(2000)

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

    // Read actual file and find existing Row positions
    const content = fs.readFileSync(TEST_FILE, 'utf-8')
    const lines = content.split('\n')
    const uri = `file://${TEST_FILE}`

    // Standard + ace didOpen
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'ets', version: 1, text: content } })
    await aceReq('aceProject/onAsyncDidOpen', {
        textDocument: { uri, languageId: 'deveco.apptool.ets', version: 1, text: content }
    })
    await sleep(3000)

    // ==================== FIND EXISTING "." positions for chain calls ====
    console.log('\n' + '═'.repeat(60))
    console.log('📍 查找文件中的 "." 属性链位置')
    console.log('═'.repeat(60))

    // Find lines that start with "." — these are chain calls in ArkTS
    const dotLines = []
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim()
        if (trimmed.startsWith('.') && !trimmed.startsWith('//') && !trimmed.startsWith('...')) {
            dotLines.push({ line: i, content: trimmed, indent: lines[i].length - trimmed.length })
            if (dotLines.length <= 5) console.log(`  L${i}: ${trimmed.substring(0, 60)}`)
        }
    }
    console.log(`  共 ${dotLines.length} 个属性链行`)

    // ==================== TEST 1: Completion at existing "." positions ====
    console.log('\n' + '═'.repeat(60))
    console.log('⌨️  测试1: 在现有 "." 位置触发补全')
    console.log('═'.repeat(60))

    for (const dl of dotLines.slice(0, 3)) {
        const dotCol = dl.indent  // The "." is at this column
        console.log(`\n  📌 L${dl.line}: ${dl.content.substring(0, 40)}`)
        const cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: dl.line, character: dotCol + 1 }, // right after the "."
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        if (!cr) { console.log(`    ❌ null`); continue }
        const items = cr.items || cr || []
        console.log(`    ✅ ${items.length} 项`)

        // Check for attribute methods
        const attrs = ['justifyContent', 'alignItems', 'width', 'height', 'backgroundColor', 'padding', 'margin', 'onClick', 'opacity', 'visibility']
        const found = attrs.filter(a => items.some(i => (i.label || '').includes(a) || (i.insertText || '').includes(a)))
        console.log(`    属性方法: ${found.length > 0 ? found.join(', ') : '无！'}`)
        if (items.length > 0 && items.length <= 10) {
            console.log(`    全部: ${items.map(i => typeof i.label === 'string' ? i.label.split('\n')[0].substring(0, 40) : i.label).join(' | ')}`)
        } else if (items.length > 0) {
            console.log(`    前10: ${items.slice(0, 10).map(i => typeof i.label === 'string' ? i.label.split('\n')[0].substring(0, 40) : i.label).join(' | ')}`)
        }
    }

    // ==================== TEST 2: Simulate typing Row().  ============
    console.log('\n' + '═'.repeat(60))
    console.log('⌨️  测试2: 模拟在 Row(){} 后输入 "."')
    console.log('═'.repeat(60))

    // Find Row() {} block end
    let rowStart = -1, rowEnd = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('Row(') || lines[i].trim() === 'Row()' || lines[i].trim().startsWith('Row({')) {
            rowStart = i
            // Find matching closing brace
            let depth = 0
            for (let j = i; j < lines.length; j++) {
                for (const ch of lines[j]) {
                    if (ch === '{') depth++
                    if (ch === '}') { depth--; if (depth === 0) { rowEnd = j; break } }
                }
                if (rowEnd > -1) break
            }
            break
        }
    }

    if (rowStart > -1 && rowEnd > -1) {
        console.log(`  Row() 块: L${rowStart} - L${rowEnd}`)

        // Insert "." on the line after "}"
        const insertLine = rowEnd + 1
        const newLines = [...lines]
        const indent = ' '.repeat(lines[rowEnd].length - lines[rowEnd].trimStart().length)
        newLines.splice(insertLine, 0, indent + '.')
        const newContent = newLines.join('\n')

        // Send didChange
        const version = 2
        notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text: newContent }]
        })
        notify('aceProject/onAsyncDidChange', {
            params: {
                textDocument: { uri, version },
                contentChanges: [{ text: newContent }],
            },
            requestId: nrid(),
        })
        await sleep(2000)

        console.log(`  补全位置: L${insertLine}:${indent.length + 1} (在 "." 后)`)
        let cr = await aceReq('aceProject/onAsyncCompletion', {
            textDocument: { uri }, position: { line: insertLine, character: indent.length + 1 },
            context: { triggerKind: 2, triggerCharacter: '.' }
        })
        if (!cr) { console.log(`    ❌ null`); } else {
            const items = cr.items || cr || []
            console.log(`    ✅ ${items.length} 项`)
            const attrs = ['justifyContent', 'alignItems', 'width', 'height', 'backgroundColor', 'padding', 'margin', 'onClick', 'opacity', 'visibility']
            const found = attrs.filter(a => items.some(i => (i.label || '').includes(a)))
            console.log(`    属性方法: ${found.length > 0 ? found.join(', ') : '无'}`)
            if (items.length > 0) {
                console.log(`    前15: ${items.slice(0, 15).map(i => typeof i.label === 'string' ? i.label.split('\n')[0].substring(0, 50) : i.label).join(' | ')}`)
            }
        }
    } else {
        console.log('  ⚠️ 未找到 Row() 块')
    }

    // ==================== TEST 3: Diagnostics with intentional error ====
    console.log('\n' + '═'.repeat(60))
    console.log('🔎 测试3: 插入错误代码触发诊断')
    console.log('═'.repeat(60))

    // Insert an intentional error
    const errLines = [...lines]
    // Find build() { and add error code
    let buildLine = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('build()') && lines[i].includes('{')) { buildLine = i + 1; break }
    }
    if (buildLine > -1) {
        errLines.splice(buildLine, 0, '      let xxx: number = "not a number"')
        const errContent = errLines.join('\n')
        const version = 3

        notify('textDocument/didChange', {
            textDocument: { uri, version },
            contentChanges: [{ text: errContent }]
        })
        notify('aceProject/onAsyncDidChange', {
            params: {
                textDocument: { uri, version },
                contentChanges: [{ text: errContent }],
            },
            requestId: nrid(),
        })

        console.log(`  插入错误: L${buildLine}: let xxx: number = "not a number"`)
        console.log('  等待诊断...')
        await sleep(8000)

        const diags = diagnosticsReceived.get(uri) || []
        console.log(`  收到诊断: ${diags.length} 条`)
        diags.slice(0, 5).forEach(d => {
            console.log(`    L${d.range?.start?.line}: [sev=${d.severity}] ${d.message?.substring(0, 80)}`)
        })

        if (diags.length === 0) {
            console.log('  ⚠️  无诊断！检查是否需要发送 aceProject/doValidateDocument...')
            // Try ace validate
            const vr = await aceReq('aceProject/doValidateDocument', {
                textDocument: { uri, version }
            }, 10000)
            console.log(`  doValidateDocument 结果: ${JSON.stringify(vr)?.substring(0, 200)}`)

            await sleep(5000)
            const diags2 = diagnosticsReceived.get(uri) || []
            console.log(`  重新检查诊断: ${diags2.length} 条`)
            diags2.slice(0, 5).forEach(d => {
                console.log(`    L${d.range?.start?.line}: [sev=${d.severity}] ${d.message?.substring(0, 80)}`)
            })
        }
    }

    // ==================== SUMMARY ====================
    console.log('\n' + '═'.repeat(60))
    console.log('📊 总结')
    console.log('═'.repeat(60))

    cleanup()
}

function cleanup() { if (proc && !proc.killed) proc.kill(); setTimeout(() => process.exit(0), 1000) }
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup)
main().catch(e => { console.error(e); cleanup() })
