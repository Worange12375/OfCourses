import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

interface Props {
  title?: string;
  description?: string;
  pageContext?: boolean;
  onStart: () => void;
  onOpenWiki: () => void;
  globalActions?: {onStart: () => void; onOpenWiki: () => void};
  onClose: () => void;
}

/** One tutorial hub shared by the navigation entry and every page context. */
export function TutorialEntryModal({title, description, pageContext = false, onStart, onOpenWiki, globalActions, onClose}: Props) {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const zh = locale === "zh";
  const isDark = theme === "dark";
  const panel = isDark ? "border-white/10 bg-[#1c1c28] text-white/90" : "border-gray-200 bg-white text-gray-800";
  const muted = isDark ? "text-white/55" : "text-gray-500";
  const card = isDark ? "border-white/10 bg-white/[0.035] hover:bg-white/[0.07]" : "border-gray-200 bg-gray-50 hover:bg-gray-100";

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <section className={`relative w-full max-w-xl rounded-2xl border p-5 shadow-2xl sm:p-6 ${panel}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={zh ? "关闭" : "Close"} onClick={onClose} className={`absolute right-4 top-4 rounded-full px-2 py-1 text-sm ${muted} hover:bg-black/5 dark:hover:bg-white/10`}>×</button>
        <div className="mb-1 pr-8 text-lg font-semibold">{title ?? (zh ? "从这里开始" : "Start here")}</div>
        <p className={`mb-5 text-sm leading-relaxed ${muted}`}>
          {description ?? (zh ? "可以跟着页面逐步操作，也可以按主题查阅完整使用指南。" : "Follow a guided walkthrough, or browse the full guide by topic.")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onStart} className={`group rounded-xl border p-4 text-left transition-colors ${card}`}>
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-lg text-violet-500" aria-hidden="true">↗</span>
            <span className="block text-sm font-semibold">{pageContext ? (zh ? "本页快速上手 · 简略版" : "Quick start · this page") : (zh ? "全站快速上手 · 简略版" : "Quick start · full site")}</span>
            <span className={`mt-1 block text-xs leading-relaxed ${muted}`}>{pageContext ? (zh ? "跟随少量提示，先掌握当前页面最常用的区域和操作。" : "Follow a few prompts to learn the most-used areas and actions on this page.") : (zh ? "从工作台开始，用几步了解网站的主要功能。" : "Start at Workspace and learn the main features in a few steps.")}</span>
            <span className="mt-4 block text-xs font-semibold text-violet-500">{zh ? "开始快速引导 →" : "Start quick guide →"}</span>
          </button>
          <button type="button" onClick={onOpenWiki} className={`group rounded-xl border p-4 text-left transition-colors ${card}`}>
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-lg text-sky-500" aria-hidden="true">≡</span>
            <span className="block text-sm font-semibold">{pageContext ? (zh ? "本页详细教程 · 图文版" : "Detailed guide · this page") : (zh ? "完整详细教程 · 图文 Wiki" : "Detailed guide · full Wiki")}</span>
            <span className={`mt-1 block text-xs leading-relaxed ${muted}`}>{pageContext ? (zh ? "查看完整步骤、界面截图和使用注意事项。" : "Read the full steps, screenshots, and practical notes.") : (zh ? "按功能查找完整步骤、界面截图和常见问题。" : "Browse full instructions, screenshots, and common questions by feature.")}</span>
            <span className="mt-4 block text-xs font-semibold text-sky-500">{zh ? "阅读详细教程 →" : "Read detailed guide →"}</span>
          </button>
        </div>
        {globalActions && (
          <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4 ${isDark ? "border-white/10" : "border-gray-100"}`}>
            <span className={`text-xs ${muted}`}>{zh ? "需要了解整个网站？" : "Looking for the whole site?"}</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={globalActions.onStart} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isDark ? "border-white/10 text-white/70 hover:bg-white/10" : "border-gray-200 text-gray-600 hover:bg-gray-100"}`}>
                {zh ? "全站快速上手" : "Full site quick start"}
              </button>
              <button type="button" onClick={globalActions.onOpenWiki} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isDark ? "border-white/10 text-white/70 hover:bg-white/10" : "border-gray-200 text-gray-600 hover:bg-gray-100"}`}>
                {zh ? "完整详细教程" : "Full detailed guide"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
