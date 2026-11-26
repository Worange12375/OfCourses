import {useEffect, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

type VersionResponse = {version?: unknown};

export const UpdateNotice = () => {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("__oc_refresh")) return;
    url.searchParams.delete("__oc_refresh");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  useEffect(() => {
    let active = true;
    let checking = false;

    const checkVersion = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/version.json?check=" + Date.now(), {cache: "no-store"});
        if (!response.ok) return;
        const data = await response.json() as VersionResponse;
        const version = typeof data.version === "string" ? data.version : null;
        if (active) setRemoteVersion(version && version !== __APP_BUILD_ID__ ? version : null);
      } catch {
        // A temporary network failure should not block the page.
      } finally {
        checking = false;
      }
    };

    void checkVersion();
    const interval = window.setInterval(() => void checkVersion(), 60_000);
    const checkOnFocus = () => void checkVersion();
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };
    window.addEventListener("focus", checkOnFocus);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkOnFocus);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  if (!remoteVersion || dismissedVersion === remoteVersion) return null;

  const refreshToLatest = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("__oc_refresh", remoteVersion);
    window.location.assign(url.toString());
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={"fixed left-1/2 top-16 z-[90] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 rounded-2xl border p-3 shadow-xl " +
        (isDark ? "border-white/10 bg-[#1a1a22] text-white" : "border-gray-200 bg-white text-gray-800")}
    >
      <div className="flex items-start gap-3">
        <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
          (isDark ? "bg-white/8 text-white/75" : "bg-gray-100 text-gray-600")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 7v5h-5" />
            <path d="M4.9 16a8 8 0 0 0 13.6 2M4 17v-5h5" />
            <path d="M5.5 6A8 8 0 0 1 19 8" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {locale === "zh" ? "网站有新版本" : "A new version is available"}
          </div>
          <p className={"mb-0 mt-1 text-xs leading-relaxed " + (isDark ? "text-white/55" : "text-gray-500")}>
            {locale === "zh"
              ? "刷新页面即可加载最新内容。"
              : "Refresh this page to load the latest version."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissedVersion(remoteVersion)}
          aria-label={locale === "zh" ? "稍后提醒" : "Dismiss update notice"}
          title={locale === "zh" ? "稍后" : "Later"}
          className={"-mr-1 -mt-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-base " +
            (isDark ? "text-white/50 hover:bg-white/10" : "text-gray-400 hover:bg-gray-100")}
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={refreshToLatest}
          className="cursor-pointer rounded-lg border-none bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
        >
          {locale === "zh" ? "立即刷新" : "Refresh now"}
        </button>
      </div>
    </div>
  );
};