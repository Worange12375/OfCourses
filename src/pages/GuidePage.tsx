import {useEffect, useMemo, useState} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

type GuideId = "getting-started" | "workspace" | "curriculum" | "curriculum-map" | "degree" | "ai-assistant" | "course-reviews" | "faq";
type GuideArticle = {id: GuideId; category: string; title: string; summary: string; sections: {heading: string; paragraphs?: string[]; steps?: string[]}[]};

const GUIDE_ZH: GuideArticle[] = [
  {id: "getting-started", category: "入门", title: "从哪里开始使用", summary: "先录入已有课程，再规划下一学期；不必一次看完所有功能。", sections: [
    {heading: "推荐的上手顺序", paragraphs: ["OfCourses 用于整理选课记录、辅助规划后续学期，并查看培养方案相关信息。第一次使用时，建议先完成最基本的课程记录，再按需要打开其他工具。"], steps: ["进入「工作台」，导入已有选课记录，或手动添加课程。", "确认当前年级与学期设置，再选择要规划的目标学期。", "在课程目录中搜索课程并加入预选，留意学分与时间冲突提示。", "保存到历史记录；需要备份或迁移时，可导出本地文件。", "需要解释规则或评估方案时，再打开「综合工具」中的学位评定或 AI 助手。"]},
    {heading: "数据从哪里来", paragraphs: ["选课记录可以在浏览器本地维护，也可以在登录后使用云端方案功能。需要在不同设备间继续编辑时，先确认当前账号和同步状态。导入、导出前请保管好包含个人选课信息的文件。"]},
  ]},
  {id: "workspace", category: "工作台", title: "工作台：记录与规划课程", summary: "了解历史记录、预选列表、课程目录和保存方式。", sections: [
    {heading: "页面区域", paragraphs: ["工作台围绕课程记录和学期规划展开。历史记录用于维护已修或正在修读的课程；预选区域用于整理目标学期的候选课程；课程目录可搜索并筛选课程。具体排列会随屏幕模式变化。"]},
    {heading: "建立一个学期计划", steps: ["检查年级和目标学期。", "从目录搜索课程，点击课程旁的添加操作放入预选列表。", "按提示处理冲突、学分和课程类别等信息。", "确认后保存到历史记录，或导出文件作为本地备份。"]},
    {heading: "本地与云端", paragraphs: ["本地数据保存在当前浏览器中；清理浏览器数据或更换设备前请先导出备份。登录后可使用云端方案相关能力。云端状态和按钮提示以页面当前显示为准。"]},
  ]},
  {id: "curriculum", category: "培养方案", title: "查阅培养方案", summary: "按年级查看培养方案、教学安排和相关解读资料。", sections: [
    {heading: "选择对应年级", paragraphs: ["培养方案内容会随所选年级版本变化。查看课程要求前，先确认页面当前使用的年级；不同年级的课组与要求可能不同。"]},
    {heading: "使用页面资料", paragraphs: ["培养方案页提供方案内容、教学计划以及页面收录的解读资料。资料用于辅助理解，涉及学籍、选课资格和最新政策时，请以书院或教务部门的正式通知为准。"]},
  ]},
  {id: "curriculum-map", category: "培养方案", title: "培养方案导图", summary: "用列表、树状图和关系图观察课程、课组与模块的联系。", sections: [
    {heading: "选择视图", paragraphs: ["列表图按模块、课组和课程层级浏览；树状图以结构关系展示方案；关系图用于查看课程与课组之间的共享关系。"]},
    {heading: "搜索与展开", paragraphs: ["在列表或树状视图中使用搜索定位课程或课组，并展开需要查看的层级。列表视图支持固定对象，减少自动折叠对重点内容的影响。关系图可以从课程或课组角度查看关联内容。"]},
    {heading: "版本提示", paragraphs: ["导图会跟随当前年级方案切换。方案说明用于辅助浏览，具体要求请核对对应年级的正式培养方案文件。"]},
  ]},
  {id: "degree", category: "综合工具", title: "学位评定", summary: "查看学位轨道进度，并了解未满足的课程或学分要求。", sections: [
    {heading: "查看评定结果", paragraphs: ["学位评定根据当前课程数据和培养方案版本展示不同轨道的完成情况。若结果与预期不符，先检查年级、课程记录、学分以及课程所属课组。"]},
    {heading: "手动选择条件", paragraphs: ["部分轨道支持指定模块或专业组合。调整选项后，页面会按所选条件更新对应进度；评定结果属于规划参考，最终要求以正式培养方案和书院认定为准。"]},
  ]},
  {id: "ai-assistant", category: "综合工具", title: "AI 选课助手", summary: "结合课程与培养方案信息回答选课规划问题。", sections: [
    {heading: "开始提问", steps: ["先在工作台核对课程记录；如需关联其他数据，可按页面提供的导入方式操作。", "在综合工具中打开 AI 推荐助手，明确你的年级、目标学期和关注点。", "复杂规划可以拆成几步提问，并追问单门课程的推荐理由。", "重要结论可导出对话记录，方便后续核对。"]},
    {heading: "使用边界", paragraphs: ["AI 输出可能有遗漏或错误，仅作为规划参考。课程政策、开课安排和选课资格请核对官方信息；避免在对话中输入不必要的敏感个人信息。"]},
  ]},
  {id: "course-reviews", category: "综合工具", title: "课程评价", summary: "搜索课程评价、查看热门内容并分享真实上课体验。", sections: [
    {heading: "查找评价", paragraphs: ["输入课程名称搜索对应评价，也可以使用页面提供的筛选、最新或热门排序。课程评价页的规则说明会介绍发布要求和互动方式。"]},
    {heading: "发布与管理", paragraphs: ["登录后按页面提示选择课程并填写评价。请围绕真实修读体验表达，避免泄露自己或他人的敏感信息。已发布内容可在「我的评价」中查看和管理。"]},
  ]},
  {id: "faq", category: "常见问题", title: "常见问题", summary: "遇到数据、页面版本或设备显示问题时先检查这些设置。", sections: [
    {heading: "刷新后页面或设置变化", paragraphs: ["网站会尽量保留上次所在页面和浏览器中的语言、主题设置。如果页面提示有新版本，按提示刷新以加载最新前端资源。"]},
    {heading: "数据没有出现在另一台设备", paragraphs: ["本地浏览器数据不会自动出现在其他设备。请检查是否登录并使用云端方案，或者在原设备导出后于目标设备导入。"]},
    {heading: "手机上显示为电脑布局", paragraphs: ["手机浏览器的「电脑模式」会改变页面检测结果。可使用导航栏或设置中的设备模式选项切换到适合当前屏幕的布局。"]},
  ]},
];

