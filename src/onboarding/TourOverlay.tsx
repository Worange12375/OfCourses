import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {useOnboarding} from "./OnboardingContext";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import type {TourStep} from "./types";

const CARD_MAX_WIDTH = 360;
const VIEWPORT_GUTTER = 16;
const TARGET_GAP = 16;
const FOCUS_PADDING = 8;
const MOBILE_TOP_SAFE_AREA = 56;
const MOBILE_BOTTOM_SAFE_AREA = 72;

type CardSide = "top" | "right" | "bottom" | "left" | "center";
interface CardPosition {top: number; left: number; side: CardSide; arrowOffset: number;}
interface Candidate {top: number; left: number; side: Exclude<CardSide, "center">; target: DOMRect;}

function readTargetElements(step: TourStep): Element[] {
    const selectors = step.selectors ?? (step.selector ? [step.selector] : []);
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
}

function readTargetRects(step: TourStep): DOMRect[] {
    return readTargetElements(step)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(value, Math.max(min, max)));
}

function chooseCardPosition(step: TourStep, rects: DOMRect[], cardWidth: number, cardHeight: number): CardPosition {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (step.cardPos === "center" || rects.length === 0) {
        return {
            top: clamp((viewportHeight - cardHeight) / 2, VIEWPORT_GUTTER, viewportHeight - cardHeight - VIEWPORT_GUTTER),
            left: clamp((viewportWidth - cardWidth) / 2, VIEWPORT_GUTTER, viewportWidth - cardWidth - VIEWPORT_GUTTER),
            side: "center",
            arrowOffset: 0,
        };
    }

    const bounds = rects.reduce((acc, rect) => ({
        left: Math.min(acc.left, rect.left),
        top: Math.min(acc.top, rect.top),
        right: Math.max(acc.right, rect.right),
        bottom: Math.max(acc.bottom, rect.bottom),
    }), {left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity});

    const candidates: Candidate[] = [
        {side: "bottom", target: rects[0], left: (bounds.left + bounds.right - cardWidth) / 2, top: bounds.bottom + TARGET_GAP},
        {side: "top", target: rects[0], left: (bounds.left + bounds.right - cardWidth) / 2, top: bounds.top - cardHeight - TARGET_GAP},
    ];
    rects.forEach((rect) => {
        candidates.push(
            {side: "right", target: rect, left: rect.right + TARGET_GAP, top: rect.top + rect.height / 2 - cardHeight / 2},
            {side: "left", target: rect, left: rect.left - cardWidth - TARGET_GAP, top: rect.top + rect.height / 2 - cardHeight / 2},
        );
    });

    const preferred = step.cardPos === "below-nav" ? "bottom" : undefined;
    let best: {candidate: Candidate; left: number; top: number; score: number} | null = null;
    for (const candidate of candidates) {
        const left = clamp(candidate.left, VIEWPORT_GUTTER, viewportWidth - cardWidth - VIEWPORT_GUTTER);
        const top = clamp(candidate.top, VIEWPORT_GUTTER, viewportHeight - cardHeight - VIEWPORT_GUTTER);
        let overlapArea = 0;
        let nearestDistance = Infinity;
        for (const rect of rects) {
            const targetLeft = rect.left - FOCUS_PADDING;
            const targetTop = rect.top - FOCUS_PADDING;
            const targetRight = rect.right + FOCUS_PADDING;
            const targetBottom = rect.bottom + FOCUS_PADDING;
            const overlapWidth = Math.max(0, Math.min(left + cardWidth, targetRight) - Math.max(left, targetLeft));
            const overlapHeight = Math.max(0, Math.min(top + cardHeight, targetBottom) - Math.max(top, targetTop));
            overlapArea += overlapWidth * overlapHeight;
            const dx = Math.max(0, targetLeft - (left + cardWidth), left - targetRight);
            const dy = Math.max(0, targetTop - (top + cardHeight), top - targetBottom);
            nearestDistance = Math.min(nearestDistance, Math.hypot(dx, dy));
        }
        const preferencePenalty = preferred && candidate.side !== preferred ? 32 : 0;
        const score = overlapArea * 1000 + nearestDistance + preferencePenalty;
        if (!best || score < best.score) best = {candidate, left, top, score};
    }

    const chosen = best!;
    const anchor = chosen.candidate.target;
    const arrowCenterX = chosen.candidate.side === "top" || chosen.candidate.side === "bottom"
        ? (bounds.left + bounds.right) / 2
        : anchor.left + anchor.width / 2;
    const arrowOffset = chosen.candidate.side === "top" || chosen.candidate.side === "bottom"
        ? clamp(arrowCenterX - chosen.left - 6, 18, cardWidth - 18)
        : clamp((anchor.top + anchor.height / 2) - chosen.top - 6, 18, cardHeight - 18);
    return {...chosen, side: chosen.candidate.side, arrowOffset};
}

