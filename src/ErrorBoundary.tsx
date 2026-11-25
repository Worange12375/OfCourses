import {Component, type ReactNode} from "react";

interface Props {
    children: ReactNode;
}
interface State {
    hasError: boolean;
}

/**
 * 全局错误边界（兜底）：
 * 任何未被局部捕获的渲染期异常（典型：浏览器翻译插件改写 DOM 导致 React
 * "Failed to execute 'removeChild'" 崩溃）都会被拦下，显示可重载的提示页，
 * 避免 React 卸载整棵树后只剩深色背景的"黑屏"。
 */
export class RootErrorBoundary extends Component<Props, State> {
    state: State = {hasError: false};

    static getDerivedStateFromError(): State {
        return {hasError: true};
    }

    componentDidCatch(error: unknown) {
        // 留在控制台便于诊断；不弹任何打扰性 UI
        console.error("[RootErrorBoundary] render crashed:", error);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div
                    style={{
                        minHeight: "100vh",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 12,
                        fontFamily: "system-ui, -apple-system, sans-serif",
                        padding: 24,
                        textAlign: "center",
                    }}
                >
                    <p style={{margin: 0, fontSize: 16, fontWeight: 600}}>页面渲染出现异常 / Something went wrong</p>
                    <p style={{margin: 0, fontSize: 13, opacity: 0.65}}>
                        请点击下方按钮重载页面；若使用浏览器翻译插件，建议关闭后使用站内「中/EN」切换。
                        <br />
                        Please reload the page. If a browser translation extension is on, prefer the built-in 中/EN toggle.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            marginTop: 8,
                            padding: "8px 24px",
                            borderRadius: 10,
                            border: "1px solid rgba(134,59,255,0.5)",
                            background: "rgba(134,59,255,0.12)",
                            color: "#a78bfa",
                            fontSize: 14,
                            cursor: "pointer",
                        }}
                    >
                        重载 / Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
