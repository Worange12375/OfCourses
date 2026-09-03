import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type {NavPage} from "../components/Navbar";
import {TOUR_STEPS} from "./tourSteps";

const ONBOARDED_KEY = "oc_onboarded_v1";

/** 是否已有真实使用数据（老用户保护）：oc_history / oc_custom 非空即视为用过 */
function hasExistingData(): boolean {
    try {
        const h = JSON.parse(localStorage.getItem("oc_history") ?? "{}");
        const c = JSON.parse(localStorage.getItem("oc_custom") ?? "{}");
        const hOk = h && typeof h === "object" && Object.keys(h).length > 0;
        const cOk = c && typeof c === "object" && Object.keys(c).length > 0;
        return hOk || cOk;
    } catch {
        return false;
    }
}

interface OnboardingContextValue {
    tourActive: boolean;
    stepIndex: number;
    helpOpen: boolean;
    startTour: () => void;
    openHelp: () => void;
    closeHelp: () => void;
    next: () => void;
    prev: () => void;
    finish: () => void;
    /** 由 AppShell 注册页面导航函数，供跨页高亮使用 */
    registerNavigate: (fn: (p: NavPage) => void) => void;
    /** 主动切页（教程步骤调用） */
    navigateTo: (page: NavPage) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export const OnboardingProvider = ({children}: {children: ReactNode}) => {
    const [helpOpen, setHelpOpen] = useState(false);
    const [tourActive, setTourActive] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const navigateRef = useRef<((p: NavPage) => void) | null>(null);

    // 新用户判定：仅依赖浏览器缓存（无账号/无云端）
    useEffect(() => {
        const done = localStorage.getItem(ONBOARDED_KEY);
        if (done) return; // 已看过，永不打扰
        if (hasExistingData()) {
            // 引导功能上线前已用过本站的老用户：标记为已看，避免被打扰
            localStorage.setItem(ONBOARDED_KEY, "done");
            return;
        }
        // 真正的新用户：首次访问自动播放
        setTourActive(true);
        setStepIndex(0);
    }, []);

    const registerNavigate = useCallback((fn: (p: NavPage) => void) => {
        navigateRef.current = fn;
    }, []);

    const navigateTo = useCallback((page: NavPage) => {
        navigateRef.current?.(page);
    }, []);

    const startTour = useCallback(() => {
        setStepIndex(0);
        setHelpOpen(false);
        setTourActive(true);
    }, []);

    const openHelp = useCallback(() => setHelpOpen(true), []);
    const closeHelp = useCallback(() => setHelpOpen(false), []);

    const finish = useCallback(() => {
        setTourActive(false);
        localStorage.setItem(ONBOARDED_KEY, "done");
    }, []);

    const next = useCallback(() => {
        setStepIndex((i) => {
            if (i >= TOUR_STEPS.length - 1) {
                finish();
                return i;
            }
            return i + 1;
        });
    }, [finish]);

    const prev = useCallback(() => {
        setStepIndex((i) => Math.max(0, i - 1));
    }, []);

    return (
        <OnboardingContext.Provider
            value={{
                tourActive,
                stepIndex,
                helpOpen,
                startTour,
                openHelp,
                closeHelp,
                next,
                prev,
                finish,
                registerNavigate,
                navigateTo,
            }}
        >
            {children}
        </OnboardingContext.Provider>
    );
};

export const useOnboarding = (): OnboardingContextValue => {
    const ctx = useContext(OnboardingContext);
    if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
    return ctx;
};
