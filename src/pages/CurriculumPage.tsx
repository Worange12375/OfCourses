import {useState, useRef, useCallback, useMemo} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import planMd from "@/assets/doc/培养方案.md?raw";
import teachMd from "@/assets/doc/教学计划.md?raw";
import crossMd from "@/assets/doc/交叉培养指南.md?raw";

// Import interpretation images via glob
const introImages: {num: number; src: string}[] = Object.entries(
  import.meta.glob("/src/assets/doc/培养方案解读/*.png", {eager: true, query: "?url", import: "default"})
)
  .map(([path, src]) => {
    const match = path.match(/_(\d+)\.png$/);
    return {num: match ? parseInt(match[1], 10) : 0, src: src as string};
  })
  .sort((a, b) => a.num - b.num);

interface Tab {
  id: string;
  label: string;
  content: string;
  isImage?: boolean;
}

const DEFAULT_TABS: Tab[] = [
  {id: "plan", label: "培养方案", content: planMd},
  {id: "teach", label: "教学计划", content: teachMd},
  {id: "cross", label: "交叉培养指南", content: crossMd},
  {id: "intro", label: "培养方案解读", content: "", isImage: true},
];

/** Simple inline markdown → JSX renderer */
const SimpleMarkdown = ({text, isDark}: {text: string; isDark: boolean}) => {
  const linkCls = isDark ? "text-blue-300" : "text-blue-600";
  const tableBorder = isDark ? "border-white/10" : "border-gray-300";
  const tableBg = isDark ? "bg-white/[0.02]" : "bg-gray-50";
  const tableBgAlt = isDark ? "bg-white/[0.06]" : "bg-white";
  const textCell = isDark ? "text-white/85" : "text-gray-700";
  const textHeader = isDark ? "text-white/90" : "text-gray-800";

  const rendered = useMemo(() => {
    const lines = text.split("\n");
    const elements: JSX.Element[] = [];
    let key = 0;

    let inTable = false;
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];
    let tableKey = 0;

    const flushTable = () => {
      if (!inTable) return;
      inTable = false;
      const hdr = tableHeaders;
      const rows = [...tableRows];
      tableHeaders = [];
      tableRows = [];

      if (hdr.length === 0) return;
      elements.push(
        <div key={`t${tableKey++}`} className="overflow-x-auto my-2">
          <table className={`w-full text-xs border-collapse ${tableBorder}`}>
            <thead>
              <tr className={tableBg}>
                {hdr.map((h, i) => (
                  <th key={i} className={`border px-2 py-1 text-left font-medium ${tableBorder} ${textHeader}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? tableBg : tableBgAlt}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`border px-2 py-0.5 ${tableBorder} ${textCell}`}>{cell || " "}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    const strip = (s: string) => s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ");
    const stripCell = (s: string) => s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        // Keep empty cells — slice off leading/trailing empty from split
        const cells = trimmed.split("|").slice(1, -1).map((c) => stripCell(c));
        if (cells.length > 0 && cells.every((c) => /^-+$/.test(c))) continue;
        if (!inTable) {
          inTable = true;
          tableHeaders = cells;
        } else {
          tableRows.push(cells);
        }
        continue;
      } else {
        flushTable();
      }

      if (!trimmed) {
        elements.push(<div key={key++} className="h-2" />);
        continue;
      }

      const stripped = strip(trimmed);
      if (trimmed.startsWith("###### ")) {
        elements.push(<h6 key={key++} className={`text-xs font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{stripped.slice(7)}</h6>);
      } else if (trimmed.startsWith("##### ")) {
        elements.push(<h5 key={key++} className={`text-sm font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{stripped.slice(6)}</h5>);
      } else if (trimmed.startsWith("#### ")) {
        elements.push(<h4 key={key++} className={`text-sm font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{stripped.slice(5)}</h4>);
      } else if (trimmed.startsWith("### ")) {
        elements.push(<h3 key={key++} className={`text-base font-semibold mt-3 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{stripped.slice(4)}</h3>);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<h2 key={key++} className={`text-lg font-semibold mt-3 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{stripped.slice(3)}</h2>);
      } else if (trimmed.startsWith("# ")) {
        elements.push(<h1 key={key++} className={`text-xl font-bold mt-4 mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>{stripped.slice(2)}</h1>);
      } else {
        let html = trimmed
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/\[(.+?)\]\((.+?)\)/g, `<a href="$2" class="${linkCls} underline">$1</a>`);
        elements.push(
          <p key={key++} className={`text-xs leading-relaxed ${isDark ? "text-white/80" : "text-gray-700"}`}
             dangerouslySetInnerHTML={{__html: html}} />
        );
      }
    }
    flushTable();
    return elements;
  }, [text, isDark, linkCls, tableBorder, tableBg, tableBgAlt, textCell, textHeader]);

  return <>{rendered}</>;
};

export const CurriculumPage = () => {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState("plan");
  const [leftWidth, setLeftWidth] = useState(40);
  const isDragging = useRef(false);
  const [showFeishuLinks, setShowFeishuLinks] = useState(false);

  const tabs = DEFAULT_TABS;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = leftWidth;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const container = document.getElementById("curriculum-split");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.max(20, Math.min(60, pct)));
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [leftWidth]);

  const bgPanel = isDark ? "bg-[#14141e]" : "bg-white";
  const textMuted = isDark ? "text-white/50" : "text-gray-500";
  const textDark = isDark ? "text-white/90" : "text-gray-800";
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const tabActiveBg = isDark ? "bg-white/10" : "bg-gray-100";
  const tabActiveText = isDark ? "text-white" : "text-gray-900";

  return (
    <div className={`flex h-full flex-col ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      <div id="curriculum-split" className="flex flex-1 overflow-hidden">
        {/* ===== LEFT: Mind Map placeholder ===== */}
        <div
          className="h-full flex flex-col overflow-hidden"
          style={{width: `${leftWidth}%`}}
        >
          <div className={`flex h-full flex-col ${bgPanel} ${borderCls} border-r`}>
            <div className={`flex items-center px-4 py-2 border-b text-xs font-medium shrink-0 ${borderCls} ${textMuted}`}>
              {locale === "zh" ? "培养方案导图" : "Curriculum Map"}
            </div>
            <div className={`flex flex-1 items-center justify-center ${isDark ? "text-white/30" : "text-gray-400"}`}>
              <div className="text-center">
                <div className="text-4xl mb-2">🔧</div>
                <div className="text-xs">{locale === "zh" ? "培养方案导图（开发中）" : "Curriculum Map (Coming Soon)"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Draggable divider ===== */}
        <div
          className={`w-1 cursor-col-resize shrink-0 relative transition-colors ${
            isDark ? "hover:bg-blue-500/30 bg-white/5" : "hover:bg-blue-400/40 bg-gray-200"
          }`}
          onMouseDown={handleMouseDown}
        >
          <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full ${
            isDark ? "bg-white/20" : "bg-gray-300"
          }`} />
        </div>

        {/* ===== RIGHT: Tabbed document viewer ===== */}
        <div
          className="h-full flex flex-col overflow-hidden"
          style={{width: `${100 - leftWidth}%`}}
        >
          <div className={`flex items-center border-b shrink-0 ${borderCls} ${bgPanel}`}>
            <div className="flex items-center overflow-x-auto flex-1 px-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`cursor-pointer border-none px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? `${tabActiveBg} ${tabActiveText}`
                      : `${textMuted} hover:${isDark ? "bg-white/5" : "bg-gray-100"}`
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <button onClick={() => setShowFeishuLinks(true)} className={`cursor-pointer border-none px-2 py-2 text-xs font-medium transition-colors ${
                isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
              }`}>
                +
              </button>
              {showFeishuLinks && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}} onClick={() => setShowFeishuLinks(false)}>
                  <div className={`w-80 rounded-xl shadow-2xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                    <div className={`text-sm font-semibold mb-3 ${textDark}`}>
                      {locale === "zh" ? "飞书云文档链接" : "Feishu Cloud Docs"}
                    </div>
                    <div className="flex flex-col gap-2 text-xs">
                      <a href="https://rcnys7k0b04o.feishu.cn/docx/D3bxddmpkoX92NxDpSscuOZrnRg" target="_blank" rel="noopener noreferrer"
                         className={`block rounded px-3 py-2 transition-colors ${
                           isDark ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                         }`}>
                        {locale === "zh" ? "📄 培养方案" : "📄 Curriculum Plan"}
                      </a>
                      <a href="https://rcnys7k0b04o.feishu.cn/docx/B4LWdkTx6oxhqfxe8WWccrTVndd" target="_blank" rel="noopener noreferrer"
                         className={`block rounded px-3 py-2 transition-colors ${
                           isDark ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                         }`}>
                        {locale === "zh" ? "📄 教学计划" : "📄 Teaching Plan"}
                      </a>
                      <a href="https://rcnys7k0b04o.feishu.cn/docx/EKC0d5ciXolXj9xQrh4cCSf7n6J" target="_blank" rel="noopener noreferrer"
                         className={`block rounded px-3 py-2 transition-colors ${
                           isDark ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                         }`}>
                        {locale === "zh" ? "📄 交叉培养指南" : "📄 Cross-Disciplinary Guide"}
                      </a>
                    </div>
                    <div className={`text-[10px] mt-3 text-center ${textMuted}`}>
                      {locale === "zh" ? "更多内容正在开发中，敬请期待！" : "More content coming soon!"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${bgPanel}`}>
            {/* Each tab has its own scrollable container with independent scroll position */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`flex-1 overflow-auto px-4 py-3 ${tab.id === activeTab ? "block" : "hidden"}`}
              >
                {tab.id === "intro" ? (
                  <div className="flex flex-col items-center gap-4 pb-8">
                    <div className={`text-xs text-center mb-2 ${textMuted}`}>
                      {locale === "zh"
                        ? `笃实书院培养方案解读（共${introImages.length}页）`
                        : `Curriculum Interpretation (${introImages.length} pages)`}
                    </div>
                    {introImages.length === 0 ? (
                      <div className={`text-xs ${textMuted}`}>
                        {locale === "zh" ? "图片加载中..." : "Loading images..."}
                      </div>
                    ) : (
                      introImages.map(({num, src}) => (
                        <div key={num} className="w-full max-w-3xl">
                          <div className={`text-[10px] mb-1 ${textMuted}`}>
                            {locale === "zh" ? `第${num}页` : `Page ${num}`}
                          </div>
                          <img
                            src={src}
                            alt={`培养方案解读第${num}页`}
                            className="w-full h-auto rounded-lg border"
                            style={{borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}}
                            loading="lazy"
                          />
                        </div>
                      ))
                    )}
                  </div>
                ) : tab.content ? (
                  <SimpleMarkdown text={tab.content} isDark={isDark} />
                ) : (
                  <div className={`flex h-full items-center justify-center text-xs ${textMuted}`}>
                    {locale === "zh" ? "文档加载中..." : "Loading document..."}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};