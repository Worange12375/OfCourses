import type {NavPage} from "../components/Navbar";

export type CardPos = "auto" | "center" | "below-nav";

export interface TourStep {
    /** 步骤唯一 id */
    id: string;
    /** 显示该步前需要切换到的页面（跨页高亮必须先把目标页切到可见） */
    targetPage?: NavPage;
    /** 单个目标元素选择器（data-tour）；多目标请用 selectors */
    selector?: string;
    /** 多个目标元素选择器（同时框出，如导航栏两项）；不填则为居中卡片（如欢迎页） */
    selectors?: string[];
    /** 卡片位置策略：auto=贴着目标自动上下、center=屏幕正中、below-nav=导航栏正下方 */
    cardPos?: CardPos;
    /** 可选：在卡片内提供一个下载按钮（如教学示例数据） */
    download?: {
        href: string;
        filename: string;
        label: { zh: string; en: string };
    };
    title: { zh: string; en: string };
    body: { zh: string; en: string };
}
