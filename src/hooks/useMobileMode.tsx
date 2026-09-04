import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from "react";

export type MobileMode = "pc" | "mobile" | null;

const STORAGE_KEY = "oc_mobile_mode_v1";

interface MobileModeContextValue {
  /** 是否判定为移动设备（UA 含 phone/tablet 或屏宽 <= 768px） */
  isMobileDevice: boolean;
  /** 用户已选的模式；null 表示还没选过，需要弹提示 */
  mobileMode: MobileMode;
  /** URL ?mode= 强制覆盖（用于桌面预览移动端），无则 null */
  forcedMode: MobileMode;
  /** 用户选择模式并持久化 */
  chooseMode: (mode: Exclude<MobileMode, null>) => void;
  /** 是否显示模式选择弹窗 */
  showPrompt: boolean;
}

const MobileModeContext = createContext<MobileModeContextValue | undefined>(undefined);

const mobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;

function _isMobileDevice() {
  if (typeof window === "undefined") return false;
  const narrow = window.innerWidth <= 768 || window.screen.width <= 768;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const ua = mobileUA.test(navigator.userAgent);
  return (narrow && touch) || ua;
}

function _readStored(): MobileMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "pc" || raw === "mobile") return raw;
  } catch {
    // ignore
  }
  return null;
}

function _readForcedMode(): MobileMode {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("mode");
  return param === "mobile" || param === "pc" ? param : null;
}

export const MobileModeProvider = ({children}: {children: ReactNode}) => {
  // 初始状态直接从 URL / UA / localStorage 计算，避免首屏闪出桌面布局
  const initialForced = _readForcedMode();
  const initialDevice = typeof window !== "undefined" ? _isMobileDevice() : false;
  const initialStored = typeof window !== "undefined" ? _readStored() : null;
  const initialMode = initialForced ?? initialStored;
  const initialShowPrompt = initialDevice && initialStored === null && !initialForced;

  const [isMobileDevice, setIsMobileDevice] = useState(initialDevice);
  const [mobileMode, setMobileMode] = useState<MobileMode>(initialMode);
  const [forcedMode, setForcedMode] = useState<MobileMode>(initialForced);
  const [showPrompt, setShowPrompt] = useState(initialShowPrompt);

  useEffect(() => {
    const device = _isMobileDevice();
    setIsMobileDevice(device);
    const stored = _readStored();
    const forced = _readForcedMode();
    setForcedMode(forced);
    const effective = forced ?? stored;
    setMobileMode(effective);
    setShowPrompt(device && stored === null && !forced);

    const onResize = () => {
      setIsMobileDevice(_isMobileDevice());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 根据当前模式给 <html> 挂类：mobile 解除最小视口；pc 保留 PC 宽度
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.classList.toggle("oc-mobile", mobileMode === "mobile");
    html.classList.toggle("oc-pc", mobileMode === "pc");
    return () => {
      html.classList.remove("oc-mobile");
      html.classList.remove("oc-pc");
    };
  }, [mobileMode]);

  const chooseMode = useCallback((mode: Exclude<MobileMode, null>) => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }
    setMobileMode(mode);
    setShowPrompt(false);
  }, []);

  const value = useMemo(
    () => ({isMobileDevice, mobileMode, forcedMode, chooseMode, showPrompt}),
    [isMobileDevice, mobileMode, forcedMode, chooseMode, showPrompt]
  );

  return <MobileModeContext.Provider value={value}>{children}</MobileModeContext.Provider>;
};

export const useMobileMode = () => {
  const ctx = useContext(MobileModeContext);
  if (!ctx) throw new Error("useMobileMode must be used within MobileModeProvider");
  return ctx;
};
