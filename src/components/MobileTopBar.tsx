import {useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";
import {HelpButton} from "../onboarding/HelpButton";
import singleLogo from "../assets/OfCourses_singleLogo.ico";
import type {NavPage} from "./Navbar";

interface MobileTopBarProps {
    currentPage: NavPage;
}

const pageTitles: Record<NavPage, string> = {
    home: "nav.home",
    curriculum: "nav.curriculum",
    workspace: "nav.workspace",
    tools: "nav.tools",
    about: "nav.about",
};

export const MobileTopBar = ({currentPage}: MobileTopBarProps) => {
    const {t, locale, setLocale} = useLocale();
    const {theme, toggleTheme} = useAppTheme();
    const {mobileMode, chooseMode, forcedMode} = useMobileMode();
    const [menuOpen, setMenuOpen] = useState(false);
    const isDark = theme === "dark";

    return (
        <>
            <header
                className={`sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 transition-colors duration-300 ${
                    isDark
                        ? "border-white/10 bg-[#121218]/95 text-white"
                        : "border-gray-200 bg-white/95 text-gray-800"
                }`}
                style={{backdropFilter: "blur(12px)"}}
            >
                <div className="flex items-center gap-2">
                    <img src={singleLogo} alt="Logo" className="h-7 w-7 rounded-lg" />
                    <span className="text-base font-semibold">{t(pageTitles[currentPage])}</span>
                </div>
                <div className="flex items-center gap-2">
                    <HelpButton />
                    <button
                        onClick={() => setMenuOpen(true)}
                        className={`flex h-8 w-8 items-center justify-center rounded-full border-none transition-colors ${
                            isDark ? "bg-white/10 text-white" : "bg-gray-100 text-gray-700"
                        }`}
                        aria-label="设置"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                </div>
            </header>

            {menuOpen && (
                <div
                    className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setMenuOpen(false);
                    }}
                >
                    <div
                        className={`w-full rounded-t-2xl px-4 pb-[env(safe-area-inset-bottom)] pt-4 transition-colors ${
                            isDark ? "bg-[#1a1a22] text-white" : "bg-white text-gray-800"
                        }`}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <span className="text-lg font-semibold">{t("mobile.settings")}</span>
                            <button
                                onClick={() => setMenuOpen(false)}
                                className={`flex h-8 w-8 items-center justify-center rounded-full border-none ${
                                    isDark ? "bg-white/10 text-white" : "bg-gray-100 text-gray-700"
                                }`}
                            >
                                ✕
                            </button>
                        </div>

                        <div className="space-y-3">
                            {/* Theme */}
                            <button
                                onClick={() => toggleTheme()}
                                className={`flex w-full items-center justify-between rounded-xl border-none px-4 py-3 text-left transition-colors ${
                                    isDark ? "bg-white/5 text-white" : "bg-gray-50 text-gray-800"
                                }`}
                            >
                                <span>{t("mobile.theme")}</span>
                                <span className={isDark ? "text-yellow-400" : "text-gray-500"}>
                                    {isDark ? "🌙 " + t("mobile.dark") : "☀️ " + t("mobile.light")}
                                </span>
                            </button>

                            {/* Language */}
                            <button
                                onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                                className={`flex w-full items-center justify-between rounded-xl border-none px-4 py-3 text-left transition-colors ${
                                    isDark ? "bg-white/5 text-white" : "bg-gray-50 text-gray-800"
                                }`}
                            >
                                <span>{t("mobile.language")}</span>
                                <span>{locale === "zh" ? "中文" : "English"}</span>
                            </button>

                            {/* Mode switch (only when not forced by URL) */}
                            {!forcedMode && (
                                <button
                                    onClick={() => {
                                        chooseMode(mobileMode === "mobile" ? "pc" : "mobile");
                                        setMenuOpen(false);
                                    }}
                                    className={`flex w-full items-center justify-between rounded-xl border-none px-4 py-3 text-left transition-colors ${
                                        isDark ? "bg-white/5 text-white" : "bg-gray-50 text-gray-800"
                                    }`}
                                >
                                    <span>{t("mobile.viewMode")}</span>
                                    <span>{mobileMode === "mobile" ? "PC" : "手机"}</span>
                                </button>
                            )}
                        </div>

                        <div className="mt-4 h-2" />
                    </div>
                </div>
            )}
        </>
    );
};
