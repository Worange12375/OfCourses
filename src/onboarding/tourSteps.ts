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
            zh: "点击「历史记录」栏中的「方案管理」，即可在弹窗中导入或导出选课数据 JSON。第一次使用可以先下载示例数据熟悉流程；登录后还可在方案管理中使用云端方案。",
            en: "Open “Plans” in the Course History panel to import or export course data as JSON. You can start with the sample file; signed-in users can also manage cloud plans there.",
        },
    },
    {
        id: "columns",
        targetPage: "workspace",
        selectors: ["[data-tour='history']", "[data-tour='staging']", "[data-tour='catalog']"],
        title: {zh: "三栏工作台", en: "The three-column workspace"},
        body: {
            zh: "工作台分为「选课记录」「预选课程」和「课程目录」三栏。页面自动显示当前学期；在中栏选择计划学期，再从右栏课程目录点击「+」加入预选。检查后按页面提供的保存操作写入记录，也可通过「方案管理」导出备份。",
            en: "The workspace has Course History, Pre-selected Courses, and the Course Catalog. The current semester is detected automatically. Choose a planning semester in the middle column, click “+” beside a catalog course, then use the available save action or export a backup from Plans.",
        },
    },
    {
        id: "recommend",
        targetPage: "workspace",
        selector: "[data-tour='recommend']",
        title: {zh: "智能推荐与提示", en: "Smart recommendation & blue hints"},
        body: {
            zh: "课程目录中的「推荐」开关会依据当前关联的选课记录调整课程排序；关闭后可按常规顺序浏览。也可以用搜索框和筛选条件缩小课程范围。",
            en: "The catalog’s “Recommend” control uses the linked course history to adjust course ordering. Turn it off to browse the regular order, or narrow the list with search and filters.",
        },
    },
    {
        id: "tools",
        selectors: ["[data-tour='nav-curriculum']", "[data-tour='nav-tools']"],
        cardPos: "below-nav",
        title: {zh: "学位评定与培养方案", en: "Degree check & curriculum"},
        body: {
            zh: "「综合工具」包含学位评定、AI 推荐助手和课程评价。学位评定关联课程记录后显示进度；AI 助手的额度和模型说明以页面实时提示为准；课程评价可搜索条目并查看同学分享。培养方案页提供方案、教学计划、资料和导图。导航栏中的「?」可重新打开教程入口，选择交互引导或 Wiki。",
            en: "Tools contains Degree Evaluation, the AI Assistant, and Course Reviews. Link course data to see degree progress; check the AI page for current model and quota details; search reviews by course. Curriculum offers plans, schedules, reference materials, and a map. The “?” in the navigation opens the tutorial hub for the walkthrough or Wiki.",
        },
    },
];
