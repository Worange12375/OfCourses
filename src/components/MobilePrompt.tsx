import {useMobileMode} from "../hooks/useMobileMode";

export const MobilePrompt = () => {
  const {showPrompt, chooseMode} = useMobileMode();

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-[#16161f]">
        <div className="mb-4 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        </div>
        <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          本网站建议在 PC 端使用
        </h2>
        <p className="mb-6 text-sm text-gray-500 dark:text-white/60">
          为获得最佳体验，推荐使用电脑浏览器访问。你也可以选择当前设备的显示方式。
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => chooseMode("pc")}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            使用 PC 模式
          </button>
          <button
            type="button"
            onClick={() => chooseMode("mobile")}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-transparent dark:text-white/80 dark:hover:bg-white/5"
          >
            使用移动端模式
          </button>
        </div>
        <p className="mt-4 text-xs text-gray-400 dark:text-white/40">
          选择后会记住你的偏好，可随时在右上角菜单切换。
        </p>
      </div>
    </div>
  );
};
