import {useEffect, useRef, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";
import {SiteMail} from "./SiteMail";
import {AccountButton} from "../account/AccountButton";
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

/** 设置行通用结构：左图标+标签，右当前值/操作提示 */
const SettingRow = ({
  icon,
  label,
  value,
  onClick,
  isDark,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  isDark: boolean;
}) => (
  <button
    onClick={onClick}
    className={`flex w-full cursor-pointer items-center justify-between border-none px-4 py-3 text-left text-[13px] transition-colors ${
      isDark ? "bg-transparent text-white/80 hover:bg-white/5" : "bg-transparent text-gray-700 hover:bg-gray-50"
    }`}
  >
    <span className="flex items-center gap-2.5">
      <span className={isDark ? "text-white/50" : "text-gray-400"}>{icon}</span>
      {label}
    </span>
    {value !== undefined && (
      <span className={`text-xs ${isDark ? "text-white/45" : "text-gray-400"}`}>{value}</span>
    )}
  </button>
);

export const MobileTopBar = ({onNavigate}: MobileTopBarProps) => {
  const {locale, setLocale} = useLocale();
  const {theme, toggleTheme} = useAppTheme();
  const {chooseMode} = useMobileMode();
  const isDark = theme === "dark";
  const zh = locale === "zh";
  // 设置抽屉：收纳中英切换、PC/手机模式与亮暗切换；教程入口常驻顶部导航
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (settingsPanelRef.current?.contains(target) || settingsButtonRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  const iconCls = "h-4 w-4";
  const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <header
      className={`sticky top-0 z-50 shrink-0 border-b ${
        isDark
          ? "border-white/10 bg-[#121218]/92 backdrop-blur-md"
          : "border-gray-200 bg-white/92 backdrop-blur-md"
      }`}
    >
      {/* 点击抽屉外的区域关闭（透明遮罩，位于面板之下） */}
      {settingsOpen && (
        <div className="fixed inset-0 top-12 z-40" onClick={() => setSettingsOpen(false)} />
      )}
      <div className="flex h-12 items-center justify-between px-3">
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
          <SiteMail variant="mobile" />
          <AccountButton compact />
          <HelpButton />
          <button
            ref={settingsButtonRef}
            onClick={() => setSettingsOpen((v) => !v)}
            title={zh ? "设置" : "Settings"}
            aria-label={zh ? "设置" : "Settings"}
            aria-expanded={settingsOpen}
            aria-controls="mobile-settings-panel"
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border transition-all duration-300 ${
              settingsOpen
                ? isDark
                  ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
                  : "border-blue-400 bg-blue-50 text-blue-600"
                : isDark
                  ? "border-white/15 bg-white/10 text-white/80 hover:bg-white/20"
                  : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              {...strokeProps}
              className={`transition-transform duration-300 ${settingsOpen ? "rotate-90" : ""}`}
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 向下平滑拉出的设置面板（grid-rows 0fr→1fr 高度过渡 + 淡入） */}
      <div
        ref={settingsPanelRef}
        id="mobile-settings-panel"
        className={`absolute left-0 right-0 top-full z-50 grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          settingsOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`border-b shadow-lg ${
              isDark
                ? "border-white/10 bg-[#16161f]/97 backdrop-blur-md"
                : "border-gray-200 bg-white/97 backdrop-blur-md"
            }`}
          >
            <SettingRow
              isDark={isDark}
              icon={
                <svg className={iconCls} viewBox="0 0 24 24" {...strokeProps}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              }
              label={zh ? "语言 Language" : "Language 语言"}
              value={zh ? "中文" : "English"}
              onClick={() => setLocale(zh ? "en" : "zh")}
            />
            <SettingRow
              isDark={isDark}
              icon={
                <svg className={iconCls} viewBox="0 0 24 24" {...strokeProps}>
                  <rect x="2" y="4" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="22" x2="16" y2="22" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                </svg>
              }
              label={zh ? "切换 PC 版" : "Switch to PC view"}
              onClick={() => chooseMode("pc")}
            />
            <SettingRow
              isDark={isDark}
              icon={
                isDark ? (
                  <svg className={iconCls} viewBox="0 0 24 24" {...strokeProps}>
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
                  <svg className={iconCls} viewBox="0 0 24 24" {...strokeProps}>
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                )
              }
              label={zh ? "深色模式" : "Dark mode"}
              value={isDark ? (zh ? "已开启" : "On") : zh ? "已关闭" : "Off"}
              onClick={toggleTheme}
            />
          </div>
        </div>
      </div>
    </header>
  );
};
