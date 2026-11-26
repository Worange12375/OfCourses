import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useMobileMode} from "../hooks/useMobileMode";

export const MobilePrompt = () => {
  const {showPrompt, isMobileDevice, mobileMode, forcedMode, chooseMode, dismissPrompt} = useMobileMode();
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const recommendedMode = isMobileDevice ? "mobile" : "pc";
  const currentMode = forcedMode ?? mobileMode ?? "pc";

  if (!showPrompt) return null;

  const title = locale === "zh"
    ? (isMobileDevice ? "要切换到移动端布局吗？" : "要切换到电脑端布局吗？")
    : (isMobileDevice ? "Switch to the mobile layout?" : "Switch to the desktop layout?");
  const description = locale === "zh"
    ? (isMobileDevice
      ? "检测到你正在使用手机或平板浏览器，但页面目前按电脑布局显示。移动端布局针对触屏和窄屏做了调整。"
      : "检测到你正在使用电脑，但页面目前按移动端布局显示。电脑端布局会更充分利用屏幕空间。")
    : (isMobileDevice
      ? "This looks like a phone or tablet, while the page is using the desktop layout. The mobile layout is tuned for touch and smaller screens."
      : "This looks like a computer, while the page is using the mobile layout. The desktop layout makes better use of your screen.");
  const recommendedLabel = locale === "zh"
    ? (recommendedMode === "mobile" ? "切换到移动端" : "切换到电脑端")
    : (recommendedMode === "mobile" ? "Use mobile layout" : "Use desktop layout");
  const currentLabel = locale === "zh"
    ? "继续使用" + (currentMode === "mobile" ? "移动端" : "电脑端") + "布局"
    : "Keep the " + (currentMode === "mobile" ? "mobile" : "desktop") + " layout";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-mode-title"
        aria-describedby="device-mode-description"
        className={"relative max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl border p-5 shadow-2xl " +
          (isDark ? "border-white/10 bg-[#1a1a22] text-white" : "border-gray-200 bg-white text-gray-800")}
      >
        <button
          type="button"
          onClick={dismissPrompt}
          aria-label={locale === "zh" ? "关闭提示" : "Close suggestion"}
          title={locale === "zh" ? "暂不切换" : "Keep current layout"}
          className={"absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none transition-colors " +
            (isDark ? "bg-white/5 text-white/65 hover:bg-white/10" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="m18 6-12 12M6 6l12 12" />
          </svg>
        </button>

        <div className={"mb-4 flex h-11 w-11 items-center justify-center rounded-xl " +
          (isDark ? "bg-white/8 text-white/75" : "bg-gray-100 text-gray-600")}>
          {isMobileDevice ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="6" y="2" width="12" height="20" rx="2" />
              <path d="M11 18h2" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
          )}
        </div>

        <h2 id="device-mode-title" className="mb-2 pr-9 text-lg font-semibold">
          {title}
        </h2>
        <p id="device-mode-description" className={"mb-5 text-sm leading-relaxed " + (isDark ? "text-white/60" : "text-gray-600")}>
          {description}
        </p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => chooseMode(recommendedMode)}
            className={"w-full cursor-pointer rounded-xl border-none px-4 py-3 text-sm font-semibold transition-colors " +
              (isDark ? "bg-blue-500 text-white hover:bg-blue-400" : "bg-blue-600 text-white hover:bg-blue-700")}
          >
            {recommendedLabel}
          </button>
          <button
            type="button"
            onClick={() => chooseMode(currentMode)}
            className={"w-full cursor-pointer rounded-xl border px-4 py-3 text-sm font-medium transition-colors " +
              (isDark ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100")}
          >
            {currentLabel}
          </button>
        </div>
        <p className={"mb-0 mt-4 text-xs leading-relaxed " + (isDark ? "text-white/40" : "text-gray-400")}>
          {locale === "zh"
            ? "此设备类型下不会重复显示这条提示；你之后仍可在导航栏更改页面模式。"
            : "This suggestion will not repeat for this device type. You can change the layout later from the navigation bar."}
        </p>
      </section>
    </div>
  );
};