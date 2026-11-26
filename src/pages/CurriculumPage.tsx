import {useState, useRef, useCallback, useMemo, useEffect} from "react";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {CurriculumMindMap} from "../components/CurriculumMindMap";
import {CurriculumTreeMap} from "../components/CurriculumTreeMap";
import {CurriculumRelationMap} from "../components/CurriculumRelationMap";
import {CurriculumMapTutorial} from "../components/CurriculumMapTutorial";
import {useOnboarding} from "../onboarding/OnboardingContext";
import {TutorialEntryModal} from "../onboarding/TutorialEntryModal";
import type {TourStep} from "../onboarding/types";
import crossMd from "@/assets/doc/交叉培养指南.md?raw";
// 三版本培养方案/教学计划文档（按当前用户年级加载；2024 沿用人工整理版，2025/2026 由 Word 自动转换）
const yearDocs = import.meta.glob("/src/assets/doc/{2024,2025,2026}/培养方案.md", {eager: true, query: "?raw", import: "default"}) as Record<string, string>;
const yearTeachDocs = import.meta.glob("/src/assets/doc/{2024,2025,2026}/教学计划.md", {eager: true, query: "?raw", import: "default"}) as Record<string, string>;
const docForYear = (map: Record<string, string>, year: string, fallback?: string): string => {
    const hit = Object.entries(map).find(([k]) => k.includes(`/${year}/`));
    return hit?.[1] ?? fallback ?? "";
};
import {useSchemeData} from "../data/schemeStore";
import listIcon from "@/assets/map-icons/list.svg?raw";
import treeIcon from "@/assets/map-icons/tree.svg?raw";
import graphIcon from "@/assets/map-icons/graph.svg?raw";
import {MapIcon} from "../components/MapIcon";

// Import interpretation images via glob
const introImages: {num: number; src: string}[] = Object.entries(
  import.meta.glob("/src/assets/doc/培养方案解读/*.png", {eager: true, query: "?url", import: "default"})
)
  .map(([path, src]) => {
    const match = path.match(/_(\d+)\.png$/);
    return {num: match ? parseInt(match[1], 10) : 0, src: src as string};
  })
  .sort((a, b) => a.num - b.num);


type MapView = "list" | "tree" | "graph";
const MAP_VIEWS: {id: MapView; labelZh: string; labelEn: string; icon: string}[] = [
  {id: "list", labelZh: "列表图", labelEn: "List", icon: listIcon},
  {id: "tree", labelZh: "树状图", labelEn: "Tree", icon: treeIcon},
  {id: "graph", labelZh: "关系图", labelEn: "Graph", icon: graphIcon},
];

interface Tab {
  id: string;
  label: string;
  labelEn: string;
  content: string;
  isImage?: boolean;
}

interface CurriculumPageProps {
  mobile?: boolean;
}

const buildTabs = (schemeYear: string): Tab[] => [
  {id: "plan", label: "培养方案", labelEn: "Curriculum", content: docForYear(yearDocs, schemeYear)},
  {id: "teach", label: "教学计划", labelEn: "Teaching Plan", content: docForYear(yearTeachDocs, schemeYear)},
  {id: "cross", label: "交叉培养指南", labelEn: "Cross Guide", content: crossMd},
  {id: "intro", label: "培养方案解读", labelEn: "Interpretation", content: "", isImage: true},
];

/** Strip markdown artifacts so search matches what the user actually sees */
const stripForSearch = (s: string) => s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ");

/** Count occurrences of `term` in `text` (case-insensitive), mirroring the renderer's highlight logic */
function countMatches(text: string, term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return 0;
  const s = stripForSearch(text).toLowerCase();
  let c = 0;
  let i = 0;
  let idx: number;
  while ((idx = s.indexOf(t, i)) !== -1) {
    c++;
    i = idx + t.length;
  }
  return c;
}

