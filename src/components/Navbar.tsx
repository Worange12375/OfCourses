import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";
import {HelpButton} from "../onboarding/HelpButton";
import {SiteMail} from "./SiteMail";
import {AccountButton} from "../account/AccountButton";
import singleLogo from "../assets/OfCourses_singleLogo.ico";

export type NavPage = "home" | "curriculum" | "workspace" | "tools" | "about" | "guide";

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

                {/* Theme is a labeled toggle: the icon and text both show the active appearance. */}
                <button
                    type="button"
                    aria-pressed={isDark}
                    onClick={toggleTheme}
                    className={"flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors " +
                        (isDark ? "border-white/10 bg-white/5 text-white/75 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100")}
                    title={isDark
                        ? (locale === "zh" ? "当前为深色模式，点击切换为浅色模式" : "Dark mode is on. Click for light mode")
                        : (locale === "zh" ? "当前为浅色模式，点击切换为深色模式" : "Light mode is on. Click for dark mode")}
                >
                    {isDark ? (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z" />
                        </svg>
                    ) : (
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="4" />
                            <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
                        </svg>
                    )}
                    <span>{locale === "zh" ? (isDark ? "深色" : "浅色") : (isDark ? "Dark" : "Light")}</span>
                </button>

                {/* One language pill with one hit area; clicking either label switches the language. */}
                <button
                    type="button"
                    aria-pressed={locale === "en"}
                    aria-label={locale === "zh" ? "当前语言：中文。点击切换为 English" : "Current language: English. Click to switch to 中文"}
                    onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                    className={"relative flex h-8 w-[72px] cursor-pointer items-center overflow-hidden rounded-full border p-0.5 transition-colors " +
                        (isDark ? "border-white/10 bg-white/10" : "border-gray-200 bg-gray-100")}
                >
                    <span className={"absolute inset-y-0 left-0 z-10 flex w-1/2 items-center justify-center text-[11px] font-medium transition-colors " +
                        (locale === "zh" ? "text-gray-900" : isDark ? "text-white/55" : "text-gray-500")}>中</span>
                    <span className={"absolute inset-y-0 right-0 z-10 flex w-1/2 items-center justify-center text-[11px] font-medium transition-colors " +
                        (locale === "en" ? "text-gray-900" : isDark ? "text-white/55" : "text-gray-500")}>EN</span>
                    <span className={"absolute left-0.5 top-0.5 h-7 w-[34px] rounded-full bg-white shadow-sm transition-transform duration-200 " +
                        (locale === "zh" ? "translate-x-0" : "translate-x-[34px]")} />
                </button>
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
