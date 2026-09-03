import Avatar from "@jetbrains/ring-ui-built/components/avatar/avatar";
import {Size} from "@jetbrains/ring-ui-built/components/avatar/avatar-size";
import Select from "@jetbrains/ring-ui-built/components/select/select";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useSemester} from "../hooks/SemesterContext";
import {useTName} from "../hooks/useCurriculumData";
import {HelpButton} from "../onboarding/HelpButton";
import singleLogo from "../assets/OfCourses_singleLogo.ico";
import duShi from "../assets/DuShi.png";

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
    const {semester, setSemester, allSemesters} = useSemester();
    const {tSemester} = useTName();
    const isDark = theme === "dark";

    const semesterOptions = allSemesters.map((s) => ({
        key: s,
        label: tSemester(s),
    }));

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
            {/* Logo + brand */}
            <button
                className="flex cursor-pointer items-center gap-2.5 border-none bg-transparent"
                onClick={() => onNavigate("home")}
            >
                <img src={singleLogo} alt="Logo" className="h-8 w-8 rounded-lg" />
                <span className={`text-base font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
                    OfCourses
                </span>
            </button>

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

            {/* Semester selector + User + Theme + Language */}
            <div className="flex items-center gap-3">
                {/* Semester dropdown */}
                {currentPage === "workspace" && (
                    <div className="flex items-center gap-2">
                        <span className={`whitespace-nowrap text-xs ${isDark ? "text-white/60" : "text-gray-500"}`}>
                            {t("nav.currentSemester")}
                        </span>
                        <div className="min-w-40" data-tour="semester">
                            <Select
                                data={semesterOptions}
                                selected={{key: semester, label: tSemester(semester)}}
                                onSelect={(option) => {
                                    if (option) setSemester(option.key as typeof semester);
                                }}
                                filter
                                popupClassName="oc-nav-select-popup"
                            />
                        </div>
                    </div>
                )}

                {/* User */}
                <div className="flex items-center gap-2">
                    <Avatar size={Size.Size28} url={duShi} />
                    <span className={`text-sm ${isDark ? "text-white/75" : "text-gray-500"}`}>
                        {t("nav.defaultUser")}
                    </span>
                </div>

                {/* Theme toggle: sun/moon */}
                <button
                    onClick={toggleTheme}
                    className={
                        `flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none text-xs transition-all duration-300 ${
                            isDark
                                ? "bg-white/10 text-yellow-400 hover:bg-white/20"
                                : "bg-[rgba(0,0,0,0.06)] text-gray-500 hover:bg-[rgba(0,0,0,0.1)]"
                        }`
                    }
                    title={isDark ? "Switch to light mode" : "Switch to dark mode"}
                >
                    {isDark ? (
                        /* Sun icon */
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5" />
                            <line x1="12" y1="1" x2="12" y2="3" />
                            <line x1="12" y1="21" x2="12" y2="23" />
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                            <line x1="1" y1="12" x2="3" y2="12" />
                            <line x1="21" y1="12" x2="23" y2="12" />
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                        </svg>
                    ) : (
                        /* Moon icon */
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                        </svg>
                    )}
                </button>

                {/* Language toggle switch */}
                    <button
                        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                        className={
                            `relative flex h-7 w-14 cursor-pointer items-center rounded-full border-none transition-colors duration-300 ${
                                isDark
                                    ? "bg-white/15"
                                    : "bg-gray-200"
                            }`
                        }
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
            </div>
        </nav>
    );
};