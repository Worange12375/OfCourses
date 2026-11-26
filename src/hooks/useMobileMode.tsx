import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from "react";

export type MobileMode = "pc" | "mobile" | null;

const STORAGE_KEY = "oc_mobile_mode_v1";
const MISMATCH_DISMISSED_KEY = "oc_mode_mismatch_dismissed_device_v1";

interface MobileModeContextValue {
  /** 是否判定为移动设备（兼顾手机浏览器请求桌面站点时的触控屏幕特征） */
  isMobileDevice: boolean;
  /** 用户已选的模式；null 表示还没选过，需要弹提示 */
  mobileMode: MobileMode;
  /** URL ?mode= 强制覆盖（用于桌面预览移动端），无则 null */
  forcedMode: MobileMode;
  /** 用户选择模式并持久化 */
  chooseMode: (mode: Exclude<MobileMode, null>) => void;
  /** 关闭设备模式提示，并在当前设备类型上记为已读 */
  dismissPrompt: () => void;
  /** 是否显示模式选择弹窗 */
  showPrompt: boolean;
}

const MobileModeContext = createContext<MobileModeContextValue | undefined>(undefined);

const mobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i;

function _isMobileDevice() {
  if (typeof window === "undefined") return false;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  const ua = mobileUA.test(navigator.userAgent);
  const userAgentData = (navigator as Navigator & {userAgentData?: {mobile?: boolean; platform?: string}}).userAgentData;
  const userAgentDataMobile = userAgentData?.mobile === true || /android|ios/i.test(userAgentData?.platform ?? "");
  const ipadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  // 手机浏览器的“桌面版网站”会伪装桌面 UA 并扩大 viewport；屏幕短边和触控能力仍可识别手机。
  const shortScreenSide = Math.min(window.screen.width || window.innerWidth, window.screen.height || window.innerHeight);
  const narrowTouchViewport = touch && window.innerWidth <= 768;
  const compactTouchScreen = touch && shortScreenSide <= 600;
  return userAgentDataMobile || ipadDesktopMode || ua || narrowTouchViewport || compactTouchScreen;
}

function _readDismissedDevice(): "pc" | "mobile" | null {
  try {
    const raw = localStorage.getItem(MISMATCH_DISMISSED_KEY);
    return raw === "pc" || raw === "mobile" ? raw : null;
  } catch {
    return null;
  }
}

function _shouldShowMismatchPrompt(deviceIsMobile: boolean, mode: MobileMode, forced: MobileMode) {
  if (forced) return false;
  const device = deviceIsMobile ? "mobile" : "pc";
  const displayed = mode ?? "pc";
  return displayed !== device && _readDismissedDevice() !== device;
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
  const initialShowPrompt = _shouldShowMismatchPrompt(initialDevice, initialMode, initialForced);

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
    setShowPrompt(_shouldShowMismatchPrompt(device, effective, forced));

    const onResize = () => {
      const nextDevice = _isMobileDevice();
      const forcedModeNow = _readForcedMode();
      setIsMobileDevice(nextDevice);
      setShowPrompt(_shouldShowMismatchPrompt(nextDevice, forcedModeNow ?? _readStored(), forcedModeNow));
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
    try {
      localStorage.setItem(MISMATCH_DISMISSED_KEY, _isMobileDevice() ? "mobile" : "pc");
    } catch {
      // ignore
    }
    setShowPrompt(false);
  }, []);

  const dismissPrompt = useCallback(() => {
    try {
      localStorage.setItem(MISMATCH_DISMISSED_KEY, _isMobileDevice() ? "mobile" : "pc");
    } catch {
      // ignore
    }
    setShowPrompt(false);
  }, []);
  const value = useMemo(
    () => ({isMobileDevice, mobileMode, forcedMode, chooseMode, dismissPrompt, showPrompt}),
    [isMobileDevice, mobileMode, forcedMode, chooseMode, dismissPrompt, showPrompt]
  );

  return <MobileModeContext.Provider value={value}>{children}</MobileModeContext.Provider>;
};

export const useMobileMode = () => {
  const ctx = useContext(MobileModeContext);
  if (!ctx) throw new Error("useMobileMode must be used within MobileModeProvider");
  return ctx;
};
