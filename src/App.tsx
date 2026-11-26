import {useCallback, useEffect, useState} from "react";
import Theme, {ThemeProvider as RingThemeProvider} from "@jetbrains/ring-ui-built/components/global/theme";
import {LocaleProvider} from "./i18n/LocaleContext";
import {AppThemeProvider, useAppTheme} from "./theme/ThemeContext";
import {SemesterProvider} from "./hooks/SemesterContext";
import {MobileModeProvider, useMobileMode} from "./hooks/useMobileMode";
import {MobilePrompt} from "./components/MobilePrompt";
import {UpdateNotice} from "./components/UpdateNotice";
import {Navbar, type NavPage} from "./components/Navbar";
import {MobileNavbar, MobileTopBar} from "./components/MobileNavbar";
import {HomePage} from "./pages/HomePage";
import {Workspace} from "./pages/Workspace";
import {CurriculumPage} from "./pages/CurriculumPage";
import {ToolsPage} from "./pages/ToolsPage";
import {AboutPage} from "./pages/AboutPage";
import {GuidePage} from "./pages/GuidePage";
import {OnboardingProvider, useOnboarding, TourOverlay, HelpPanel} from "./onboarding";
import {reportVisit} from "./utils/visitorId";
import {AccountProvider, useAccount} from "./account/AccountContext";
import {AuthModal} from "./account/AuthModal";
import {useSchemeData} from "./data/schemeStore";

const AppShell = () => {
    // 当前页面持久化（sessionStorage）：年级切换等整页刷新后仍停留在原页面（如培养方案页）
    const [page, setPageRaw] = useState<NavPage>(() => {
        try {
            if (window.location.hash.startsWith("#guide/")) return "guide";
            const saved = sessionStorage.getItem("oc_page_restore");
            return saved && ["home", "workspace", "curriculum", "tools", "about", "guide"].includes(saved) ? (saved as NavPage) : "home";
        } catch { return "home"; }
    });
    const [guideSection, setGuideSection] = useState(() => {
        const hash = window.location.hash;
        return hash.startsWith("#guide/") ? hash.slice("#guide/".length) : "getting-started";
    });
    const setPage = useCallback((p: NavPage) => {
        setPageRaw(p);
        if (p !== "guide" && window.location.hash.startsWith("#guide/")) {
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        }
        try { sessionStorage.setItem("oc_page_restore", p); } catch { /* 隐私模式忽略 */ }
    }, []);
    const navigateApp = useCallback((p: NavPage, section?: string) => {
        if (p === "guide" && section) setGuideSection(section);
        setPage(p);
    }, [setPage]);
    const {theme} = useAppTheme();
    const {registerNavigate} = useOnboarding();
    const {mobileMode, forcedMode} = useMobileMode();
    const {workspaceVersion} = useAccount();
    // 年级变化时同步培养方案数据仓库（schemeStore 单例；所有 getSchemeData() 读取点随之切换）
    useSchemeData();
    const isMobile = mobileMode === "mobile" || forcedMode === "mobile";
    const isDark = theme === "dark";

    useEffect(() => {
        registerNavigate(navigateApp);
    }, [registerNavigate, navigateApp]);

    // 站点访问统计上报：匿名标识，随页面切换计一次 PV，服务端按 vid 去重得 UV
    useEffect(() => {
        reportVisit(page, isMobile);
    }, [page, isMobile]);

    const baseBg = isDark ? "bg-[#0e0e14]" : "bg-gray-50";

    const pageWrapClass = (active: boolean) =>
        isMobile
            ? `flex flex-col h-full w-full ${active ? "" : "hidden"}`
            : `flex-1 flex-col min-h-0 ${active ? "flex" : "hidden"}`;

    return (
        <div className={`flex h-full w-full flex-col transition-colors duration-300 ${baseBg}`}>
            <UpdateNotice />
            {/* 移动端顶部简化栏（含 logo/主题/用户） */}
            {isMobile && <MobileTopBar onNavigate={setPage} />}

            {/* 桌面端导航栏；移动端 Navbar 组件内部返回 null */}
            {!isMobile && <Navbar currentPage={page} onNavigate={setPage} />}

            {/* 移动端：主内容区可滚动；PC 端：保持原来的全屏布局 */}
            <div className={`flex-1 flex flex-col min-h-0 w-full ${isMobile ? "overflow-hidden" : ""}`}>
                <div className={pageWrapClass(page === "home")}>
                    <HomePage onNavigate={setPage} mobile={isMobile} />
                </div>
                <div className={pageWrapClass(page === "workspace")}>
                    {/* key 变化 = 云端方案应用后仅重挂载工作台（读取新 localStorage），页面不跳转 */}
                    <Workspace key={workspaceVersion} onNavigate={setPage} mobile={isMobile} />
                </div>
                <div className={pageWrapClass(page === "curriculum")}>
                    <CurriculumPage mobile={isMobile} />
                </div>
                <div className={pageWrapClass(page === "tools")}>
                    <ToolsPage mobile={isMobile} />
                </div>
                <div className={pageWrapClass(page === "about")}>
                    <AboutPage mobile={isMobile} />
                </div>
                <div className={pageWrapClass(page === "guide")}>
                    <GuidePage mobile={isMobile} active={page === "guide"} initialSection={guideSection} onSectionChange={setGuideSection} />
                </div>
            </div>

            {/* 移动端底部导航栏 */}
            {isMobile && <MobileNavbar currentPage={page} onNavigate={setPage} />}

            {/* Onboarding UI (tour overlay + help panel) */}
            <TourOverlay />
            <HelpPanel />

            {/* 账号系统：登录/注册弹窗（全局唯一，由 Navbar/工作台云同步面板触发） */}
            <AuthModal />
        </div>
    );
};

const AppInner = () => {
    const {theme} = useAppTheme();
    return (
        <RingThemeProvider theme={theme === "dark" ? Theme.DARK : Theme.LIGHT} className="h-full">
            <LocaleProvider>
                {/* AccountProvider 需在 SemesterProvider 之外：学期自动判定依赖账号的年级信息 */}
                <AccountProvider>
                    <SemesterProvider>
                        <MobileModeProvider>
                            <OnboardingProvider>
                                <MobilePrompt />
                                <AppShell />
                            </OnboardingProvider>
                        </MobileModeProvider>
                    </SemesterProvider>
                </AccountProvider>
            </LocaleProvider>
        </RingThemeProvider>
    );
};

export const App = () => (
    <AppThemeProvider>
        <AppInner />
    </AppThemeProvider>
);
