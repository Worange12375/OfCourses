import type {TourStep} from "./types";

/** 首次引导的 5 步。顺序即播放顺序。 */
export const TOUR_STEPS: TourStep[] = [
    {
        id: "welcome",
        title: {zh: "欢迎使用 OfCourses", en: "Welcome to OfCourses"},
        body: {
            zh: "这是为笃实书院的大家精心打造的选课规划工具：帮你记录历史选课、规划下学期、查询学位进度……下面用4个步骤带你快速上手。",
            en: "This is a course-planning tool crafted for everyone at Dushi College: it helps you record your course history, plan next semester, and check your degree progress... The following 4 steps will get you started quickly.",
        },
    },
    {
        id: "import",
        targetPage: "workspace",
        selector: "[data-tour='history']",
        download: {
            href: "/tutorial-sample.json",
            filename: "OfCourses-教学示例数据.json",
            label: {zh: "下载教学示例数据", en: "Download sample data"},
        },
        title: {zh: "导入你的选课历史", en: "Import your course history"},
        body: {
            zh: "点击「历史记录」区域的「导入」按钮可载入选课历史 JSON。新同学可先下载教学示例数据熟悉流程，操作熟练后即可尝试手动编辑自己的选课历史和预选数据了。完成后，记得点击「导出」保存到本地哦；登录后还可把方案存为云端方案，多设备同步。",
            en: "Click the “Import” button in the “History” area to load a course-history JSON. New users can download the teaching sample data first to get familiar with the flow; once you’re comfortable, you can try manually editing your own course history and pre-selection data. When done, remember to click “Export” to save it locally. Signed-in users can also save the plan to the cloud and sync it across devices.",
        },
    },
    {
        id: "columns",
        targetPage: "workspace",
        selectors: ["[data-tour='history']", "[data-tour='staging']", "[data-tour='catalog']"],
        title: {zh: "三栏工作台", en: "The three-column workspace"},
        body: {
            zh: "工作台分为「选课记录」「预选课程」和「课程目录」三栏。页面会自动识别当前学期；先在中栏选择计划学期，再从右栏课程目录添加课程。检查完预选课程后，可保存到历史记录，或导出文件留作本地备份。",
            en: "The workspace has Course History, Pre-selected Courses, and the Course Catalog. The current semester is detected automatically. Choose a planning semester in the middle column, then add courses from the catalog on the right. Review your plan and save it to history or export a local backup.",
        },
    },
    {
        id: "recommend",
        targetPage: "workspace",
        selector: "[data-tour='recommend']",
        title: {zh: "智能推荐与提示", en: "Smart recommendation & blue hints"},
        body: {
            zh: "「推荐」开关开启后，课程目录会按你的选课历史智能排序。下方蓝字会提示须选课程、推荐模块等重要信息。你也可以通过搜索、添加筛选项进行个性化选择。",
            en: "After turning on the “Recommend” switch, the course catalog is intelligently sorted by your course history. The blue text below shows important info such as required courses and recommended modules. You can also use search and add filters for personalized selection.",
        },
    },
    {
        id: "tools",
        selectors: ["[data-tour='nav-curriculum']", "[data-tour='nav-tools']"],
        cardPos: "below-nav",
        title: {zh: "学位评定与培养方案", en: "Degree check & curriculum"},
        body: {
            zh: "点击顶部导航的「综合工具」进入综合工具页：「学位评定」可查看七条学位轨道的获取进度（含交叉工程双学位，可手动指定专业对/主修模块），「AI 推荐助手」能结合你的选课数据回答规划问题；点击「培养方案」可查看培养方案、教学计划与解读PPT（由于时效性，仅供参考，请以书院官方最新文件为准）。如果你忘记了本教程内容，可以点右上角的「?」重看本引导。",
            en: "Click “Tools” in the top navigation to open the tools page: “Degree Evaluation” shows your progress across all 7 degree tracks (including the Cross-Engineering double degree, with manual major-pair/module selection), and the “AI Assistant” answers planning questions based on your course record. Click “Curriculum” to view the training plan, teaching schedule, and explanatory slides (for reference only — please follow the college’s latest official documents). If you forget this tutorial, click “?” in the top-right corner to replay it.",
        },
    },
];
