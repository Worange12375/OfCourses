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
            zh: "点击「历史记录」区域的「导入」按钮可载入选课历史 JSON。新同学可先下载教学示例数据熟悉流程，操作熟练后即可尝试手动编辑自己的选课历史和预选数据了。完成后，记得点击「导出」保存到本地哦。",
            en: "Click the “Import” button in the “History” area to load a course-history JSON. New users can download the teaching sample data first to get familiar with the flow; once you’re comfortable, you can try manually editing your own course history and pre-selection data. When done, remember to click “Export” to save it locally.",
        },
    },
    {
        id: "columns",
        targetPage: "workspace",
        selectors: ["[data-tour='workspace']", "[data-tour='semester']"],
        cardPos: "center",
        title: {zh: "三栏工作台", en: "The three-column workspace"},
        body: {
            zh: "左栏为「选课记录」，中栏为「预选课程」，右栏为「课程目录」。请先设置好自己的学期，然后在「预选课程」中选择需要选课的学期，再在「课程目录」中点击课程信息左侧的「+」即可加入选课列表。完成后请点击「保存到历史记录」进行保存。如需保存到本地，请点击「导出」。",
            en: "The left column is your Course History, the middle is Pre-selected Courses, and the right is the Course Catalog. First set your semester (the top-right dropdown in the navigation bar), then choose the semester you want to enroll in under Pre-selected Courses, and click the “+” to the left of a course in the Course Catalog to add it to your list. When done, click “Save to History” to save. To save locally, click “Export”.",
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
            zh: "点击顶部导航的「综合工具」进入综合工具页，这里有「学位评定」等实用小工具；点击「培养方案」可看到目前较新的培养方案、教学计划与解读PPT（由于时效性，仅供参考，请以书院官方最新文件为准）。如果你忘记了本教程内容，可以点右上角的「?」重看本引导。",
            en: "Click “Tools” in the top navigation to enter the tools page, where you’ll find handy utilities such as “Degree Evaluation”; click “Curriculum” to view the relatively recent training plan, teaching schedule, and explanatory PPT (due to timeliness, for reference only — please refer to the college’s official latest documents). If you forget this tutorial, click “?” in the top-right corner to replay this guide.",
        },
    },
];
