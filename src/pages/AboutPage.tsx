import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

import overviewTextZh from "../assets/text/DevelopmentOverview.txt?raw";
import overviewTextEn from "../assets/text/DevelopmentOverview_En.txt?raw";
import feedbackGuidanceZh from "../assets/text/ProblemFeedback_guidance.txt?raw";
import feedbackGuidanceEn from "../assets/text/ProblemFeedback_guidance_En.txt?raw";

interface AboutPageProps {
    mobile?: boolean;
}

const URL_RE = /https?:\/\/[^\s\)\]\,，。；;]+/g;

function linkLabel(url: string, isZh: boolean): string {
    if (url.includes("mp.weixin.qq.com") || url.includes("weixin.qq.com")) {
        return isZh ? "[公众号文章]" : "[WeChat article]";
    }
    if (url.includes("docs.qq.com")) {
        return isZh ? "[腾讯文档]" : "[Tencent Doc]";
    }
    return isZh ? "[链接]" : "[link]";
}

function LinkedText({text, isDark, isZh}: {text: string; isDark: boolean; isZh: boolean}) {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    const regex = new RegExp(URL_RE.source, URL_RE.flags);
    while ((match = regex.exec(text)) !== null) {
        const url = match[0];
        if (match.index > lastIndex) {
            parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>);
        }
        parts.push(
            <a
                key={`u-${match.index}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-block max-w-full truncate align-bottom underline underline-offset-2 ${
                    isDark ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-500"
                }`}
                title={url}
            >
                {linkLabel(url, isZh)}
            </a>,
        );
        lastIndex = match.index + url.length;
    }
    if (lastIndex < text.length) {
        parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }
    return <>{parts}</>;
}

export const AboutPage = ({mobile}: AboutPageProps) => {
    const {locale, t} = useLocale();
    const {theme} = useAppTheme();
    const isDark = theme === "dark";
    const isZh = locale === "zh";

    const overviewText = isZh ? overviewTextZh : overviewTextEn;
    const feedbackGuidance = isZh ? feedbackGuidanceZh : feedbackGuidanceEn;

    return (
        <div className={`flex flex-1 flex-col items-center gap-8 overflow-y-auto ${mobile ? "p-4 oc-mobile-pb-nav" : "p-10"} transition-colors duration-300 ${
            isDark ? "text-white/85" : "text-gray-700"
        }`}>
            {/* Title */}
            <h1 className={`m-0 text-3xl font-bold transition-colors duration-300 ${
                isDark ? "text-white" : "text-gray-800"
            }`}>
                {t("about.title")}
            </h1>

            {/* Development Overview */}
            <div className={`w-full max-w-3xl rounded-xl p-6 transition-colors duration-300 ${
                isDark ? "bg-white/5" : "bg-white shadow-sm"
            }`}>
                <h2 className={`m-0 mb-3 text-xl font-semibold ${
                    isDark ? "text-white/90" : "text-gray-800"
                }`}>
                    {isZh ? "网页与开发介绍" : "Development Overview"}
                </h2>
                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                    <LinkedText text={overviewText} isDark={isDark} isZh={isZh} />
                </p>
            </div>

            {/* Problem Feedback */}
            <div className={`w-full max-w-3xl rounded-xl p-6 transition-colors duration-300 ${
                isDark ? "bg-white/5" : "bg-white shadow-sm"
            }`}>
                <h2 className={`m-0 mb-3 text-xl font-semibold ${
                    isDark ? "text-white/90" : "text-gray-800"
                }`}>
                    {isZh ? "问题反馈" : "Feedback"}
                </h2>
                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                    <LinkedText text={feedbackGuidance} isDark={isDark} isZh={isZh} />
                </p>
            </div>
        </div>
    );
};