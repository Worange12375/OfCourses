import {useOnboarding} from "./OnboardingContext";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

const HELP_ITEMS = [
    {
        key: "import",
        title: {zh: "导入历史", en: "Import history"},
        body: {
            zh: "点击工作台左上「导入」载入选课历史。",
            en: "Use “Import” (top-left of workspace) to load a history JSON, or add records manually.",
        },
    },
    {
        key: "plan",
        title: {zh: "规划下学期", en: "Plan next semester"},
        body: {
            zh: "在课程目录点击「+」加入预选，点击保存以记录选课数据。",
            en: "Click courses in the catalog to plan; conflicts and credits are checked automatically.",
        },
    },
    {
        key: "recommend",
        title: {zh: "智能推荐", en: "Smart recommendation"},
        body: {
            zh: "开启「推荐」开关时课程目录会智能排序。",
            en: "Toggle “Recommend” to sort by history; the blue bar hints required/overdue courses.",
        },
    },
    {
        key: "degree",
        title: {zh: "综合工具", en: "Degree check"},
        body: {
            zh: "使用多种多样的工具来管理你的选课和学位进度。",
            en: "The Tools page shows the 5 degree tracks and cross-discipline check.",
        },
    },
    {
        key: "curriculum",
        title: {zh: "培养方案", en: "Curriculum"},
        body: {
            zh: "在选课时可以快捷查看培养方案、教学计划与解读PPT。",
            en: "The Curriculum page has the full plan, schedule, and guides.",
        },
    },
];

export const HelpPanel = () => {
    const {helpOpen, closeHelp, startTour} = useOnboarding();
    const {locale} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    if (!helpOpen) return null;

    return (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/50" onClick={closeHelp} />
            <div
                className={`relative w-[420px] max-w-[92vw] rounded-2xl border p-5 shadow-2xl ${
                    isDark ? "border-white/10 bg-[#1c1c28] text-white/90" : "border-gray-200 bg-white text-gray-800"
                }`}
            >
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-base font-semibold">{locale === "zh" ? "使用帮助" : "Help"}</div>
                    <button onClick={closeHelp} className="text-sm opacity-60 hover:opacity-100">
                        ✕
                    </button>
                </div>
                <div className="mb-4 flex flex-col gap-3">
                    {HELP_ITEMS.map((it) => (
                        <div key={it.key}>
                            <div className="text-sm font-medium">{it.title[locale]}</div>
                            <div className="text-xs leading-relaxed opacity-75">{it.body[locale]}</div>
                        </div>
                    ))}
                </div>
                <button
                    onClick={startTour}
                    className="w-full rounded-lg py-2 text-sm font-medium text-white"
                    style={{background: isDark ? "#7c5cff" : "#863bff"}}
                >
                    {locale === "zh" ? "重新观看引导" : "Replay tutorial"}
                </button>
            </div>
        </div>
    );
};
