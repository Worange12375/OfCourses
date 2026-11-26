import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

interface Props {
  title?: string;
  description?: string;
  onStart: () => void;
  onOpenWiki: () => void;
  onClose: () => void;
}

/** Shared choice screen for the global tutorial hub and feature-specific tutorials. */
export function TutorialEntryModal({title, description, onStart, onOpenWiki, onClose}: Props) {
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
            <span className="block text-sm font-semibold">{zh ? "交互引导" : "Guided walkthrough"}</span>
            <span className={`mt-1 block text-xs leading-relaxed ${muted}`}>{zh ? "跟随提示认识主要页面和操作。" : "Explore the main pages and actions with step-by-step prompts."}</span>
            <span className="mt-4 block text-xs font-semibold text-violet-500">{zh ? "开始引导 →" : "Start walkthrough →"}</span>
          </button>
          <button type="button" onClick={onOpenWiki} className={`group rounded-xl border p-4 text-left transition-colors ${card}`}>
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-lg text-sky-500" aria-hidden="true">≡</span>
            <span className="block text-sm font-semibold">{zh ? "使用指南 Wiki" : "User guide Wiki"}</span>
            <span className={`mt-1 block text-xs leading-relaxed ${muted}`}>{zh ? "按功能查找说明、操作步骤和常见问题。" : "Look up feature explanations, steps, and common questions."}</span>
            <span className="mt-4 block text-xs font-semibold text-sky-500">{zh ? "打开使用指南 →" : "Open the guide →"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
