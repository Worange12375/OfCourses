import type {NavPage} from "../components/Navbar";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {HelpButton} from "../onboarding/HelpButton";
import mainLogo from "../assets/OfCourses_Logo.png";

interface HomePageProps {
    onNavigate: (page: NavPage) => void;
}

export const HomePage = ({onNavigate}: HomePageProps) => {
    const {locale, setLocale, t} = useLocale();
    const {theme, toggleTheme} = useAppTheme();
    const isDark = theme === "dark";

    return (
        <div className={`relative flex flex-1 flex-col items-center justify-center overflow-hidden transition-colors duration-300 ${
            isDark ? "bg-[#0e0e14]" : "bg-gradient-to-br from-gray-50 to-gray-100"
        }`}>
            {/* Background decorative glow */}
            {isDark && (
                <>
                    <div className="absolute -top-40 h-96 w-96 rounded-full bg-[rgba(134,59,255,0.12)] blur-[120px]" />
                    <div className="absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-[rgba(71,191,255,0.08)] blur-[100px]" />
                </>
            )}

            {/* Top-right controls */}
            <div className="absolute right-6 top-4 flex items-center gap-2">
                {/* Language toggle */}
                <button
                    onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                    className={`relative flex h-7 w-14 cursor-pointer items-center rounded-full border-none transition-colors duration-300 ${
                        isDark ? "bg-white/15" : "bg-gray-200"
                    }`}
                >
                    <span className={`absolute left-[7px] text-[11px] font-medium z-10 transition-colors duration-300 ${
                        locale === "zh"
                            ? (isDark ? "text-white" : "text-gray-800")
                            : (isDark ? "text-white/40" : "text-gray-400")
                    }`}>中</span>
                    <span className={`absolute right-[7px] text-[11px] font-medium z-10 transition-colors duration-300 ${
                        locale === "en"
                            ? (isDark ? "text-white" : "text-gray-800")
                            : (isDark ? "text-white/40" : "text-gray-400")
                    }`}>EN</span>
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${
                        locale === "zh" ? "left-1" : "right-1"
                    }`} />
                </button>

                <HelpButton />

                {/* Theme toggle */}
                <button
                    onClick={toggleTheme}
                    className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none text-xs transition-colors duration-300 ${
                        isDark
                            ? "bg-white/10 text-yellow-400 hover:bg-white/20"
                            : "bg-gray-200 text-gray-500 hover:bg-gray-300"
                    }`}
                >
                    {isDark ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                    )}
                </button>
            </div>

            {/* Main content */}
            <div className="flex w-full max-w-4xl flex-col items-center gap-6 px-8">
                {/* Logo with glow frame + radial fade — full width */}
                <div className="relative w-full">
                    {/* Outer glow frame */}
                    <div className={`absolute -inset-6 rounded-[28px] blur-2xl ${
                        isDark
                            ? "bg-gradient-to-br from-[rgba(134,59,255,0.35)] via-[rgba(71,191,255,0.18)] to-[rgba(134,59,255,0.25)]"
                            : "bg-gradient-to-br from-[rgba(134,59,255,0.15)] via-[rgba(71,191,255,0.08)] to-[rgba(134,59,255,0.1)]"
                    }`} />
                    <div className={`absolute -inset-3 rounded-2xl blur-md ${
                        isDark
                            ? "bg-gradient-to-br from-[rgba(134,59,255,0.2)] via-transparent to-[rgba(71,191,255,0.12)]"
                            : "bg-gradient-to-br from-[rgba(134,59,255,0.08)] via-transparent to-[rgba(71,191,255,0.05)]"
                    }`} />
                    {/* Logo image with radial fade for white edges */}
                    <div className="relative w-full rounded-2xl">
                        {/* Stage light spotlight (dark mode only) — top-down cone */}
                        {isDark && (
                            <div
                                className="absolute inset-0 z-20 rounded-2xl pointer-events-none"
                                style={{
                                    background: "radial-gradient(ellipse 70% 25% at 50% 0%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 30%, transparent 70%)"
                                }}
                            />
                        )}
                        {/* Radial mask: blend white edges into background */}
                        <div
                            className="absolute inset-0 z-10 rounded-2xl"
                            style={{
                                background: isDark
                                    ? "transparent"
                                    : "radial-gradient(ellipse 70% 70% at center, transparent 40%, rgba(249,250,251,1) 100%)"
                            }}
                        />
                        <img
                            src={mainLogo}
                            alt="OfCourses Logo"
                            className="w-full h-auto object-contain rounded-2xl"
                        />
                    </div>
                </div>

                {/* Welcome text */}
                <div className="flex flex-col items-center gap-2">
                    <h1 className={`m-0 text-center text-4xl font-bold transition-colors duration-300 ${
                        isDark
                            ? "bg-gradient-to-r from-white via-white/95 to-white/80 bg-clip-text text-transparent"
                            : "text-gray-800"
                    }`}>
                        {t("home.welcome")}
                    </h1>
                    <p className={`m-0 text-base transition-colors duration-300 ${
                        isDark ? "text-white/50" : "text-gray-400"
                    }`}>
                        {t("home.subtitle")}
                    </p>
                </div>

                {/* Custom buttons */}
                <div className="mt-2 flex items-center gap-4">
                    {/* Curriculum 按钮 - 次级（描边） */}
                    <button
                        onClick={() => onNavigate("curriculum")}
                        className={`cursor-pointer rounded-xl border px-8 py-3 text-sm font-semibold transition-all duration-300 hover:scale-105 ${
                            isDark
                                ? "border-white/15 bg-white/5 text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/10 hover:text-white"
                                : "border-[rgba(134,59,255,0.2)] bg-[rgba(134,59,255,0.04)] text-[rgba(134,59,255,0.8)] hover:border-[rgba(134,59,255,0.35)] hover:bg-[rgba(134,59,255,0.08)] hover:text-[#863bff]"
                        }`}
                    >
                        {t("nav.curriculum")}
                    </button>

                    {/* Workspace 按钮 - 最突出（渐变紫） */}
                    <button
                        onClick={() => onNavigate("workspace")}
                        className={`cursor-pointer rounded-xl border-none bg-gradient-to-r from-[#863bff] to-[#a855f7] px-8 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-xl ${
                            isDark
                                ? "shadow-[rgba(134,59,255,0.35)] hover:shadow-[rgba(134,59,255,0.5)]"
                                : "shadow-[rgba(134,59,255,0.25)] hover:shadow-[rgba(134,59,255,0.4)]"
                        }`}
                    >
                        {t("nav.workspace")}
                    </button>

                    {/* Tools 按钮 */}
                    <button
                        onClick={() => onNavigate("tools")}
                        className={`cursor-pointer rounded-xl border px-8 py-3 text-sm font-semibold transition-all duration-300 hover:scale-105 ${
                            isDark
                                ? "border-white/15 bg-white/5 text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/10 hover:text-white"
                                : "border-[rgba(0,0,0,0.1)] bg-transparent text-gray-500 hover:border-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.03)] hover:text-gray-700"
                        }`}
                    >
                        {t("nav.tools")}
                    </button>

                    {/* About 按钮 */}
                    <button
                        onClick={() => onNavigate("about")}
                        className={`cursor-pointer rounded-xl border px-8 py-3 text-sm font-semibold transition-all duration-300 hover:scale-105 ${
                            isDark
                                ? "border-white/15 bg-white/5 text-white/80 backdrop-blur-sm hover:border-white/30 hover:bg-white/10 hover:text-white"
                                : "border-[rgba(0,0,0,0.1)] bg-transparent text-gray-500 hover:border-[rgba(0,0,0,0.2)] hover:bg-[rgba(0,0,0,0.03)] hover:text-gray-700"
                        }`}
                    >
                        {t("nav.about")}
                    </button>
                </div>
            </div>
        </div>
    );
};