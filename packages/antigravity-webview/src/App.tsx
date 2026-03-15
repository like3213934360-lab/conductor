import React from 'react';
import Dashboard from './components/Dashboard';

// ── Error Boundary — 防止子组件崩溃导致白屏 ──────────────────────────────────
class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error?: Error }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[Antigravity Dashboard] Unhandled render error:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    padding: '40px', textAlign: 'center',
                    color: 'var(--vscode-errorForeground, #f87171)',
                    fontFamily: 'var(--vscode-font-family, system-ui)',
                }}>
                    <h2 style={{ margin: '0 0 12px', fontSize: '18px' }}>⚠️ Dashboard 渲染崩溃</h2>
                    <pre style={{
                        fontSize: '12px', whiteSpace: 'pre-wrap', textAlign: 'left',
                        background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '8px',
                        maxHeight: '200px', overflow: 'auto',
                    }}>
                        {this.state.error?.message}
                        {'\n'}
                        {this.state.error?.stack}
                    </pre>
                    <button
                        onClick={() => this.setState({ hasError: false, error: undefined })}
                        style={{
                            marginTop: '16px', padding: '8px 20px', cursor: 'pointer',
                            background: 'rgba(6,182,212,0.15)', color: '#22d3ee',
                            border: '1px solid rgba(6,182,212,0.3)', borderRadius: '20px',
                        }}
                    >
                        重试
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const App: React.FC = () => {
    return (
        <ErrorBoundary>
            <Dashboard />
        </ErrorBoundary>
    );
};

export default App;
