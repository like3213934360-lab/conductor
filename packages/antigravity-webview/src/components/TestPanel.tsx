import React, { useState } from 'react';
import { colors, radius, s, glass, shadow } from '../theme';
import { Lang } from './Dashboard';
import { vscode } from '../vscode-api';
import Icon from './Icon';

const TestPanel: React.FC<{ lang: Lang }> = ({ lang }) => {
    const isEN = lang === 'en';
    const [copied, setCopied] = useState<string | null>(null);

    const title = isEN ? 'Standard Test & Diagnostics' : '标准测试 & 诊断';
    const desc = isEN
        ? 'After installing Antigravity Workflow, paste the test prompt below into the Antigravity chat to verify all MCP tools work correctly.'
        : '安装 Antigravity Workflow 后，将以下测试 Prompt 粘贴到 Antigravity 聊天框中，主模型会自动测试所有功能并生成报告。';

    const testPrompt = isEN
        ? `Run a complete Antigravity Workflow feature test. For each item below, test and report the result:

1. mcp_antigravity_ai_list_models() — list all configured catalog models
2. mcp_antigravity_ai_ask(message="Reply: Antigravity Workflow connectivity test OK") — auto-route
3. mcp_antigravity_ai_ask(message="What is your model name?", model_hint="<first available model id or label fragment>") — specific model hint
4. mcp_antigravity_ai_multi_ask(message="What is 1+1? Reply with just the number") — multi-model
5. mcp_antigravity_ai_consensus(message="Difference between const and let in JS? One sentence.", criteria="accuracy") — voting engine
6. mcp_antigravity_ai_codex_task(task="echo Antigravity Workflow Codex test OK") — Codex CLI (SKIP if not installed)
7. mcp_antigravity_ai_gemini_task(prompt="Reply: Gemini CLI test OK") — Gemini CLI (SKIP if not installed)
8. Skill Verification — Check if file ~/.gemini/antigravity/skills/antigravity-routing/SKILL.md exists. Read it and confirm you can see the Antigravity Workflow AI routing rules. PASS if you can see the routing tables.

After testing, output a report table:
| # | Test | Status | Time | Notes |
Then summarize: X/8 passed (X skipped).
If any failed, suggest pasting the report to: https://github.com/like3213934360-lab/conductor/issues/new`
        : `请执行 Antigravity Workflow 完整功能验证测试，逐项测试以下所有功能，最后给出标准报告。

1. 调用 mcp_antigravity_ai_list_models()，列出所有已配置模型目录项。通过标准：返回至少 1 个已启用模型
2. 调用 mcp_antigravity_ai_ask(message="请回复：Antigravity Workflow 连通性测试成功")，不指定 model_hint。通过标准：收到正常回复
3. 如步骤1有多个模型，选第一个模型 ID 或 label 片段，调用 mcp_antigravity_ai_ask(message="请回复你的模型名称", model_hint="<第一个模型提示>")
4. 调用 mcp_antigravity_ai_multi_ask(message="1+1等于几？请只回答数字")。通过标准：至少2个模型返回
5. 调用 mcp_antigravity_ai_consensus(message="JS中const和let的区别？一句话回答", criteria="accuracy")。通过标准：返回评分+最佳答案
6. 调用 mcp_antigravity_ai_codex_task(task="echo Antigravity Workflow Codex test OK")。未安装 Codex CLI 标记 SKIP
7. 调用 mcp_antigravity_ai_gemini_task(prompt="请回复：Gemini CLI 连通测试成功")。未安装标记 SKIP
8. Skill 验证 — 检查 ~/.gemini/antigravity/skills/antigravity-routing/SKILL.md 文件是否存在，读取内容确认能看到 Antigravity Workflow AI 调度规则表。通过标准：文件存在且包含路由规则

测试完成后按以下格式输出报告：
| # | 测试项 | 状态 | 耗时 | 备注 |
总结：X/8 通过（X项跳过）
如发现问题，请将报告粘贴到：https://github.com/like3213934360-lab/conductor/issues/new`;

    const quickTest = isEN
        ? 'Call mcp_antigravity_ai_list_models() to list available catalog models, then send "Antigravity Workflow test OK" through mcp_antigravity_ai_ask.'
        : '调用 mcp_antigravity_ai_list_models() 列出所有可用模型目录项，然后用 mcp_antigravity_ai_ask 发送 "Antigravity Workflow 测试成功"。';

    const handleCopy = (text: string, id: string) => {
        vscode.postMessage({ command: 'copyToClipboard', text });
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const handleDiagnostic = () => {
        vscode.postMessage({ command: 'generateDiagnostics' });
    };

    const stepsTitle = isEN ? 'How to Test' : '测试步骤';
    const steps = isEN
        ? ['Install Antigravity Workflow and reload Antigravity', 'Open a chat window', 'Copy the test prompt below', 'Paste into chat and send', 'The AI will auto-test all 8 items (7 MCP tools + Skill) and generate a report']
        : ['安装 Antigravity Workflow 并重启 Antigravity', '打开聊天窗口', '复制下方测试 Prompt', '粘贴到聊天中发送', '主模型自动测试全部 8 项（7 个 MCP 工具 + Skill）并生成报告'];

    const copyBtn = (text: string, id: string, primary?: boolean) => (
        <button
            onClick={() => handleCopy(text, id)}
            style={{
                padding: '5px 14px', borderRadius: radius.pill,
                fontSize: '11px', cursor: 'pointer',
                background: copied === id ? 'rgba(52,211,153,0.15)'
                    : primary ? colors.brandGradient
                    : 'rgba(255,255,255,0.04)',
                color: copied === id ? colors.success
                    : primary ? '#fff'
                    : 'var(--vscode-editor-foreground)',
                border: copied === id ? `1px solid ${colors.success}40`
                    : primary ? 'none'
                    : `1px solid ${colors.glassBorder}`,
                fontWeight: 600, transition: 'all 0.2s',
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                boxShadow: primary && copied !== id ? '0 2px 10px rgba(6,182,212,0.25)' : 'none',
                backdropFilter: 'blur(8px)',
            }}
        >
            <Icon
                name={copied === id ? 'check' : 'copy'}
                size={12}
                color={copied === id ? colors.success : primary ? '#fff' : 'var(--vscode-editor-foreground)'}
            />
            {copied === id ? (isEN ? 'Copied!' : '已复制！') : (isEN ? 'Copy' : '复制')}
        </button>
    );

    return (
        <div className="animate-in" style={{ maxWidth: '860px', paddingBottom: '20px' }}>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <Icon name="flask" size={20} color={colors.brand} />
                    <h2 style={{
                        margin: 0, fontSize: '18px', fontWeight: 700,
                        letterSpacing: '-0.3px',
                        background: colors.brandGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        {title}
                    </h2>
                </div>
                <div style={{
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.6, paddingLeft: '30px',
                }}>
                    {desc}
                </div>
            </div>

            {/* Steps */}
            <div style={{
                ...glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    marginBottom: '12px',
                }}>
                    <Icon name="clipboard" size={15} color={colors.brand} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' }}>
                        {stepsTitle}
                    </span>
                </div>
                <div style={{ paddingLeft: '4px' }}>
                    {steps.map((step, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'baseline', gap: '10px',
                            marginBottom: '6px',
                        }}>
                            <span style={{
                                width: '20px', height: '20px',
                                borderRadius: '50%',
                                background: `${colors.brand}15`,
                                color: colors.brand,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '10px', fontWeight: 700, flexShrink: 0,
                            }}>
                                {i + 1}
                            </span>
                            <span style={{
                                fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                                lineHeight: 1.7,
                            }}>
                                {step}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Full Test Prompt */}
            <div style={{
                ...glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            }}>
                <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '12px',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <Icon name="flask" size={15} color="#E879F9" />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' }}>
                            {isEN ? 'Full Test Prompt (8 items)' : '完整测试 Prompt（8 项）'}
                        </span>
                    </div>
                    {copyBtn(testPrompt, 'full', true)}
                </div>
                <pre style={{
                    ...glass.panel,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '14px', fontSize: '11px', lineHeight: 1.6,
                    color: 'var(--vscode-descriptionForeground)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: '200px', overflow: 'auto', margin: 0,
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                }}>
                    {testPrompt}
                </pre>
            </div>

            {/* Quick Test */}
            <div style={{
                ...glass.panel,
                padding: '18px 20px',
                marginBottom: '14px',
            }}>
                <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: '12px',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <Icon name="zap" size={15} color="#FBBF24" />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' }}>
                            {isEN ? 'Quick Connectivity Test (1 line)' : '快速连通性测试（1 行）'}
                        </span>
                    </div>
                    {copyBtn(quickTest, 'quick')}
                </div>
                <pre style={{
                    ...glass.panel,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '12px', fontSize: '11px', lineHeight: 1.5,
                    color: 'var(--vscode-descriptionForeground)',
                    whiteSpace: 'pre-wrap', margin: 0,
                    fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                }}>
                    {quickTest}
                </pre>
            </div>

            {/* Diagnostics */}
            <div style={{
                ...glass.panel,
                padding: '18px 20px',
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    marginBottom: '10px',
                }}>
                    <Icon name="settings" size={15} color="#60A5FA" />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--vscode-editor-foreground)' }}>
                        {isEN ? 'One-Click Diagnostics' : '一键诊断'}
                    </span>
                </div>
                <div style={{
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    marginBottom: '14px', lineHeight: 1.6,
                }}>
                    {isEN
                        ? 'Generate a diagnostic report with your configuration, model status, and error logs. You can paste the report into a GitHub Issue for support.'
                        : '生成包含配置状态、模型连通性、错误日志的诊断报告。可直接粘贴到 GitHub Issue 获取支持。'}
                </div>
                <button
                    onClick={handleDiagnostic}
                    style={{
                        padding: '10px 24px', borderRadius: radius.pill,
                        fontSize: '12px', cursor: 'pointer',
                        background: colors.brandGradient,
                        color: '#fff', border: 'none', fontWeight: 600,
                        boxShadow: '0 4px 16px rgba(6,182,212,0.3)',
                        transition: 'all 0.2s',
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = ''}
                >
                    <Icon name="activity" size={13} color="#fff" />
                    {isEN ? 'Generate Diagnostic Report' : '生成诊断报告'}
                </button>
            </div>
        </div>
    );
};

export default TestPanel;
