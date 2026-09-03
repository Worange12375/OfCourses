import {useOnboarding} from "./OnboardingContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useLocale} from "../i18n/LocaleContext";

/** 常驻「?」帮助按钮，挂到导航栏 / 首页控件区 */
export const HelpButton = () => {
    const {openHelp} = useOnboarding();
    const {theme} = useAppTheme();
    const {locale} = useLocale();
    const isDark = theme === "dark";

    return (
        <button
            onClick={openHelp}
            title={locale === "zh" ? "使用帮助" : "Help"}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border text-xs font-bold transition-all duration-300 ${
                isDark
                    ? "border-white/15 bg-white/10 text-white/80 hover:bg-white/20"
                    : "border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
        >
            ?
        </button>
    );
};
