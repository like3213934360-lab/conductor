import React from 'react';
import { vscode } from '../vscode-api';
import { colors, radius, s, glass } from '../theme';
import { Lang } from './Dashboard';
import Icon from './Icon';

const RoutingGuidePanel: React.FC<{ lang: Lang }> = ({ lang }) => {
    const T = {
        en: {
            title: 'Default Routing Recommendations',
            desc: 'Antigravity Workflow routes different task types to specific models by default based on benchmarking and cost-effectiveness. You can freely change these in the Models tab.',
            colTask: 'Task / Feature',
            colModel: 'Recommended Model',
            colReason: 'Reason for Recommendation',
            data: [
                { icon: 'terminal', task: 'Code Generation', model: 'GPT/Codex 5.3', reason: 'Terminal-Bench #1; Codex CLI directly modifies local workspace.' },
                { icon: 'brain', task: 'Agentic Coding', model: 'MiniMax-M2.5 Coding', reason: 'SWE-bench 80.2% ≈ Claude Opus 4.6; BFCL Tool Calling 76.8% surpasses Opus.' },
                { icon: 'git-branch', task: 'Multi-step / Chains', model: 'GLM-5 Coding Plan', reason: 'SWE-bench 77.8% (top-tier); Outstanding long context planning.' },
                { icon: 'dollar-sign', task: 'Economical Code', model: 'DeepSeek-V3', reason: 'Unbeatable cost-effectiveness, lightning fast.' },
                { icon: 'file-text', task: 'Translation / Docs', model: 'Qwen-Max', reason: 'Superior Chinese localization; Tau2-bench #1 for tool calls.' },
                { icon: 'pen-tool', task: 'UI / Frontend', model: 'Gemini 3.1 Pro', reason: 'ARC-AGI-2 Global #1 (77.1%); Unmatched frontend design.' },
                { icon: 'crosshair', task: 'Math / Logic', model: 'Gemini 3.1 Pro', reason: 'GPQA 94.3%; Competitive Programming Elo 2887.' },
                { icon: 'layers', task: 'Long Context Summaries', model: 'Gemini 3.1 Pro', reason: '1M+ token context window.' },
                { icon: 'terminal', task: 'Terminal / DevOps', model: 'GPT-5.3 Codex', reason: 'Terminal-Bench #1.' },
                { icon: 'zap', task: 'Creative / Mass Gen', model: 'MiniMax-M2.5 HighSpeed', reason: '100+ tokens/sec, high-speed output.' },
                { icon: 'tool', task: 'Local File Operations', model: 'Codex CLI (ai_codex_task)', reason: 'OAuth Login (No Key Needed); Autonomous workspace manipulation.' },
                { icon: 'compass', task: 'Local Agentic', model: 'Gemini CLI (ai_gemini_task)', reason: 'Google OAuth (No Key Needed); Built-in file & browser agents.' },
            ]
        },
        zh: {
            title: '默认路由推荐表',
            desc: '为了最大化性能并节约使用成本，Antigravity Workflow 默认采用以下模型推荐。这只是初始指导字典，您可以在「模型管理」中自由为任何模型分配任务。',
            colTask: '使用场景 / 任务属性',
            colModel: '推荐绑定模型',
            colReason: '核心竞争力入选理由',
            data: [
                { icon: 'terminal', task: '代码生成', model: 'GPT/Codex 5.3', reason: 'Terminal-Bench #1；自带 Codex CLI 能够直接读写操作本地代码' },
                { icon: 'brain', task: 'Agentic 复杂编码', model: 'MiniMax-M2.5 Coding', reason: 'SWE-bench 80.2% ≈ Claude Opus 4.6；BFCL 工具调用 76.8% 全球第二' },
                { icon: 'git-branch', task: '多步调试 / 工具链', model: 'GLM-5 Coding Plan', reason: 'SWE-bench 77.8%，顶级梯队；长程任务规划能力极强' },
                { icon: 'dollar-sign', task: '代码经济型', model: 'DeepSeek-V3', reason: '无敌的性价比与极快的首字输出' },
                { icon: 'file-text', task: '翻译 / 中文环境与文档', model: 'Qwen-Max', reason: '中文母语级；工具调用 Tau2-bench 称霸' },
                { icon: 'pen-tool', task: 'UI / 前端视觉设计', model: 'Gemini 3.1 Pro', reason: 'ARC-AGI-2 全球 #1（77.1%）；美学品位独步天下' },
                { icon: 'crosshair', task: '极强推理 / 算法 / 数学', model: 'Gemini 3.1 Pro', reason: 'GPQA 94.3%；竞技编程水平超神（Elo 2887）' },
                { icon: 'layers', task: '超长文本 / 源码库总结', model: 'Gemini 3.1 Pro', reason: '稳定扛起百万 Token 级别的上下文洪流' },
                { icon: 'terminal', task: '终端命令 / DevOps', model: 'GPT-5.3 Codex', reason: 'Terminal-Bench 霸榜选手' },
                { icon: 'zap', task: '极速生成 / 闲聊 / 脑暴', model: 'MiniMax-M2.5 HighSpeed', reason: '100 tok/s，流式体验拉满' },
                { icon: 'tool', task: '独立安全本地文件操作', model: 'Codex CLI (ai_codex_task)', reason: '直接走 OAuth 免 Key 嫖；以隔离全功能独立 Agent 形态干脏活' },
                { icon: 'compass', task: '系统级深度本地爬虫', model: 'Gemini CLI (ai_gemini_task)', reason: '走 Google OAuth 订阅额度；原厂自带视效浏览器控制系统' },
            ]
        }
    }[lang];

    return (
        <div className="animate-in" style={{ maxWidth: '860px', paddingBottom: '20px' }}>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <Icon name="compass" size={20} color={colors.brand} />
                    <h2 style={{
                        margin: 0, fontSize: '18px', fontWeight: 700,
                        letterSpacing: '-0.3px',
                        background: colors.brandGradient,
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                    }}>
                        {T.title}
                    </h2>
                </div>
                <div style={{
                    fontSize: '12px', color: 'var(--vscode-descriptionForeground)',
                    lineHeight: 1.6, paddingLeft: '30px',
                }}>
                    {T.desc}
                </div>
            </div>

            {/* Table */}
            <div style={{
                ...glass.panel,
                overflow: 'hidden',
                padding: 0,
            }}>
                <table style={{
                    width: '100%', borderCollapse: 'collapse',
                    textAlign: 'left', fontSize: '12.5px',
                }}>
                    <thead>
                        <tr style={{
                            background: 'rgba(6,182,212,0.04)',
                            borderBottom: `1px solid ${colors.glassBorder}`,
                        }}>
                            <th style={{
                                padding: '14px 16px', fontWeight: 600,
                                color: 'var(--vscode-editor-foreground)',
                                fontSize: '11px', textTransform: 'uppercase' as const,
                                letterSpacing: '0.05em',
                            }}>
                                {T.colTask}
                            </th>
                            <th style={{
                                padding: '14px 16px', fontWeight: 600,
                                color: 'var(--vscode-editor-foreground)',
                                fontSize: '11px', textTransform: 'uppercase' as const,
                                letterSpacing: '0.05em',
                            }}>
                                {T.colModel}
                            </th>
                            <th style={{
                                padding: '14px 16px', fontWeight: 600,
                                color: 'var(--vscode-descriptionForeground)',
                                fontSize: '11px', textTransform: 'uppercase' as const,
                                letterSpacing: '0.05em',
                            }}>
                                {T.colReason}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {T.data.map((row, i) => (
                            <tr key={i} style={{
                                borderBottom: i === T.data.length - 1 ? 'none' : `1px solid rgba(255,255,255,0.03)`,
                                transition: 'background 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(6,182,212,0.03)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <td style={{
                                    padding: '13px 16px',
                                    color: 'var(--vscode-editor-foreground)',
                                    fontWeight: 500, whiteSpace: 'nowrap',
                                }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                        <Icon name={row.icon} size={14} color={colors.brand} />
                                        {row.task}
                                    </span>
                                </td>
                                <td style={{
                                    padding: '13px 16px', fontWeight: 600,
                                    color: colors.brand,
                                    whiteSpace: 'nowrap',
                                    fontFamily: "'SF Mono', monospace",
                                    fontSize: '12px',
                                }}>
                                    {row.model}
                                </td>
                                <td style={{
                                    padding: '13px 16px',
                                    color: 'var(--vscode-descriptionForeground)',
                                    lineHeight: 1.5, fontSize: '12px',
                                }}>
                                    {row.reason}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RoutingGuidePanel;
