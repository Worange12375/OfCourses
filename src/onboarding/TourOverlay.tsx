import {useEffect, useState} from "react";
import {useOnboarding} from "./OnboardingContext";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {TOUR_STEPS} from "./tourSteps";

const CARD_W = 340;
const PAD = 12;
const NAV_H = 56; // 顶部导航栏高度（h-14 = 56px）

export const TourOverlay = () => {
    const {tourActive, stepIndex, next, prev, finish, navigateTo} = useOnboarding();
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";

    // displayIndex 门控：文字与位置在同一帧翻转，避免“先改文字、后移位置”的间隔
    const [displayIndex, setDisplayIndex] = useState(-1);
    const [rects, setRects] = useState<(DOMRect | null)[] | null>(null);

    const target = TOUR_STEPS[stepIndex];

    useEffect(() => {
        if (!tourActive) return;
        if (stepIndex === displayIndex) return; // 当前步已显示，无需重测
        // 跨页高亮：先把目标页切到可见，再等布局完成后测量
        if (target.targetPage) navigateTo(target.targetPage);
        const measure = () => {
            const sels = target.selectors ?? (target.selector ? [target.selector] : []);
            const measured = sels.map((s) => {
                const el = document.querySelector(s);
                return el ? el.getBoundingClientRect() : null;
            });
            setRects(sels.length ? measured : null);
            setDisplayIndex(stepIndex); // 文字 + 位置同时翻转
        };
        const timer = window.setTimeout(measure, target.targetPage ? 130 : 30);
        return () => window.clearTimeout(timer);
    }, [tourActive, stepIndex, displayIndex, target, navigateTo]);

    if (!tourActive) return null;

    const step = TOUR_STEPS[displayIndex] ?? target;
    const isLast = stepIndex === TOUR_STEPS.length - 1;

    // 计算提示卡片位置
    let top: number;
    let left: number;
    if (step.cardPos === "center") {
        top = window.innerHeight / 2 - 110;
        left = window.innerWidth / 2 - CARD_W / 2;
    } else if (step.cardPos === "below-nav") {
        top = NAV_H + 16;
        left = window.innerWidth / 2 - CARD_W / 2;
    } else if (rects && rects.length && rects[0]) {
        const r = rects[0];
        const fitsBelow = r.bottom + 12 + 190 < window.innerHeight;
        top = fitsBelow ? r.bottom + 12 : Math.max(PAD, r.top - 12 - 190);
        left = Math.min(Math.max(r.left, PAD), window.innerWidth - CARD_W - PAD);
    } else {
        top = window.innerHeight / 2 - 110;
        left = window.innerWidth / 2 - CARD_W / 2;
    }

    const accent = isDark ? "#7c5cff" : "#863bff";

    return (
        <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true">
            {/* 单层遮罩 + 多个透明挖孔：被圈出的位置完全不加滤镜、全亮度清晰可见；
                点击不跳过，避免误关，跳过走显式按钮 */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                    <mask id="tour-cutout">
                        {/* 白 = 显示遮罩（压暗），黑 = 挖空（露出目标） */}
                        <rect x="0" y="0" width="100%" height="100%" fill="white" />
                        {rects?.map((r, i) =>
                            r ? (
                                <rect
                                    key={i}
                                    x={r.left - 8}
                                    y={r.top - 8}
                                    width={r.width + 16}
                                    height={r.height + 16}
                                    rx={12}
                                    fill="black"
                                />
                            ) : null,
                        )}
                    </mask>
                </defs>
                <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tour-cutout)" />
                {rects?.map((r, i) =>
                    r ? (
                        <rect
                            key={i}
                            x={r.left - 8}
                            y={r.top - 8}
                            width={r.width + 16}
                            height={r.height + 16}
                            rx={12}
                            fill="none"
                            stroke={accent}
                            strokeWidth={2}
                        />
                    ) : null,
                )}
            </svg>

            {/* 提示卡片 */}
            <div
                className={`absolute rounded-xl border p-4 shadow-2xl ${
                    isDark ? "border-white/10 bg-[#1c1c28] text-white/90" : "border-gray-200 bg-white text-gray-800"
                }`}
                style={{
                    top,
                    left,
                    width: CARD_W,
                    transition: "top 0.25s ease, left 0.25s ease",
                }}
            >
                <div className="mb-1 text-sm font-semibold">{step.title[locale]}</div>
                <div className="mb-3 text-xs leading-relaxed opacity-80">{step.body[locale]}</div>

                {step.download && (
                    <a
                        href={step.download.href}
                        download={step.download.filename}
                        className={`mb-3 flex w-full items-center justify-center rounded-lg border py-2 text-xs font-medium transition-all ${
                            isDark
                                ? "border-[#7c5cff]/50 bg-[#7c5cff]/10 text-white hover:bg-[#7c5cff]/20"
                                : "border-[#863bff]/40 bg-[#863bff]/10 text-[#863bff] hover:bg-[#863bff]/20"
                        }`}
                    >
                        {step.download.label[locale]}
                    </a>
                )}

                <div className="flex items-center justify-between">
                    <span className="text-[10px] opacity-50">
                        {stepIndex + 1} / {TOUR_STEPS.length}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={finish}
                            className="text-[11px] opacity-60 underline hover:opacity-100"
                        >
                            {locale === "zh" ? "我已知晓用法，跳过教程" : "Skip tutorial"}
                        </button>
                        <button
                            onClick={prev}
                            disabled={stepIndex === 0}
                            className={`rounded px-2 py-1 text-xs ${stepIndex === 0 ? "opacity-30" : "opacity-80 hover:opacity-100"}`}
                        >
                            {locale === "zh" ? "上一步" : "Back"}
                        </button>
                        <button
                            onClick={next}
                            className="rounded px-3 py-1 text-xs font-medium text-white"
                            style={{background: accent}}
                        >
                            {isLast ? (locale === "zh" ? "完成" : "Done") : locale === "zh" ? "下一步" : "Next"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
