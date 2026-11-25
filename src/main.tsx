import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from "./App.tsx";
import {RootErrorBoundary} from "./ErrorBoundary";
import './index.css'

// 年级切换整页刷新后恢复滚动位置（AccountButton.switchCohort 写入），保持用户所在页面位置
try {
    const saved = sessionStorage.getItem("oc_scroll_restore");
    if (saved !== null) {
        sessionStorage.removeItem("oc_scroll_restore");
        requestAnimationFrame(() => window.scrollTo(0, Number(saved) || 0));
    }
} catch { /* 隐私模式等场景忽略 */ }

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <RootErrorBoundary>
            <App/>
        </RootErrorBoundary>
    </StrictMode>,
)
