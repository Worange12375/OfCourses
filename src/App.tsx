import {useEffect, useState} from "react";
import Theme, {ThemeProvider as RingThemeProvider} from "@jetbrains/ring-ui-built/components/global/theme";
import {LocaleProvider} from "./i18n/LocaleContext";
import {AppThemeProvider, useAppTheme} from "./theme/ThemeContext";
import {SemesterProvider} from "./hooks/SemesterContext";
import {Navbar, type NavPage} from "./components/Navbar";
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
    const isDark = theme === "dark";

    useEffect(() => {
        registerNavigate(setPage);
    }, [registerNavigate, setPage]);

    const baseBg = isDark ? "bg-[#0e0e14]" : "bg-gray-50";

    return (
        <div className={`flex h-full flex-col transition-colors duration-300 ${baseBg}`}>
            {/* All pages always mounted — only active one visible, preserving state */}
            <div className={`flex-1 flex-col min-h-0 ${page === "home" ? "flex" : "hidden"}`}>
                <HomePage onNavigate={setPage} />
            </div>
            <div className={`flex-1 flex-col min-h-0 ${page === "workspace" ? "flex" : "hidden"}`}>
                <Workspace onNavigate={setPage} />
            </div>
            <div className={`flex-1 flex-col min-h-0 overflow-hidden ${page === "curriculum" ? "flex" : "hidden"}`}>
                <div className={`flex h-full flex-col transition-colors duration-300 ${baseBg}`}>
                    <Navbar currentPage="curriculum" onNavigate={setPage} />
                    <CurriculumPage />
                </div>
            </div>
            <div className={`flex-1 flex-col min-h-0 overflow-hidden ${page === "tools" ? "flex" : "hidden"}`}>
                <div className={`flex h-full flex-col transition-colors duration-300 ${baseBg}`}>
                    <Navbar currentPage="tools" onNavigate={setPage} />
                    <ToolsPage />
                </div>
            </div>
            <div className={`flex-1 flex-col min-h-0 overflow-hidden ${page === "about" ? "flex" : "hidden"}`}>
                <div className={`flex h-full flex-col transition-colors duration-300 ${baseBg}`}>
                    <Navbar currentPage="about" onNavigate={setPage} />
                    <AboutPage />
                </div>
            </div>

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
                    <OnboardingProvider>
                        <AppShell />
                    </OnboardingProvider>
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
