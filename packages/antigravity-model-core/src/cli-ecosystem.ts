/**
 * CLI Ecosystem Discovery — 读取 Codex/Gemini CLI 的 MCP + 扩展配置
 *
 * 四层描述策略:
 *   ① 内置注册表 — 已知 MCP server 的中文描述 (最快, 0ms)
 *   ② npm package.json — 本地读 description 字段
 *   ③ npm Registry API — 联网查询 registry.npmjs.org (约 200ms)
 *   ④ 降级 — "自定义 MCP 服务器"
 *
 * 安全: 环境变量自动脱敏 (Token/Key/Secret → ****)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface McpServerInfo {
    name: string;
    command: string;
    args: string[];
    description: string;
    env?: Record<string, string>;  // 已脱敏
}

export interface ExtensionInfo {
    name: string;
    description: string;
}

export interface CliEcosystem {
    codex: {
        version: string;
        model: string;
        mcpServers: McpServerInfo[];
    };
    gemini: {
        mcpServers: McpServerInfo[];
        extensions: ExtensionInfo[];
    };
}

// ── 内置描述注册表 ────────────────────────────────────────────────────────────

/**
 * 已知 MCP server 描述 — 按 npm 包名 或 server 名匹配
 * 优先用包名匹配 (如 @modelcontextprotocol/server-filesystem)
 * 其次用 server key 匹配 (如 filesystem)
 */
const KNOWN_DESCRIPTIONS: Record<string, string> = {
    // ── 官方 MCP servers ──
    'filesystem':           '文件系统读写 — 在指定目录内安全地读、写、搜索文件',
    'server-filesystem':    '文件系统读写 — 在指定目录内安全地读、写、搜索文件',
    'mcp-server-filesystem': '文件系统读写 — 在指定目录内安全地读、写、搜索文件',

    'github':               'GitHub API — 仓库管理、Issue/PR 操作、代码搜索',
    'server-github':        'GitHub API — 仓库管理、Issue/PR 操作、代码搜索',

    // ── 第三方 MCP servers ──
    'context7':             'Context7 — 实时查询任意编程库/框架的最新文档和代码示例',
    'context7-mcp':         'Context7 — 实时查询任意编程库/框架的最新文档和代码示例',

    'playwright':           'Playwright — 浏览器自动化测试、网页截图、DOM 操作',
    'playwright-mcp':       'Playwright — 浏览器自动化测试、网页截图、DOM 操作',

    'chrome':               'Chrome DevTools — 浏览器调试、性能分析、网络监控',
    'chrome-devtools-mcp':  'Chrome DevTools — 浏览器调试、性能分析、网络监控',

    'pencil':               'Pencil — .pen 格式设计文件编辑器，UI/UX 设计生成与验证',

    'puppeteer':            'Puppeteer — Chrome 无头浏览器控制，截图和 PDF 生成',
    'memory':               'Memory — 基于知识图谱的持久化记忆存储',
    'brave-search':         'Brave Search — 网络搜索 (无需 Google API)',
    'fetch':                'Fetch — HTTP 请求发送和网页内容抓取',
    'sqlite':               'SQLite — 本地 SQLite 数据库查询和管理',
    'postgres':             'PostgreSQL — 数据库只读查询和 schema 检查',
    'sequential-thinking':  'Sequential Thinking — 动态多步推理和问题分解',
    'slack':                'Slack — 频道消息、文件搜索和用户管理',
    'everart':              'Everart — AI 图片生成',
    'everything':           'Everything — Windows 文件极速搜索',
    'sentry':               'Sentry — 错误监控和异常追踪',
    'git':                  'Git — 版本控制操作 (commit, diff, log, branch)',
    'linear':               'Linear — 项目管理、Issue 和 Sprint 追踪',
};

/** Gemini CLI 扩展描述 */
const KNOWN_EXTENSIONS: Record<string, string> = {
    'antigravity-swarm':     'Antigravity 集群模式 — 多 Agent 并行任务执行',
    'code-review':           '代码审查 — 自动化 Code Review 和质量分析',
    'antigravity-workflow':  'Antigravity Workflow — 多模型编排与治理运行时',
    'context7':              'Context7 — 库文档实时查询集成',
    'criticalthink':         '批判性思维 — 结论验证和逻辑推理增强',
    'skill-porter':          '技能迁移 — 跨平台技能文件导入/导出',
};

// ── TOML 简单解析 (只解析 Codex config.toml 的子集) ──────────────────────────

interface TomlSection {
    [key: string]: string | string[] | TomlSection;
}