function focusRect(rect: DOMRect) {
    const left = Math.max(0, rect.left - FOCUS_PADDING);
    const top = Math.max(0, rect.top - FOCUS_PADDING);
    const right = Math.min(window.innerWidth, rect.right + FOCUS_PADDING);
    const bottom = Math.min(window.innerHeight, rect.bottom + FOCUS_PADDING);
    return {left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top)};
}

export const TourOverlay = () => {
    const {tourActive, stepIndex, activeSteps, tourSessionId, next, prev, finish, navigateTo} = useOnboarding();
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const accent = isDark ? "#a78bfa" : "#7542d8";
    const [displayIndex, setDisplayIndex] = useState(-1);
    const [displayedSessionId, setDisplayedSessionId] = useState(-1);
    const [rects, setRects] = useState<DOMRect[]>([]);
    const [position, setPosition] = useState<CardPosition | null>(null);
    const [cardVisible, setCardVisible] = useState(false);
    const [positionMotion, setPositionMotion] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);
    const target = activeSteps[stepIndex] ?? activeSteps[0];
    const step = activeSteps[displayIndex] ?? target;
    const isLast = stepIndex === activeSteps.length - 1;
    // A new tour session can briefly inherit the last card's coordinates before
    // the layout effect runs. Keep that stale card hidden until this step has
    // been measured, so the first card cannot flash or travel from its old spot.
    const displayReady = stepIndex === displayIndex && tourSessionId === displayedSessionId;

    // Switch the page first, then measure the target in its visible layout.
    useEffect(() => {
        if (!tourActive || (stepIndex === displayIndex && tourSessionId === displayedSessionId)) return;
        setPosition(null);
        setCardVisible(false);
        setPositionMotion(false);
        target.beforeShow?.();
        if (target.targetPage) navigateTo(target.targetPage);
        const timers: number[] = [];
        const showStep = () => {
            setRects(readTargetRects(target));
            setDisplayIndex(stepIndex);
            setDisplayedSessionId(tourSessionId);
        };
        const timer = window.setTimeout(() => {
            if (window.innerWidth < 640) {
                const element = readTargetElements(target).find((candidate) => {
                    const rect = candidate.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
                const rect = element?.getBoundingClientRect();
                if (element && rect && (rect.top < 64 || rect.bottom > window.innerHeight - 96)) {
                    element.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"});
                    timers.push(window.setTimeout(showStep, 360));
                    return;
                }
            }
            showStep();
        }, target.targetPage ? 180 : 0);
        timers.push(timer);
        return () => timers.forEach(window.clearTimeout);
    }, [tourActive, stepIndex, displayIndex, target, activeSteps, tourSessionId, displayedSessionId, navigateTo]);

    // Measure and place while hidden, then reveal in place. This prevents a new card
    // from animating from the fallback top-left coordinate to its target.
    useLayoutEffect(() => {
        if (!tourActive || displayIndex < 0) return;
        const card = cardRef.current;
        if (!card) return;
        const mobileViewport = window.innerWidth < 640;
        const gutter = mobileViewport ? 12 : VIEWPORT_GUTTER;
        const width = Math.min(CARD_MAX_WIDTH, window.innerWidth - gutter * 2);
        const safeTop = mobileViewport ? MOBILE_TOP_SAFE_AREA : gutter;
        const safeBottom = mobileViewport ? MOBILE_BOTTOM_SAFE_AREA : gutter;
        const heightLimit = Math.max(160, window.innerHeight - safeTop - safeBottom - gutter);
        const height = Math.min(card.getBoundingClientRect().height, heightLimit);
        const suggestedPosition = mobileViewport && rects.length === 0
            ? {top: window.innerHeight - height - safeBottom, left: (window.innerWidth - width) / 2, side: "center" as const, arrowOffset: 0}
            : chooseCardPosition(step, rects, width, height);
        const nextPosition = {
            ...suggestedPosition,
            top: clamp(suggestedPosition.top, safeTop, window.innerHeight - height - safeBottom),
        };
        setPosition(nextPosition);
        const frame = window.requestAnimationFrame(() => {
            setPositionMotion(true);
            setCardVisible(true);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [tourActive, displayIndex, rects, step]);

    // Keep the cutout and callout near the target as the page or viewport moves.
    useEffect(() => {
        if (!tourActive || displayIndex < 0) return;
        const updateTargets = () => setRects(readTargetRects(step));
        window.addEventListener("resize", updateTargets);
        window.addEventListener("scroll", updateTargets, true);
        return () => {
            window.removeEventListener("resize", updateTargets);
            window.removeEventListener("scroll", updateTargets, true);
        };
    }, [tourActive, displayIndex, step]);

    if (!tourActive) return null;

    const mobileViewport = window.innerWidth < 640;
    const holes = rects.map(focusRect);
    const pointerThrough = holes.length > 0;
    if (mobileViewport) {
        return (
            <div className={`fixed inset-0 z-[10000] ${pointerThrough ? "pointer-events-none" : ""}`} role="dialog" aria-modal="true">
                <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                    <defs>
                        <mask id="tour-cutout-mobile">
                            <rect x="0" y="0" width="100%" height="100%" fill="white" />
                            {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={12} fill="black" />)}
                        </mask>
                    </defs>
                    <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#tour-cutout-mobile)" />
                    {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={12} fill="none" stroke={accent} strokeWidth={3} />)}
                </svg>
                <section
                    ref={cardRef}
                    className={`fixed z-[10001] overflow-y-auto rounded-2xl border p-4 shadow-2xl transition-[opacity,transform] duration-150 ease-out ${cardVisible && displayReady ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-[0.99] opacity-0"} ${pointerThrough ? "pointer-events-auto" : ""} ${
                    isDark ? "border-white/10 bg-[#1c1c28] text-white/90" : "border-gray-200 bg-white text-gray-800"
                }`}
                    style={{
                        top: position?.top ?? 16,
                        left: position?.left ?? 12,
                        width: `min(${CARD_MAX_WIDTH}px, calc(100vw - 24px))`,
                        maxHeight: Math.max(160, window.innerHeight - MOBILE_TOP_SAFE_AREA - MOBILE_BOTTOM_SAFE_AREA - 12),
                        visibility: position && displayReady ? "visible" : "hidden",
                    }}
                >
                    <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-violet-300" : "text-violet-600"}`}>
                        {locale === "zh" ? `交互引导 · ${stepIndex + 1}/${activeSteps.length}` : `Guided tour · ${stepIndex + 1}/${activeSteps.length}`}
                    </div>
                    <h2 className="mb-2 text-base font-semibold">{step.title[locale]}</h2>
                    <p className="text-sm leading-6 opacity-75">{step.body[locale]}</p>
                    {step.download && <a href={step.download.href} download={step.download.filename} className="mt-4 inline-flex rounded-lg border border-violet-400/30 px-3 py-2 text-xs font-medium text-violet-500">{step.download.label[locale]}</a>}
                    <div className={`mt-5 flex items-center gap-2 border-t pt-4 ${isDark ? "border-white/10" : "border-gray-100"}`}>
                        <button onClick={finish} className="mr-auto rounded-lg px-2 py-2 text-xs opacity-60 hover:opacity-100">{locale === "zh" ? "跳过" : "Skip"}</button>
                        {stepIndex > 0 && <button onClick={prev} className={`rounded-lg border px-3 py-2 text-xs ${isDark ? "border-white/15" : "border-gray-200"}`}>{locale === "zh" ? "上一步" : "Back"}</button>}
                        <button onClick={isLast ? finish : next} className="rounded-lg px-4 py-2 text-xs font-semibold text-white" style={{background: accent}}>{isLast ? (locale === "zh" ? "完成" : "Finish") : (locale === "zh" ? "下一步" : "Next")}</button>
                    </div>
                </section>
            </div>
        );
    }

    const side = position?.side ?? "center";
    const arrowStyle = side === "bottom"
        ? {left: position?.arrowOffset ?? "50%", top: -7}
        : side === "top"
            ? {left: position?.arrowOffset ?? "50%", bottom: -7}
            : side === "right"
                ? {left: -7, top: position?.arrowOffset ?? "50%"}
                : side === "left"
                    ? {right: -7, top: position?.arrowOffset ?? "50%"}
                    : null;
    const notchClass = side === "bottom"
        ? "rotate-45 border-l border-t"
        : side === "top"
            ? "-rotate-45 border-l border-t"
            : side === "right"
                ? "-rotate-45 border-l border-t"
                : "rotate-45 border-l border-t";

    return (
        <div className={`fixed inset-0 z-[10000] ${pointerThrough ? "pointer-events-none" : ""}`} role="dialog" aria-modal="true">
            <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
                <defs>
                    <mask id="tour-cutout">
                        <rect x="0" y="0" width="100%" height="100%" fill="white" />
                        {holes.map((hole, index) => <rect key={index} x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={12} fill="black" />)}
                    </mask>
                </defs>
                <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.58)" mask="url(#tour-cutout)" />
                {holes.map((hole, index) => (
                    <g key={index}>
                        <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={12} fill="none" stroke={accent} strokeWidth={7} strokeOpacity={0.16} />
                        <rect x={hole.left} y={hole.top} width={hole.width} height={hole.height} rx={12} fill="none" stroke={accent} strokeWidth={2.5} />
                    </g>
                ))}
            </svg>

            <div
                ref={cardRef}
                className={`absolute rounded-2xl border p-4 shadow-2xl ${pointerThrough ? "pointer-events-auto" : ""} ${
                    isDark ? "border-white/10 bg-[#1c1c28] text-white/90" : "border-gray-200 bg-white text-gray-800"
                }`}
                style={{
                    top: position?.top ?? 16,
                    left: position?.left ?? 16,
                    width: `min(${CARD_MAX_WIDTH}px, calc(100vw - ${VIEWPORT_GUTTER * 2}px))`,
                    maxHeight: `calc(100vh - ${VIEWPORT_GUTTER * 2}px)`,
                    overflowY: "auto",
                    visibility: position && displayReady ? "visible" : "hidden",
                    opacity: cardVisible && displayReady ? 1 : 0,
                    transform: cardVisible && displayReady ? "translateY(0) scale(1)" : "translateY(4px) scale(0.985)",
                    transition: positionMotion ? "top 0.14s ease, left 0.14s ease, opacity 0.16s ease, transform 0.16s ease" : "opacity 0.16s ease, transform 0.16s ease",
                }}
            >
                {arrowStyle && <span aria-hidden="true" className={`absolute h-3 w-3 ${notchClass} ${isDark ? "border-white/10 bg-[#1c1c28]" : "border-gray-200 bg-white"}`} style={arrowStyle} />}
                <div className={`mb-2 h-1 overflow-hidden rounded-full ${isDark ? "bg-white/10" : "bg-gray-100"}`}>
                    <div className="h-full rounded-full transition-[width] duration-300" style={{width: `${((stepIndex + 1) / activeSteps.length) * 100}%`, background: accent}} />
                </div>
                <div className="mb-1 text-[10px] font-medium opacity-50">{locale === "zh" ? `第 ${stepIndex + 1} 步，共 ${activeSteps.length} 步` : `Step ${stepIndex + 1} of ${activeSteps.length}`}</div>
                <h2 className="mb-2 text-sm font-semibold">{step.title[locale]}</h2>
                <p className="mb-3 text-xs leading-relaxed opacity-75">{step.body[locale]}</p>

                {step.download && (
                    <a href={step.download.href} download={step.download.filename} className={`mb-3 flex w-full items-center justify-center rounded-lg border py-2 text-xs font-medium transition-colors ${
                        isDark ? "border-violet-400/40 bg-violet-400/10 text-white hover:bg-violet-400/15" : "border-violet-500/30 bg-violet-500/5 text-violet-700 hover:bg-violet-500/10"
                    }`}>
                        {step.download.label[locale]}
                    </a>
                )}

                <div className={`flex items-center justify-between gap-2 border-t pt-3 ${isDark ? "border-white/10" : "border-gray-100"}`}>
                    <button onClick={finish} className="text-[11px] opacity-60 underline hover:opacity-100">{locale === "zh" ? "跳过" : "Skip"}</button>
                    <div className="flex items-center gap-2">
                        <button onClick={prev} disabled={stepIndex === 0} className={`rounded-lg px-2.5 py-1.5 text-xs ${stepIndex === 0 ? "opacity-30" : "opacity-70 hover:opacity-100"}`}>{locale === "zh" ? "上一步" : "Back"}</button>
                        <button onClick={isLast ? finish : next} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white" style={{background: accent}}>{isLast ? (locale === "zh" ? "完成" : "Finish") : (locale === "zh" ? "下一步" : "Next")}</button>
                    </div>
                </div>
            </div>
        </div>
    );
};
