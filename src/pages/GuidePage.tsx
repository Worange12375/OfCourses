import {useEffect, useMemo, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

type GuideId = "getting-started" | "workspace" | "curriculum" | "curriculum-map" | "tools-overview" | "degree" | "ai-assistant" | "course-reviews" | "faq";
type GuideArticle = {id: GuideId; category: string; title: string; summary: string; sections: {heading: string; paragraphs?: string[]; steps?: string[]}[]; related?: GuideId[]};

const GUIDE_ZH: GuideArticle[] = [
  {id: "getting-started", category: "入门", title: "从哪里开始使用", summary: "先建立课程记录，再规划目标学期；遇到不熟悉的功能时从页面教程或 Wiki 继续。", related: ["workspace", "tools-overview", "curriculum"], sections: [
    {heading: "第一次使用：推荐顺序", paragraphs: ["OfCourses 把课程记录、学期规划、培养方案资料和辅助工具放在一起。可以先完成一件具体的事：导入已有记录，或从空白工作台开始添加课程。"], steps: ["打开「工作台」。已有数据可点击历史记录栏的「方案管理 / Plans」，在弹窗中导入 JSON；也可以不导入，直接手动建计划。", "在中间的预选区域选择要规划的学期。工作台会显示自动识别的当前学期，规划目标需要在预选区域选择。", "在课程目录搜索课程，点击课程旁的「+」加入预选；按需使用搜索和筛选。", "检查预选课程、学分和页面提示，再使用预选区域提供的保存操作。修改已有学期时，留意保存或取消编辑的提示。", "需要备份时，在「方案管理 / Plans」中导出本地 JSON；登录并关联云端方案后，也可查看其同步状态。"]},
    {heading: "接下来可以做什么", paragraphs: ["「培养方案」用于查看对应年级的培养方案文件和课程关系；「综合工具」包含学位评定、AI 推荐助手和课程评价。各页面的「?」会提供针对当前页面的交互引导和对应 Wiki 入口。"]},
    {heading: "数据与隐私", paragraphs: ["本地课程记录保存在当前浏览器。清理浏览器数据或更换设备前请先导出备份。云端功能需要登录并按页面提示选择或创建云端方案；请勿把含有个人信息的导出文件发给他人。"]},
  ]},
  {id: "workspace", category: "工作台", title: "工作台：记录与规划课程", summary: "工作台由历史记录、预选区域和课程目录组成；页面布局会按当前设备模式调整。", related: ["getting-started", "degree", "ai-assistant"], sections: [
    {heading: "认识三个区域", paragraphs: ["「历史记录」维护不同学期的课程；「预选课程」用于规划一个目标学期；「课程目录」提供课程搜索、筛选和加入预选的操作。移动端会把部分区域改为标签或抽屉，功能含义相同。"]},
    {heading: "规划一个学期", steps: ["在预选区域选择目标学期；当前学期由页面自动识别并显示。", "在目录中搜索课程，或按课程组、学期等条件筛选。", "点击课程旁的「+」加入预选；需要移除时使用对应的移除操作。", "检查课程冲突、学分和课程组提示。推荐开关会根据已有课程记录调整目录排序，可随时关闭。", "使用预选区域的保存操作保存计划。编辑已有历史学期时，按页面提示保存修改或取消编辑。"]},
    {heading: "导入、导出与云端方案", steps: ["点击历史记录栏的「方案管理 / Plans」打开管理弹窗。", "本地备份区可导出 JSON，或选择 JSON 文件导入。导入后先查看预览，再选择合并、覆盖或取消；覆盖会替换现有本地记录。", "登录后可在云端方案区新建、切换、重命名或管理方案。页面会显示当前归属、同步状态和未同步改动提示。"]},
    {heading: "数据保存在哪里", paragraphs: ["未关联云端方案时，工作台数据保存在当前浏览器。登录并选择云端方案后，修改会按页面显示的状态自动同步。切换浏览器、设备或清理站点数据前，先确认同步完成或导出备份。"]},
  ]},
  {id: "curriculum", category: "培养方案", title: "查阅培养方案", summary: "查看当前年级对应的培养方案、教学计划及相关资料。", related: ["curriculum-map", "degree", "faq"], sections: [
    {heading: "先确认年级版本", paragraphs: ["培养方案页展示与当前账号或方案对应的年级版本；未登录时会按页面默认方案显示。不同年级的课程结构和毕业要求可能不同，因此核对要求时先确认当前版本，并查看文件标题或年份。"]},
    {heading: "浏览文件和搜索内容", steps: ["在资料栏顶部切换培养方案、教学计划及页面提供的其他资料。", "使用资料栏上方的搜索框查找课程名、课组或关键词。若其他资料也有匹配结果，可从提示切换过去。", "需要从结构角度理解课程关系时，打开「培养方案导图」，选择列表、树状或关系视图。"]},
    {heading: "以正式文件为准", paragraphs: ["网站内的方案和解读资料用于检索与辅助理解。涉及选课资格、学分认定或最新政策时，请核对书院、教务部门发布的正式文件和通知。"]},
  ]},
  {id: "curriculum-map", category: "培养方案", title: "培养方案导图", summary: "用列表、树状和关系视图浏览课程、课组与模块的结构。", related: ["curriculum", "degree"], sections: [
    {heading: "选择适合的视图", paragraphs: ["列表视图按模块、课组和课程层级展开，适合逐项浏览；树状视图突出层级关系；关系视图用于探索课程所属课组或多个课组之间的共同课程。三种视图读取当前年级方案。"]},
    {heading: "查找和浏览", steps: ["用导图上方的视图切换器选择列表、树状或关系视图。", "在列表或树状视图中搜索课程或课组，再展开相关层级查看上下文。列表视图可固定重点对象，减少自动收起对浏览的影响。", "在关系视图中先选择课程视角或课组视角，再按页面提示点选课程或勾选课组；视图只呈现当前选择相关的关系，避免一次铺开全部网络。"]},
    {heading: "阅读结果时注意", paragraphs: ["图中的关系有助于浏览结构，不等同于正式修读资格或毕业审核结论。具体课程要求请回到对应年级的培养方案文件核对。"]},
  ]},
  {id: "tools-overview", category: "综合工具", title: "综合工具：从哪个工具开始", summary: "学位评定、AI 推荐助手和课程评价分别解决不同问题。", related: ["degree", "ai-assistant", "course-reviews", "workspace"], sections: [
    {heading: "按你的问题选择工具", steps: ["想知道已修课程对培养要求的完成情况：打开「学位评定」，先关联工作台课程数据。", "想根据自己的课程背景讨论后续选课：打开「AI 推荐助手」，检查课程数据来源，再描述目标学期和限制条件。", "想了解一门课的同学体验：打开「课程评价」，搜索课程或按首字母浏览。发布评价需要登录。"]},
    {heading: "每个工具的数据不同", paragraphs: ["学位评定和 AI 助手都需要课程记录，但页面的导入或关联状态分别管理；在一个工具导入数据不代表另一工具也已关联。课程评价是独立的社区内容。具体状态和可用操作请以当前页面显示为准。"]},
    {heading: "从页面教程继续", paragraphs: ["综合工具页面的「?」会打开教程入口：交互引导会依次切换到三个工具的关键控件；Wiki 可直接查看各工具的操作说明。"]},
  ]},
  {id: "degree", category: "综合工具", title: "学位评定", summary: "关联课程记录后查看各评定轨道的进度和待满足要求。", related: ["tools-overview", "workspace", "curriculum"], sections: [
    {heading: "关联课程记录", steps: ["在「综合工具 → 学位评定」中选择导入本地数据，使用工作台导出的 JSON；或选择云端方案。", "未登录或没有云端方案时，云端入口可能按页面提示回退到本浏览器的工作台数据。", "确认导入或关联的课程范围正确，再查看评定结果。需要更新时，重新关联最新数据。"]},
    {heading: "阅读进度", paragraphs: ["页面按当前培养方案版本计算不同轨道和模块的完成情况；部分轨道允许手动指定模块或专业组合。检查结果异常时，优先核对年级方案、课程记录、课程学分和课组归属。"]},
    {heading: "结果的用途", paragraphs: ["评定结果用于提前检查和规划，不替代书院审核。毕业要求、课程认定和最终学位评定以书院正式培养方案及审核结果为准。"]},
  ]},
  {id: "ai-assistant", category: "综合工具", title: "AI 选课助手", summary: "结合课程和培养方案信息讨论选课问题；模型与额度状态以页面实时信息为准。", related: ["tools-overview", "workspace", "degree"], sections: [
    {heading: "开始一段有效的提问", steps: ["先看输入框上方的课程数据面板，确认当前使用的数据来源；如需切换或上传，使用面板提供的操作。", "写清楚年级、目标学期、已修或计划中的课程，以及你关心的限制，例如学分或课程方向。", "把复杂问题拆成几步：先请求候选课程，再追问某门课的匹配原因或需要核对的条件。", "重要答复可使用页面的导出功能保存为文本，之后对照培养方案或官方通知核实。"]},
    {heading: "模型、额度与会话", paragraphs: ["可选模型、剩余额度、使用条款和会话保存方式可能随版本或账号状态变化。请以助手页面当前显示的模型控制、说明和实时提示为准，不要依赖旧教程中的固定次数或时长。"]},
    {heading: "回答边界", paragraphs: ["AI 可能理解错误或遗漏信息，结果只用于辅助思考。课程开设、选课资格和毕业要求请以官方信息为准；提问时避免输入不必要的敏感个人信息。"]},
  ]},
  {id: "course-reviews", category: "综合工具", title: "课程评价", summary: "搜索课程、阅读同学分享，也可以发布和管理自己的评价。", related: ["tools-overview", "faq"], sections: [
    {heading: "查找课程和评价", steps: ["在搜索框输入课程名称，从匹配条目中选择课程。", "不确定课程名时，可以按页面提供的首字母入口浏览。", "查看最新或热门内容；有搜索或筛选条件时，按页面提示退出筛选可恢复常规列表。", "打开规则说明，了解发布规范和互动方式。"]},
    {heading: "发布与管理", paragraphs: ["登录后使用「我要评价」并按表单选择课程、填写内容和提交。评价应来自真实修读体验，避免泄露自己或他人的敏感信息。发布后可在「我的评价」查看或管理自己的内容；站内消息会提示相关动态。"]},
  ]},
  {id: "faq", category: "常见问题", title: "常见问题", summary: "按症状检查页面状态、设备模式和数据来源。", related: ["getting-started", "workspace", "curriculum", "ai-assistant"], sections: [
    {heading: "刷新后停在旧页面或旧版本", paragraphs: ["页面会尝试恢复上次打开的位置和部分浏览器设置。如果网站提示已有新版本，按提示刷新；仍未更新时，可在确认本地编辑已保存后重新加载页面。"]},
    {heading: "数据没有出现在另一台设备", paragraphs: ["本地浏览器数据不会自动跨设备共享。先在原设备确认云端同步完成；没有关联云端方案时，在原设备从「方案管理 / Plans」导出 JSON，再在另一设备导入。"]},
    {heading: "学位评定或 AI 没有读到课程", paragraphs: ["工作台、学位评定和 AI 助手的课程数据关联是分开的。分别打开学位评定或 AI 助手，检查各自的数据面板和导入状态。"]},
    {heading: "手机浏览器显示为电脑布局", paragraphs: ["手机浏览器的「电脑模式」可能让网站按较宽屏幕呈现。首次检测到设备与页面模式不一致时，按弹窗建议选择适合的模式；也可以在设置中手动调整。"]},
  ]},
];

const GUIDE_EN: GuideArticle[] = [
  {id: "getting-started", category: "Getting started", title: "Where to start", summary: "Set up course history, plan a target semester, then open other tools when you need them.", related: ["workspace", "tools-overview", "curriculum"], sections: [
    {heading: "A suggested first session", paragraphs: ["OfCourses brings course history, semester planning, curriculum materials, and supporting tools together. Start with one task: import existing records or build a plan from an empty workspace."], steps: ["Open Workspace. To import existing data, use Plans in the Course History area and choose a JSON file; or start by adding courses manually.", "Choose a target semester in the preselection area. The current semester is detected and displayed automatically.", "Search the catalog and click “+” beside a course to add it to your preselection.", "Review the selected courses and page notices, then use the save control in the preselection area. When editing an existing semester, follow the save or cancel prompts.", "Use Plans to export a local JSON backup. After signing in and linking a cloud plan, check its sync status before switching devices."]},
    {heading: "Where to go next", paragraphs: ["Curriculum contains cohort-specific documents and a map of course relationships. Tools contains Degree Evaluation, the AI Assistant, and Course Reviews. The “?” on each page opens a focused walkthrough and its related Wiki topic."]},
    {heading: "Data and privacy", paragraphs: ["Local course records stay in the current browser. Export a backup before clearing site data or changing devices. Cloud features require signing in and choosing or creating a cloud plan. Keep exported files containing personal course information private."]},
  ]},
  {id: "workspace", category: "Workspace", title: "Workspace: record and plan courses", summary: "Use Course History, the preselection area, and the catalog to plan a semester.", related: ["getting-started", "degree", "ai-assistant"], sections: [
    {heading: "The three areas", paragraphs: ["Course History stores courses by semester; Pre-selected Courses is where you plan one target semester; the Course Catalog provides search, filters, and add actions. On phones, some areas become tabs or drawers, while their purpose stays the same."]},
    {heading: "Plan a semester", steps: ["Choose a target semester in the preselection area. The current semester is detected and shown by the page.", "Search the catalog or narrow it with available filters.", "Click “+” beside a course to add it. Use the matching remove action if you change your mind.", "Review conflict, credit, and course-group notices. The Recommend control adjusts catalog ordering based on your course history and can be turned off.", "Use the save control in the preselection area. When editing a saved semester, follow the page prompt to save changes or cancel editing."]},
    {heading: "Plans, import, export, and cloud sync", steps: ["Click Plans in Course History to open plan management.", "The local backup area can export a JSON file or select one to import. Review the preview, then choose merge, overwrite, or cancel. Overwrite replaces existing local records.", "After signing in, the cloud plans area lets you create, switch, rename, or manage plans. The modal shows current ownership, sync state, and unsynced changes."]},
    {heading: "Where data is stored", paragraphs: ["Without a linked cloud plan, Workspace data stays in this browser. When signed in and linked to a cloud plan, changes sync according to the status shown in the app. Before switching browsers, devices, or clearing site data, confirm sync has completed or export a backup."]},
  ]},
  {id: "curriculum", category: "Curriculum", title: "Browse the curriculum", summary: "Open curriculum and teaching-plan documents for the current cohort, then search within them.", related: ["curriculum-map", "degree", "faq"], sections: [
    {heading: "Check the cohort version", paragraphs: ["The page uses the cohort version associated with the current account or plan; when signed out, it shows the default scheme. Course structure and graduation requirements may differ by cohort, so check the year in the page or document before relying on it."]},
    {heading: "Browse and search documents", steps: ["Use the tabs above the document area to switch among the curriculum, teaching plan, and other available materials.", "Search for a course, group, or keyword in the document search field. If other documents also contain matches, use the notice to switch to them.", "For a structural view of course relationships, open Curriculum Map and choose List, Tree, or Graph."]},
    {heading: "Use official documents for decisions", paragraphs: ["Site materials support browsing and understanding. For current eligibility, credit recognition, or policy, check the official files and notices from the college or academic-affairs office."]},
  ]},
  {id: "curriculum-map", category: "Curriculum", title: "Curriculum map", summary: "Browse course, group, and module structure with list, tree, and relationship views.", related: ["curriculum", "degree"], sections: [
    {heading: "Choose a view", paragraphs: ["List view follows the module, group, and course hierarchy. Tree view emphasizes hierarchy. Relationship view helps explore which groups contain a course or which courses are shared by selected groups. Each view follows the current cohort scheme."]},
    {heading: "Search and explore", steps: ["Use the view switcher above the map to select List, Tree, or Graph.", "In List or Tree, search for a course or group, then expand relevant levels to see its context. List view can pin key items so they are less likely to collapse automatically.", "In Graph, choose a course or group perspective and select items as prompted. The map focuses on relationships around your selection instead of drawing the whole network at once."]},
    {heading: "How to read the map", paragraphs: ["Relationships help you explore the structure; they are not an official eligibility or degree-audit result. Verify course requirements in the curriculum document for your cohort."]},
  ]},
  {id: "tools-overview", category: "Tools", title: "Tools: choose the right one", summary: "Degree Evaluation, the AI Assistant, and Course Reviews answer different questions.", related: ["degree", "ai-assistant", "course-reviews", "workspace"], sections: [
    {heading: "Choose by task", steps: ["To check progress against curriculum requirements, open Degree Evaluation and link your course records.", "To discuss future course choices using your history, open the AI Assistant, check its data source, and state your target semester and constraints.", "To learn about a class from other students, open Course Reviews and search by course or browse by initial. Sign-in is required to post."]},
    {heading: "Data is linked separately", paragraphs: ["Degree Evaluation and the AI Assistant both use course records, but each manages its own import or data-link state. Importing into one does not automatically link data to the other. Course Reviews is a separate community feature. Follow each page's current status and controls."]},
    {heading: "Open the focused tutorial", paragraphs: ["The “?” on Tools opens a tutorial hub. Its interactive walkthrough switches between the three tools and highlights their key controls; the Wiki links to their detailed instructions."]},
  ]},
  {id: "degree", category: "Tools", title: "Degree Evaluation", summary: "Link course records to review progress and remaining requirements across evaluation tracks.", related: ["tools-overview", "workspace", "curriculum"], sections: [
    {heading: "Link your course records", steps: ["Open Tools → Degree Evaluation and choose the local-data import option to use a JSON export from Workspace, or choose a cloud plan.", "If you are signed out or have no cloud plan, the cloud action may fall back to Workspace data in this browser, as described by the page.", "Confirm the linked data is the one you intend to evaluate, then review the results. Re-link the latest data when your records change."]},
    {heading: "Read progress", paragraphs: ["The page calculates completion across tracks and modules using the current curriculum version. Some tracks allow you to choose a module or major combination manually. If results look unexpected, check your cohort, course history, credits, and group assignments."]},
    {heading: "What the result means", paragraphs: ["Evaluation is a planning aid and does not replace an official review. The college's curriculum and final audit determine graduation requirements and course recognition."]},
  ]},
  {id: "ai-assistant", category: "Tools", title: "AI course assistant", summary: "Discuss course planning using course and curriculum information; live model and quota details are shown in the app.", related: ["tools-overview", "workspace", "degree"], sections: [
    {heading: "Ask a useful question", steps: ["Check the course-data panel above the composer to see which data source is active. Use the panel controls to switch or upload data when available.", "Include your cohort, target semester, courses already taken or planned, and constraints such as credits or subject areas.", "Break a complex question into smaller steps: ask for candidate courses first, then ask why a course fits or what requirements to verify.", "Export important answers with the page's export control so you can compare them with the curriculum or official notices."]},
    {heading: "Model, quota, and conversation", paragraphs: ["Available models, remaining quota, terms, and conversation retention can change by version or account state. Follow the live model controls, notices, and terms on the AI page rather than relying on fixed limits or durations from an older guide."]},
    {heading: "Limitations", paragraphs: ["The assistant can misunderstand or omit information. Treat its output as a thinking aid, verify course availability and graduation requirements with official sources, and avoid sharing unnecessary sensitive personal information."]},
  ]},
  {id: "course-reviews", category: "Tools", title: "Course Reviews", summary: "Search courses, read student posts, and publish or manage your own reviews.", related: ["tools-overview", "faq"], sections: [
    {heading: "Find a course and its reviews", steps: ["Enter a course name in the search field and choose a matching result.", "If you do not know the exact name, browse using the available initial index.", "Browse latest or popular posts. When search or filters are active, follow the page controls to clear them and return to the general list.", "Open the rules panel to review posting standards and interaction details."]},
    {heading: "Post and manage reviews", paragraphs: ["After signing in, select “Write a review” and follow the form to choose a course, enter your review, and submit. Write from your actual experience and avoid exposing sensitive information about yourself or others. My Reviews lists and manages your posts; Inbox shows relevant site messages."]},
  ]},
  {id: "faq", category: "FAQ", title: "Frequently asked questions", summary: "Check page state, device mode, and data sources when something looks unexpected.", related: ["getting-started", "workspace", "curriculum", "ai-assistant"], sections: [
    {heading: "The old page or version appears after refresh", paragraphs: ["The app tries to restore your last page and some browser preferences. If the site reports a newer version, follow its refresh prompt. If it still looks old, make sure local edits are saved before reloading the page."]},
    {heading: "Data is missing on another device", paragraphs: ["Local browser data does not sync by itself. On the original device, confirm cloud sync has completed. If there is no linked cloud plan, export JSON from Plans and import it on the other device."]},
    {heading: "Degree Evaluation or AI cannot see my courses", paragraphs: ["Workspace, Degree Evaluation, and the AI Assistant manage their course-data links separately. Open each tool and check its own data panel and import status."]},
    {heading: "A phone is showing the desktop layout", paragraphs: ["A mobile browser's desktop-site mode can make the site detect a wide-screen layout. When the site detects a mismatch, choose the suggested device mode in the prompt, or change it manually in Settings."]},
  ]},
];

interface Props {mobile: boolean; active: boolean; initialSection: string; onSectionChange: (section: string) => void;}

export function GuidePage({mobile, active, initialSection, onSectionChange}: Props) {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const zh = locale === "zh";
  const isDark = theme === "dark";
  const articles = zh ? GUIDE_ZH : GUIDE_EN;
  const [selectedId, setSelectedId] = useState<GuideId>((initialSection as GuideId) || "getting-started");
  const [query, setQuery] = useState("");
  const selected = articles.find((article) => article.id === selectedId) ?? articles[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return articles;
    return articles.filter((article) => [article.title, article.summary, article.category, ...article.sections.flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.steps ?? [])])].join(" ").toLocaleLowerCase().includes(normalized));
  }, [articles, query]);

  useEffect(() => {
    if (!active) return;
    const wanted = initialSection as GuideId;
    if (articles.some((article) => article.id === wanted)) setSelectedId(wanted);
    else setSelectedId("getting-started");
  }, [active, initialSection, articles]);

  const chooseArticle = (id: GuideId) => {
    setSelectedId(id);
    onSectionChange(id);
    window.history.replaceState(null, "", `#guide/${id}`);
  };

  const surface = isDark ? "border-white/10 bg-[#171720] text-white/90" : "border-gray-200 bg-white text-gray-800";
  const muted = isDark ? "text-white/55" : "text-gray-500";
  const selectedCls = isDark ? "bg-white/10 text-white" : "bg-violet-50 text-violet-700";

  return (
    <main className={`flex min-h-0 flex-1 flex-col overflow-hidden ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      <header className={`shrink-0 border-b px-4 py-4 sm:px-7 ${isDark ? "border-white/10" : "border-gray-200"}`}>
        <div className="mx-auto w-full max-w-6xl">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-500">OfCourses · Wiki</div>
          <h1 className="mt-1 text-xl font-semibold">{zh ? "使用指南" : "User guide"}</h1>
          <p className={`mt-1 text-sm ${muted}`}>{zh ? "按功能查阅操作说明，也可以从教程入口直接跳到对应主题。" : "Browse by feature, or open a topic directly from its tutorial entry."}</p>
        </div>
      </header>
      <div className={`mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-4 overflow-hidden p-3 sm:gap-6 sm:p-6 ${mobile ? "flex-col" : "flex-row"}`}>
        <aside className={`${mobile ? "max-h-[38%] shrink-0" : "w-64 shrink-0"} flex flex-col overflow-hidden rounded-xl border ${surface}`}>
          <label className={`m-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${isDark ? "border-white/10 bg-black/10" : "border-gray-200 bg-gray-50"}`}>
            <span className={muted} aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索指南" : "Search the guide"} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" />
          </label>
          <nav className={`flex-1 overflow-y-auto px-2 pb-2 ${mobile ? "grid grid-cols-2 gap-1" : "space-y-1"}`} aria-label={zh ? "指南主题" : "Guide topics"}>
            {filtered.map((article) => (
              <button key={article.id} onClick={() => chooseArticle(article.id)} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${selectedId === article.id ? selectedCls : (isDark ? "text-white/65 hover:bg-white/5" : "text-gray-600 hover:bg-gray-50")}`}>
                {!mobile && <span className={`block text-[10px] ${muted}`}>{article.category}</span>}
                <span className="block truncate text-sm">{article.title}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className={`col-span-2 px-3 py-4 text-xs ${muted}`}>{zh ? "没有找到相关主题。" : "No topics found."}</p>}
          </nav>
        </aside>
        <article key={selected.id} className={`min-h-0 flex-1 overflow-y-auto rounded-xl border p-4 sm:p-7 ${surface}`}>
          <div className="mb-2 text-xs font-medium text-violet-500">{selected.category}</div>
          <h2 className="text-xl font-semibold sm:text-2xl">{selected.title}</h2>
          <p className={`mt-2 border-b pb-5 text-sm leading-relaxed ${muted} ${isDark ? "border-white/10" : "border-gray-100"}`}>{selected.summary}</p>
          <div className="max-w-3xl space-y-7 py-5">
            {selected.sections.map((section) => (
              <section key={section.heading}>
                <h3 className="mb-2 text-base font-semibold">{section.heading}</h3>
                {section.paragraphs?.map((paragraph, index) => <p key={index} className={`mb-2 text-sm leading-7 ${muted}`}>{paragraph}</p>)}
                {section.steps && <ol className="space-y-2">
                  {section.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-semibold text-violet-500">{index + 1}</span>
                    <span className={muted}>{step}</span>
                  </li>)}
                </ol>}
              </section>
            ))}
          </div>
          {selected.related?.length ? (
            <section className={`max-w-3xl border-t pt-4 ${isDark ? "border-white/10" : "border-gray-100"}`}>
              <h3 className="mb-2 text-sm font-semibold">{zh ? "相关主题" : "Related topics"}</h3>
              <div className="flex flex-wrap gap-2">
                {selected.related.map((id) => {
                  const article = articles.find((item) => item.id === id);
                  if (!article) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => chooseArticle(id)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${isDark ? "border-white/10 text-white/65 hover:bg-white/10 hover:text-white" : "border-gray-200 text-gray-600 hover:bg-violet-50 hover:text-violet-700"}`}
                    >{article.title}</button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
