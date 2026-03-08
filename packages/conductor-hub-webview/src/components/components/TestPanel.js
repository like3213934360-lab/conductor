"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importStar(require("react"));
const theme_1 = require("../theme");
const vscode_api_1 = require("../vscode-api");
const Icon_1 = __importDefault(require("./Icon"));
const TestPanel = ({ lang }) => {
    const isEN = lang === 'en';
    const [copied, setCopied] = (0, react_1.useState)(null);
    const title = isEN ? 'Standard Test & Diagnostics' : '标准测试 & 诊断';
    const desc = isEN
        ? 'After installing Conductor Hub, paste the test prompt below into the Antigravity chat to verify all MCP tools work correctly.'
        : '安装 Conductor Hub 后，将以下测试 Prompt 粘贴到 Antigravity 聊天框中，主模型会自动测试所有功能并生成报告。';
    const testPrompt = isEN
        ? `Run a complete Conductor Hub feature test. For each item below, test and report the result:

1. mcp_conductor_hub_ai_list_providers() — list all configured models
2. mcp_conductor_hub_ai_ask(message="Reply: Conductor Hub connectivity test OK") — auto-route
3. mcp_conductor_hub_ai_ask(message="What is your model name?", provider="<first available>") — specific provider
4. mcp_conductor_hub_ai_multi_ask(message="What is 1+1? Reply with just the number") — multi-model
5. mcp_conductor_hub_ai_consensus(message="Difference between const and let in JS? One sentence.", criteria="accuracy") — voting engine
6. mcp_conductor_hub_ai_codex_task(task="echo Conductor Hub Codex test OK") — Codex CLI (SKIP if not installed)
7. mcp_conductor_hub_ai_gemini_task(prompt="Reply: Gemini CLI test OK") — Gemini CLI (SKIP if not installed)
8. Skill Verification — Check if file ~/.gemini/antigravity/skills/conductor-hub-routing/SKILL.md exists. Read it and confirm you can see the Conductor Hub AI Routing rules. PASS if you can see the routing tables.

After testing, output a report table:
| # | Test | Status | Time | Notes |
Then summarize: X/8 passed (X skipped).
If any failed, suggest pasting the report to: https://github.com/like3213934360-lab/conductor/issues/new`
        : `请执行 Conductor Hub 完整功能验证测试，逐项测试以下所有功能，最后给出标准报告。

1. 调用 mcp_conductor_hub_ai_list_providers()，列出所有已配置模型。通过标准：返回至少 1 个已启用模型
2. 调用 mcp_conductor_hub_ai_ask(message="请回复：Conductor Hub 连通性测试成功")，不指定 provider。通过标准：收到正常回复
3. 如步骤1有多个 provider，选第一个调用 mcp_conductor_hub_ai_ask(message="请回复你的模型名称", provider="<第一个>")
4. 调用 mcp_conductor_hub_ai_multi_ask(message="1+1等于几？请只回答数字")。通过标准：至少2个模型返回
5. 调用 mcp_conductor_hub_ai_consensus(message="JS中const和let的区别？一句话回答", criteria="accuracy")。通过标准：返回评分+最佳答案
6. 调用 mcp_conductor_hub_ai_codex_task(task="echo Conductor Hub Codex test OK")。未安装 Codex CLI 标记 SKIP
7. 调用 mcp_conductor_hub_ai_gemini_task(prompt="请回复：Gemini CLI 连通测试成功")。未安装标记 SKIP
8. Skill 验证 — 检查 ~/.gemini/antigravity/skills/conductor-hub-routing/SKILL.md 文件是否存在，读取内容确认能看到 Conductor Hub AI 调度规则表。通过标准：文件存在且包含路由规则

测试完成后按以下格式输出报告：
| # | 测试项 | 状态 | 耗时 | 备注 |
总结：X/8 通过（X项跳过）
如发现问题，请将报告粘贴到：https://github.com/like3213934360-lab/conductor/issues/new`;
    const quickTest = isEN
        ? 'Call mcp_conductor_hub_ai_list_providers() to list all available models, then send "Conductor Hub test OK" to the first available model via mcp_conductor_hub_ai_ask.'
        : '调用 mcp_conductor_hub_ai_list_providers() 列出所有可用模型，然后用 mcp_conductor_hub_ai_ask 向第一个可用模型发送 "Conductor Hub 测试成功"。';
    const handleCopy = (text, id) => {
        vscode_api_1.vscode.postMessage({ command: 'copyToClipboard', text });
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };
    const handleDiagnostic = () => {
        vscode_api_1.vscode.postMessage({ command: 'generateDiagnostics' });
    };
    const stepsTitle = isEN ? 'How to Test' : '测试步骤';
    const steps = isEN
        ? ['Install Conductor Hub and reload Antigravity', 'Open a chat window', 'Copy the test prompt below', 'Paste into chat and send', 'The AI will auto-test all 8 items (7 MCP tools + Skill) and generate a report']
        : ['安装 Conductor Hub 并重启 Antigravity', '打开聊天窗口', '复制下方测试 Prompt', '粘贴到聊天中发送', '主模型自动测试全部 8 项（7 个 MCP 工具 + Skill）并生成报告'];
    const copyBtn = (text, id, primary) => (react_1.default.createElement("button", { onClick: () => handleCopy(text, id), style: {
            padding: '5px 14px', borderRadius: theme_1.radius.pill,
            fontSize: '11px', cursor: 'pointer',
            background: copied === id ? 'rgba(52,211,153,0.15)'
                : primary ? theme_1.colors.brandGradient
                    : 'rgba(255,255,255,0.04)',
            color: copied === id ? theme_1.colors.success
                : primary ? '#fff'
                    : 'var(--vscode-editor-foreground)',
            border: copied === id ? `1px solid ${theme_1.colors.success}40`
                : primary ? 'none'
                    : `1px solid ${theme_1.colors.glassBorder}`,
            fontWeight: 600, transition: 'all 0.2s',
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            boxShadow: primary && copied !== id ? '0 2px 10px rgba(6,182,212,0.25)' : 'none',
            backdropFilter: 'blur(8px)',
        } },
        react_1.default.createElement(Icon_1.default, { name: copied === id ? 'check' : 'copy', size: 12, color: copied === id ? theme_1.colors.success : primary ? '#fff' : 'var(--vscode-editor-foreground)' }),
        copied === id ? (isEN ? 'Copied!' : '已复制！') : (isEN ? 'Copy' : '复制')));
    return (react_1.default.createElement("div", { className: "animate-in", style: { maxWidth: '860px', paddingBottom: '20px' } },
        react_1.default.createElement("div", { style: { marginBottom: '20px' } },
            react_1.default.createElement("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
                react_1.default.createElement(Icon_1.default, { name: "flask", size: 20, color: theme_1.colors.brand }),
                react_1.default.createElement("h2", { style: {
                        margin: 0, fontSize: '18px', fontWeight: 700,
                        letterSpacing: '-0.3px',
                        background: theme_1.colors.brandGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    } }, title)),
            react_1.default.createElement("div", { style: {
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.6, paddingLeft: '30px',
                } }, desc)),
        react_1.default.createElement("div", { style: {
                ...theme_1.glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', alignItems: 'center', gap: '8px',
                    marginBottom: '12px',
                } },
                react_1.default.createElement(Icon_1.default, { name: "clipboard", size: 15, color: theme_1.colors.brand }),
                react_1.default.createElement("span", { style: { fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' } }, stepsTitle)),
            react_1.default.createElement("div", { style: { paddingLeft: '4px' } }, steps.map((step, i) => (react_1.default.createElement("div", { key: i, style: {
                    display: 'flex', alignItems: 'baseline', gap: '10px',
                    marginBottom: '6px',
                } },
                react_1.default.createElement("span", { style: {
                        width: '20px', height: '20px',
                        borderRadius: '50%',
                        background: `${theme_1.colors.brand}15`,
                        color: theme_1.colors.brand,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', fontWeight: 700, flexShrink: 0,
                    } }, i + 1),
                react_1.default.createElement("span", { style: {
                        fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                        lineHeight: 1.7,
                    } }, step)))))),
        react_1.default.createElement("div", { style: {
                ...theme_1.glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '12px',
                } },
                react_1.default.createElement("div", { style: {
                        display: 'flex', alignItems: 'center', gap: '8px',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: "flask", size: 15, color: "#E879F9" }),
                    react_1.default.createElement("span", { style: { fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' } }, isEN ? 'Full Test Prompt (8 items)' : '完整测试 Prompt（8 项）')),
                copyBtn(testPrompt, 'full', true)),
            react_1.default.createElement("pre", { style: {
                    ...theme_1.glass.panel,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '14px', fontSize: '11px', lineHeight: 1.6,
                    color: 'var(--vscode-descriptionForeground)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: '200px', overflow: 'auto', margin: 0,
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                } }, testPrompt)),
        react_1.default.createElement("div", { style: {
                ...theme_1.glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '12px',
                } },
                react_1.default.createElement("div", { style: {
                        display: 'flex', alignItems: 'center', gap: '8px',
                    } },
                    react_1.default.createElement(Icon_1.default, { name: "zap", size: 15, color: "#FBBF24" }),
                    react_1.default.createElement("span", { style: { fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' } }, isEN ? 'Quick Connectivity Test (1 line)' : '快速连通性测试（1 行）')),
                copyBtn(quickTest, 'quick')),
            react_1.default.createElement("pre", { style: {
                    ...theme_1.glass.panel,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '12px', fontSize: '11px', lineHeight: 1.5,
                    color: 'var(--vscode-descriptionForeground)',
                    whiteSpace: 'pre-wrap', margin: 0,
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                } }, quickTest)),
        react_1.default.createElement("div", { style: {
                ...theme_1.glass.panel,
                padding: '18px 20px',
            } },
            react_1.default.createElement("div", { style: {
                    display: 'flex', alignItems: 'center', gap: '8px',
                    marginBottom: '10px',
                } },
                react_1.default.createElement(Icon_1.default, { name: "settings", size: 15, color: "#60A5FA" }),
                react_1.default.createElement("span", { style: { fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' } }, isEN ? 'One-Click Diagnostics' : '一键诊断')),
            react_1.default.createElement("div", { style: {
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    marginBottom: '14px', lineHeight: 1.6,
                } }, isEN
                ? 'Generate a diagnostic report with your configuration, model status, and error logs. You can paste the report into a GitHub Issue for support.'
                : '生成包含配置状态、模型连通性、错误日志的诊断报告。可直接粘贴到 GitHub Issue 获取支持。'),
            react_1.default.createElement("button", { onClick: handleDiagnostic, style: {
                    padding: '10px 24px', borderRadius: theme_1.radius.pill,
                    fontSize: '12px', cursor: 'pointer',
                    background: theme_1.colors.brandGradient,
                    color: '#fff', border: 'none', fontWeight: 600,
                    boxShadow: '0 4px 16px rgba(6,182,212,0.3)',
                    transition: 'all 0.2s',
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                }, onMouseEnter: e => e.currentTarget.style.transform = 'translateY(-1px)', onMouseLeave: e => e.currentTarget.style.transform = '' },
                react_1.default.createElement(Icon_1.default, { name: "activity", size: 13, color: "#fff" }),
                isEN ? 'Generate Diagnostic Report' : '生成诊断报告'))));
};
exports.default = TestPanel;
