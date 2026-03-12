import type React from 'react';

// ─── iOS Liquid Glass Design System ───────────────────────────────────────────

export const colors = {
    brand: '#06b6d4',               // Cyan — 主品牌色
    brandGlow: '#22d3ee',           // 品牌发光色
    brandGradient: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
    brandBg: 'rgba(6,182,212,0.06)',
    success: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    link: '#60A5FA',
    // 液态玻璃色系
    glass: 'rgba(255,255,255,0.04)',
    glassBorder: 'rgba(255,255,255,0.08)',
    glassHover: 'rgba(255,255,255,0.07)',
    glassShine: 'rgba(255,255,255,0.06)',
    glassBlur: 'blur(40px) saturate(180%)',
};

export const radius = {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    pill: '9999px',
};

export const shadow = {
    glass: '0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)',
    glassHover: '0 12px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
    glow: (color: string) => `0 0 20px ${color}40, 0 0 60px ${color}20`,
    subtle: '0 2px 8px rgba(0,0,0,0.08)',
};

// Model-family 品牌色 (iOS 风格配色)
export const modelFamilyColors: Record<string, string> = {
    'DeepSeek': '#4A90D9',
    'GLM (智谱)': '#8B5CF6',
    'Qwen (通义)': '#F97316',
    'MiniMax': '#EC4899',
    'Kimi K2': '#14B8A6',
    'OpenAI': '#10A37F',
    'Anthropic (Claude)': '#D97706',
    'Google (Gemini)': '#4285F4',
    'Mistral': '#FF6F00',
    'cli': '#38BDF8',
    'codex': '#10A37F',
    'gemini': '#4285F4',
    'deepseek': '#4A90D9',
};

// ─── Liquid Glass Shared Styles ───────────────────────────────────────────────

export const glass = {
    /** 标准液态玻璃面板 */
    panel: {
        background: colors.glass,
        backdropFilter: colors.glassBlur,
        WebkitBackdropFilter: colors.glassBlur,
        border: `1px solid ${colors.glassBorder}`,
        borderRadius: radius.lg,
        boxShadow: shadow.glass,
    } as React.CSSProperties,

    /** 液态玻璃卡片 (可悬浮) */
    card: {
        background: colors.glass,
        backdropFilter: colors.glassBlur,
        WebkitBackdropFilter: colors.glassBlur,
        border: `1px solid ${colors.glassBorder}`,
        borderRadius: radius.lg,
        boxShadow: shadow.glass,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        cursor: 'default',
    } as React.CSSProperties,

    /** 液态玻璃输入框 */
    input: {
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        border: `1px solid ${colors.glassBorder}`,
        borderRadius: radius.md,
        color: 'var(--vscode-input-foreground)',
        fontSize: '13px',
        padding: '10px 14px',
        outline: 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        width: '100%',
        boxSizing: 'border-box' as const,
    } as React.CSSProperties,
};

export const s = {
    card: glass.card,

    cardHover: {
        background: colors.glassHover,
        borderColor: 'rgba(255,255,255,0.12)',
        boxShadow: shadow.glassHover,
        transform: 'translateY(-2px)',
    } as React.CSSProperties,

    input: glass.input,

    select: {
        ...glass.input,
    } as React.CSSProperties,

    btnPrimary: {
        padding: '10px 22px',
        background: colors.brandGradient,
        color: '#fff',
        border: 'none',
        borderRadius: radius.pill,
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '600' as const,
        boxShadow: `0 4px 16px rgba(6,182,212,0.3)`,
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        backdropFilter: 'blur(8px)',
    } as React.CSSProperties,

    btnSecondary: {
        padding: '9px 18px',
        background: colors.glass,
        color: 'var(--vscode-editor-foreground)',
        border: `1px solid ${colors.glassBorder}`,
        borderRadius: radius.pill,
        cursor: 'pointer',
        fontSize: '13px',
        backdropFilter: 'blur(12px)',
        transition: 'all 0.2s',
    } as React.CSSProperties,

    label: {
        display: 'block',
        marginBottom: '6px',
        fontSize: '12px',
        fontWeight: '500' as const,
        color: 'var(--vscode-editor-foreground)',
        letterSpacing: '0.01em',
    } as React.CSSProperties,

    hint: {
        margin: '4px 0 0',
        fontSize: '11px',
        color: 'var(--vscode-descriptionForeground)',
        opacity: 0.7,
    } as React.CSSProperties,

    sectionTitle: {
        margin: '0 0 4px',
        fontSize: '15px',
        fontWeight: '600' as const,
        letterSpacing: '-0.2px',
    } as React.CSSProperties,

    /** iOS Liquid Glass 浮动胶囊 Tab */
    pillTab: (active: boolean): React.CSSProperties => ({
        padding: '8px 20px',
        borderRadius: radius.pill,
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: active ? '600' : '400',
        background: active
            ? colors.brandGradient
            : 'rgba(255,255,255,0.03)',
        color: active ? '#fff' : 'var(--vscode-descriptionForeground)',
        border: active
            ? 'none'
            : `1px solid rgba(255,255,255,0.06)`,
        boxShadow: active
            ? `0 4px 16px rgba(6,182,212,0.3), inset 0 1px 0 rgba(255,255,255,0.15)`
            : 'none',
        backdropFilter: active ? 'none' : 'blur(12px)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        userSelect: 'none' as const,
        letterSpacing: '-0.01em',
    }),
};