const GUIDE_EN: GuideArticle[] = [
  {id: "getting-started", category: "Getting started", title: "Where to start", summary: "Add your course history, then plan a semester. You can explore other tools as needed.", sections: [
    {heading: "A suggested first session", paragraphs: ["OfCourses helps you organize course history, plan future semesters, and review curriculum information. Start with the records you need; you do not need to learn every feature at once."], steps: ["Open Workspace and import your course history or add courses manually.", "Check your cohort and semester settings, then choose a target semester.", "Search the catalog and add courses to your plan; review credit and conflict notices.", "Save your plan to history. Export a local backup when needed.", "Open Degree Evaluation or the AI Assistant when you need planning help."]},
    {heading: "Where your data lives", paragraphs: ["Course records can be maintained in this browser or with cloud-plan features after signing in. Check the current account and sync status before continuing on another device. Keep exported files containing personal course data secure."]},
  ]},
  {id: "workspace", category: "Workspace", title: "Workspace: record and plan courses", summary: "Learn about course history, the plan, catalog, and saving options.", sections: [
    {heading: "Page areas", paragraphs: ["Workspace brings together course records and semester planning. History stores completed or current courses; the plan holds candidate courses for a target semester; the catalog lets you search and filter courses. The layout adapts to your screen mode."]},
    {heading: "Create a semester plan", steps: ["Check your cohort and target semester.", "Search the catalog and add courses to the plan.", "Review any conflict, credit, or course-category notices.", "Save the result to history or export a local backup."]},
    {heading: "Local and cloud data", paragraphs: ["Local data stays in the current browser. Export a backup before clearing browser data or changing devices. Cloud-plan features are available after signing in; follow the status shown in the app."]},
  ]},
  {id: "curriculum", category: "Curriculum", title: "Browse the curriculum", summary: "View curriculum plans, teaching schedules, and related materials by cohort.", sections: [
    {heading: "Choose the right cohort", paragraphs: ["Curriculum content depends on the selected cohort. Check the cohort version before reviewing course requirements, as groups and rules may differ."]},
    {heading: "Use the materials", paragraphs: ["The page includes curriculum content, teaching plans, and available explanatory materials. These are for reference; use official college or academic-affairs notices for current policies and eligibility."]},
  ]},
  {id: "curriculum-map", category: "Curriculum", title: "Curriculum map", summary: "Explore links among courses, groups, and modules in list, tree, and graph views.", sections: [
    {heading: "Choose a view", paragraphs: ["List view follows the module, group, and course hierarchy. Tree view shows the structure. Graph view helps inspect relationships between courses and groups."]},
    {heading: "Search and expand", paragraphs: ["Search in list or tree view to locate a course or group, then expand the levels you need. The list view can pin an item to keep it from being collapsed. Graph view offers course- and group-focused exploration."]},
    {heading: "Cohort versions", paragraphs: ["The map follows the selected cohort. Verify requirements against the official curriculum document for that cohort."]},
  ]},
  {id: "degree", category: "Tools", title: "Degree evaluation", summary: "Review progress across degree tracks and identify outstanding requirements.", sections: [
    {heading: "Read the results", paragraphs: ["Evaluation uses your course data and selected curriculum version. If the result looks unexpected, check your cohort, course records, credits, and group assignments."]},
    {heading: "Manual options", paragraphs: ["Some tracks let you select a module or major combination. Results are planning references; the official curriculum and college determine final requirements."]},
  ]},
  {id: "ai-assistant", category: "Tools", title: "AI course assistant", summary: "Ask course-planning questions using course and curriculum information.", sections: [
    {heading: "Ask a question", steps: ["Check your course history in Workspace, or import data using the options shown in the app.", "Open the AI Assistant and specify your cohort, target semester, and goal.", "Break complex planning into smaller questions and ask for reasons behind suggestions.", "Export important conversations so you can review them later."]},
    {heading: "Limitations", paragraphs: ["AI responses may be incomplete or incorrect and should be treated as planning references. Verify policies, course availability, and eligibility with official sources. Avoid sharing unnecessary sensitive information."]},
  ]},
  {id: "course-reviews", category: "Tools", title: "Course reviews", summary: "Search reviews, explore popular posts, and share your real class experience.", sections: [
    {heading: "Find reviews", paragraphs: ["Search by course name and use the available filters or latest/popular sorting. The rules panel explains posting and interaction guidelines."]},
    {heading: "Post and manage", paragraphs: ["After signing in, choose a course and follow the form. Focus on your actual experience and avoid revealing sensitive information. Use My Reviews to manage your posts."]},
  ]},
  {id: "faq", category: "FAQ", title: "Frequently asked questions", summary: "Check these settings when data, versions, or screen layouts look unexpected.", sections: [
    {heading: "Page or settings changed after refresh", paragraphs: ["The app tries to restore your last page and browser-stored language and theme. If the app reports a newer version, refresh to load the latest frontend files."]},
    {heading: "Data is missing on another device", paragraphs: ["Local browser data does not automatically move between devices. Sign in and use cloud plans, or export from the original device and import on the new one."]},
    {heading: "Desktop layout on a phone", paragraphs: ["A browser's desktop-site mode changes how the page detects the device. Use the device-mode control in the app to choose a layout for your screen."]},
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
        </article>
      </div>
    </main>
  );
}
