/**
 * AI 档位显示名称（全站统一）：
 * 后端 /vote/ai/quota 端点下发 display 字段（管理页「模型配置」可改），
 * 前端缓存到 localStorage，端点不可用时用缓存或内置默认兜底。
 * 英文界面：显示名仍为中文默认值时回退英文默认（Standard / Pro）；
 * 管理页自定义了名称则原样展示（不做翻译）。
 */

export interface AiDisplayNames {
  flash: string;
  strong: string;
}

const CACHE_KEY = "oc_ai_display";

export const AI_DISPLAY_DEFAULTS: AiDisplayNames = {
  flash: "标准模型",
  strong: "强模型",
};

export function saveAiDisplay(d: Partial<AiDisplayNames> | null | undefined): void {
  if (!d || (!d.flash && !d.strong)) return;
  try {
    const merged = { ...getAiDisplay(), ...d };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ flash: merged.flash, strong: merged.strong }));
  } catch {
    /* ignore */
  }
}

export function getAiDisplay(): AiDisplayNames {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        flash: typeof o.flash === "string" && o.flash ? o.flash : AI_DISPLAY_DEFAULTS.flash,
        strong: typeof o.strong === "string" && o.strong ? o.strong : AI_DISPLAY_DEFAULTS.strong,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...AI_DISPLAY_DEFAULTS };
}

/** 档位展示名：zh 直接用（自定义名原样展示）；en 在未自定义时回退英文默认 */
export function tierLabel(tier: "flash" | "strong", zh: boolean): string {
  const name = getAiDisplay()[tier];
  if (!zh) {
    if (name === AI_DISPLAY_DEFAULTS.flash) return "Standard";
    if (name === AI_DISPLAY_DEFAULTS.strong) return "Pro";
  }
  return name;
}
