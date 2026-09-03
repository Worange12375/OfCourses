import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";

interface Props {
  onClose: () => void;
}

export function CurriculumMapTutorial({onClose}: Props) {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const zh = locale === "zh";

  const bg = isDark ? "bg-[#1e1e2a]" : "bg-white";
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const textDark = isDark ? "text-white" : "text-gray-900";
  const textMuted = isDark ? "text-white/60" : "text-gray-600";
  const textAccent = isDark ? "text-[#c4a3ff]" : "text-[#863bff]";
  const sectionTitle = isDark ? "text-white/90" : "text-gray-800";
  const chip = isDark ? "bg-white/10 text-white/90 border-white/20" : "bg-gray-100 text-gray-700 border-gray-200";

  const steps = [
    {
      title: zh ? "三视图切换" : "3 map views",
      body: zh
        ? "列表图：按“模块→课组→课程”层级浏览，点击即进行展开/折叠；树状图：树状结构更便于你理清模块内容；关系图：查看课程被哪些课组共享、或若干课组有哪些共同课程。"
        : "List view: browse by Module → Group → Course and click to expand/collapse. Tree view: a tree structure that helps you make sense of module contents. Graph view: see which groups a course is shared by, or which courses several groups have in common.",
    },
    {
      title: zh ? "列表图操作" : "List view",
      body: zh
        ? "点击左侧层级可展开或折叠；顶部搜索可帮助你快速定位。可点击右侧的📍以固定对象，使其不会被自动折叠，便于重点跟踪。点「展开全部」或「收起全部」可一次性调整层级。"
        : "Click a level on the left to expand or collapse it. The top search bar helps you locate items quickly. Click the 📍 on the right to pin an item so it won't be auto-collapsed, making it easy to track. Use “Expand All” / “Collapse All” to adjust all levels at once.",
    },
    {
      title: zh ? "树状图操作" : "Tree view",
      body: zh
        ? "树状图以树状结构展示模块内容，你可以像思维导图那样更加直观地看到培养方案结构了，支持搜索和展开/折叠子节点。"
        : "The tree view presents module contents as a tree structure, letting you see the curriculum layout as intuitively as a mind map. It supports search and expanding/collapsing child nodes.",
    },
    {
      title: zh ? "关系图操作" : "Graph view",
      body: zh
        ? "课程视角：点击一门跨组课，会以辐射状方式呈现其属于哪些课组。课组视角：勾选 2–6 个课组，右侧会绘制出它们共同包含的课程关系。"
        : "Course view: click a cross-group course to see the groups it belongs to in a radial layout. Group view: select 2–6 groups and the shared courses among them are drawn on the right.",
    },
    {
      title: zh ? "其他提示" : "Tips",
      body: zh
        ? "鼠标悬停在任意节点上通常能看到完整课程名称和学分信息。上侧滑条可以调整全局呈现的课程总数上限。"
        : "Hover over any node to see its full name and credits. The slider at the top adjusts the maximum number of courses shown globally.",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background: "rgba(0,0,0,0.45)"}}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-xl border shadow-2xl ${bg} ${borderCls}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between border-b px-4 py-3 ${borderCls}`}>
          <div className={`text-sm font-semibold ${textDark}`}>
            {zh ? "培养方案导图使用说明" : "How to use the Curriculum Map"}
          </div>
          <button
            onClick={onClose}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${isDark ? "text-white/60 hover:text-white hover:bg-white/10" : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"}`}
          >
            {zh ? "关闭" : "Close"}
          </button>
        </div>

        <div className={`max-h-[70vh] overflow-y-auto px-4 py-3 text-xs leading-relaxed ${textMuted}`}>
          <div className={`mb-3 ${textAccent}`}>
            {zh
              ? "培养方案导图帮你从多个维度看清课程与课组之间的关系。"
              : "The Curriculum Map helps you understand the relationships between courses and groups from multiple angles."}
          </div>

          {!zh && (
            <div className={`mb-3 rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
              <div className={`mb-1 text-[11px] font-semibold ${sectionTitle}`}>Note on English support</div>
              <div>
                Since the developers have not yet obtained English-language documents for the curriculum, and to avoid possible confusion caused by direct translation, official English support is temporarily unavailable. We appreciate your understanding. If you have any relevant English-language materials, please contact the developers — your help would mean a great deal to us.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <div key={i} className={`rounded-lg border p-3 ${borderCls} ${isDark ? "bg-white/[0.03]" : "bg-gray-50"}`}>
                <div className={`mb-1 flex items-center gap-2 text-[11px] font-semibold ${sectionTitle}`}>
                  <span className={`rounded px-1.5 py-0.5 border ${chip}`}>{i + 1}</span>
                  {s.title}
                </div>
                <div>{s.body}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={`flex justify-end border-t px-4 py-3 ${borderCls}`}>
          <button
            onClick={onClose}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isDark
                ? "bg-white/10 text-white hover:bg-white/20"
                : "bg-[#863bff] text-white hover:bg-[#6b2ecc]"
            }`}
          >
            {zh ? "知道了" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