function parseSimpleToml(content: string): Record<string, TomlSection> {
    const result: Record<string, TomlSection> = { '': {} as TomlSection };
    let currentSection = '';

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // [section.subsection]
        const sectionMatch = trimmed.match(/^\[(.+)]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1]!;
            if (!result[currentSection]) result[currentSection] = {} as TomlSection;
            continue;
        }

        // key = value
        const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
        if (kvMatch) {
            const key = kvMatch[1]!;
            let value = kvMatch[2]!.trim();

            if (value.startsWith('"') && value.endsWith('"')) {
                // String value
                if (!result[currentSection]) result[currentSection] = {} as TomlSection;
                result[currentSection]![key] = value.slice(1, -1);
            } else if (value.startsWith('[')) {
                // Array value — simple inline array
                const items = value.slice(1, -1).split(',')
                    .map(s => s.trim().replace(/^"/, '').replace(/"$/, ''))
                    .filter(Boolean);
                if (!result[currentSection]) result[currentSection] = {} as TomlSection;
                result[currentSection]![key] = items;
            } else {
                if (!result[currentSection]) result[currentSection] = {} as TomlSection;
                result[currentSection]![key] = value.replace(/^"/, '').replace(/"$/, '');
            }
        }
    }
    return result;
}

// ── 脱敏 ─────────────────────────────────────────────────────────────────────

const SENSITIVE = ['token', 'key', 'secret', 'password', 'pat', 'authorization'];

function sanitizeEnv(env: Record<string, string>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        const lower = k.toLowerCase();
        if (SENSITIVE.some(s => lower.includes(s))) {
            safe[k] = v.length > 8 ? `${v.slice(0, 4)}****${v.slice(-4)}` : '****';
        } else {
            safe[k] = v;
        }
    }
    return safe;
}

// ── 描述解析 (四层策略) ───────────────────────────────────────────────────────

/** npm Registry 查询缓存 (进程生命周期内有效) */
const npmDescCache = new Map<string, string>();

/**
 * 从 command / args 中提取 npm 包名
 * 支持:
 *   npx -y @upstash/context7-mcp → @upstash/context7-mcp
 *   /path/to/node_modules/.bin/playwright-mcp → playwright-mcp
 *   mcp-server-filesystem → mcp-server-filesystem
 */
function extractNpmPackage(command: string, args: string[]): string | undefined {
    const allParts = [command, ...args];
    for (const part of allParts) {
        // 跳过 npx, -y, node 等
        if (['npx', 'node', '-y', '--yes'].includes(part)) continue;

        // @scope/name 格式
        const scopedMatch = part.match(/@[\w-]+\/[\w.-]+/);
        if (scopedMatch) return scopedMatch[0];

        // 从 node_modules/.bin/xxx 提取
        const binMatch = part.match(/node_modules\/\.bin\/([\w.-]+)/);
        if (binMatch) return binMatch[1];

        // 独立包名 (含 mcp 关键字的)
        if (part.match(/^[\w-]+-mcp$/) || part.match(/^mcp-[\w-]+$/)) {
            return part;
        }
    }
    return undefined;
}

/** 联网查询 npm registry (带超时 + 缓存) */
async function fetchNpmDescription(packageName: string): Promise<string | undefined> {
    // 缓存命中
    if (npmDescCache.has(packageName)) return npmDescCache.get(packageName);

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000); // 3s 超时

        const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });
        clearTimeout(timer);

        if (!res.ok) return undefined;

        const data = await res.json() as { description?: string };
        if (data.description) {
            npmDescCache.set(packageName, data.description);
            return data.description;
        }
    } catch {
        // 网络不可用 / 超时 → 静默降级
    }
    return undefined;
}

async function getDescription(serverName: string, command: string, args: string[]): Promise<string> {
    // 层次 1: 内置注册表 (0ms)
    if (KNOWN_DESCRIPTIONS[serverName]) return KNOWN_DESCRIPTIONS[serverName]!;

    // 从 command/args 提取包名
    const allParts = [command, ...args];
    for (const part of allParts) {
        const npmMatch = part.match(/(@[\w-]+\/[\w-]+|[\w-]+(?:-mcp)?)/);
        if (npmMatch) {
            const pkg = npmMatch[1]!;
            const shortName = pkg.split('/').pop()!;
            if (KNOWN_DESCRIPTIONS[shortName]) return KNOWN_DESCRIPTIONS[shortName]!;
            if (KNOWN_DESCRIPTIONS[pkg]) return KNOWN_DESCRIPTIONS[pkg]!;
        }
    }

    // 层次 2: 本地 npm package.json
    try {
        for (const part of allParts) {
            if (part.includes('node_modules')) {
                const binDir = path.dirname(part);
                const pkgJson = path.join(binDir, '..', 'package.json');
                if (fs.existsSync(pkgJson)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
                    if (pkg.description) return pkg.description;
                }
            }
        }
    } catch { /* ignore */ }

    // 层次 3: npm Registry API (联网)
    const npmPkg = extractNpmPackage(command, args);
    if (npmPkg) {
        const desc = await fetchNpmDescription(npmPkg);
        if (desc) return `📦 ${desc}`;
    }

    // 层次 4: Fallback
    return '自定义 MCP 服务器';
}

function getExtensionDescription(name: string): string {
    if (KNOWN_EXTENSIONS[name]) return KNOWN_EXTENSIONS[name]!;

    // Try reading extension manifest
    const extDir = path.join(os.homedir(), '.gemini', 'extensions', name);
    try {
        const manifestPath = path.join(extDir, 'gemini-extension.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest.description) return manifest.description;
        }
        // Try package.json
        const pkgPath = path.join(extDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.description) return pkg.description;
        }
    } catch { /* ignore */ }

    return 'Gemini CLI 扩展';
}

