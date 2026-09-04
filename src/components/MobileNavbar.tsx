import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";
import {HelpButton} from "../onboarding/HelpButton";
import {type NavPage} from "./Navbar";
import singleLogo from "../assets/OfCourses_singleLogo.ico";

interface MobileNavbarProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
}

interface MobileTopBarProps {
  onNavigate: (page: NavPage) => void;
}

const items: {page: NavPage; labelKey: string; icon: (active: boolean) => React.ReactNode}[] = [
  {
    page: "home",
    labelKey: "nav.home",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-blue-500" : ""}>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    page: "curriculum",
    labelKey: "nav.curriculum",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-blue-500" : ""}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    page: "workspace",
    labelKey: "nav.workspace",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-blue-500" : ""}>
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    page: "tools",
    labelKey: "nav.tools",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-blue-500" : ""}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    page: "about",
    labelKey: "nav.about",
    icon: (active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-blue-500" : ""}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

export const MobileNavbar = ({currentPage, onNavigate}: MobileNavbarProps) => {
  const {t} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";

  return (
    <nav
      className={`oc-mobile-bottom-nav border-t ${
        isDark
          ? "border-white/10 bg-[#121218]/95 backdrop-blur-md"
          : "border-gray-200 bg-white/95 backdrop-blur-md"
      }`}
    >
      {items.map(({page, labelKey, icon}) => {
        const active = currentPage === page;
        return (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 border-none bg-transparent py-1 transition-colors ${
              active
                ? isDark
                  ? "text-blue-300"
                  : "text-blue-600"
                : isDark
                  ? "text-white/55"
                  : "text-gray-500"
            }`}
          >
            {icon(active)}
            <span className="text-[10px] font-medium">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
};

export const MobileTopBar = ({onNavigate}: MobileTopBarProps) => {
  const {locale, setLocale} = useLocale();
  const {theme, toggleTheme} = useAppTheme();
  const {chooseMode} = useMobileMode();
  const isDark = theme === "dark";

  return (
    <header
      className={`sticky top-0 z-50 flex h-12 items-center justify-between px-3 shrink-0 border-b ${
        isDark
          ? "border-white/10 bg-[#121218]/92 backdrop-blur-md"
          : "border-gray-200 bg-white/92 backdrop-blur-md"
      }`}
    >
      <button
        className="flex items-center gap-2 border-none bg-transparent"
        onClick={() => onNavigate("home")}
      >
        <img src={singleLogo} alt="OfCourses" className="h-7 w-7 rounded-lg" />
        <span className={`text-sm font-semibold ${isDark ? "text-white/90" : "text-gray-800"}`}>
          OfCourses
        </span>
      </button>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-medium transition-colors ${
            isDark
              ? "border-white/15 bg-white/10 text-white/80 hover:bg-white/20"
              : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {locale === "zh" ? "中" : "EN"}
        </button>
        <HelpButton />
        <button
          onClick={() => chooseMode("pc")}
          title="切换到 PC 版"
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold transition-colors ${
            isDark
              ? "border-white/15 bg-white/10 text-white/80 hover:bg-white/20"
              : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          PC
        </button>
        <button
          onClick={toggleTheme}
          className={`flex h-8 w-8 items-center justify-center rounded-full border-none transition-colors ${
            isDark ? "bg-white/10 text-yellow-400" : "bg-gray-100 text-gray-600"
          }`}
        >
          {isDark ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
};
