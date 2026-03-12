import React from 'react';

/**
 * iOS / SF Symbols style inline SVG icons (Lucide-based).
 * Shared across all Antigravity Workflow panels.
 */
const Icon: React.FC<{ name: string; size?: number; color?: string }> = ({ name, size = 16, color = 'currentColor' }) => {
    const p = {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: color, strokeWidth: 1.8,
        strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    };
    switch (name) {
        // General
        case 'monitor': return <svg {...p}><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>;
        case 'zap': return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
        case 'activity': return <svg {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>;
        case 'gem': return <svg {...p}><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M2 9h20"/><path d="M12 22L6 9"/><path d="M12 22l6-13"/></svg>;
        case 'signal': return <svg {...p}><path d="M2 20h.01"/><path d="M7 20v-4"/><path d="M12 20v-8"/><path d="M17 20V8"/><path d="M22 20V4"/></svg>;
        case 'check-circle': return <svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
        case 'x-circle': return <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>;
        case 'help-circle': return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
        case 'cpu': return <svg {...p}><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>;
        case 'refresh': return <svg {...p}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
        case 'plus': return <svg {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
        case 'bar-chart': return <svg {...p}><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
        case 'key': return <svg {...p}><circle cx="7.5" cy="14.5" r="3.5"/><path d="M11 14.5h10"/><path d="M18 14.5v3"/><path d="M15 14.5v2"/></svg>;

        // History page
        case 'clock': return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
        case 'search': return <svg {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
        case 'send': return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
        case 'inbox': return <svg {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
        case 'download': return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
        case 'upload': return <svg {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
        case 'trash': return <svg {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
        case 'clipboard': return <svg {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>;

        // Routing / Guide page
        case 'compass': return <svg {...p}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>;
        case 'git-branch': return <svg {...p}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
        case 'target': return <svg {...p}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;

        // Skill / AI Scheduling page
        case 'layers': return <svg {...p}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>;
        case 'shield': return <svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
        case 'dollar-sign': return <svg {...p}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
        case 'tool': return <svg {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
        case 'crosshair': return <svg {...p}><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>;
        case 'pen-tool': return <svg {...p}><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>;
        case 'brain': return <svg {...p}><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5V5a2.5 2.5 0 0 1 2.5-2.5A2.5 2.5 0 0 1 17 5a2.5 2.5 0 0 1-.5 1.5A2.5 2.5 0 0 1 19 9a2.5 2.5 0 0 1-1 2 2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-2 1.2 2.5 2.5 0 0 1-4 .3 2.5 2.5 0 0 1-4-.3A2.5 2.5 0 0 1 6 16a2.5 2.5 0 0 1 0-5A2.5 2.5 0 0 1 5 9a2.5 2.5 0 0 1 2.5-2.5A2.5 2.5 0 0 1 7 5a2.5 2.5 0 0 1 2.5-3z"/><path d="M12 5v17"/></svg>;

        // Test / Diagnostics page
        case 'flask': return <svg {...p}><path d="M9 3h6"/><path d="M10 3v7.4a2 2 0 0 1-.6 1.4L4 17.2A2 2 0 0 0 3 19v0a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v0a2 2 0 0 0-1-1.7l-5.4-5.5a2 2 0 0 1-.6-1.4V3"/></svg>;
        case 'copy': return <svg {...p}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
        case 'check': return <svg {...p}><polyline points="20 6 9 17 4 12"/></svg>;
        case 'terminal': return <svg {...p}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
        case 'file-text': return <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
        case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

        // Navigation / overview
        case 'grid': return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
        case 'radio': return <svg {...p}><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49"/><line x1="12" y1="12" x2="12" y2="12.01"/></svg>;
        case 'table': return <svg {...p}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>;
        case 'workflow': return <svg {...p}><circle cx="5" cy="12" r="2.5"/><circle cx="12" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="19" cy="12" r="2.5"/><line x1="7.5" y1="11" x2="9.5" y2="6.5"/><line x1="7.5" y1="13" x2="9.5" y2="17.5"/><line x1="14.5" y1="6.5" x2="16.5" y2="11"/><line x1="14.5" y1="17.5" x2="16.5" y2="13"/></svg>;
        case 'arrow-right': return <svg {...p}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;

        default: return null;
    }
};

export default Icon;
