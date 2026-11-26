import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";
import {HelpButton} from "../onboarding/HelpButton";
import {SiteMail} from "./SiteMail";
import {AccountButton} from "../account/AccountButton";
import singleLogo from "../assets/OfCourses_singleLogo.ico";

export type NavPage = "home" | "curriculum" | "workspace" | "tools" | "about";

interface NavbarProps {
    currentPage: NavPage;
    onNavigate: (page: NavPage) => void;
}

const navLinks: {page: NavPage; labelKey: string; tour?: string}[] = [
    {page: "home", labelKey: "nav.home"},
    {page: "curriculum", labelKey: "nav.curriculum", tour: "nav-curriculum"},
    {page: "workspace", labelKey: "nav.workspace"},
    {page: "tools", labelKey: "nav.tools", tour: "nav-tools"},
    {page: "about", labelKey: "nav.about"},
];

export const Navbar = ({currentPage, onNavigate}: NavbarProps) => {
    const {locale, setLocale, t} = useLocale();
    const {theme, toggleTheme} = useAppTheme();
    const {isMobileDevice, mobileMode, forcedMode, chooseMode} = useMobileMode();
    const isDark = theme === "dark";

    // 移动端由 MobileTopBar + MobileNavbar 接管，桌面 Navbar 不渲染
    if (mobileMode === "mobile") return null;

    return (
        <nav
            className={
                `sticky top-0 z-50 shrink-0 flex h-14 items-center justify-between px-5 transition-colors duration-300 ${
                    isDark
                        ? "border-b border-[rgba(255,255,255,0.06)] bg-[rgba(18,18,24,0.92)] text-white"
                        : "border-b border-[rgba(0,0,0,0.08)] bg-white/95 text-gray-800 shadow-sm"
                }`
            }
        >
            {/* Logo + brand + site mail */}
            <div className="flex items-center gap-3">
                <button
                    className="flex cursor-pointer items-center gap-2.5 border-none bg-transparent"
                    onClick={() => onNavigate("home")}
                >
                    <img src={singleLogo} alt="Logo" className="h-8 w-8 rounded-lg" />
                    <span className={`text-base font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                        OfCourses
                    </span>
                </button>
                <SiteMail />
            </div>

            {/* Nav links */}
            <div className="flex items-center gap-1">
                {navLinks.map(({page, labelKey, tour}) => (
                    <button
                        key={page}
                        data-tour={tour}
                        onClick={() => onNavigate(page)}
                        className={
                            `cursor-pointer rounded-lg border-none px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
                                currentPage === page
                                    ? isDark
                                        ? "bg-white/10 text-white"
                                        : "bg-[rgba(134,59,255,0.1)] text-[#863bff]"
                                    : isDark
                                        ? "bg-transparent text-white/60 hover:bg-white/5 hover:text-white/85"
                                        : "bg-transparent text-gray-500 hover:bg-[rgba(0,0,0,0.04)] hover:text-gray-700"
                            }`
                        }
                    >
                        {t(labelKey)}
                    </button>
                ))}
            </div>

            {/* Account + Theme + Language（当前学期已自动化，显示位置移至工作台课程目录栏标题右侧） */}
            <div className="flex items-center gap-3">

                {/* Account（登录/注册 或 用户菜单） */}
                <div className="flex items-center gap-2">
                    <AccountButton />
                </div>

                {/* Theme switch: the thumb shows the currently active mode. */}
                <button
                    type="button"
                    role="switch"
                    aria-checked={isDark}
                    onClick={toggleTheme}
                    className={"relative flex h-8 w-[62px] cursor-pointer items-center justify-between overflow-hidden rounded-full border px-1 transition-colors duration-300 " +
                        (isDark ? "border-indigo-700 bg-indigo-950" : "border-amber-200 bg-amber-50")}
                    title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                    aria-label={isDark ? "Dark mode is on. Switch to light mode" : "Light mode is on. Switch to dark mode"}
                >
                    <svg className={"relative z-0 h-3.5 w-3.5 " + (isDark ? "text-amber-200/45" : "text-amber-500")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="4" />
                        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                    </svg>
                    <svg className={"relative z-0 h-3.5 w-3.5 " + (isDark ? "text-indigo-200" : "text-indigo-400/50")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />
                    </svg>
                    <span className={"absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full shadow-sm transition-transform duration-300 " +
                        (isDark ? "translate-x-[30px] bg-indigo-600 text-indigo-50" : "translate-x-0 bg-white text-amber-500")}>
                        {isDark ? (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />
                            </svg>
                        ) : (
                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="4" />
                                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                            </svg>
                        )}
                    </span>
                </button>

                {/* Language uses a two-segment selector, visually distinct from the theme switch. */}
                <div
                    role="group"
                    aria-label={locale === "zh" ? "语言" : "Language"}
                    className={"flex h-8 w-[68px] items-center rounded-full border p-0.5 " +
                        (isDark ? "border-white/15 bg-white/10" : "border-gray-200 bg-gray-100")}
                >
                    <button
                        type="button"
                        aria-pressed={locale === "zh"}
                        onClick={() => setLocale("zh")}
                        className={"flex h-full flex-1 cursor-pointer items-center justify-center rounded-full border-none text-[11px] font-medium transition-colors " +
                            (locale === "zh"
                                ? "bg-white text-gray-900 shadow-sm"
                                : isDark ? "bg-transparent text-white/60 hover:text-white/85" : "bg-transparent text-gray-500 hover:text-gray-800")}
                    >中</button>
                    <button
                        type="button"
                        aria-pressed={locale === "en"}
                        onClick={() => setLocale("en")}
                        className={"flex h-full flex-1 cursor-pointer items-center justify-center rounded-full border-none text-[11px] font-medium transition-colors " +
                            (locale === "en"
                                ? "bg-white text-gray-900 shadow-sm"
                                : isDark ? "bg-transparent text-white/60 hover:text-white/85" : "bg-transparent text-gray-500 hover:text-gray-800")}
                    >EN</button>
                </div>
                    {(isMobileDevice || forcedMode) && (
                        <button
                            onClick={() => chooseMode("mobile")}
                            className={
                                `flex h-7 cursor-pointer items-center rounded-full border-none px-2 text-xs transition-colors duration-300 ${
                                    isDark
                                        ? "bg-white/15 text-white/80 hover:bg-white/25"
                                        : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                }`
                            }
                            title={locale === "zh" ? "切换到移动端模式" : "Switch to mobile view"}
                        >
                            {locale === "zh" ? "手机" : "Mobile"}
                        </button>
                    )}
                    <HelpButton />
            </div>
        </nav>
    );
};