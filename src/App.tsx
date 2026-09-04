import {useEffect, useState} from "react";
import Theme, {ThemeProvider as RingThemeProvider} from "@jetbrains/ring-ui-built/components/global/theme";
import {LocaleProvider} from "./i18n/LocaleContext";
import {AppThemeProvider, useAppTheme} from "./theme/ThemeContext";
import {SemesterProvider} from "./hooks/SemesterContext";
import {MobileModeProvider, useMobileMode} from "./hooks/useMobileMode";
import {MobilePrompt} from "./components/MobilePrompt";
import {Navbar, type NavPage} from "./components/Navbar";
import {MobileNavbar, MobileTopBar} from "./components/MobileNavbar";
import {HomePage} from "./pages/HomePage";
import {Workspace} from "./pages/Workspace";
import {CurriculumPage} from "./pages/CurriculumPage";
import {ToolsPage} from "./pages/ToolsPage";
import {AboutPage} from "./pages/AboutPage";
import {OnboardingProvider, useOnboarding, TourOverlay, HelpPanel} from "./onboarding";

const AppShell = () => {
    const [page, setPage] = useState<NavPage>("home");
    const {theme} = useAppTheme();
    const {registerNavigate} = useOnboarding();
    const {mobileMode, forcedMode} = useMobileMode();
    const isMobile = mobileMode === "mobile" || forcedMode === "mobile";
    const isDark = theme === "dark";

    useEffect(() => {
        registerNavigate(setPage);
    }, [registerNavigate, setPage]);

    const baseBg = isDark ? "bg-[#0e0e14]" : "bg-gray-50";

    const pageWrapClass = (active: boolean) =>
        isMobile
            ? `flex flex-col h-full w-full ${active ? "" : "hidden"}`
            : `flex-1 flex-col min-h-0 ${active ? "flex" : "hidden"}`;

    return (
        <div className={`flex h-full w-full flex-col transition-colors duration-300 ${baseBg}`}>
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
                    <Workspace onNavigate={setPage} mobile={isMobile} />
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
            </div>

            {/* 移动端底部导航栏 */}
            {isMobile && <MobileNavbar currentPage={page} onNavigate={setPage} />}

            {/* Onboarding UI (tour overlay + help panel) */}
            <TourOverlay />
            <HelpPanel />
        </div>
    );
};

const AppInner = () => {
    const {theme} = useAppTheme();
    return (
        <RingThemeProvider theme={theme === "dark" ? Theme.DARK : Theme.LIGHT} className="h-full">
            <LocaleProvider>
                <SemesterProvider>
                    <MobileModeProvider>
                        <OnboardingProvider>
                            <MobilePrompt />
                            <AppShell />
                        </OnboardingProvider>
                    </MobileModeProvider>
                </SemesterProvider>
            </LocaleProvider>
        </RingThemeProvider>
    );
};

export const App = () => (
    <AppThemeProvider>
        <AppInner />
    </AppThemeProvider>
);
