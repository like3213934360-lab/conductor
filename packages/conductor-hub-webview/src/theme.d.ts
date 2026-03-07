import type React from 'react';
export declare const colors: {
    brand: string;
    brandGlow: string;
    brandGradient: string;
    brandBg: string;
    success: string;
    warning: string;
    error: string;
    link: string;
    glass: string;
    glassBorder: string;
    glassHover: string;
    glassShine: string;
    glassBlur: string;
};
export declare const radius: {
    sm: string;
    md: string;
    lg: string;
    xl: string;
    pill: string;
};
export declare const shadow: {
    glass: string;
    glassHover: string;
    glow: (color: string) => string;
    subtle: string;
};
export declare const providerColors: Record<string, string>;
export declare const glass: {
    /** 标准液态玻璃面板 */
    panel: React.CSSProperties;
    /** 液态玻璃卡片 (可悬浮) */
    card: React.CSSProperties;
    /** 液态玻璃输入框 */
    input: React.CSSProperties;
};
export declare const s: {
    card: React.CSSProperties;
    cardHover: React.CSSProperties;
    input: React.CSSProperties;
    select: React.CSSProperties;
    btnPrimary: React.CSSProperties;
    btnSecondary: React.CSSProperties;
    label: React.CSSProperties;
    hint: React.CSSProperties;
    sectionTitle: React.CSSProperties;
    /** iOS Liquid Glass 浮动胶囊 Tab */
    pillTab: (active: boolean) => React.CSSProperties;
};
//# sourceMappingURL=theme.d.ts.map