/** Simple inline markdown → JSX renderer, with in-text search highlighting */
const SimpleMarkdown = ({
  text,
  isDark,
  searchTerm,
  activeMatchIdx,
  activeMatchRef,
}: {
  text: string;
  isDark: boolean;
  searchTerm?: string;
  activeMatchIdx?: number;
  activeMatchRef?: React.RefObject<HTMLElement | null>;
}) => {
  const linkCls = isDark ? "text-blue-300" : "text-blue-600";
  const tableBorder = isDark ? "border-white/10" : "border-gray-300";
  const tableBg = isDark ? "bg-white/[0.02]" : "bg-gray-50";
  const tableBgAlt = isDark ? "bg-white/[0.06]" : "bg-white";
  const textCell = isDark ? "text-white/85" : "text-gray-700";
  const textHeader = isDark ? "text-white/90" : "text-gray-800";
  const markActiveCls = isDark ? "bg-yellow-300 text-black" : "bg-yellow-500 text-white";
  const markNormalCls = isDark ? "bg-yellow-500/40 text-white" : "bg-yellow-200 text-gray-900";

  const strip = (s: string) => s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ");
  const stripCell = (s: string) => s.replace(/\*\*/g, "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();

  const rendered = useMemo(() => {
    const term = searchTerm && searchTerm.trim() ? searchTerm.trim() : "";
    const matchState = {count: 0, activeIdx: activeMatchIdx ?? -1, activeRef: activeMatchRef};

    const markNode = (seg: string, key: number): React.ReactNode => {
      const isActive = matchState.count === matchState.activeIdx;
      matchState.count++;
      if (isActive && matchState.activeRef) {
        return (
          <mark key={`mk${key}`} ref={matchState.activeRef as React.Ref<HTMLElement>} className={markActiveCls}>
            {seg}
          </mark>
        );
      }
      return <mark key={`mk${key}`} className={isActive ? markActiveCls : markNormalCls}>{seg}</mark>;
    };

    // Inline formatting: links, **bold**, *italic*
    const applyInline = (str: string): React.ReactNode[] => {
      const out: React.ReactNode[] = [];
      let i = 0;
      let k = 0;
      while (i < str.length) {
        const rest = str.slice(i);
        const linkM = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
        if (linkM) {
          out.push(
            <a key={`il${k++}`} href={linkM[2]} target="_blank" rel="noopener noreferrer" className={`${linkCls} underline`}>
              {linkM[1]}
            </a>,
          );
          i += linkM[0].length;
          continue;
        }
        const bM = /^\*\*(.+?)\*\*/.exec(rest);
        if (bM) {
          out.push(<strong key={`il${k++}`}>{bM[1]}</strong>);
          i += bM[0].length;
          continue;
        }
        const iM = /^\*(.+?)\*/.exec(rest);
        if (iM) {
          out.push(<em key={`il${k++}`}>{iM[1]}</em>);
          i += iM[0].length;
          continue;
        }
        const next = rest.search(/\[|\*\*|\*/);
        if (next === -1) {
          out.push(rest);
          break;
        }
        if (next > 0) {
          out.push(rest.slice(0, next));
          i += next;
        } else {
          out.push(rest[0]);
          i += 1;
        }
      }
      return out;
    };

    // Split by search term and highlight matches, applying inline formatting to the rest
    const renderText = (str: string): React.ReactNode => {
      if (!term) return <>{applyInline(str)}</>;
      const lt = str.toLowerCase();
      const lterm = term.toLowerCase();
      const out: React.ReactNode[] = [];
      let i = 0;
      let idx: number;
      let k = 0;
      while ((idx = lt.indexOf(lterm, i)) !== -1) {
        if (idx > i) out.push(<span key={`s${k++}`}>{applyInline(str.slice(i, idx))}</span>);
        out.push(markNode(str.slice(idx, idx + term.length), k++));
        i = idx + term.length;
      }
      if (i < str.length) out.push(<span key={`s${k++}`}>{applyInline(str.slice(i))}</span>);
      return <>{out}</>;
    };

    const lines = text.split("\n");
    const elements: React.JSX.Element[] = [];
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
                  <th key={i} className={`border px-2 py-1 text-left font-medium ${tableBorder} ${textHeader}`}>{renderText(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? tableBg : tableBgAlt}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={`border px-2 py-0.5 ${tableBorder} ${textCell}`}>{renderText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    };

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
        elements.push(<h6 key={key++} className={`text-xs font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{renderText(stripped.slice(7))}</h6>);
      } else if (trimmed.startsWith("##### ")) {
        elements.push(<h5 key={key++} className={`text-sm font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{renderText(stripped.slice(6))}</h5>);
      } else if (trimmed.startsWith("#### ")) {
        elements.push(<h4 key={key++} className={`text-sm font-semibold mt-2 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{renderText(stripped.slice(5))}</h4>);
      } else if (trimmed.startsWith("### ")) {
        elements.push(<h3 key={key++} className={`text-base font-semibold mt-3 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{renderText(stripped.slice(4))}</h3>);
      } else if (trimmed.startsWith("## ")) {
        elements.push(<h2 key={key++} className={`text-lg font-semibold mt-3 mb-1 ${isDark ? "text-white/90" : "text-gray-800"}`}>{renderText(stripped.slice(3))}</h2>);
      } else if (trimmed.startsWith("# ")) {
        elements.push(<h1 key={key++} className={`text-xl font-bold mt-4 mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>{renderText(stripped.slice(2))}</h1>);
      } else {
        elements.push(
          <p key={key++} className={`text-xs leading-relaxed ${isDark ? "text-white/80" : "text-gray-700"}`}>{renderText(stripped)}</p>,
        );
      }
    }
    flushTable();
    return elements;
  }, [text, isDark, linkCls, tableBorder, tableBg, tableBgAlt, textCell, textHeader, markActiveCls, markNormalCls, searchTerm, activeMatchIdx, activeMatchRef]);

  return <>{rendered}</>;
};

export const CurriculumPage = ({mobile}: CurriculumPageProps) => {
  const {locale} = useLocale();
  const {theme} = useAppTheme();
  const {navigateTo, startTour} = useOnboarding();
  // 当前年级的培养方案版本（未登录回落 2024）；文档 tabs 与之联动
  const {schemeYear} = useSchemeData();
  const TABS = useMemo(() => buildTabs(schemeYear), [schemeYear]);
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState("plan");
  const [leftWidth, setLeftWidth] = useState(40);
  const [mapView, setMapView] = useState<MapView>("list");
  const [showTutorial, setShowTutorial] = useState(false);
  const [showPageTutorial, setShowPageTutorial] = useState(false);
  const [mobileTab, setMobileTab] = useState<"map" | "doc">("map");
  const isDragging = useRef(false);
  const [showFeishuLinks, setShowFeishuLinks] = useState(false);

  const curriculumTourSteps = useMemo<TourStep[]>(() => [
    {
      id: "curriculum-map-views",
      targetPage: "curriculum",
      beforeShow: () => setMobileTab("map"),
      selector: "[data-tour='curriculum-map-views']",
      title: {zh: "切换导图视图", en: "Choose a map view"},
      body: {
        zh: "列表图适合按模块、课组逐层查找；树状图展示整体结构；关系图用于查看课程与课组之间的关联。点击这里切换，数据仍跟随当前年级方案。",
        en: "Use List to browse modules and groups, Tree to see the overall structure, and Graph to explore course-group relationships. Switch views here; the map follows the selected cohort scheme.",
      },
    },
    {
      id: "curriculum-document-tabs",
      targetPage: "curriculum",
      beforeShow: () => setMobileTab("doc"),
      selector: "[data-tour='curriculum-document-tabs']",
      title: {zh: "切换方案资料", en: "Browse curriculum documents"},
      body: {
        zh: "资料栏顶部可以切换培养方案、教学计划和其他已添加资料。不同年级对应不同版本；涉及最新要求时，请以书院正式文件为准。",
        en: "Use the document tabs to switch between the curriculum, teaching plan, and other added materials. Documents vary by cohort; follow the college's official files for current requirements.",
      },
    },
    {
      id: "curriculum-document-search",
      targetPage: "curriculum",
      beforeShow: () => setMobileTab("doc"),
      selector: "[data-tour='curriculum-document-search']",
      title: {zh: "在资料中搜索", en: "Search the documents"},
      body: {
        zh: "输入课程名、课组或关键词查看匹配位置；若其他资料中也有结果，可以从结果提示切换到对应资料。",
        en: "Search for a course, group, or keyword. If other documents also contain matches, use the result notice to switch to them.",
      },
    },
  ], [locale]);

  // ---- Document search state ----
  const [searchTerm, setSearchTerm] = useState("");
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const activeMatchRef = useRef<HTMLElement>(null);
  const scrollNonceRef = useRef(0);
  const [scrollNonce, setScrollNonce] = useState(0);

  const textTabs = TABS.filter((t) => !t.isImage && t.content);
  const matchCounts = useMemo(() => {
    const m: Record<string, number> = {};
    textTabs.forEach((t) => {
      m[t.id] = countMatches(t.content, searchTerm);
    });
    return m;
  }, [searchTerm]);
  const currentCount = matchCounts[activeTab] || 0;
  const otherMatches = textTabs.filter((t) => t.id !== activeTab && (matchCounts[t.id] || 0) > 0);

  const scrollToIndex = (idx: number) => {
    if (currentCount === 0) return;
    // 循环跳转：到末尾再下一个回到 1，到开头再上一个跳到末尾
    const wrapped = ((idx % currentCount) + currentCount) % currentCount;
    setCurrentMatchIdx(wrapped);
    scrollNonceRef.current += 1;
    setScrollNonce(scrollNonceRef.current);
  };
  const prevMatch = () => scrollToIndex(currentMatchIdx - 1);
  const nextMatch = () => scrollToIndex(currentMatchIdx + 1);
  const jumpNearest = () => {
    const container = document.getElementById(`tab-content-${activeTab}`);
    if (!container) return;
    const marks = Array.from(container.querySelectorAll("mark")) as HTMLElement[];
    if (!marks.length) return;
    const top = container.scrollTop;
    let bestIdx = 0;
    let bestDist = Infinity;
    marks.forEach((m, i) => {
      const d = Math.abs(m.offsetTop - top);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    scrollToIndex(bestIdx);
  };

  useEffect(() => {
    if (scrollNonce === 0) return;
    activeMatchRef.current?.scrollIntoView({block: "center", behavior: "smooth"});
  }, [scrollNonce]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

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
  const searchBtnCls = isDark
    ? "rounded px-2 py-1 text-[11px] border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-30 transition-colors"
    : "rounded px-2 py-1 text-[11px] border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-30 transition-colors";

  const switchTab = (id: string) => {
    setActiveTab(id);
    setCurrentMatchIdx(0);
  };

  const mapPanel = (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={mobile ? undefined : {width: `${leftWidth}%`}}
    >
      <div className={`flex h-full flex-col ${bgPanel} ${borderCls} ${mobile ? "" : "border-r"}`}>
        <div className={`flex items-center justify-between px-3 py-2 border-b shrink-0 ${borderCls}`}>
          <span className={`text-xs font-medium ${textMuted}`}>
            {locale === "zh" ? "培养方案导图" : "Curriculum Map"}
          </span>
          {/* 三视图切换器 */}
          <div data-tour="curriculum-map-views" className={`flex rounded-lg border p-0.5 ${borderCls} ${isDark ? "bg-white/5" : "bg-gray-100"}`}>
            {MAP_VIEWS.map((v) => {
              const active = mapView === v.id;
              const color = active
                ? (isDark ? "#c4a3ff" : "#863bff")
                : (isDark ? "rgba(255,255,255,0.5)" : "rgba(55,65,81,0.55)");
              return (
                <button
                  key={v.id}
                  onClick={() => setMapView(v.id)}
                  title={locale === "zh" ? v.labelZh : v.labelEn}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? (isDark ? "bg-white/10 text-white" : "bg-white text-[#863bff] shadow-sm")
                      : (isDark ? "text-white/55 hover:text-white/85" : "text-gray-500 hover:text-gray-800")
                  }`}
                >
                  <MapIcon svg={v.icon} color={color} size={14} />
                  <span>{locale === "zh" ? v.labelZh : v.labelEn}</span>
                </button>
              );
            })}
          </div>

          {/* 导图教程入口 */}
          <button
            onClick={() => setShowTutorial(true)}
            title={locale === "zh" ? "查看使用说明" : "How to use"}
            className={`ml-1 flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold transition-colors ${
              isDark
                ? "border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                : "border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            }`}
          >
            ?
          </button>
        </div>
        {mapView === "list" && <CurriculumMindMap key={schemeYear} mobile={mobile} />}
        {mapView === "tree" && <CurriculumTreeMap key={schemeYear} mobile={mobile} />}
        {mapView === "graph" && <CurriculumRelationMap key={schemeYear} mobile={mobile} />}
      </div>
    </div>
  );

  const docPanel = (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={mobile ? undefined : {width: `${100 - leftWidth}%`}}
    >
      {/* Search bar (persistent, top of document area) */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b shrink-0 ${borderCls} ${bgPanel}`}>
        <input
          data-tour="curriculum-document-search"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentMatchIdx(0);
          }}
          placeholder={locale === "zh" ? "在文档中搜索…" : "Search documents…"}
          className={`flex-1 rounded-md border px-2 py-1 text-xs outline-none ${
            borderCls
          } ${isDark ? "bg-white/5 text-white/90 placeholder-white/30" : "bg-white text-gray-800 placeholder-gray-400"}`}
        />
        {searchTerm.trim() && (
          <>
            <span className={`text-[10px] whitespace-nowrap ${textMuted}`}>
              {currentCount === 0 ? "0/0" : `${Math.min(currentMatchIdx + 1, currentCount)}/${currentCount}`}
            </span>
            <button onClick={jumpNearest} disabled={currentCount === 0} className={searchBtnCls}>
              {locale === "zh" ? "最近" : "Nearest"}
            </button>
            <button onClick={prevMatch} disabled={currentCount === 0} className={searchBtnCls}>
              {locale === "zh" ? "上一个" : "Prev"}
            </button>
            <button onClick={nextMatch} disabled={currentCount === 0} className={searchBtnCls}>
              {locale === "zh" ? "下一个" : "Next"}
            </button>
          </>
        )}
      </div>

      {/* Hint: other docs also have matches */}
      {searchTerm.trim() && otherMatches.length > 0 && (
        <div className={`flex flex-wrap items-center gap-2 px-3 py-1 text-[10px] border-b ${borderCls} ${bgPanel} ${textMuted}`}>
          <span>{locale === "zh" ? "其他文档也有匹配：" : "Also in:"}</span>
          {otherMatches.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`rounded px-2 py-0.5 border ${borderCls} ${
                isDark ? "bg-white/5 hover:bg-white/10 text-white/80" : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }`}
            >
              {locale === "zh" ? t.label : t.labelEn} ({matchCounts[t.id]})
            </button>
          ))}
        </div>
      )}

      <div data-tour="curriculum-document-tabs" className={`flex items-center border-b shrink-0 ${borderCls} ${bgPanel}`}>
        <div className="flex items-center overflow-x-auto flex-1 px-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`cursor-pointer border-none px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? `${tabActiveBg} ${tabActiveText}`
                  : `${textMuted} hover:${isDark ? "bg-white/5" : "bg-gray-100"}`
              }`}
            >
              {locale === "zh" ? tab.label : tab.labelEn}
            </button>
          ))}
          <button onClick={() => setShowFeishuLinks(true)} className={`cursor-pointer border-none px-2 py-2 text-xs font-medium transition-colors ${
            isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
          }`}>
            +
          </button>
          <button
            type="button"
            onClick={() => setShowPageTutorial(true)}
            title={locale === "zh" ? "培养方案页面引导" : "Curriculum page guide"}
            aria-label={locale === "zh" ? "培养方案页面引导" : "Curriculum page guide"}
            className={`mx-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${isDark ? "border-white/15 text-white/60 hover:bg-white/10" : "border-gray-200 text-gray-500 hover:bg-gray-100"}`}
          >?</button>
          {showFeishuLinks && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}} onClick={() => setShowFeishuLinks(false)}>
              <div className={`w-80 rounded-xl shadow-2xl border px-5 py-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`} onClick={(e) => e.stopPropagation()}>
                <div className={`text-sm font-semibold mb-3 ${textDark}`}>
                  {locale === "zh" ? "文档链接" : "Documents"}
                </div>
                <div className="flex flex-col gap-2 text-xs">
                  <a href="https://cloud.tsinghua.edu.cn/d/f79958a3677843ffabd5/" target="_blank" rel="noopener noreferrer"
                     className={`block rounded px-3 py-2 transition-colors ${
                       isDark ? "bg-blue-500/10 text-blue-300 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                     }`}>
                    {locale === "zh" ? "📄 最新版培养方案云盘链接" : "📄 Latest Curriculum Plan (Cloud)"}
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
        {TABS.map((tab) => (
          <div
            key={tab.id}
            id={`tab-content-${tab.id}`}
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
              <SimpleMarkdown
                text={tab.content}
                isDark={isDark}
                searchTerm={searchTerm}
                activeMatchIdx={tab.id === activeTab ? currentMatchIdx : -1}
                activeMatchRef={tab.id === activeTab ? activeMatchRef : undefined}
              />
            ) : (
              <div className={`flex h-full items-center justify-center text-xs ${textMuted}`}>
                {locale === "zh" ? "文档加载中..." : "Loading document..."}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-1 min-h-0 flex-col ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      {mobile ? (
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {mobileTab === "map" ? mapPanel : docPanel}
          </div>
          <nav className={`shrink-0 flex border-t ${isDark ? "border-white/10 bg-[#16161f]" : "border-gray-200 bg-white"}`}>
            <button
              onClick={() => setMobileTab("map")}
              className={`flex-1 py-3 text-sm font-medium ${
                mobileTab === "map"
                  ? (isDark ? "text-blue-300" : "text-blue-600")
                  : (isDark ? "text-white/50" : "text-gray-500")
              }`}
            >
              {locale === "zh" ? "导图" : "Map"}
            </button>
            <button
              onClick={() => setMobileTab("doc")}
              className={`flex-1 py-3 text-sm font-medium ${
                mobileTab === "doc"
                  ? (isDark ? "text-blue-300" : "text-blue-600")
                  : (isDark ? "text-white/50" : "text-gray-500")
              }`}
            >
              {locale === "zh" ? "方案" : "Docs"}
            </button>
            <button
              type="button"
              onClick={() => setShowPageTutorial(true)}
              title={locale === "zh" ? "培养方案页面引导" : "Curriculum page guide"}
              aria-label={locale === "zh" ? "培养方案页面引导" : "Curriculum page guide"}
              className={`shrink-0 px-4 text-sm font-medium ${isDark ? "text-white/50" : "text-gray-500"}`}
            >?</button>
          </nav>
        </div>
      ) : (
        <div id="curriculum-split" className="flex flex-1 overflow-hidden">
          {mapPanel}
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
          {docPanel}
        </div>
      )}

      {showTutorial && <CurriculumMapTutorial
        onClose={() => setShowTutorial(false)}
        onStart={() => { setShowTutorial(false); startTour(curriculumTourSteps.slice(0, 1)); }}
        onOpenWiki={() => { setShowTutorial(false); navigateTo("guide", "curriculum-map"); }}
      />}
      {showPageTutorial && <TutorialEntryModal
        title={locale === "zh" ? "培养方案页面" : "Curriculum page"}
        description={locale === "zh" ? "了解导图视图、方案资料和文档搜索。" : "Learn about map views, curriculum documents, and document search."}
        onStart={() => { setShowPageTutorial(false); startTour(curriculumTourSteps); }}
        onOpenWiki={() => { setShowPageTutorial(false); navigateTo("guide", "curriculum"); }}
        onClose={() => setShowPageTutorial(false)}
      />}
    </div>
  );
};