// ── 主函数 ────────────────────────────────────────────────────────────────────

/** 发现 Codex + Gemini CLI 的完整生态系统 (含联网查询) */
export async function discoverCliEcosystem(): Promise<CliEcosystem> {
    const [codex, gemini] = await Promise.all([
        discoverCodex(),
        discoverGemini(),
    ]);
    return { codex, gemini };
}

async function discoverCodex(): Promise<CliEcosystem['codex']> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    const mcpServers: McpServerInfo[] = [];
    let model = 'unknown';
    let version = 'unknown';

    // 读版本
    try {
        const { execSync } = require('child_process');
        version = String(execSync('codex --version 2>/dev/null', { timeout: 3000 })).trim();
    } catch { /* not installed */ }

    try {
        if (fs.existsSync(configPath)) {
            const toml = parseSimpleToml(fs.readFileSync(configPath, 'utf8'));

            // 全局 model
            if (toml[''] && typeof toml['']!['model'] === 'string') {
                model = toml['']!['model'] as string;
            }

            // MCP servers: [mcp_servers.name] sections
            for (const [section, data] of Object.entries(toml)) {
                if (section.startsWith('mcp_servers.')) {
                    const name = section.replace('mcp_servers.', '');
                    const command = (data as TomlSection)['command'] as string || '';
                    const args = ((data as TomlSection)['args'] as string[]) || [];

                    mcpServers.push({
                        name,
                        command,
                        args,
                        description: await getDescription(name, command, args),
                    });
                }
            }
        }
    } catch { /* config missing/malformed */ }

    return { version, model, mcpServers };
}

async function discoverGemini(): Promise<CliEcosystem['gemini']> {
    const settingsPath = path.join(os.homedir(), '.gemini', 'settings.json');
    const extensionsDir = path.join(os.homedir(), '.gemini', 'extensions');
    const mcpServers: McpServerInfo[] = [];
    const extensions: ExtensionInfo[] = [];

    try {
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

            if (settings.mcpServers) {
                for (const [name, config] of Object.entries(settings.mcpServers)) {
                    const c = config as { command?: string; args?: string[]; env?: Record<string, string> };
                    mcpServers.push({
                        name,
                        command: c.command || '',
                        args: c.args || [],
                        description: await getDescription(name, c.command || '', c.args || []),
                        env: c.env ? sanitizeEnv(c.env) : undefined,
                    });
                }
            }
        }
    } catch { /* settings missing/malformed */ }

    // Extensions
    try {
        if (fs.existsSync(extensionsDir)) {
            const dirs = fs.readdirSync(extensionsDir).filter(d => {
                const full = path.join(extensionsDir, d);
                return fs.statSync(full).isDirectory() && !d.startsWith('.');
            });
            for (const dir of dirs) {
                extensions.push({
                    name: dir,
                    description: getExtensionDescription(dir),
                });
            }
        }
    } catch { /* extensions dir missing */ }

    return { mcpServers, extensions };
}

// ── 格式化输出 ────────────────────────────────────────────────────────────────

/** 格式化为 Markdown 展示 */
export function formatEcosystem(eco: CliEcosystem): string {
    const lines: string[] = ['# 🔌 CLI Ecosystem Discovery\n'];

    // Codex
    lines.push('## Codex CLI');
    lines.push(`- **版本**: ${eco.codex.version}`);
    lines.push(`- **模型**: ${eco.codex.model}`);
    lines.push(`- **MCP Servers**: ${eco.codex.mcpServers.length} 个\n`);

    if (eco.codex.mcpServers.length > 0) {
        lines.push('| 名称 | 描述 | 命令 |');
        lines.push('|:-----|:-----|:-----|');
        for (const s of eco.codex.mcpServers) {
            lines.push(`| **${s.name}** | ${s.description} | \`${s.command}\` |`);
        }
    }

    // Gemini
    lines.push('\n## Gemini CLI');
    lines.push(`- **MCP Servers**: ${eco.gemini.mcpServers.length} 个`);
    lines.push(`- **Extensions**: ${eco.gemini.extensions.length} 个\n`);

    if (eco.gemini.mcpServers.length > 0) {
        lines.push('### MCP Servers\n');
        lines.push('| 名称 | 描述 | 命令 |');
        lines.push('|:-----|:-----|:-----|');
        for (const s of eco.gemini.mcpServers) {
            lines.push(`| **${s.name}** | ${s.description} | \`${s.command}\` |`);
        }
    }

    if (eco.gemini.extensions.length > 0) {
        lines.push('\n### Extensions\n');
        lines.push('| 扩展 | 描述 |');
        lines.push('|:-----|:-----|');
        for (const e of eco.gemini.extensions) {
            lines.push(`| **${e.name}** | ${e.description} |`);
        }
    }

    return lines.join('\n');
}
