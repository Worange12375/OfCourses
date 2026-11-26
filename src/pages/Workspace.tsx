import {useState, useMemo, useRef, useEffect} from "react";
import Button from "@jetbrains/ring-ui-built/components/button/button";
import Input from "@jetbrains/ring-ui-built/components/input/input";
import Island, {Content, Header} from "@jetbrains/ring-ui-built/components/island/island";
import Select, {type SelectItem} from "@jetbrains/ring-ui-built/components/select/select";
import {type NavPage} from "../components/Navbar";
import {useLocale} from "../i18n/LocaleContext";
import {useAppTheme} from "../theme/ThemeContext";
import {useSemester} from "../hooks/SemesterContext";
import {
  useCourses,
  useSemesterCourses,
  useModules,
  useAllSemesters,
  useCourseGroups,
  useTName,
} from "../hooks/useCurriculumData";
import {useSchemeData} from "@/data/schemeStore";
import enData from "@/data/courses_en.json";
import type {Course} from "@/types/curriculum";
import {ATTR_LABELS, ATTR_LABELS_EN, cohortScoringTables} from "../utils/recommend";
import {SchemeManageModal} from "../account/SchemeManageModal";
import {useAccount} from "../account/AccountContext";

// 自定义课程属性的双语标签（"通识-艺术" 等），用于通识学分统计展示
const GE_PROP_LABELS: Record<string, {zh: string; en: string}> = {
  "通识-艺术": {zh: "艺术", en: "Art"},
  "通识-社科": {zh: "社科", en: "Social Sci"},
  "通识-人文": {zh: "人文", en: "Humanities"},
  "通识-科学": {zh: "科学", en: "Natural Sci"},
  "SRT": {zh: "SRT", en: "SRT"},
  "思政限选": {zh: "思政限选", en: "Pol. Elective"},
};
const geLabelFor = (k: string, locale: string) =>
  GE_PROP_LABELS[k]?.[locale === "zh" ? "zh" : "en"] ?? k;

interface WorkspaceProps {
  onNavigate?: (page: NavPage) => void;
  /** 移动端模式：底部两段 Tab（目录/历史）+ 预选抽屉 */
  mobile?: boolean;
}

interface FilterState {
  group: string;
  semester: string;
  module: string;
  abGroup: string;
}

/** Foundation category labels — zh */
const FOUNDATION_ZH: Record<string, string> = {
  MATH_BASIS: "数学基础",
  PHY_BASIS: "物理基础",
  CS_BASIS: "信智基础",
  ME_BASIS: "机电基础",
  COMP_BASIS: "计算基础",
  OR_STAT: "运筹统计",
  MECH_BASIS: "力学基础",
  SHUYUAN_GE: "书院通识",
  SHIJIAN: "进阶实践",
};

/** Foundation category labels — en (short) */
const FOUNDATION_EN: Record<string, string> = {
  MATH_BASIS: "Math Found.",
  PHY_BASIS: "Physics Found.",
  CS_BASIS: "CS & AI Found.",
  ME_BASIS: "ME Found.",
  COMP_BASIS: "Computing",
  OR_STAT: "OR & Stat.",
  MECH_BASIS: "Mech. Found.",
  SHUYUAN_GE: "Academy GE",
  SHIJIAN: "Practice",
};

/** Abbreviate semester: "大一·开学前（军训）" → "大一夏" */
const abbreviateSemester = (sem: string): string =>
  sem
    .replace("·开学前（军训）", "军")
    .replace("·秋季", "秋")
    .replace("·春季", "春")
    .replace("·夏季", "夏");

interface NativeSelectProps {
  value: string;
  options: {key: string | number; label: React.ReactNode; disabled?: boolean}[];
  onChange: (key: string) => void;
  className?: string;
  dark?: boolean;
  borderCls?: string;
  textMuted?: string;
}

const NativeSelect = ({value, options, onChange, className, dark, borderCls, textMuted}: NativeSelectProps) => (
  <div className={`relative ${className ?? ""}`}>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full appearance-none rounded-md border px-2.5 py-1.5 pr-8 text-xs outline-none ${borderCls ?? ""} ${dark ? "bg-[#1e1e2a] text-white/90" : "bg-white text-gray-800"}`}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key} disabled={o.disabled}>{o.label}</option>
      ))}
    </select>
    <span className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs ${textMuted ?? ""}`}>▼</span>
  </div>
);

/** Module ID → 类 label */
const moduleTypeLabel = (modId: number): string =>
  modId <= 3 ? "I" : modId <= 8 ? "II" : "III";

/** Format module option display */
const formatModuleOption = (modId: number, name: string, locale: string): string =>
  locale === "zh" ? `模块${modId}：${name}` : `Module ${modId}: ${name}`;

export const Workspace = ({onNavigate: _onNavigate, mobile = false}: WorkspaceProps) => {
  // 当前年级的培养方案数据（切年级时引用变化，驱动下方 useMemo 重算）
  // 响应式年级数据：年级切换（登录/手动）时组件重渲染并拿到新方案
  const {structuredData, schemeYear} = useSchemeData();
  const {t, locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const {semester: currentSemester, semesterAuto} = useSemester();
  const {tName, tModule, tSemester, tGroup} = useTName();

  const [leftExpanded, setLeftExpanded] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    group: "all", semester: "all", module: "all", abGroup: "all",
  });
  // 移动端：搜索与筛选侧边栏默认关闭（抽屉式），点击展开按钮从左侧滑出占 80% 宽度
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  // 抽屉滑动手势状态（从右向左滑关闭）
  const filterDragRef = useRef<{startX: number; startY: number; startT: number; currentX: number} | null>(null);
  const [filterDragging, setFilterDragging] = useState(false);
  const [filterTranslate, setFilterTranslate] = useState(0);
  // 移动端首次进入课程目录时，短暂显示的引导提示条（仅触发一次）
  const [showFilterHint, setShowFilterHint] = useState(false);
  const filterHintShownRef = useRef(false);
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  /** 编辑来源学期：从选课历史点「编辑」进入时记录该学期；编辑中该学期课程在目录置顶、对勾按预选态显示。
   *  退出编辑态的时机：保存成功 / 点击取消修改 / 切换预选学期（删除、新增课程不退出）。 */
  const [editingFromHistory, setEditingFromHistory] = useState<string | null>(null);
  /** 编辑态下被软删除的课程（编辑学期原有的课）：预选栏划线展示、可恢复，保存时剔除。 */
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [detailCourse, setDetailCourse] = useState<Course | null>(null);
  const [savedHistory, setSavedHistory] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("oc_history") ?? "{}"); }
    catch { return {}; }
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  /** 取消修改/清空预选 的确认弹窗 */
  const [cancelConfirm, setCancelConfirm] = useState(false);
  /** 编辑学期 A 时点击学期 B 的编辑：待确认的切换意图（确认后保存 A / 放弃 A 再进 B） */
  const [pendingEditSwitch, setPendingEditSwitch] = useState<{ sem: string; savedIds: string[] } | null>(null);
  const [stagingSemester, setStagingSemester] = useState<string>("");
  const [customCourses, setCustomCourses] = useState<Record<string, Array<{id: string; name: string; credits: number; property?: string}>>>(() => {
    try { return JSON.parse(localStorage.getItem("oc_custom") ?? "{}"); }
    catch { return {}; }
  });
  const [customName, setCustomName] = useState("");
  const [customCredits, setCustomCredits] = useState("");
  const [customProperty, setCustomProperty] = useState("无");
  const [customDuplicateMsg, setCustomDuplicateMsg] = useState<string | null>(null);
  /** 统计变量接口：通识-艺术/社科/人文/科学/SRT 五类的总学分数，供后续功能使用 */
  const [customStats, setCustomStats] = useState<Record<string, number>>({ "通识-艺术": 0, "通识-社科": 0, "通识-人文": 0, "通识-科学": 0, "SRT": 0, "思政限选": 0 });
  // 移动端：目录/历史 两段 Tab + 预选抽屉
  const [mobileTab, setMobileTab] = useState<"catalog" | "history">("catalog");
  // 移动端首次进入「课程目录」时，显示一次引导提示条，提示左侧有搜索筛选抽屉，4.5s 后自动消失（可手动关闭）
  useEffect(() => {
    if (mobile && mobileTab === "catalog" && !filterHintShownRef.current) {
      filterHintShownRef.current = true;
      setShowFilterHint(true);
      const t = window.setTimeout(() => setShowFilterHint(false), 4500);
      return () => window.clearTimeout(t);
    }
  }, [mobile, mobileTab]);
  // 加入课程时给预选按钮的抖动反馈
  const [shakeBtn, setShakeBtn] = useState(false);
  const prevSelectedCountRef = useRef(selectedCourses.size);
  useEffect(() => {
    if (selectedCourses.size > prevSelectedCountRef.current) {
      setShakeBtn(true);
      const t = window.setTimeout(() => setShakeBtn(false), 420);
      prevSelectedCountRef.current = selectedCourses.size;
      return () => window.clearTimeout(t);
    }
    prevSelectedCountRef.current = selectedCourses.size;
  }, [selectedCourses.size]);
  // 编辑态维护：仅当切换预选学期时退出编辑态（删除/新增课程不退出，由保存/取消按钮显式结束）。
  useEffect(() => {
    if (!editingFromHistory) return;
    if (stagingSemester !== editingFromHistory) {
      setEditingFromHistory(null);
      setRemovedIds(new Set());
    }
  }, [stagingSemester, editingFromHistory]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 预选抽屉滑动手势状态（从上向下滑关闭）
  const stagingDragRef = useRef<{startY: number; startT: number; currentY: number} | null>(null);
  const [stagingDragging, setStagingDragging] = useState(false);
  const [stagingTranslate, setStagingTranslate] = useState(0);
  // 移动端预选浮动按钮垂直位置（可上下拖动），持久化到 localStorage，范围 56~240px
  const [stagingBtnBottom, setStagingBtnBottom] = useState(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("ofcourses-staging-btn-bottom") : null;
    const n = saved ? Number(saved) : NaN;
    return Number.isFinite(n) ? Math.max(56, Math.min(240, n)) : 80;
  });
  const stagingBtnDragRef = useRef<{startY: number; startBottom: number; dragging: boolean} | null>(null);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    history: Record<string, string[]>;
    customCourses: Record<string, Array<{id: string; name: string; credits: number; property?: string}>>;
  } | null>(null);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [, setForceSaveData] = useState<string[] | null>(null);
  const [diagExpanded, setDiagExpanded] = useState(false);
  const [foldOpen, setFoldOpen] = useState<Set<string>>(new Set());
  /* 云端方案：管理浮窗 + 脏标 + 云同步状态标注（2026-11-14 重构） */
  const {user, syncState, lastSyncTs, dirtyHistory} = useAccount();
  const [schemeModalOpen, setSchemeModalOpen] = useState(false);
  const [cloudBubble, setCloudBubble] = useState(false);
  const [cloudBubbleMounted, setCloudBubbleMounted] = useState(false);
  const cloudStatusRef = useRef<HTMLSpanElement>(null);
  const cloudOn = !!user && syncState !== "off";
  const cloudText = (() => {
    if (!user) return locale === "zh" ? "未登录" : "Signed out";
    if (syncState === "off") return locale === "zh" ? "未开启" : "Off";
    if (syncState === "syncing") return locale === "zh" ? "同步中…" : "Syncing…";
    if (syncState === "conflict") return locale === "zh" ? "有冲突" : "Conflict";
    if (syncState === "error") return locale === "zh" ? "同步失败" : "Error";
    if (syncState === "saved" && lastSyncTs) {
      const t = new Date(lastSyncTs).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {hour: "2-digit", minute: "2-digit"});
      return locale === "zh" ? `已同步 ${t}` : `Synced ${t}`;
    }
    return locale === "zh" ? "自动同步" : "Auto-sync";
  })();
  const cloudDetail = (() => {
    if (!user) return locale === "zh"
      ? "目前只保存在这台设备。登录后可在多台设备间同步方案。"
      : "Your plans are stored on this device. Sign in to sync them across devices.";
    if (syncState === "off") return locale === "zh"
      ? "云端同步尚未开启，本地方案仍可正常使用。"
      : "Cloud sync is off. Your local plans are still available.";
    if (syncState === "syncing") return locale === "zh"
      ? "正在同步方案，请稍候。"
      : "Your plans are syncing. Please wait.";
    if (syncState === "conflict") return locale === "zh"
      ? "本地和云端方案有差异，请打开方案管理检查并处理。"
      : "Local and cloud plans differ. Open plan management to review them.";
    if (syncState === "error") return locale === "zh"
      ? "同步没有完成，本地数据仍保留。稍后可在方案管理中重试。"
      : "Sync did not complete. Your local data is safe; try again in plan management.";
    if (dirtyHistory) return locale === "zh"
      ? "有尚未同步的修改，联网后会自动保存到云端。"
      : "Changes are waiting to sync and will be saved when a connection is available.";
    if (syncState === "saved" && lastSyncTs) return locale === "zh"
      ? "最近一次同步已完成。"
      : "The latest sync completed successfully.";
    return locale === "zh"
      ? "云端自动同步已开启，方案有修改时会自动保存。"
      : "Cloud sync is on. Changes to your plans are saved automatically.";
  })();

  useEffect(() => {
    if (!cloudBubbleMounted || cloudBubble) return;
    const timer = window.setTimeout(() => setCloudBubbleMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [cloudBubble, cloudBubbleMounted]);

  useEffect(() => {
    if (!cloudBubble) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!cloudStatusRef.current?.contains(event.target as Node)) setCloudBubble(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCloudBubble(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cloudBubble]);

  const toggleCloudBubble = () => {
    if (cloudBubble) {
      setCloudBubble(false);
      return;
    }
    setCloudBubbleMounted(true);
    window.requestAnimationFrame(() => setCloudBubble(true));
  };
  const toggleFold = (id: string) =>
    setFoldOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [dismissedDiag, setDismissedDiag] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("oc_diag_dismiss") ?? "[]")); }
    catch { return new Set(); }
  });
  const [choiceConflict, setChoiceConflict] = useState<{
    courseId: string;
    courseName: string;
    setName: string;
    conflictId: string;
    conflictName: string;
  } | null>(null);
  const [historyDetail, setHistoryDetail] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [recommendEnabled, setRecommendEnabled] = useState(true);
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Data ---
  const {data: courses} = useCourses();
  const {data: semesterCourses} = useSemesterCourses();
  const {data: semesters} = useAllSemesters();
  const {data: modules} = useModules();
  const {data: allGroups} = useCourseGroups();

  const courseMap = useMemo(() => new Map(courses.map((c) => [c.course_id, c])), [courses]);

  const currentIdx = semesters.indexOf(currentSemester);
  const historySemesters = currentIdx >= 0
    ? [...semesters.slice(0, currentIdx + 1), ...Object.keys(savedHistory).filter((s) => semesters.indexOf(s) > currentIdx).sort((a, b) => semesters.indexOf(a) - semesters.indexOf(b))]
    : [];

  // Compute available staging semesters
  const availableStagingSemesters = useMemo(() => {
    const savedSems = new Set(Object.keys(savedHistory));
    const available: string[] = [];
    for (let i = 0; i <= currentIdx; i++) {
      if (!savedSems.has(semesters[i])) available.push(semesters[i]);
    }
    let nextIdx = currentIdx + 1;
    while (nextIdx < semesters.length) {
      if (!savedSems.has(semesters[nextIdx])) { available.push(semesters[nextIdx]); break; }
      nextIdx++;
    }
    return available;
  }, [savedHistory, semesters, currentIdx]);

  // Also include editing semesters (those with saved data) as valid staging options
  // 仅在「正处于该学期的编辑态」时保留为可选预选学期；退出编辑后不得滞留
  //（否则取消/保存后非编辑态可往有历史记录的学期加课，保存会覆盖历史）
  const editingSemesters = useMemo(() => {
    if (editingFromHistory && stagingSemester === editingFromHistory && savedHistory[stagingSemester]) {
      return [stagingSemester];
    }
    return [];
  }, [editingFromHistory, stagingSemester, savedHistory]);

  const allStagingOptions = useMemo(() => [...availableStagingSemesters, ...editingSemesters], [availableStagingSemesters, editingSemesters]);

  useEffect(() => {
    if (!stagingSemester && availableStagingSemesters.length > 0) {
      setStagingSemester(availableStagingSemesters[0]);
    }
    // If current staging semester is no longer available and not editing, reset
    if (stagingSemester && allStagingOptions.length > 0 && !allStagingOptions.includes(stagingSemester)) {
      setStagingSemester(availableStagingSemesters[0]);
    }
  }, [availableStagingSemesters, stagingSemester, allStagingOptions]);

  const persistHistory = (next: Record<string, string[]>) => {
    setSavedHistory(next);
    localStorage.setItem("oc_history", JSON.stringify(next));
  };

  const persistCustom = (next: Record<string, Array<{id: string; name: string; credits: number; property?: string}>>) => {
    setCustomCourses(next);
    localStorage.setItem("oc_custom", JSON.stringify(next));
  };

  const addCustomCourse = () => {
    if (!stagingSemester || !customName.trim()) return;
    // 去重检查：用正则归一化课程名（去空白、全角括号转半角、转小写）后比对，
    // 避免“机器学习”与“机器学习 ”被误判为不同课程而导致重复添加。
    const normalizeName = (n: string) => n.replace(/\s+/g, "").replace(/[（）()]/g, "").toLowerCase();
    const normTarget = normalizeName(customName.trim());
    const existingNorm = new Set<string>();
    for (const list of Object.values(customCourses)) {
      list.forEach((cc) => existingNorm.add(normalizeName(cc.name)));
    }
    if (existingNorm.has(normTarget)) {
      setCustomDuplicateMsg(locale === "zh" ? `同名课程已存在：${customName.trim()}` : `A course with the same name already exists: ${customName.trim()}`);
      return;
    }
    setCustomDuplicateMsg(null);
    // 思政限选课固定 1 学分（培养方案口径），忽略输入框数值
    const creds = customProperty === "思政限选" ? 1 : (parseFloat(customCredits) || 0);
    const id = "custom_" + Date.now();
    const next = {...customCourses};
    if (!next[stagingSemester]) next[stagingSemester] = [];
    next[stagingSemester] = [...next[stagingSemester], {id, name: customName.trim(), credits: creds, property: customProperty !== "无" ? customProperty : undefined}];
    persistCustom(next);
    setCustomName("");
    setCustomCredits("");
    setCustomProperty("无");
    setCustomDuplicateMsg(null);
  };

  const removeCustomCourse = (sem: string, cid: string) => {
    const next = {...customCourses};
    if (!next[sem]) return;
    next[sem] = next[sem].filter((c) => c.id !== cid);
    if (next[sem].length === 0) delete next[sem];
    persistCustom(next);
  };

  // 五类通识自定义课程总学分统计：遍历所有学期的自定义课程，按课程属性累加学分，结果同步到 customStats 用于展示。
  useEffect(() => {
    const stats: Record<string, number> = { "通识-艺术": 0, "通识-社科": 0, "通识-人文": 0, "通识-科学": 0, "SRT": 0, "思政限选": 0 };
    for (const list of Object.values(customCourses)) {
      for (const cc of list) {
        if (cc.property && cc.property in stats) stats[cc.property] += cc.credits;
      }
    }
    setCustomStats(stats);
  }, [customCourses]);

  // --- Credit limits ---
  const getCreditLimit = (sem: string): {max: number; min: number} | null => {
    const isSummer = sem.includes("夏季") || sem.includes("开学前");
    const year = sem.startsWith("大一") ? 1 : sem.startsWith("大二") ? 2 : sem.startsWith("大三") ? 3 : sem.startsWith("大四") ? 4 : 0;
    const max = year <= 1 ? 23 : year <= 2 ? 27 : 30;
    const min = isSummer ? 0 : 6;
    return {max, min};
  };

  const calcSemesterCredits = (sem: string, selected: string[]): number => {
    const courseCredits = selected.reduce((s, cid) => s + (courseMap.get(cid)?.credits ?? 0), 0);
    const customCreds = (customCourses[sem] ?? []).reduce((s, c) => s + c.credits, 0);
    return courseCredits + customCreds;
  };

  // --- Prerequisite map ---
  const prereqMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of structuredData.course_prerequisites) {
      const prev = map.get(p.course_id) ?? [];
      prev.push(p.prereq_course_id);
      map.set(p.course_id, prev);
    }
    return map;
  }, [structuredData]);

  // --- Choice set lookup (set_id → course_ids[]) ---
  const choiceSetCourseMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const sc of structuredData.choice_set_courses) {
      const prev = map.get(sc.set_id) ?? [];
      prev.push(sc.course_id);
      map.set(sc.set_id, prev);
    }
    return map;
  }, [structuredData]);

  const choiceSetMap = useMemo(() => {
    const map = new Map<number, typeof structuredData.choice_sets[0]>();
    for (const cs of structuredData.choice_sets) {
      map.set(cs.set_id, cs);
    }
    return map;
  }, [structuredData]);

  // PE courses by semester
  const PE_BY_SEMESTER: Record<string, string[]> = {
    "大一·秋季": ["10720011"],
    "大一·春季": ["10720021"],
    "大二·秋季": ["10720031"],
    "大二·春季": ["10720041"],
    "大三·秋季": ["10720110"],
    "大三·春季": ["10720120"],
    "大四·秋季": ["10720130"],
    "大四·春季": ["10720140"],
  };

  // Course → choice sets it belongs to (for multi-select display)
  const courseChoiceSets = useMemo(() => {
    const map = new Map<string, Array<{setId: number; setName: string; minSelect: number; maxSelect: number; siblings: Array<{courseId: string; name: string}>}>>();
    for (const [setId, courseIds] of choiceSetCourseMap.entries()) {
      const cs = choiceSetMap.get(setId);
      if (!cs) continue;
      const siblings = courseIds.map((cid) => ({
        courseId: cid,
        name: courseMap.get(cid)?.name ?? cid,
      }));
      for (const cid of courseIds) {
        const prev = map.get(cid) ?? [];
        prev.push({setId, setName: cs.name, minSelect: cs.min_select, maxSelect: cs.max_select, siblings: siblings.filter((s) => s.courseId !== cid)});
        map.set(cid, prev);
      }
    }
    return map;
  }, [choiceSetCourseMap, choiceSetMap, courseMap]);

  const getSemesterChecks = (sem: string, selected: string[]): Array<{type: "error" | "warning"; category: string; msg: string}> => {
    const checks: Array<{type: "error" | "warning"; category: string; msg: string}> = [];
    const total = calcSemesterCredits(sem, selected);
    const limit = getCreditLimit(sem);
    if (!limit) return checks;

    if (total > limit.max) {
      checks.push({
        type: "warning",
        category: "overMax",
        msg: locale === "zh" ? `学分 ${total} > 上限 ${limit.max}` : `${total} credits > max ${limit.max}`,
      });
    }

    if (limit.min > 0 && total > 0 && total < limit.min) {
      checks.push({
        type: "error",
        category: "underMin",
        msg: locale === "zh" ? `学分 ${total} < 下限 ${limit.min}` : `${total} credits < min ${limit.min}`,
      });
    }

    // Prerequisite checks — WARNING (not error) unless forced (TBD)
    const allTaken = new Set<string>();
    for (const [, ids] of Object.entries(savedHistory)) ids.forEach((id) => allTaken.add(id));
    selected.forEach((id) => allTaken.add(id));

    for (const cid of selected) {
      const prereqs = prereqMap.get(cid) ?? [];
      for (const pid of prereqs) {
        if (!allTaken.has(pid)) {
          const cName = tName(cid, courseMap.get(cid)?.name ?? cid);
          const pName = tName(pid, courseMap.get(pid)?.name ?? pid);
          checks.push({
            type: "warning",
            category: "prereq",
            msg: locale === "zh" ? `「${cName}」需先修「${pName}」` : `"${cName}" needs prereq "${pName}"`,
          });
        }
      }
    }

    // Choice set checks — WARNING (mutual exclusion across all taken courses)
    for (const [setId, setCourseIds] of choiceSetCourseMap.entries()) {
      const cs = choiceSetMap.get(setId);
      if (!cs) continue;
      const selectedInSet = selected.filter((cid) => setCourseIds.includes(cid));
      const totalInSet = [...allTaken].filter((cid) => setCourseIds.includes(cid)).length;
      if (totalInSet > (cs.max_select ?? 1)) {
        checks.push({
          type: "warning",
          category: "choice",
          msg: locale === "zh" ? `「${cs.name}」可只选 ${cs.max_select} 门` : `"${cs.name}" max ${cs.max_select}`,
        });
      } else if (selectedInSet.length > (cs.max_select ?? 1)) {
        checks.push({
          type: "warning",
          category: "choice",
          msg: locale === "zh" ? `「${cs.name}」可只选 ${cs.max_select} 门` : `"${cs.name}" max ${cs.max_select}`,
        });
      }
    }

    // Duplicate course check — ERROR (course already in savedHistory for other semesters)
    for (const cid of selected) {
      for (const [otherSem, ids] of Object.entries(savedHistory)) {
        if (otherSem === sem) continue;
        if (ids.includes(cid)) {
          const cName = tName(cid, courseMap.get(cid)?.name ?? cid);
          checks.push({
            type: "error",
            category: "duplicate",
            msg: locale === "zh" ? `「${cName}」已在 ${abbreviateSemester(otherSem)} 中选择过` : `"${cName}" already taken in ${abbreviateSemester(otherSem)}`,
          });
          break;
        }
      }
    }

    // PE requirement check — ERROR (only for saved history semesters, not for staging)
    const isBootCampOrSummer = sem.includes("开学前") || sem.includes("夏季");
    const hasSavedData = savedHistory[sem] !== undefined;
    if (hasSavedData && !isBootCampOrSummer) {
      const peCourses = PE_BY_SEMESTER[sem] ?? [];
      const hasPe = peCourses.some((pid) => selected.includes(pid));
      if (peCourses.length > 0 && !hasPe) {
        checks.push({
          type: "error",
          category: "pe",
          msg: t("workspace.peRequired"),
        });
      }
    }

    return checks;
  };

  // Build diagnostic data for all semesters + current staging
  const diagData = useMemo(() => {
    type DiagCheck = {type: "error" | "warning"; category: string; msg: string};
    const semesterEntries: Array<{sem: string; checks: DiagCheck[]}> = []; // errors only (always individual)
    const overMax: Array<{sem: string; total: number; max: number}> = [];
    const prereqGroups = new Map<string, {prereq: string; courses: string[]}>();
    const choiceConflicts: Array<{setName: string; max: number}> = [];

    const allSems = [...historySemesters, ...availableStagingSemesters];
    const seen = new Set<string>();
    const stagingSem =
      stagingSemester && selectedCourses.size > 0 && !seen.has(stagingSemester) ? stagingSemester : null;

    const processSem = (sem: string, selected: string[]) => {
      const checks = getSemesterChecks(sem, selected);
      // Errors stay per-semester, shown individually
      const errs = checks.filter((c) => c.type === "error");
      if (errs.length > 0) semesterEntries.push({sem, checks: errs});

      for (const c of checks) {
        if (c.category === "overMax") {
          const m = c.msg.match(/学分 (\d+(?:\.\d+)?) > 上限 (\d+)/) ?? c.msg.match(/(\d+(?:\.\d+)?) credits > max (\d+)/);
          if (m) overMax.push({sem, total: parseFloat(m[1]), max: parseInt(m[2], 10)});
        } else if (c.category === "prereq") {
          const m = c.msg.match(/「(.+?)」需先修「(.+?)」/) ?? c.msg.match(/"([^"]+)" needs prereq "([^"]+)"/);
          if (m) {
            const course = m[1];
            const prereq = m[2];
            if (!prereqGroups.has(prereq)) prereqGroups.set(prereq, {prereq, courses: []});
            const g = prereqGroups.get(prereq)!;
            if (!g.courses.includes(course)) g.courses.push(course);
          }
        } else if (c.category === "choice") {
          const m = c.msg.match(/「(.+?)」可只选 (\d+)/) ?? c.msg.match(/"([^"]+)" max (\d+)/);
          if (m) {
            const setName = m[1];
            if (!choiceConflicts.some((x) => x.setName === setName)) choiceConflicts.push({setName, max: parseInt(m[2], 10)});
          }
        }
      }
    };

    for (const sem of allSems) {
      if (seen.has(sem)) continue;
      seen.add(sem);
      processSem(sem, savedHistory[sem] ?? []);
    }
    if (stagingSem) processSem(stagingSem, [...selectedCourses]);

    return {semesterEntries, overMax, prereqGroups: [...prereqGroups.values()], choiceConflicts};
  }, [historySemesters, availableStagingSemesters, savedHistory, customCourses, stagingSemester, selectedCourses, locale]);

  // --- Import / Export ---
  const handleExport = () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      history: savedHistory,
      customCourses,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oc_history_export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // 解析并校验导入文件，暂存待确认（不直接覆盖已有数据）
  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!data || typeof data !== "object") {
          alert(t("workspace.importError"));
          return;
        }
        const history = data.history;
        if (!history || typeof history !== "object" || Array.isArray(history)) {
          alert(t("workspace.importError"));
          return;
        }
        for (const ids of Object.values(history)) {
          if (!Array.isArray(ids)) {
            alert(t("workspace.importError"));
            return;
          }
        }
        const customCoursesIn =
          data.customCourses && typeof data.customCourses === "object" && !Array.isArray(data.customCourses)
            ? (data.customCourses as typeof customCourses)
            : {};
        const histCount = Object.values(history as Record<string, string[]>).reduce((n, a) => n + a.length, 0);
        const customCount = Object.values(customCoursesIn).reduce((n, a) => n + a.length, 0);
        setPendingImport({
          history: history as Record<string, string[]>,
          customCourses: customCoursesIn,
        });
        setImportPreview(
          `${locale === "zh" ? "历史学期数" : "History semesters"}: ${Object.keys(history).length}\n` +
            `${locale === "zh" ? "历史课程数" : "History courses"}: ${histCount}\n` +
            `${locale === "zh" ? "自定义课程数" : "Custom courses"}: ${customCount}`
        );
      } catch {
        alert(t("workspace.importError"));
      }
    };
    reader.readAsText(file);
  };

  // 合并导入（按学期并集），避免静默覆盖已有数据
  const confirmImport = () => {
    if (!pendingImport) return;
    const mergedHistory: Record<string, string[]> = {...savedHistory};
    for (const [sem, ids] of Object.entries(pendingImport.history)) {
      const set = new Set(mergedHistory[sem] ?? []);
      ids.forEach((id) => set.add(id));
      mergedHistory[sem] = [...set];
    }
    const mergedCustom = {...customCourses};
    for (const [sem, list] of Object.entries(pendingImport.customCourses)) {
      const byId = new Map((mergedCustom[sem] ?? []).map((c) => [c.id, c]));
      list.forEach((c) => byId.set(c.id, c));
      mergedCustom[sem] = [...byId.values()];
    }
    persistHistory(mergedHistory);
    persistCustom(mergedCustom);
    setPendingImport(null);
    setImportPreview(null);
  };

  // 覆盖导入：直接以导入文件替换现有历史与自定义课程
  const confirmImportOverwrite = () => {
    if (!pendingImport) return;
    persistHistory(pendingImport.history);
    persistCustom(pendingImport.customCourses);
    setPendingImport(null);
    setImportPreview(null);
  };

  const cancelImport = () => {
    setPendingImport(null);
    setImportPreview(null);
  };

  const toggleSelected = (courseId: string) => {
    // Build full set of all taken courses across all history + current selection
    const allTaken = new Set(selectedCourses);
    for (const [, ids] of Object.entries(savedHistory)) {
      ids.forEach((id) => allTaken.add(id));
    }

    const isAlreadySelected = selectedCourses.has(courseId);
    if (!isAlreadySelected) {
      // 编辑学期原有的课（含被软删除的）：它本就属于该学期，允许自由加回，不算重复选择
      const isEditingSemCourse = editingFromHistory !== null && editingSavedSet.has(courseId);
      // Preventative: if course is already in history, block adding
      let foundInHistory = false;
      for (const [, ids] of Object.entries(savedHistory)) {
        if (ids.includes(courseId)) { foundInHistory = true; break; }
      }
      if (foundInHistory && !isEditingSemCourse) {
        // Show alert that this course is already taken
        setChoiceConflict({
          courseId,
          courseName: courseMap.get(courseId)?.name ?? courseId,
          setName: "历史已选课程", // 固定哨兵值（自冲突场景不对外显示；勿按语言改动，冲突弹窗靠它判断）
          conflictId: courseId,
          conflictName: locale === "zh" ? "该课程已在历史记录中，无法重复添加" : "This course is already in your history",
        });
        return;
      }
      // 从软删除状态加回：同步清除删除标记（预选栏由划线+恢复按钮变回正常+叉）
      if (removedIds.has(courseId)) {
        setRemovedIds((prev) => {
          const next = new Set(prev);
          next.delete(courseId);
          return next;
        });
      }

      // Check choice set conflict across ALL taken courses
      const csInfo = courseChoiceSets.get(courseId);
      if (csInfo && csInfo.length > 0) {
        for (const cs of csInfo) {
          const conflictSibling = cs.siblings.find((s) => allTaken.has(s.courseId));
          if (conflictSibling) {
            setChoiceConflict({
              courseId,
              courseName: courseMap.get(courseId)?.name ?? courseId,
              setName: cs.setName,
              conflictId: conflictSibling.courseId,
              conflictName: conflictSibling.name,
            });
            return;
          }
        }
      }
    }
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const semesterMap = useMemo(() => {
    const m = new Map<string, typeof courses>();
    for (const sc of semesterCourses) {
      const prev = m.get(sc.semester) ?? [];
      const course = courseMap.get(sc.course_id);
      if (course) prev.push(course);
      m.set(sc.semester, prev);
    }
    // 英语1-4为常年开课（数据 semester_courses 中的 semester 仅表示"推荐学期"，非开课学期）。
    // 在运行时把所有春秋学期都注入英语，使跨学期选课与"延迟惩罚"生效，且不污染原始数据。
    const ENGLISH_IDS = ["14201002", "14201012", "14201022", "14201032"];
    for (const [sem, list] of m.entries()) {
      if (sem.includes("夏季") || sem.includes("开学前")) continue;
      const ids = new Set(list.map((c) => c.course_id));
      for (const id of ENGLISH_IDS) {
        const ec = courseMap.get(id);
        if (ec && !ids.has(id)) {
          list.push(ec);
          ids.add(id);
        }
      }
    }
    return m;
  }, [semesterCourses, courseMap]);

  const courseSemesterMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sc of semesterCourses) {
      const prev = m.get(sc.course_id) ?? [];
      prev.push(sc.semester);
      m.set(sc.course_id, prev);
    }
    return m;
  }, [semesterCourses]);

  const groupMap = useMemo(() => new Map(allGroups.map((g) => [g.group_id, g])), [allGroups]);

  const courseGroupInfo = useMemo(() => {
    const map = new Map<string, Array<{groupCode: string; moduleId: number | null; groupName: string}>>();
    for (const gc of structuredData.group_courses) {
      const group = groupMap.get(gc.group_id);
      if (!group) continue;
      for (const cid of gc.course_ids) {
        const prev = map.get(cid) ?? [];
        prev.push({groupCode: group.group_code, moduleId: group.module_id, groupName: group.name});
        map.set(cid, prev);
      }
    }
    return map;
  }, [groupMap, structuredData]);

  // --- enName lookup ---
  const enNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [id, en] of Object.entries(enData.courses as Record<string, string>)) {
      map.set(id, en);
    }
    return map;
  }, []);

  // --- Validation logic ---
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);

  // Clear validationErrors when selectedCourses change and checks pass
  useEffect(() => {
    if (validationErrors && stagingSemester) {
      const checks = getSemesterChecks(stagingSemester, [...selectedCourses]);
      const hasErrors = checks.some((c) => c.type === "error");
      if (!hasErrors) {
        setValidationErrors(null);
      }
    }
  }, [selectedCourses, stagingSemester]);

  // --- Category display (locale-aware) ---
  const CAT_LABELS = locale === "zh" ? FOUNDATION_ZH : FOUNDATION_EN;

  const getCourseCategories = (courseId: string): string[] => {
    const infos = courseGroupInfo.get(courseId) ?? [];
    const categories = infos.map((info) => {
      if (info.moduleId === null) {
        return CAT_LABELS[info.groupCode] ?? info.groupName;
      }
      const type = moduleTypeLabel(info.moduleId);
      return locale === "zh" ? `${type}类${info.groupCode}` : `${type}-${info.groupCode}`;
    });
    return [...new Set(categories)];
  };

  // --- Filter Options (i18n-aware) ---
  const unsetLabel = t("workspace.filterUnset");

  const semesterOptions: SelectItem[] = useMemo(
    () => [
      {key: "all", label: unsetLabel},
      ...semesters.map((s) => ({key: s, label: tSemester(s)})),
    ],
    [semesters, unsetLabel, tSemester]
  );

  const moduleOptions: SelectItem[] = useMemo(
    () => [
      {key: "all", label: unsetLabel},
      ...modules.map((m) => ({
        key: `mod_${m.module_id}`,
        label: formatModuleOption(m.module_id, tModule(m.module_id, m.name), locale),
      })),
      {key: "none", label: t("workspace.filterNonModule")},
    ],
    [modules, unsetLabel, tModule, locale, t]
  );

  const groupOptions: SelectItem[] = useMemo(
    () => [
      {key: "all", label: unsetLabel},
      {key: "TYPE_I", label: t("workspace.filterTypeI")},
      {key: "TYPE_II", label: t("workspace.filterTypeII")},
      {key: "TYPE_III", label: t("workspace.filterTypeIII")},
      ...allGroups.map((g) => ({key: g.group_code, label: tGroup(g.group_code, g.name)})),
    ],
    [allGroups, unsetLabel, t, tGroup]
  );

  const abOptions: SelectItem[] = useMemo(
    () => [
      {key: "all", label: unsetLabel},
      {key: "A", label: t("workspace.filterGroupA")},
      {key: "B", label: t("workspace.filterGroupB")},
    ],
    [unsetLabel, t]
  );

  // --- Foundation enhancement groups (基础加强) ---
  const FOUNDATION_GROUP_IDS = useMemo(() => {
    const ids = new Set<number>();
    for (const g of allGroups) {
      if (["COMP_BASIS", "OR_STAT", "MECH_BASIS"].includes(g.group_code)) {
        ids.add(g.group_id);
      }
    }
    return ids;
  }, [allGroups]);

  // Course → module IDs it belongs to
  const courseModuleMap = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const [cid, infos] of courseGroupInfo) {
      for (const info of infos) {
        if (info.moduleId !== null) {
          const prev = map.get(cid) ?? new Set();
          prev.add(info.moduleId);
          map.set(cid, prev);
        }
      }
    }
    return map;
  }, [courseGroupInfo]);

  // Foundation group → course_ids
  const foundationCourseIds = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const gc of structuredData.group_courses) {
      if (FOUNDATION_GROUP_IDS.has(gc.group_id)) {
        const set = new Set(gc.course_ids);
        map.set(gc.group_id, set);
      }
    }
    return map;
  }, [FOUNDATION_GROUP_IDS, structuredData]);

  // All selected course IDs across history + current staging
  const allSelectedIds = useMemo(() => {
    const set = new Set(selectedCourses);
    for (const [, ids] of Object.entries(savedHistory)) {
      ids.forEach((id) => set.add(id));
    }
    return set;
  }, [selectedCourses, savedHistory]);

  // --- Module scoring config (per-module per-course A/B scores) ---
  const moduleScoringConfig = useMemo(() => {
    const modConfig = new Map<number, {aPerCourse: number; bPerCourse: number}>();
    const courseModInfo = new Map<string, Map<number, {isA: boolean; isB: boolean}>>();
    const modACount = new Map<number, number>();
    const modBCount = new Map<number, number>();

    for (const gc of structuredData.group_courses) {
      const group = groupMap.get(gc.group_id);
      if (!group || group.module_id === null) continue;
      const isA = group.group_code.endsWith("A");
      const isB = group.group_code.endsWith("B");
      if (isA) modACount.set(group.module_id, (modACount.get(group.module_id) ?? 0) + gc.course_ids.length);
      if (isB) modBCount.set(group.module_id, (modBCount.get(group.module_id) ?? 0) + gc.course_ids.length);
      for (const cid of gc.course_ids) {
        if (!courseModInfo.has(cid)) courseModInfo.set(cid, new Map());
        const cm = courseModInfo.get(cid)!;
        if (!cm.has(group.module_id)) cm.set(group.module_id, {isA: false, isB: false});
        const e = cm.get(group.module_id)!;
        if (isA) e.isA = true;
        if (isB) e.isB = true;
      }
    }

    for (const modId of new Set([...modACount.keys(), ...modBCount.keys()])) {
      const aCount = modACount.get(modId) ?? 0;
      const bCount = modBCount.get(modId) ?? 0;
      modConfig.set(modId, {
        aPerCourse: aCount > 0 ? 240 / aCount : 0,
        bPerCourse: bCount > 0 ? 80 / bCount : 0,
      });
    }

    return {modConfig, courseModInfo};
  }, [groupMap, structuredData]);

  // --- Module score map (accumulated from selected courses) ---
  const moduleScoreMap = useMemo(() => {
    const map = new Map<number, number>();
    const {courseModInfo, modConfig} = moduleScoringConfig;
    for (const cid of allSelectedIds) {
      const cm = courseModInfo.get(cid);
      if (!cm) continue;
      for (const [modId, {isA, isB}] of cm) {
        const cfg = modConfig.get(modId);
        if (!cfg) continue;
        let add = 0;
        if (isA) add += cfg.aPerCourse;
        if (isB) add += cfg.bPerCourse;
        map.set(modId, (map.get(modId) ?? 0) + add);
      }
    }
    return map;
  }, [allSelectedIds, moduleScoringConfig]);

  // --- Foundation direction scores ---
  const foundationActive = useMemo(() => {
    const map = new Map<string, number>();
    const FOUNDATION_MAP: Array<[string, string]> = [
      ["COMP_BASIS", "II"],
      ["OR_STAT", "III"],
      ["MECH_BASIS", "I"],
    ];
    for (const [gCode] of FOUNDATION_MAP) {
      for (const [gid, cids] of foundationCourseIds) {
        const g = groupMap.get(gid);
        if (g && g.group_code === gCode) {
          let cnt = 0;
          for (const cid of allSelectedIds) { if (cids.has(cid)) cnt++; }
          if (cnt >= 2) map.set(gCode, 80);
        }
      }
    }
    return map;
  }, [allSelectedIds, foundationCourseIds, groupMap]);

  // --- Staging semester derived data (for scoring + hint) ---
  const stagingCourseInfo = useMemo(() => {
    const stagingCourseIds = new Set(
      (stagingSemester ? (semesterMap.get(stagingSemester) ?? []).map((c) => c.course_id) : [])
    );
    const peCourseIds = new Set(stagingSemester ? (PE_BY_SEMESTER[stagingSemester] ?? []) : []);
    const isSummer = stagingSemester?.includes("开学前") || stagingSemester?.includes("夏季");
    const needPe = stagingSemester && !isSummer && peCourseIds.size > 0
      ? ![...allSelectedIds].some((id) => peCourseIds.has(id))
      : false;

    // 书院通识/进阶实践 courses in staging semester + whether still needed
    const stagingShuyuanIds = new Set<string>();
    const stagingShijianIds = new Set<string>();
    for (const cid of stagingCourseIds) {
      const infos = courseGroupInfo.get(cid) ?? [];
      for (const info of infos) {
        if (info.groupCode === "SHUYUAN_GE") stagingShuyuanIds.add(cid);
        if (info.groupCode === "SHIJIAN") stagingShijianIds.add(cid);
      }
    }
    const needShuyuan = stagingShuyuanIds.size > 0 && ![...allSelectedIds].some((id) => stagingShuyuanIds.has(id));
    const needShijian = stagingShijianIds.size > 0 && ![...allSelectedIds].some((id) => stagingShijianIds.has(id));

    // All special-course IDs in staging (for scoring boost)
    const stagingSpecialIds = new Set([...stagingShuyuanIds, ...stagingShijianIds]);

    return {stagingCourseIds, peCourseIds, isSummer, needPe, needShuyuan, needShijian, stagingSpecialIds};
  }, [stagingSemester, semesterMap, courseGroupInfo, allSelectedIds]);

  // --- Per-course semester bonus map ---
  /** Foundation group codes for 大二·春季 bonus */
  const FOUNDATION_GROUP_CODES = new Set(["MATH_BASIS","PHY_BASIS","ME_BASIS","MECH_BASIS","CS_BASIS","OR_STAT","COMP_BASIS"]);

  /** 大二·春特殊课 +62 / 定向加分表：按年级取（recommend.ts 同源分年级表，按当前方案数据过滤幽灵课号） */
  const {courseBonus: COURSE_BONUS, daerChun62: DAER_CHUN_SPECIAL_62} = useMemo(
    () => cohortScoringTables(schemeYear), [schemeYear]);

  /** English3(14201022) and English4(14201032) weight maps */
  const ENGLISH3_WEIGHT: Record<string, number> = {
    "大二·秋季": 0, "大二·春季": 1, "大二·夏季": 0,
    "大三·秋季": 2, "大三·春季": 3, "大三·夏季": 0,
    "大四·秋季": 4, "大四·春季": 4,
  };
  const ENGLISH4_WEIGHT: Record<string, number> = {
    "大二·秋季": 0, "大二·春季": 0, "大二·夏季": 0,
    "大三·秋季": 1, "大三·春季": 2, "大三·夏季": 0,
    "大四·秋季": 3, "大四·春季": 4,
  };

  // （COURSE_BONUS 已在上方按年级从 cohortScoringTables 取得，与 recommend.ts 同源）

  // 学期顺序（用于延迟惩罚的"越往后优先级越高"语义）
  const SEM_ORDER = ["大一·秋季","大一·春季","大一·夏季","大二·秋季","大二·春季","大二·夏季","大三·秋季","大三·春季","大三·夏季","大四·秋季","大四·春季","大四·夏季"];
  const termIdx = (s: string) => SEM_ORDER.indexOf(s);

  // 是否已选/已修第二外国语（FOREIGN_1~4）：选了则英语3/4 视为已满足，不再推荐/惩罚
  const hasSecondForeign = useMemo(() => {
    const ids = new Set<string>();
    for (const idsArr of Object.values(savedHistory)) idsArr.forEach((id) => ids.add(id));
    for (const list of Object.values(customCourses)) list.forEach((cc) => ids.add(cc.id));
    for (const id of selectedCourses) ids.add(id);
    return [...ids].some((id) => id.startsWith("FOREIGN_"));
  }, [savedHistory, customCourses, selectedCourses]);

  // --- Recommendation scores ---
  const courseScores = useMemo(() => {
    const scores = new Map<string, number>();
    const {courseModInfo} = moduleScoringConfig;
    const {stagingCourseIds, peCourseIds, needPe, stagingSpecialIds} = stagingCourseInfo;

    // Build set of all course IDs already saved in history
    const historyCourseIds = new Set<string>();
    for (const [, ids] of Object.entries(savedHistory)) {
      ids.forEach((id) => historyCourseIds.add(id));
    }

    const FOUNDATION_MAP: Array<[string, number, number]> = [
      ["COMP_BASIS", 4, 8],
      ["OR_STAT", 9, 13],
      ["MECH_BASIS", 1, 3],
    ];

    for (const c of courses) {
      let score = 0;

      // Special: PE +400 if needed and in staging semester
      if (needPe && peCourseIds.has(c.course_id)) score += 400;

      // Special: 书院通识/进阶实践 in staging semester +400
      if (stagingSpecialIds.has(c.course_id)) score += 400;

      // Semester boost: courses in staging semester +100
      if (stagingCourseIds.has(c.course_id)) score += 100;

      // Foundation boost: max applicable foundation direction (+80)
      const cMods = courseModuleMap.get(c.course_id);
      if (cMods && foundationActive.size > 0) {
        let maxF = 0;
        for (const [gCode, fScore] of foundationActive) {
          const entry = FOUNDATION_MAP.find(([c]) => c === gCode);
          if (!entry) continue;
          const [, lo, hi] = entry;
          for (const m of cMods) { if (m >= lo && m <= hi) { maxF = Math.max(maxF, fScore); } }
        }
        score += maxF;
      }

      // Module boost: max module score among modules this course belongs to
      const cm = courseModInfo.get(c.course_id);
      if (cm) {
        let maxMod = 0;
        for (const [modId] of cm) {
          const ms = moduleScoreMap.get(modId) ?? 0;
          if (ms > maxMod) maxMod = ms;
        }
        score += maxMod;
      }

      // Category extra: +10 per category (min 1)
      const cats = courseGroupInfo.get(c.course_id) ?? [];
      score += Math.max(cats.length, 1) * 10;

      // Per-course semester-specific bonus
      const bonusRules = COURSE_BONUS[c.course_id];
      if (bonusRules && stagingSemester) {
        for (const rule of bonusRules) {
          if (rule.semesterMatch === stagingSemester) {
            score += rule.bonus;
          }
        }
      }

      // 大二·春 special bonus: foundation category courses in 大二·春 +61
      if (stagingSemester === "大二·春季") {
        const courseCats = courseGroupInfo.get(c.course_id) ?? [];
        const inFoundation = courseCats.some((i) => FOUNDATION_GROUP_CODES.has(i.groupCode));
        if (inFoundation && stagingCourseIds.has(c.course_id)) {
          score += 61;
        }
        // 三门特殊课程 +62
        if (DAER_CHUN_SPECIAL_62.has(c.course_id)) {
          score += 62;
        }
      }

      // English3 bonus: weight * 101 if not in history (二外替代时跳过)
      if (c.course_id === "14201022" && !historyCourseIds.has("14201022") && stagingSemester && !hasSecondForeign) {
        const w = ENGLISH3_WEIGHT[stagingSemester];
        if (w !== undefined && w > 0) score += w * 101;
      }
      // English4 bonus: weight * 101 if not in history (二外替代时跳过)
      if (c.course_id === "14201032" && !historyCourseIds.has("14201032") && stagingSemester && !hasSecondForeign) {
        const w = ENGLISH4_WEIGHT[stagingSemester];
        if (w !== undefined && w > 0) score += w * 101;
      }

      // 英语1/2 必修：若已过大一且历史未修，后续学期直接拉极高优先级（+400）
      if (c.course_id === "14201002" && !historyCourseIds.has("14201002") && stagingSemester && termIdx(stagingSemester) > termIdx("大一·秋季")) {
        score += 400;
      }
      if (c.course_id === "14201012" && !historyCourseIds.has("14201012") && stagingSemester && termIdx(stagingSemester) > termIdx("大一·春季")) {
        score += 400;
      }

      // History deduction: courses already recorded in history get -400
      if (historyCourseIds.has(c.course_id)) {
        score -= 400;
      }

      scores.set(c.course_id, score);
    }

    return scores;
  }, [courses, stagingCourseInfo, courseModuleMap, foundationActive, moduleScoreMap, courseGroupInfo, moduleScoringConfig, savedHistory, stagingSemester, hasSecondForeign, COURSE_BONUS, DAER_CHUN_SPECIAL_62]);

  const hasActiveFilters =
    filters.group !== "all" ||
    filters.semester !== "all" ||
    filters.module !== "all" ||
    searchText.trim().length > 0;

  // 移动端：有活跃筛选时若抽屉关闭，在统计头显示提示；不自动展开抽屉，避免打断浏览
  const activeFilterCount = [filters.group, filters.semester, filters.module, searchText.trim()].filter((v) => v && v !== "all").length;

  // --- Filtered Courses ---
  // 第二外国语系列检索别名：输入这些词时命中所有"第二外国语"课程
  const FOREIGN_ALIASES = ["二外","日语","俄语","德语","西班牙语","法语","韩语","韩国语","意大利语","葡萄牙语","阿拉伯语","希腊语","波斯语"];
  const filteredCourses = useMemo(() => {
    let result = courses;

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const isNewQuery = q === "新开课" || q === "新开" || q === "new course";
      const isForeignAlias = FOREIGN_ALIASES.some((a) => q.includes(a));
      result = result.filter((c) => {
        // "新开课"/"新开"/"new course" → show all NEW-id courses
        if (isNewQuery && c.course_id.startsWith("NEW")) return true;

        // Pure numeric query should NOT match NEW-id (e.g. "021" should not match "NEW021")
        if (c.course_id.startsWith("NEW") && /^\d+$/.test(q)) return false;

        // 外语检索别名：二外/各语种名 → 命中第二外国语系列课程
        if (isForeignAlias) return c.name.startsWith("第二外国语");

        return (
          c.course_id.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          tName(c.course_id, c.name).toLowerCase().includes(q)
        );
      });
    }

    if (filters.group !== "all") {
      if (filters.group === "TYPE_I") {
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          return infos.some((i) => i.moduleId !== null && i.moduleId >= 1 && i.moduleId <= 3);
        });
      } else if (filters.group === "TYPE_II") {
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          return infos.some((i) => i.moduleId !== null && i.moduleId >= 4 && i.moduleId <= 8);
        });
      } else if (filters.group === "TYPE_III") {
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          return infos.some((i) => i.moduleId !== null && i.moduleId >= 9 && i.moduleId <= 13);
        });
      } else {
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          return infos.some((i) => i.groupCode === filters.group);
        });
      }
    }

    if (filters.module !== "all") {
      if (filters.module === "none") {
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          return infos.length === 0 || infos.every((i) => i.moduleId === null);
        });
      } else {
        const modId = parseInt(filters.module.replace("mod_", ""), 10);
        result = result.filter((c) => {
          const infos = courseGroupInfo.get(c.course_id) ?? [];
          const inModule = infos.some((i) => i.moduleId === modId);
          if (!inModule) return false;
          if (filters.abGroup !== "all") {
            return infos.some((i) => i.moduleId === modId && i.groupCode === `${modId}${filters.abGroup}`);
          }
          return true;
        });
      }
    }

    if (filters.semester !== "all") {
      const ids = semesterMap.get(filters.semester)?.map((c) => c.course_id) ?? [];
      const idSet = new Set(ids);
      result = result.filter((c) => idSet.has(c.course_id));
    }

    // Apply recommendation sort if no search/filter is active
    if (recommendEnabled && !hasActiveFilters) {
      result = [...result].sort((a, b) => {
        const sa = courseScores.get(a.course_id) ?? 0;
        const sb = courseScores.get(b.course_id) ?? 0;
        return sb - sa;
      });
      // 编辑历史学期时：该学期的课程（含已软删除的——对勾变加号）强制置顶，按历史记录原顺序；
      // 退出编辑态后恢复普通排序。
      if (editingFromHistory && !hasActiveFilters) {
        const editingIds = savedHistory[editingFromHistory] ?? [];
        const rank = new Map(editingIds.map((id, i) => [id, i]));
        result = [
          ...result.filter((c) => rank.has(c.course_id)).sort((a, b) => (rank.get(a.course_id) ?? 0) - (rank.get(b.course_id) ?? 0)),
          ...result.filter((c) => !rank.has(c.course_id)),
        ];
      }
    }

    return result;
  }, [courses, filters, courseGroupInfo, semesterMap, searchText, tName, recommendEnabled, courseScores, hasActiveFilters, editingFromHistory, selectedCourses, savedHistory]);

  // --- Scroll history to rightmost ---
  // 正在编辑的学期原有的课程集合（含已被软删除的）
  const editingSavedSet = useMemo(
    () => new Set(editingFromHistory ? savedHistory[editingFromHistory] ?? [] : []),
    [editingFromHistory, savedHistory],
  );
  /** 课程是否属于正在编辑的学期：目录对勾上，这些课一律按预选态（绿勾/+）显示，替代黄勾。 */
  const isEditingSemesterCourse = (courseId: string) =>
    editingFromHistory !== null && editingSavedSet.has(courseId);

  // 编辑态软删除 / 恢复
  const softRemoveCourse = (courseId: string) => {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      next.delete(courseId);
      return next;
    });
    setRemovedIds((prev) => new Set(prev).add(courseId));
  };
  const restoreCourse = (courseId: string) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.delete(courseId);
      return next;
    });
    setSelectedCourses((prev) => new Set(prev).add(courseId));
  };
  // 取消修改（编辑态）/ 清空预选（普通态）
  const cancelStaging = () => {
    const wasEditingSem = editingFromHistory;
    setSelectedCourses(new Set());
    setRemovedIds(new Set());
    setEditingFromHistory(null);
    // 取消编辑后不得滞留在有历史记录的学期：非编辑态下往该学期加课并保存会直接覆盖历史记录。
    // 与保存流程一致，自动切到下一可选预选学期（无则置空，由下方 effect 回落到首个可选学期）。
    if (wasEditingSem && stagingSemester === wasEditingSem) {
      const idx = availableStagingSemesters.indexOf(stagingSemester);
      if (idx >= 0 && idx + 1 < availableStagingSemesters.length) setStagingSemester(availableStagingSemesters[idx + 1]);
      else setStagingSemester("");
    }
  };
  /** 编辑态下是否有未保存的改动（删除过课 / 增删过课） */
  const hasUnsavedEdits =
    editingFromHistory !== null &&
    (removedIds.size > 0 ||
      [...selectedCourses].sort().join("|") !== [...(savedHistory[editingFromHistory] ?? [])].sort().join("|"));

  // 定向重点课蓝字提醒：当前预选学期命中定向加分规则（带 label）且课程未入历史时返回提示文案
  const targetedBoostLabel = (courseId: string): string | null => {
    if (!stagingSemester) return null;
    const rule = (COURSE_BONUS[courseId] ?? []).find((r) => r.semesterMatch === stagingSemester && r.label);
    if (!rule || !rule.label) return null;
    if (Object.values(savedHistory).some((ids) => ids.includes(courseId))) return null;
    return rule.label;
  };

  useEffect(() => {
    if (historyScrollRef.current) {
      historyScrollRef.current.scrollLeft = historyScrollRef.current.scrollWidth;
    }
  }, [historySemesters.length, leftExpanded]);

  // --- UI helpers ---
  const textDark = isDark ? "text-white/90" : "text-gray-800";
  const textMuted = isDark ? "text-white/50" : "text-gray-500";
  const textBody = isDark ? "text-white/75" : "text-gray-700";
  const bgCard = isDark ? "bg-white/5" : "bg-white";
  const bgHeader = isDark ? "bg-[#1a1a24]" : "bg-gray-50";
  const bgHistoryCard = isDark ? "bg-white/[0.04]" : "bg-gray-50";
  const borderCls = isDark ? "border-white/10" : "border-gray-200";
  const borderLight = isDark ? "border-white/5" : "border-gray-100";
  const hoverBg = isDark ? "hover:bg-white/5" : "hover:bg-gray-100";

  const clearFilters = () => {
    setFilters({group: "all", semester: "all", module: "all", abGroup: "all"});
    setSearchText("");
  };

  const moduleEnabled = filters.module !== "all" && filters.module !== "none";

  // --- 移动端抽屉滑动手势 ---
  // 筛选抽屉：在抽屉上水平向左滑动超过阈值即关闭
  const onFilterTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    filterDragRef.current = {startX: t.clientX, startY: t.clientY, startT: Date.now(), currentX: t.clientX};
    setFilterDragging(false);
  };
  const onFilterTouchMove = (e: React.TouchEvent) => {
    const d = filterDragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.startX;
    const dy = t.clientY - d.startY;
    if (!filterDragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      setFilterDragging(true);
    }
    if (!filterDragging) return;
    e.preventDefault();
    d.currentX = t.clientX;
    // 只允许向左滑（关闭方向），向右滑时不偏移
    setFilterTranslate(dx < 0 ? dx : 0);
  };
  const onFilterTouchEnd = () => {
    const d = filterDragRef.current;
    if (!d) return;
    filterDragRef.current = null;
    setFilterDragging(false);
    const dx = d.currentX - d.startX;
    const dt = Date.now() - d.startT;
    const velocity = dt > 0 ? Math.abs(dx) / dt : 0;
    if (dx < -80 || (dx < -40 && velocity > 0.6)) {
      setFiltersCollapsed(true);
    }
    setFilterTranslate(0);
  };
  // 预选抽屉：在头部拖动条从上向下滑动超过阈值即关闭
  const onStagingTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    stagingDragRef.current = {startY: t.clientY, startT: Date.now(), currentY: t.clientY};
    setStagingDragging(false);
  };
  const onStagingTouchMove = (e: React.TouchEvent) => {
    const d = stagingDragRef.current;
    if (!d) return;
    const t = e.touches[0];
    const dy = t.clientY - d.startY;
    if (!stagingDragging && dy > 8) {
      setStagingDragging(true);
    }
    if (!stagingDragging) return;
    d.currentY = t.clientY;
    setStagingTranslate(dy > 0 ? dy : 0);
  };
  const onStagingTouchEnd = () => {
    const d = stagingDragRef.current;
    if (!d) return;
    stagingDragRef.current = null;
    setStagingDragging(false);
    const dy = d.currentY - d.startY;
    const dt = Date.now() - d.startT;
    const velocity = dt > 0 ? dy / dt : 0;
    if (dy > 80 || (dy > 40 && velocity > 0.6)) {
      setDrawerOpen(false);
    }
    setStagingTranslate(0);
  };

  return (
    <div className={`flex h-full flex-col ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      <main
        data-tour="workspace"
        className={mobile ? "relative flex flex-1 flex-col overflow-hidden" : "flex flex-1 gap-3 p-3 overflow-hidden"}
      >
        {/* 移动端顶部当前学期条（学期已自动判定，不再手动选择；旧下拉框位置改为打印文字） */}
        {mobile && (
          <div className={`shrink-0 flex items-center justify-between gap-2 border-b px-3 py-2 ${isDark ? "border-white/10 bg-[#121218]" : "border-gray-200 bg-white"}`}>
            <span className={`text-xs ${textMuted}`}>{locale === "zh" ? "当前学期" : "Current semester"}</span>
            <span className={`flex items-baseline gap-1 text-xs ${textBody}`}>
              <span className={`font-medium ${textDark}`}>{tSemester(currentSemester)}</span>
              {semesterAuto && <span className={`text-[9px] ${isDark ? "text-white/35" : "text-gray-400"}`}>{locale === "zh" ? "（自动）" : "(auto)"}</span>}
            </span>
          </div>
        )}

        {/* ========== LEFT: History ========== */}
        <section
          className={`h-full flex flex-col overflow-hidden transition-all duration-300 ${
            mobile ? (mobileTab === "history" ? "w-full" : "hidden") : ""
          }`}
          style={mobile ? undefined : {flex: leftExpanded ? "4" : "3"}}
        >
          <Island className={`flex h-full flex-col ${bgCard}`}>
            <Header border wrapWithTitle={false}>
              <div className="flex w-full flex-col">
                <div className={`flex w-full items-center gap-3 ${mobile ? "flex-wrap" : ""}`}>
                  <span className={`text-sm font-semibold text-nowrap ${textDark}`}>{t("workspace.history")}</span>
                  <div className={`relative flex items-center gap-1 ${mobile ? "flex-wrap justify-end" : ""}`}>
                    {/* 方案管理（合并原导出/导入；按钮风格与「清除」一致，有未保存改动时右上角紫点提醒） */}
                    <span className="relative inline-flex">
                      <Button
                        onClick={() => setSchemeModalOpen(true)}
                        className={mobile ? "text-[10px] px-2 py-1" : ""}
                        title={locale === "zh" ? "方案管理：云端方案 / 导入 / 导出" : "Plans: cloud / import / export"}
                      >
                        {locale === "zh" ? "方案管理" : "Plans"}
                      </Button>
                      {dirtyHistory && (
                        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#a78bfa]" title={locale === "zh" ? "有未保存的改动" : "Unsaved changes"} />
                      )}
                    </span>
                    <Button onClick={() => setClearConfirm(true)} className={mobile ? "text-[10px] px-2 py-1" : ""}>{locale === "zh" ? "清除" : "Clear"}</Button>
                    {/* 移动端：云同步状态卡片，可点外部关闭 */}
                    {mobile && (
                      <span ref={cloudStatusRef} className="relative inline-flex">
                        <button
                          type="button"
                          aria-expanded={cloudBubble}
                          aria-label={locale === "zh" ? "查看云端同步状态" : "View cloud sync status"}
                          onClick={toggleCloudBubble}
                          className={"flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border text-xs transition-colors " +
                            (cloudOn
                              ? isDark ? "border-blue-500/40 bg-blue-500/15 text-blue-300" : "border-blue-500/40 bg-blue-500/10 text-blue-600"
                              : isDark ? "border-white/10 text-white/45 hover:bg-white/5" : "border-gray-200 text-gray-500 hover:bg-gray-50")}
                          title={locale === "zh" ? "云同步状态" : "Cloud sync"}
                        >☁</button>
                        {cloudBubbleMounted && (
                          <div
                            role="dialog"
                            aria-label={locale === "zh" ? "云端同步状态" : "Cloud sync status"}
                            aria-hidden={!cloudBubble}
                            className={"absolute right-0 top-full z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] origin-top-right rounded-xl border p-3 shadow-xl transition-[opacity,transform] duration-200 ease-out " +
                              (isDark ? "border-white/10 bg-[#1e1e2a] text-white/85" : "border-gray-200 bg-white text-gray-800") +
                              (cloudBubble ? " translate-y-0 scale-100 opacity-100" : " pointer-events-none -translate-y-1 scale-95 opacity-0")}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className={"text-xs font-semibold " + (isDark ? "text-white/90" : "text-gray-900")}>
                                  {locale === "zh" ? "云端同步" : "Cloud sync"}
                                </div>
                                <div className={"mt-1 text-xs font-medium " + (cloudOn ? (isDark ? "text-blue-300" : "text-blue-700") : (isDark ? "text-white/65" : "text-gray-600"))}>
                                  {cloudText}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setCloudBubble(false)}
                                aria-label={locale === "zh" ? "关闭" : "Close"}
                                className={"-mr-1 -mt-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-sm " +
                                  (isDark ? "text-white/45 hover:bg-white/10" : "text-gray-400 hover:bg-gray-100")}
                              >×</button>
                            </div>
                            <p className={"mb-3 mt-2 text-[11px] leading-relaxed " + (isDark ? "text-white/55" : "text-gray-500")}>
                              {cloudDetail}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setCloudBubble(false);
                                setSchemeModalOpen(true);
                              }}
                              className={"w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors " +
                                (isDark ? "border-white/10 bg-white/5 text-white/80 hover:bg-white/10" : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100")}
                            >
                              {locale === "zh" ? "打开方案管理" : "Open plan management"}
                              <span className="float-right" aria-hidden="true">›</span>
                            </button>
                          </div>
                        )}
                      </span>
                    )}
                    {/* 历史展开/折叠仅对 PC 三栏布局生效；移动端该 section 恒为 w-full，此按钮无效，故仅在 PC 渲染 */}
                    {!mobile && (
                      <Button onClick={() => setLeftExpanded(!leftExpanded)}>
                        {leftExpanded ? t("workspace.fold") : t("workspace.unfold")}
                      </Button>
                    )}
                    {/* PC：云同步状态标注（展开按钮右侧；未开启灰字，开启蓝字） */}
                    {!mobile && (
                      <span className={`ml-1 flex items-center gap-1 whitespace-nowrap text-[10px] ${cloudOn ? (isDark ? "text-blue-300" : "text-blue-600") : (isDark ? "text-white/35" : "text-gray-400")}`}>
                        <span className="text-[10px]">☁</span>
                        {cloudText}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Header>
            <Content className="flex-1 overflow-hidden p-0">
              <div
                ref={historyScrollRef}
                className="h-full overflow-x-auto overflow-y-hidden"
                style={{transform: "rotateX(180deg)"}}
              >
                <div
                  className="flex gap-2 px-2 py-2"
                  style={{transform: "rotateX(180deg)"}}
                >
                  {historySemesters.length === 0 && (
                    <div className={`flex w-full items-center justify-center text-sm ${textMuted}`}>
                      {t("workspace.noHistory")}
                    </div>
                  )}
                  {historySemesters.map((sem) => {
                    // Get saved course IDs for this semester
                    const savedIds = savedHistory[sem] ?? [];
                    // Get full course objects for display
                    const savedCourses = savedIds.map((id) => courseMap.get(id)).filter(Boolean) as typeof courses;
                    // Custom courses for this semester
                    const semesterCustom = customCourses[sem] ?? [];
                    const totalDisplayCourses = savedCourses.length + semesterCustom.length;
                    const totalDisplayCredits = savedCourses.reduce((sum, c) => sum + c.credits, 0) + semesterCustom.reduce((sum, c) => sum + c.credits, 0);
                    // Display: only show saved data, no default fallback
                    const displayCourses = savedIds.length > 0 ? savedCourses : [];
                    const hasSaved = savedIds.length > 0;
                    return (
                      <div
                        key={sem}
                        className={`flex w-48 shrink-0 flex-col rounded-lg p-2 ${bgHistoryCard}`}
                        style={{height: "fit-content"}}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-xs font-semibold ${textDark}`}>
                              {locale === "zh" ? abbreviateSemester(sem) : tSemester(sem)}
                            </span>
                            {hasSaved && semesters.indexOf(sem) > currentIdx && (
                              <span className={`rounded px-1 py-0.5 text-[9px] font-medium leading-none ${
                                semesters.indexOf(sem) === currentIdx + 1
                                  ? isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-500/10 text-blue-600"
                                  : isDark ? "bg-purple-500/20 text-purple-300" : "bg-purple-500/10 text-purple-600"
                              }`}>
                                {semesters.indexOf(sem) === currentIdx + 1
                                  ? t("workspace.historyFutureNext")
                                  : t("workspace.historyFuturePlanned")}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Detail button */}
                            {hasSaved && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setHistoryDetail(historyDetail === sem ? null : sem);
                                }}
                                className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none text-[9px] font-bold transition-colors ${
                                  isDark
                                    ? "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/85"
                                    : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                                }`}
                                title={locale === "zh" ? "查看详情" : "View details"}
                              >i</button>
                            )}
                            {/* Edit button — recall to staging */}
                            {hasSaved && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // 正在编辑学期 A 时改编辑学期 B：有未保存改动则先弹窗确认
                                  if (editingFromHistory !== null && editingFromHistory !== sem && hasUnsavedEdits) {
                                    setPendingEditSwitch({ sem, savedIds });
                                    return;
                                  }
                                  setStagingSemester(sem);
                                  setSelectedCourses(new Set(savedIds));
                                  setRemovedIds(new Set());
                                  setEditingFromHistory(sem);
                                  if (mobile) setDrawerOpen(true);
                                }}
                                className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none text-[10px] transition-colors ${
                                  isDark
                                    ? "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/85"
                                    : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                                }`}
                                title={t("workspace.historyEdit")}
                              >✎</button>
                            )}
                            {/* Delete button — only show if has saved data */}
                            {hasSaved && (
                              <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirm(deleteConfirm === sem ? null : sem);
                              }}
                              className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded border-none text-[10px] transition-colors ${
                                isDark
                                  ? "bg-red-500/15 text-red-400 hover:bg-red-500/30"
                                  : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                              }`}
                              title={t("workspace.historyDelete")}
                            >✕</button>
                            )}
                          </div>
                        </div>
                        <div className={`mb-1 text-[10px] ${textMuted}`}>
                          {locale === "zh" ? `共${totalDisplayCourses}门，${totalDisplayCredits}学分` : `${totalDisplayCourses} courses, ${totalDisplayCredits} cr.`}
                        </div>

                        {/* Delete confirmation */}
                        {deleteConfirm === sem && (
                          <div className={`mb-1 rounded px-1.5 py-1 text-[10px] ${isDark ? "bg-red-500/15" : "bg-red-50"}`}>
                            <div className={`mb-1 ${isDark ? "text-red-300" : "text-red-600"}`}>
                              {t("workspace.historyDeleteConfirm")}
                            </div>
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  const next = {...savedHistory};
                                  delete next[sem];
                                  persistHistory(next);
                                  // 同步清理该学期的自定义课程：否则删学期后课程滞留在自定义课程栏（孤儿数据）
                                  if ((customCourses[sem] ?? []).length > 0) {
                                    const nextCustom = {...customCourses};
                                    delete nextCustom[sem];
                                    persistCustom(nextCustom);
                                  }
                                  // 删除的正是正在编辑的学期 → 一并退出编辑态
                                  if (editingFromHistory === sem) {
                                    setEditingFromHistory(null);
                                    setRemovedIds(new Set());
                                    setSelectedCourses(new Set());
                                  }
                                  setDeleteConfirm(null);
                                }}
                                className={`cursor-pointer rounded border-none px-2 py-0.5 text-[10px] font-medium ${
                                  isDark ? "bg-red-500 text-white" : "bg-red-500 text-white"
                                }`}
                              >{t("workspace.historyDelete")}</button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className={`cursor-pointer rounded border-none px-2 py-0.5 text-[10px] ${
                                  isDark ? "bg-white/10 text-white/70" : "bg-gray-200 text-gray-600"
                                }`}
                              >{t("workspace.historyDeleteCancel")}</button>
                            </div>
                          </div>
                        )}

                        {displayCourses.length === 0 && (
                          <div className={`text-xs ${textMuted}`}>—</div>
                        )}
                        {displayCourses.map((c) => (
                          <div
                            key={c.course_id}
                            className={`flex justify-between gap-1 rounded px-1 py-0.5 text-xs ${hoverBg}`}
                          >
                            <span className={`break-words ${textBody}`} style={{wordBreak: "break-word", maxWidth: "calc(100% - 2rem)"}}>
                              {tName(c.course_id, c.name)}
                            </span>
                            <span className={`shrink-0 ${textMuted}`}>{c.credits}</span>
                          </div>
                        ))}
                        {/* Custom courses in history */}
                        {savedIds.length > 0 && (customCourses[sem] ?? []).length > 0 && (
                          <div className={`my-1 border-t pt-1 ${borderLight}`}>
                            {(customCourses[sem] ?? []).map((cc) => (
                              <div key={cc.id} className={`flex justify-between gap-1 rounded px-1 py-0.5 text-xs ${hoverBg}`}>
                                <span className={isDark ? "text-white/60 italic" : "text-gray-500 italic"} style={{wordBreak: "break-word", maxWidth: "calc(100% - 2rem)"}}>
                                  {cc.name}
                                </span>
                                {cc.property && <span className={`shrink-0 text-[9px] mr-1 ${isDark ? "text-white/40" : "text-gray-400"}`}>{cc.property}</span>}
                                <span className={`shrink-0 ${textMuted}`}>{cc.credits}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Content>

            {/* Diagnostics inside history Island */}
            {diagData.semesterEntries.length > 0 || diagData.overMax.length > 0 || diagData.prereqGroups.length > 0 || diagData.choiceConflicts.length > 0 ? (
              <div className={`border-t shrink-0 flex flex-col ${borderCls}`} style={{flex: diagExpanded ? "0.33" : "0 0 auto", minHeight: 0}}>
                <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${bgHeader}`}>
                  <span className={`font-semibold ${textDark}`}>
                    {locale === "zh" ? "诊断" : "Diagnostics"}
                  </span>
                  {(() => {
                    const totalErrors = diagData.semesterEntries.reduce(
                      (s, e) => s + e.checks.filter((c) => !dismissedDiag.has(`${e.sem}_${e.checks.indexOf(c)}`)).length,
                      0,
                    );
                    const overMaxCount = diagData.overMax.filter((o) => !dismissedDiag.has(`overmax_${o.sem}`)).length;
                    const prereqCount = diagData.prereqGroups.reduce(
                      (s, g) => s + g.courses.filter((course) => !dismissedDiag.has(`prereq_${g.prereq}_${course}`)).length,
                      0,
                    );
                    const choiceCount = diagData.choiceConflicts.filter((c) => !dismissedDiag.has(`choice_${c.setName}`)).length;
                    const totalWarnings = overMaxCount + prereqCount + choiceCount;
                    return (
                      <span className={`text-[10px] ${textMuted}`}>
                        {totalErrors > 0 && <span className="text-red-400">❌({totalErrors})</span>}
                        {totalWarnings > 0 && <span className="text-yellow-400 ml-1">⚠({totalWarnings})</span>}
                      </span>
                    );
                  })()}
                  <div className="ml-auto">
                    <Button onClick={() => setDiagExpanded(!diagExpanded)}>
                      {diagExpanded ? t("workspace.fold") : t("workspace.unfold")}
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-0" style={{minHeight: 0}}>
                  <div className={`flex ${diagExpanded ? "flex-row gap-2" : "flex-col"} px-2 py-1`}>
                    {/* Semester-specific entries */}
                    {/* Error blocks — per semester, always shown individually */}
                    {diagExpanded && diagData.semesterEntries.map((entry) => {
                      const remaining = entry.checks.filter((c) => !dismissedDiag.has(`${entry.sem}_${entry.checks.indexOf(c)}`));
                      if (remaining.length === 0) return null;
                      return (
                        <div key={entry.sem} className={`rounded px-2 py-1.5 text-xs ${isDark ? "bg-red-500/10" : "bg-red-50"} ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                          <div className={`flex items-center gap-1 font-medium ${isDark ? "text-red-300" : "text-red-600"}`}>
                            ✕ {locale === "zh" ? abbreviateSemester(entry.sem) : tSemester(entry.sem)}
                          </div>
                          {remaining.map((c) => {
                            const diagKey = `${entry.sem}_${entry.checks.indexOf(c)}`;
                            return (
                              <div key={diagKey} className={`ml-3 flex items-start justify-between gap-1 ${isDark ? "text-red-200" : "text-red-500"}`}>
                                <span>• {c.msg}</span>
                                <button
                                  onClick={() => {
                                    const next = new Set(dismissedDiag);
                                    next.add(diagKey);
                                    setDismissedDiag(next);
                                    localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                                  }}
                                  className={`shrink-0 cursor-pointer border-none text-[9px] ${isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}
                                >✕</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* 超学分上限 — fold across semesters when > 2 */}
                    {diagExpanded && diagData.overMax.length > 0 && (() => {
                      const list = diagData.overMax;
                      const folded = list.length > 2;
                      const foldId = "overmax";
                      const open = foldOpen.has(foldId);
                      const dismiss = (key: string) => {
                        const next = new Set(dismissedDiag);
                        next.add(key);
                        setDismissedDiag(next);
                        localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                      };
                      return (
                        <div className={`rounded px-2 py-1.5 text-xs ${isDark ? "bg-yellow-500/10" : "bg-yellow-50"} ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                          <button
                            onClick={() => folded && toggleFold(foldId)}
                            className={`flex items-center gap-1 font-medium ${isDark ? "text-yellow-300" : "text-yellow-700"} ${folded ? "cursor-pointer" : "cursor-default"}`}
                          >
                            {folded && <span>{open ? "▾" : "▸"}</span>}
                            {folded
                              ? (locale === "zh" ? `⚠ ${abbreviateSemester(list[0].sem)}等${list.length}个学期超过了学分限制` : `⚠ ${tSemester(list[0].sem)} and ${list.length - 1} more term(s) exceed the credit limit`)
                              : (locale === "zh" ? "⚠ 学分超限" : "⚠ Credit limit exceeded")}
                          </button>
                          {(open || !folded) && list.map((o) => {
                            const key = `overmax_${o.sem}`;
                            if (dismissedDiag.has(key)) return null;
                            return (
                              <div key={o.sem} className={`ml-3 flex items-start justify-between gap-1 ${isDark ? "text-yellow-200" : "text-yellow-600"}`}>
                                <span>• {locale === "zh" ? `${abbreviateSemester(o.sem)}：学分 ${o.total} > 上限 ${o.max}` : `${tSemester(o.sem)}: ${o.total} > ${o.max}`}</span>
                                <button onClick={() => dismiss(key)} className={`shrink-0 cursor-pointer border-none text-[9px] ${isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* 强先修缺失 — fold by prereq course when > 2 */}
                    {diagExpanded && diagData.prereqGroups.map((g) => {
                      const folded = g.courses.length > 2;
                      const foldId = `prereq_${g.prereq}`;
                      const open = foldOpen.has(foldId);
                      const dismiss = (key: string) => {
                        const next = new Set(dismissedDiag);
                        next.add(key);
                        setDismissedDiag(next);
                        localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                      };
                      return (
                        <div key={g.prereq} className={`rounded px-2 py-1.5 text-xs ${isDark ? "bg-yellow-500/10" : "bg-yellow-50"} ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                          <button
                            onClick={() => folded && toggleFold(foldId)}
                            className={`flex items-center gap-1 font-medium ${isDark ? "text-yellow-300" : "text-yellow-700"} ${folded ? "cursor-pointer" : "cursor-default"}`}
                          >
                            {folded && <span>{open ? "▾" : "▸"}</span>}
                            {folded
                              ? (locale === "zh" ? `⚠ ${g.courses[0]}等${g.courses.length}门课程需先修${g.prereq}` : `⚠ ${g.courses.length} course(s) incl. ${g.courses[0]} require ${g.prereq} first`)
                              : (locale === "zh" ? "⚠ 先修缺失" : "⚠ Missing prerequisites")}
                          </button>
                          {(open || !folded) && g.courses.map((course) => {
                            const key = `prereq_${g.prereq}_${course}`;
                            if (dismissedDiag.has(key)) return null;
                            return (
                              <div key={course} className={`ml-3 flex items-start justify-between gap-1 ${isDark ? "text-yellow-200" : "text-yellow-600"}`}>
                                <span>• {locale === "zh" ? `「${course}」需先修「${g.prereq}」` : `"${course}" needs prereq "${g.prereq}"`}</span>
                                <button onClick={() => dismiss(key)} className={`shrink-0 cursor-pointer border-none text-[9px] ${isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* 多选一冲突 — fold across sets when > 2 */}
                    {diagExpanded && diagData.choiceConflicts.length > 0 && (() => {
                      const list = diagData.choiceConflicts;
                      const folded = list.length > 2;
                      const foldId = "choice";
                      const open = foldOpen.has(foldId);
                      const dismiss = (key: string) => {
                        const next = new Set(dismissedDiag);
                        next.add(key);
                        setDismissedDiag(next);
                        localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                      };
                      return (
                        <div className={`rounded px-2 py-1.5 text-xs ${isDark ? "bg-orange-500/10" : "bg-orange-50"} ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                          <button
                            onClick={() => folded && toggleFold(foldId)}
                            className={`flex items-center gap-1 font-medium ${isDark ? "text-orange-300" : "text-orange-700"} ${folded ? "cursor-pointer" : "cursor-default"}`}
                          >
                            {folded && <span>{open ? "▾" : "▸"}</span>}
                            {folded
                              ? (locale === "zh" ? `⚠ ${list[0].setName}等${list.length}个组别超出二选一上限` : `⚠ ${list.length} group(s) incl. ${list[0].setName} exceed the mutual-exclusion limit`)
                              : (locale === "zh" ? "⚠ 多选一冲突" : "⚠ Mutual exclusion conflict")}
                          </button>
                          {(open || !folded) && list.map((c) => {
                            const key = `choice_${c.setName}`;
                            if (dismissedDiag.has(key)) return null;
                            return (
                              <div key={c.setName} className={`ml-3 flex items-start justify-between gap-1 ${isDark ? "text-yellow-200" : "text-yellow-600"}`}>
                                <span>• {locale === "zh" ? `「${c.setName}」可只选 ${c.max} 门` : `"${c.setName}" max ${c.max}`}</span>
                                <button onClick={() => dismiss(key)} className={`shrink-0 cursor-pointer border-none text-[9px] ${isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"}`}>✕</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {!diagExpanded && (
                      <div className={`text-xs ${textMuted} px-2 py-2 text-left`}>
                        {(() => {
                          const pastSems = historySemesters.filter((s) => {
                            const idx = semesters.indexOf(s);
                            return idx >= 0 && idx <= currentIdx;
                          });
                          const futureSems = historySemesters.filter((s) => {
                            const idx = semesters.indexOf(s);
                            return idx > currentIdx;
                          });
                          const pastCount = pastSems.reduce((sum, s) => {
                            const ids = savedHistory[s] ?? [];
                            return sum + ids.length + (customCourses[s] ?? []).length;
                          }, 0);
                          const pastCredits = pastSems.reduce((sum, s) => {
                            const ids = savedHistory[s] ?? [];
                            const cCred = ids.reduce((s2, cid) => s2 + (courseMap.get(cid)?.credits ?? 0), 0);
                            const custCred = (customCourses[s] ?? []).reduce((s2, c) => s2 + c.credits, 0);
                            return sum + cCred + custCred;
                          }, 0);
                          const futureCount = futureSems.reduce((sum, s) => {
                            const ids = savedHistory[s] ?? [];
                            return sum + ids.length + (customCourses[s] ?? []).length;
                          }, 0);
                          const futureCredits = futureSems.reduce((sum, s) => {
                            const ids = savedHistory[s] ?? [];
                            const cCred = ids.reduce((s2, cid) => s2 + (courseMap.get(cid)?.credits ?? 0), 0);
                            const custCred = (customCourses[s] ?? []).reduce((s2, c) => s2 + c.credits, 0);
                            return sum + cCred + custCred;
                          }, 0);
                          return locale === "zh"
                            ? `已选${pastCount}门，${pastCredits}学分${futureCount > 0 ? `；预选${futureCount}门，${futureCredits}学分` : ""}`
                            : `${pastCount} courses, ${pastCredits} cr.${futureCount > 0 ? `; preselected ${futureCount} courses, ${futureCredits} cr.` : ""}`;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </Island>
        </section>

        {/* ========== MIDDLE: Staging / Pre-selection (1/5) ========== */}
        {mobile && (
          <div
            className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <section
          className={`h-full flex flex-col overflow-hidden ${mobile ? `fixed inset-x-0 bottom-0 z-50 max-h-[85vh] rounded-t-2xl ${isDark ? "bg-[#16161f]" : "bg-white"}` : ""}`}
          style={mobile ? {
            flex: undefined,
            minWidth: undefined,
            transition: stagingDragging ? "none" : "transform 300ms ease-out",
            transform: drawerOpen ? `translateY(${stagingTranslate}px)` : "translateY(100%)",
            pointerEvents: drawerOpen ? "auto" : "none",
          } : {flex: "2", minWidth: 240}}
        >
          <Island className={`flex h-full flex-col ${bgCard}`}>
            {/* 拖动条：按住并向下滑动可关闭预选抽屉 */}
            {mobile && (
              <div
                onTouchStart={onStagingTouchStart}
                onTouchMove={onStagingTouchMove}
                onTouchEnd={onStagingTouchEnd}
                className="shrink-0 cursor-grab touch-none pt-2 pb-1 active:cursor-grabbing"
              >
                <div className={`mx-auto h-1 w-10 rounded-full ${isDark ? "bg-white/20" : "bg-gray-300"}`} />
              </div>
            )}
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>{t("workspace.stagingCourse")}</span>
            </Header>
            <Content className="flex flex-1 flex-col p-0" style={{minHeight: 0}}>
              {/* Semester selector (always visible at top) */}
              {allStagingOptions.length > 0 && (
                <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs shrink-0 ${textBody}`}>
                  <span className="whitespace-nowrap">{t("workspace.stagingSemester")}</span>
                  <NativeSelect
                    value={stagingSemester}
                    options={allStagingOptions.map((s) => ({
                      key: s,
                      label: locale === "zh" ? abbreviateSemester(s) : tSemester(s),
                    }))}
                    onChange={(key) => setStagingSemester(key)}
                    dark={isDark}
                    borderCls={borderCls}
                    textMuted={textMuted}
                  />
                </div>
              )}

              {/* Selected course list (scrollable middle) */}
              <div className="flex-1 overflow-auto px-3 py-1" style={{minHeight: "4.5rem"}}>
                {(() => {
                  // 编辑态：原课程列表在前（含被软删除的——划线展示、可恢复），新增课程在后；
                  // 普通态：仅当前预选课程。
                  const isEditing = editingFromHistory !== null;
                  const addedIds = [...selectedCourses].filter((cid) => !editingSavedSet.has(cid));
                  const rows: Array<{ cid: string; removed: boolean }> = isEditing
                    ? [
                        ...(savedHistory[editingFromHistory] ?? []).map((cid) => ({ cid, removed: removedIds.has(cid) })),
                        ...addedIds.map((cid) => ({ cid, removed: false })),
                      ]
                    : [...selectedCourses].map((cid) => ({ cid, removed: false }));
                  if (rows.length === 0) {
                    return (
                      <div className={`flex h-full items-center justify-center text-xs ${textMuted}`}>
                        {t("workspace.stagingEmpty")}
                      </div>
                    );
                  }
                  return rows.map(({ cid, removed }) => {
                    const c = courseMap.get(cid);
                    if (!c) return null;
                    // Check if this course has siblings in same choice sets
                    const csInfo = courseChoiceSets.get(cid);
                    const isSavedCourse = editingSavedSet.has(cid); // 编辑学期原有课 → 软删除语义
                    return (
                      <div
                        key={cid}
                        className={`flex items-center justify-between gap-1 rounded px-1.5 py-1 text-xs ${hoverBg}`}
                      >
                        <span
                          className={`flex-1 min-w-0 truncate ${removed ? "line-through opacity-50" : textBody}`}
                          title={tName(cid, c.name)}
                        >
                          {tName(cid, c.name)}
                        </span>
                        <span className={`shrink-0 ${textMuted} mr-1`}>{c.credits}</span>
                        {csInfo && csInfo.length > 0 && !removed && (
                          <span className={`shrink-0 text-[9px] mr-1 ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
                            {csInfo.map((cs) => (locale === "zh" ? `${cs.maxSelect}选1` : `pick 1 of ${cs.maxSelect}`)).join(" ")}
                          </span>
                        )}
                        {removed ? (
                          <button
                            onClick={() => restoreCourse(cid)}
                            className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-none text-[10px] transition-colors ${
                              isDark
                                ? "bg-green-500/15 text-green-400 hover:bg-green-500/30"
                                : "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                            }`}
                            title={locale === "zh" ? "恢复选择" : "Restore"}
                          >↻</button>
                        ) : (
                          <button
                            onClick={() => (isEditing && isSavedCourse ? softRemoveCourse(cid) : toggleSelected(cid))}
                            className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-none text-[10px] transition-colors ${
                              isDark
                                ? "bg-red-500/15 text-red-400 hover:bg-red-500/30"
                                : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                            }`}
                            title={t("workspace.stagingRemove")}
                          >✕</button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Summary + Save button */}
              {(selectedCourses.size > 0 || removedIds.size > 0) && (
                <div className={`flex flex-col border-t shrink-0 ${borderCls}`}>
                  {stagingSemester && (() => {
                    const limit = getCreditLimit(stagingSemester);
                    const total = calcSemesterCredits(stagingSemester, [...selectedCourses]);
                    const customList = customCourses[stagingSemester] ?? [];
                    const customCount = customList.length;
                    const customCreditsCount = customList.reduce((s, c) => s + c.credits, 0);
                    return limit ? (
                      <div className={`flex flex-col px-3 pt-1.5 pb-0.5 text-[10px] ${textMuted}`}>
                        <span>{total}/{limit.max} {locale === "zh" ? "学分" : "cr."}{limit.min > 0 && (locale === "zh" ? ` 每学期至少6学分（军训/暑期除外）` : ` (min 6 credits per term, excluding boot camp & summer)`)}</span>
                        {customCount > 0 && (
                          <span>{locale === "zh" ? `已添加${customCount}门自定义课程，占${customCreditsCount}学分` : `${customCount} custom course(s) added, ${customCreditsCount} cr.`}</span>
                        )}
                      </div>
                    ) : null;
                  })()}
                  <div className={`flex items-center justify-between gap-2 px-3 pt-2 pb-1 text-xs`}>
                    <span className={textMuted}>
                    {locale === "zh"
                      ? `共${selectedCourses.size + ((customCourses[stagingSemester] ?? []).length)}门，${calcSemesterCredits(stagingSemester, [...selectedCourses])}学分`
                      : `${selectedCourses.size} courses, ${calcSemesterCredits(stagingSemester, [...selectedCourses])} cr.`}
                  </span>
                  </div>
                  <div className="flex items-stretch gap-1.5 px-3 pb-2">
                    <button
                      onClick={() => setCancelConfirm(true)}
                      className={`flex-1 cursor-pointer whitespace-nowrap rounded px-2 py-1.5 text-xs transition-colors border-none ${
                        isDark
                          ? "bg-white/10 text-white/70 hover:bg-white/20"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >{editingFromHistory ? (locale === "zh" ? "取消修改" : "Discard") : (locale === "zh" ? "清空" : "Clear")}</button>
                  <Button
                    className="flex-1"
                    style={{flex: "1 1 0%"}}
                    onClick={() => {
                      if (!stagingSemester) return;
                      const selected = [...selectedCourses];
                      const checks = getSemesterChecks(stagingSemester, selected);
                      const hasErrors = checks.some((c) => c.type === "error");
                      if (hasErrors) {
                        setValidationErrors(checks.map((c) => c.msg));
                        return;
                      }
                      const next = {...savedHistory, [stagingSemester]: selected};
                      persistHistory(next);
                      setSelectedCourses(new Set());
                      setRemovedIds(new Set());
                      setEditingFromHistory(null);
                      setValidationErrors(null);
                      setForceSaveData(null);
                      // Auto-advance to next available semester
                      const idx = availableStagingSemesters.indexOf(stagingSemester);
                      if (idx >= 0 && idx + 1 < availableStagingSemesters.length) {
                        setStagingSemester(availableStagingSemesters[idx + 1]);
                      } else {
                        setStagingSemester("");
                      }
                    }}
                  >{t("workspace.stagingSave")}</Button>
                  </div>
                </div>
                )}

              {/* Force-save button when validation errors exist */}
              {validationErrors && validationErrors.length > 0 && (
                <div className={`border-t shrink-0 px-3 py-2 ${borderCls}`}>
                  <div className={`mb-2 rounded px-2 py-1.5 text-[10px] space-y-0.5 ${
                    isDark ? "bg-red-500/15" : "bg-red-50"
                  }`}>
                    {(() => {
                      const checks = stagingSemester ? getSemesterChecks(stagingSemester, [...selectedCourses]) : [];
                      const errorMsgs = checks.filter((c) => c.type === "error").map((c) => c.msg);
                      const warningMsgs = checks.filter((c) => c.type === "warning").map((c) => c.msg);
                      return (
                        <>
                          {errorMsgs.map((err, i) => (
                            <div key={i} className={isDark ? "text-red-200" : "text-red-500"}>• {err}</div>
                          ))}
                          {warningMsgs.map((warn, i) => (
                            <div key={`w${i}`} className={isDark ? "text-yellow-200" : "text-yellow-600"}>• {warn}</div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                  <Button
                    onClick={() => setShowForceConfirm(true)}
                  >{t("workspace.saveAnyway")}</Button>
                </div>
              )}

              {/* Custom Courses - pinned at bottom by flex-1 above */}
              <div className={`border-t shrink-0 ${borderCls}`}>
                <div className={`px-3 pt-2 pb-1 text-xs font-medium ${textDark}`}>
                  {t("workspace.customCourse")}
                </div>
                <div className="px-3 pb-1">
                  <div className="flex items-center gap-1 mb-1">
                    <input
                      className={`w-24 min-w-0 rounded border px-1.5 py-0.5 text-xs outline-none ${
                        isDark ? "bg-white/5 border-white/10 text-white/80" : "bg-gray-50 border-gray-200 text-gray-800"
                      }`}
                      placeholder={t("workspace.customCourseName")}
                      value={customName}
                      onChange={(e) => { setCustomName(e.target.value); setCustomDuplicateMsg(null); }}
                    />
                    <input
                      className="w-16 rounded border px-1.5 py-0.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      style={
                        isDark
                          ? {background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)"}
                          : {background: "#f9fafb", borderColor: "#e5e7eb", color: "#374151"}
                      }
                      placeholder={t("workspace.customCourseCredits")}
                      value={customProperty === "思政限选" ? "1" : customCredits}
                      onChange={(e) => setCustomCredits(e.target.value)}
                      disabled={customProperty === "思政限选"}
                      type="number"
                      min="0"
                      step="0.5"
                    />
                    <button
                      onClick={addCustomCourse}
                      className={`cursor-pointer rounded border-none px-2 py-[3px] text-xs font-medium transition-colors shrink-0 ${
                        isDark
                          ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                          : "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                      }`}
>{t("workspace.customCourseAdd")}</button>
                  </div>
                  {/* 课程属性下拉框：移动端用原生 select，避免 Ring UI 弹层在抽屉/遮罩内打不开 */}
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] shrink-0 ${textMuted}`}>{locale === "zh" ? "课程属性" : "Property"}</span>
                    <div className="shrink-0" style={{width: "8rem"}}>
                      <NativeSelect
                        value={customProperty}
                        options={[
                          {key: "无", label: locale === "zh" ? "无" : "None"},
                          {key: "通识-艺术", label: geLabelFor("通识-艺术", locale)},
                          {key: "通识-社科", label: geLabelFor("通识-社科", locale)},
                          {key: "通识-人文", label: geLabelFor("通识-人文", locale)},
                          {key: "通识-科学", label: geLabelFor("通识-科学", locale)},
                          {key: "SRT", label: "SRT"},
                          {key: "思政限选", label: locale === "zh" ? "思政限选（1学分）" : "Pol. Elective (1 cr)"},
                          {key: "重修", label: locale === "zh" ? "重修" : "Retake"},
                          {key: "其他", label: locale === "zh" ? "其他" : "Other"},
                        ]}
                        onChange={(key) => {
                          setCustomProperty(key);
                          // 思政限选固定 1 学分：选中时锁定学分输入框
                          if (key === "思政限选") setCustomCredits("1");
                        }}
                        dark={isDark}
                        borderCls={isDark ? "border-white/10" : "border-gray-200"}
                        textMuted={textMuted}
                      />
                    </div>
                  </div>
                  {/* 重复提示 */}
                  {customDuplicateMsg && (
                    <div className={`text-[10px] ${isDark ? "text-red-300" : "text-red-600"}`}>{customDuplicateMsg}</div>
                  )}
                  {stagingSemester && (customCourses[stagingSemester] ?? []).length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      {(customCourses[stagingSemester] ?? []).map((cc) => (
                        <div key={cc.id} className={`flex items-center justify-between rounded px-1.5 py-0.5 text-xs ${hoverBg}`}>
                          <span className={`flex-1 min-w-0 truncate ${textBody}`}>{cc.name}</span>
                          {cc.property && <span className={`shrink-0 text-[9px] mr-1 ${isDark ? "text-white/40" : "text-gray-400"}`}>{cc.property}</span>}
                          <span className={`shrink-0 ${textMuted} mr-1`}>{cc.credits}</span>
                          <button
                            onClick={() => removeCustomCourse(stagingSemester, cc.id)}
                            className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-none text-[9px] transition-colors ${
                              isDark ? "text-white/40 hover:text-white/70" : "text-gray-400 hover:text-gray-600"
                            }`}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(!stagingSemester || (customCourses[stagingSemester] ?? []).length === 0) && (
                    <div className={`text-[10px] ${textMuted} py-1`}>{t("workspace.customCourseEmpty")}</div>
                  )}
                  {/* 五类通识自定义课程总学分统计 */}
                  <div className={`mt-1 text-[9px] leading-tight ${textMuted}`}>
                    {t("workspace.geCredits")}
                    {geLabelFor("通识-艺术", locale)} {customStats["通识-艺术"]} / {geLabelFor("通识-社科", locale)} {customStats["通识-社科"]} / {geLabelFor("通识-人文", locale)} {customStats["通识-人文"]} / {geLabelFor("通识-科学", locale)} {customStats["通识-科学"]} / {geLabelFor("SRT", locale)} {customStats["SRT"]} / {geLabelFor("思政限选", locale)} {customStats["思政限选"]}
                  </div>
                </div>
              </div>

              </Content>

            </Island>
          </section>

          {/* ===== Force-save confirm modal ===== */}
          {showForceConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}
                 onClick={() => setShowForceConfirm(false)}>
              <div className={`w-72 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}
                   onClick={(e) => e.stopPropagation()}>
                <div className={`text-sm font-semibold mb-2 ${textDark}`}>{t("workspace.saveForceTitle")}</div>
                <div className={`text-xs mb-3 ${textBody}`}>{t("workspace.saveForceConfirm")}</div>
                {stagingSemester && (() => {
                  const checks = getSemesterChecks(stagingSemester, [...selectedCourses]);
                  const errorMsgs = checks.filter((c) => c.type === "error").map((c) => c.msg);
                  const warningMsgs = checks.filter((c) => c.type === "warning").map((c) => c.msg);
                  return (
                    <div className={`mb-3 rounded px-2 py-1.5 text-[10px] space-y-0.5 ${isDark ? "bg-red-500/15" : "bg-red-50"}`}>
                      {errorMsgs.map((err, i) => (
                        <div key={i} className={isDark ? "text-red-200" : "text-red-500"}>• {err}</div>
                      ))}
                      {warningMsgs.map((warn, i) => (
                        <div key={`w${i}`} className={isDark ? "text-yellow-200" : "text-yellow-600"}>• {warn}</div>
                      ))}
                    </div>
                  );
                })()}
                <div className="flex gap-2 justify-end">
                  <Button onClick={() => setShowForceConfirm(false)}>{t("workspace.historyDeleteCancel")}</Button>
                  <Button onClick={() => {
                    if (!stagingSemester) return;
                    const selected = [...selectedCourses];
                    const next = {...savedHistory, [stagingSemester]: selected};
                    persistHistory(next);
                    setSelectedCourses(new Set());
                    setRemovedIds(new Set());
                    setEditingFromHistory(null);
                    setValidationErrors(null);
                    setShowForceConfirm(false);
                    setForceSaveData(null);
                    const idx = availableStagingSemesters.indexOf(stagingSemester);
                    if (idx >= 0 && idx + 1 < availableStagingSemesters.length) {
                      setStagingSemester(availableStagingSemesters[idx + 1]);
                    } else {
                      setStagingSemester("");
                    }
                  }}>
                    {t("workspace.stagingSave")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ===== Choice conflict modal ===== */}
          {choiceConflict && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}>
              <div className={`w-80 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}>
                <div className={`text-sm font-semibold mb-2 ${textDark}`}>
                  {choiceConflict.courseId === choiceConflict.conflictId && choiceConflict.setName === "历史已选课程"
                    ? t("workspace.conflictDuplicate")
                    : choiceConflict.courseId === choiceConflict.conflictId
                    ? t("workspace.conflictNotice")
                    : t("workspace.conflictTitle")}
                </div>
                <div className={`text-xs mb-3 leading-relaxed ${textBody}`}>
                  {choiceConflict.courseId === choiceConflict.conflictId ? (
                    choiceConflict.conflictName
                  ) : (
                    locale === "zh"
                      ? `「${choiceConflict.courseName}」与「${choiceConflict.conflictName}」属于「${choiceConflict.setName}」，只需选择一门。`
                      : `"${choiceConflict.courseName}" and "${choiceConflict.conflictName}" are in "${choiceConflict.setName}". Only one is needed.`
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button onClick={() => setChoiceConflict(null)}>
                    {choiceConflict.courseId === choiceConflict.conflictId && choiceConflict.setName !== "历史已选课程"
                      ? (locale === "zh" ? "知道了" : "OK")
                      : (locale === "zh" ? "取消" : "Cancel")}
                  </Button>
                  {(choiceConflict.courseId !== choiceConflict.conflictId || choiceConflict.setName === "历史已选课程") && (
                    <Button onClick={() => {
                      setChoiceConflict(null);
                      setSelectedCourses((prev) => {
                        const next = new Set(prev);
                        next.add(choiceConflict.courseId);
                        return next;
                      });
                    }}>
                      {locale === "zh" ? "仍然选课" : "Select Anyway"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===== Clear All confirmation modal ===== */}
          {clearConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}
                 onClick={() => setClearConfirm(false)}>
              <div className={`w-72 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}
                   onClick={(e) => e.stopPropagation()}>
                <div className={`text-sm font-semibold mb-2 ${textDark}`}>
                  {locale === "zh" ? "确定清除全部选课记录吗？" : "Clear all course records?"}
                </div>
                <div className={`text-xs mb-3 ${textBody}`}>
                  {locale === "zh"
                    ? "此操作将清除所有学期的选课记录和自定义课程数据。此操作不可撤销。"
                    : "This will clear all course records and custom course data across all semesters. This action cannot be undone."}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button onClick={() => setClearConfirm(false)}>
                    {locale === "zh" ? "取消" : "Cancel"}
                  </Button>
                  <Button onClick={() => {
                    persistHistory({});
                    persistCustom({});
                    setEditingFromHistory(null);
                    setRemovedIds(new Set());
                    setSelectedCourses(new Set());
                    setClearConfirm(false);
                  }}>
                    {locale === "zh" ? "确定清除" : "Clear All"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ===== Cancel-edit confirmation modal ===== */}
          {cancelConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}>
              <div className={`w-80 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}>
                <div className={`text-sm font-semibold mb-2 ${textDark}`}>
                  {editingFromHistory ? (locale === "zh" ? "取消修改" : "Discard Changes") : (locale === "zh" ? "清空预选" : "Clear Staging")}
                </div>
                <div className={`text-xs mb-3 leading-relaxed ${textBody}`}>
                  {editingFromHistory
                    ? (locale === "zh"
                      ? `确定放弃对「${abbreviateSemester(editingFromHistory)}」的修改吗？未保存的改动将丢失。`
                      : `Discard unsaved changes to ${tSemester(editingFromHistory)}?`)
                    : (locale === "zh"
                      ? "确定清空当前预选的课程吗？"
                      : "Clear all preselected courses?")}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button onClick={() => setCancelConfirm(false)}>
                    {locale === "zh" ? "继续编辑" : "Keep Editing"}
                  </Button>
                  <Button onClick={() => {
                    cancelStaging();
                    setCancelConfirm(false);
                  }} primary>
                    {locale === "zh" ? "确定取消" : "Discard"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ===== Switch-editing-semester confirmation modal ===== */}
          {pendingEditSwitch && (() => {
            const fromSem = editingFromHistory ?? "";
            const target = pendingEditSwitch;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}>
                <div className={`w-80 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}>
                  <div className={`text-sm font-semibold mb-2 ${textDark}`}>
                    {locale === "zh" ? "切换编辑学期" : "Switch Editing Semester"}
                  </div>
                  <div className={`text-xs mb-3 leading-relaxed ${textBody}`}>
                    {locale === "zh"
                      ? `正在编辑「${abbreviateSemester(fromSem)}」的选课且尚未保存。切换到编辑「${abbreviateSemester(target.sem)}」前，要保存对「${abbreviateSemester(fromSem)}」的修改吗？`
                      : `You have unsaved changes in ${tSemester(fromSem)}. Save them before editing ${tSemester(target.sem)}?`}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button onClick={() => setPendingEditSwitch(null)}>
                      {locale === "zh" ? "取消" : "Cancel"}
                    </Button>
                    <Button onClick={() => {
                      // 放弃 A 的修改，直接进 B
                      setStagingSemester(target.sem);
                      setSelectedCourses(new Set(target.savedIds));
                      setRemovedIds(new Set());
                      setEditingFromHistory(target.sem);
                      setPendingEditSwitch(null);
                      if (mobile) setDrawerOpen(true);
                    }}>
                      {locale === "zh" ? "不保存" : "Discard"}
                    </Button>
                    <Button primary onClick={() => {
                      // 保存 A 的当前预选，再进 B
                      const next = {...savedHistory, [fromSem]: [...selectedCourses]};
                      persistHistory(next);
                      setStagingSemester(target.sem);
                      setSelectedCourses(new Set(target.savedIds));
                      setRemovedIds(new Set());
                      setEditingFromHistory(target.sem);
                      setPendingEditSwitch(null);
                      if (mobile) setDrawerOpen(true);
                    }}>
                      {locale === "zh" ? "保存并切换" : "Save & Switch"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== History Detail Popup ===== */}
          {historyDetail && (() => {
            const sem = historyDetail;
            const savedIds = savedHistory[sem] ?? [];
            const savedCourses = savedIds.map((id) => courseMap.get(id)).filter(Boolean) as typeof courses;
            const semesterCustom = customCourses[sem] ?? [];
            return (
              <div
                className="fixed inset-0 z-50 flex items-start justify-center pt-12"
                style={{background: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.15)"}}
                onClick={() => setHistoryDetail(null)}
              >
                <div
                  className={`w-96 max-h-[75vh] overflow-auto rounded-xl shadow-2xl border ${isDark ? "bg-[#1e1e2a]" : "bg-white"} ${borderCls}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className={`flex items-center justify-between px-5 py-4 border-b ${borderCls}`}>
                    <span className={`text-base font-semibold ${textDark}`}>
                      {locale === "zh" ? abbreviateSemester(sem) : tSemester(sem)}
                      <span className={`ml-2 text-xs font-normal ${textMuted}`}>
                        ({locale === "zh" ? `共${savedCourses.length + semesterCustom.length}门` : `${savedCourses.length + semesterCustom.length} courses`})
                      </span>
                    </span>
                    <button
                      onClick={() => setHistoryDetail(null)}
                      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-none text-sm transition-colors ${
                        isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-400"
                      }`}
                    >✕</button>
                  </div>
                  <div className="flex flex-col gap-3 px-5 py-4">
                    {savedCourses.length === 0 && semesterCustom.length === 0 && (
                      <span className={`text-sm ${textMuted}`}>{locale === "zh" ? "无课程数据" : "No courses"}</span>
                    )}
                    {savedCourses.map((c) => {
                      const prereqIds = prereqMap.get(c.course_id) ?? [];
                      const prereqNames = prereqIds.map((pid) => {
                        const pc = courseMap.get(pid);
                        return pc ? tName(pid, pc.name) : pid;
                      });
                      const categories = getCourseCategories(c.course_id);
                      const sems = courseSemesterMap.get(c.course_id) ?? [];
                      const enName = enNameMap.get(c.course_id);
                      const csInfo = courseChoiceSets.get(c.course_id);
                      return (
                        <div key={c.course_id} className={`rounded-lg border p-3 ${borderCls}`}>
                          <div className={`text-base font-semibold ${textDark}`}>{tName(c.course_id, c.name)}</div>
                          {locale === "zh" && enName && (
                            <div className={`text-xs ${textMuted} mb-1`}>{enName}</div>
                          )}
                          <div className={`flex flex-col gap-1 mt-1 text-sm ${textMuted}`}>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "编号" : "Code"}</span>
                              <span className={`font-mono ${textDark}`}>{c.course_id.startsWith("NEW") ? (locale === "zh" ? "新开课" : "New") : c.course_id}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "学分" : "Credits"}</span>
                              <span className={`font-semibold ${textDark}`}>{c.credits}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "类别" : "Category"}</span>
                              <span className={`text-right ${textDark}`} style={{maxWidth: "65%"}}>
                                {categories.length > 0 ? categories.join(", ") : "—"}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "修读属性" : "Attribute"}</span>
                              <span className={`text-right ${textDark}`} style={{maxWidth: "65%"}}>
                            {(() => {
                              const key = c.course_attr ?? "";
                              if (!key) return "—";
                              const label = locale === "zh" ? (ATTR_LABELS[key] ?? key) : (ATTR_LABELS_EN[key] ?? key);
                              if (key === "prof_required") return locale === "zh" ? `${label}（${c.prof_note ?? ""}）` : `${label} (${c.prof_note ?? ""})`;
                              return label;
                            })()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "推荐学期" : "Semester"}</span>
                              <span className={`text-right ${textDark}`}>
                                {sems.length > 0
                                  ? sems.map((s) => (locale === "zh" ? abbreviateSemester(s) : tSemester(s))).join(", ")
                                  : "—"}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>{locale === "zh" ? "先修课程" : "Prerequisites"}</span>
                              <span className={`text-right ${textDark}`} style={{maxWidth: "65%"}}>
                                {prereqNames.length > 0 ? prereqNames.join("; ") : "—"}
                              </span>
                            </div>
                            {csInfo && csInfo.length > 0 && (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className={`text-xs ${textMuted}`}>{locale === "zh" ? "多选一关系" : "Mutual Exclusion"}</span>
                                {csInfo.map((cs) => (
                                  <span key={cs.setId} className={`pl-2 text-xs ${isDark ? "text-yellow-300" : "text-yellow-700"}`}>
                                    {cs.setName}（{locale === "zh" ? `${cs.maxSelect}选1` : `pick 1 of ${cs.maxSelect}`}）：{cs.siblings.map((s) => tName(s.courseId, s.name)).join("、")}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {semesterCustom.map((cc) => (
                      <div key={cc.id} className={`rounded-lg border p-3 ${borderCls}`}>
                        <div className={`text-base font-semibold ${textDark}`}>{cc.name}</div>
                        <div className={`flex flex-col gap-1 mt-1 text-sm ${textMuted}`}>
                          <div className="flex justify-between">
                            <span>{locale === "zh" ? "来源" : "Source"}</span>
                            <span className={isDark ? "text-white/60 italic" : "text-gray-500 italic"}>
                              {locale === "zh" ? "自定义课程" : "Custom"}{cc.property ? "(" + cc.property + ")" : ""}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>{locale === "zh" ? "学分" : "Credits"}</span>
                            <span className={`font-semibold ${textDark}`}>{cc.credits}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ===== 方案管理浮窗（云端方案 + 本地导入导出；导入面板内嵌于浮窗） ===== */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = ""; // 允许重复选择同一文件
            }}
          />
          <SchemeManageModal
            open={schemeModalOpen}
            onClose={() => setSchemeModalOpen(false)}
            onExport={handleExport}
            mobile={mobile}
            importPreview={importPreview}
            hasPending={!!pendingImport}
            onPickFile={() => fileInputRef.current?.click()}
            onConfirmMerge={confirmImport}
            onConfirmOverwrite={confirmImportOverwrite}
            onCancelImport={cancelImport}
          />

          {/* ========== RIGHT: Catalog ========== */}
        <section
          className={`h-full flex flex-col overflow-hidden ${
            mobile ? (mobileTab === "catalog" ? "w-full" : "hidden") : ""
          }`}
          style={mobile ? undefined : {flex: leftExpanded ? "4" : "5", minWidth: 520}}
        >
          {/* 移动端首次进入「课程目录」时短暂显示的引导提示条（可手动关闭，约 4.5s 自动消失） */}
          {mobile && showFilterHint && (
            <div
              className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-[11px] leading-snug ${isDark ? "border-[#863bff]/30 bg-[#863bff]/10 text-purple-200" : "border-[#863bff]/30 bg-[#863bff]/10 text-[#863bff]"}`}
            >
              <span className="flex-1">{t("workspace.filterSidebarHint")}</span>
              <button
                onClick={() => { setShowFilterHint(false); setFiltersCollapsed(false); }}
                className={`shrink-0 rounded border px-2 py-0.5 text-[10px] transition-colors ${isDark ? "border-white/20 bg-white/10 text-white/80 hover:text-white" : "border-[#863bff]/30 bg-white/80 text-[#863bff] hover:bg-white"}`}
              >
                {locale === "zh" ? "去筛选" : "Filter"}
              </button>
              <button
                onClick={() => setShowFilterHint(false)}
                className={`shrink-0 rounded px-1 text-base leading-none ${isDark ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-800"}`}
                aria-label="close hint"
              >×</button>
            </div>
          )}

          <Island className={`flex ${mobile ? "flex-1 min-h-0" : "h-full"} flex-col ${bgCard}`}>
            {!mobile && (
              <Header border wrapWithTitle={false}>
                <div className="flex w-full items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${textDark}`}>{t("workspace.catalog")}</span>
                  {/* 当前学期显示（自动判定后仅作展示，不再手动切换） */}
                  <span className={`flex items-baseline gap-1 text-xs ${textBody}`}>
                    {locale === "zh" ? "当前学期：" : "Current semester: "}
                    <span className={`font-medium ${textDark}`}>{tSemester(currentSemester)}</span>
                    {semesterAuto && <span className={`text-[9px] ${isDark ? "text-white/35" : "text-gray-400"}`}>{locale === "zh" ? "（自动）" : "(auto)"}</span>}
                  </span>
                </div>
              </Header>
            )}

            {/* 移动端：搜索与筛选抽屉（从左侧滑出，占屏幕宽度 80%） */}
            {mobile && (
              <>
                {/* 遮罩 */}
                <div
                  className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${filtersCollapsed ? "opacity-0 pointer-events-none" : "opacity-100"}`}
                  onClick={() => setFiltersCollapsed(true)}
                />
                {/* 抽屉 */}
                <div
                  onTouchStart={onFilterTouchStart}
                  onTouchMove={onFilterTouchMove}
                  onTouchEnd={onFilterTouchEnd}
                  className={`fixed inset-y-0 left-0 z-50 w-[80vw] max-w-[320px] flex flex-col shadow-2xl touch-pan-y ${isDark ? "bg-[#16161f]" : "bg-white"}`}
                  style={{
                    transition: filterDragging ? "none" : "transform 300ms ease-out",
                    transform: filtersCollapsed ? "translateX(-100%)" : `translateX(${filterTranslate}px)`,
                  }}
                >
                  <div className={`flex items-center justify-between gap-2 border-b px-3 py-2 ${borderCls}`}>
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${textDark}`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      {t("workspace.searchFilter")}
                    </span>
                    <button
                      onClick={() => setFiltersCollapsed(true)}
                      className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${isDark ? "border-white/10 text-white/55 hover:text-white/85" : "border-gray-200 text-gray-500 hover:text-gray-800"}`}
                    >
                      <span>{t("workspace.collapseFilters")}</span>
                      <span className="text-xs leading-none">▴</span>
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-3">
                    <div className="flex flex-col gap-2">
                      <Input
                        label={t("workspace.searchPlaceholder")}
                        value={searchText}
                        onChange={(e) => setSearchText(e.currentTarget.value)}
                        onClear={() => setSearchText("")}
                      />
                      <button
                        data-tour="recommend"
                        onClick={() => setRecommendEnabled(!recommendEnabled)}
                        className={`self-start rounded border px-3 py-1.5 text-xs font-medium leading-none transition-colors ${
                          recommendEnabled
                            ? isDark
                              ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                              : "bg-blue-500/10 border-blue-500/30 text-blue-600"
                            : isDark
                              ? "bg-white/5 border-white/10 text-white/50"
                              : "bg-gray-50 border-gray-200 text-gray-400"
                        }`}
                      >
                        {locale === "zh" ? `推荐${recommendEnabled ? "ON" : "OFF"}` : `Rec.${recommendEnabled ? "ON" : "OFF"}`}
                      </button>
                      <div className={`text-xs font-medium ${textMuted} pt-1`}>{t("workspace.filterHeader")}</div>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs ${textBody}`}>{t("workspace.filterGroup")}</span>
                          <NativeSelect
                            value={filters.group}
                            options={groupOptions.map((o) => ({key: o.key, label: o.label}))}
                            onChange={(key) => setFilters((f) => ({...f, group: key}))}
                            dark={isDark}
                            borderCls={borderCls}
                            textMuted={textMuted}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs ${textBody}`}>{t("workspace.filterSemester")}</span>
                          <NativeSelect
                            value={filters.semester}
                            options={semesterOptions.map((o) => ({key: o.key, label: o.label}))}
                            onChange={(key) => setFilters((f) => ({...f, semester: key}))}
                            dark={isDark}
                            borderCls={borderCls}
                            textMuted={textMuted}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs ${textBody}`}>{t("workspace.filterModule")}</span>
                          <NativeSelect
                            value={filters.module}
                            options={moduleOptions.map((o) => ({key: o.key, label: o.label}))}
                            onChange={(key) => setFilters((f) => ({...f, module: key, abGroup: "all"}))}
                            dark={isDark}
                            borderCls={borderCls}
                            textMuted={textMuted}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className={`text-xs ${textBody}`}>{t("workspace.filterABGroup")}</span>
                          <NativeSelect
                            value={filters.abGroup}
                            options={abOptions.map((o) => ({key: o.key, label: o.label, disabled: !moduleEnabled && o.key !== "all"}))}
                            onChange={(key) => moduleEnabled && setFilters((f) => ({...f, abGroup: key}))}
                            dark={isDark}
                            borderCls={borderCls}
                            textMuted={textMuted}
                          />
                        </div>
                      </div>
                      {hasActiveFilters && (
                        <div className="pt-1">
                          <Button onClick={clearFilters}>{t("workspace.filterClear")}</Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* 底部【完成】：筛选条件实时生效，此按钮用于引导用户收起抽屉、查看已筛选的课程列表 */}
                  <div className={`shrink-0 border-t px-3 py-2 ${borderCls}`}>
                    <button
                      onClick={() => setFiltersCollapsed(true)}
                      className={`w-full cursor-pointer rounded-lg border py-2.5 text-sm font-medium transition-colors ${isDark ? "border-blue-500/30 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30" : "border-blue-500/30 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"}`}
                    >
                      {t("workspace.doneFilters")}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ===== Filters (PC 端) ===== */}
            <Content
              className="overflow-visible border-b shrink-0"
              style={{position: "relative", zIndex: 2}}
            >
              {/* PC 端：搜索与筛选始终内联显示 */}
              {!mobile && (
              <div className={`px-3 pt-2 pb-1 grid grid-cols-2 gap-x-4`}>
                {/* Col 1: Search input */}
                <div className="flex flex-col gap-0.5">
                  <Input
                    label={t("workspace.searchPlaceholder")}
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                    onClear={() => setSearchText("")}
                  />
                </div>
                {/* Col 2: Recommend toggle + ? + hint */}
                <div className={`flex flex-col gap-0.5 min-w-0 justify-end`}>
                  <div className="flex items-center gap-1">
                    <button
                      data-tour="recommend"
                      onClick={() => setRecommendEnabled(!recommendEnabled)}
                      className={`shrink-0 cursor-pointer rounded border px-3 py-1.5 text-xs font-medium leading-none transition-colors ${
                        recommendEnabled
                          ? isDark
                            ? "bg-blue-500/20 border-blue-500/30 text-blue-300"
                            : "bg-blue-500/10 border-blue-500/30 text-blue-600"
                          : isDark
                            ? "bg-white/5 border-white/10 text-white/50"
                            : "bg-gray-50 border-gray-200 text-gray-400"
                      }`}
                      title={locale === "zh" ? "智能推荐开关" : "Recommendation toggle"}
                    >
                      {locale === "zh" ? `推荐${recommendEnabled ? "ON" : "OFF"}` : `Rec.${recommendEnabled ? "ON" : "OFF"}`}
                    </button>
                    {/* Info tooltip — z-[9999] to float above everything */}
                    <div className="relative group shrink-0">
                      <span className={`inline-flex h-4 w-4 cursor-default items-center justify-center rounded-full text-[9px] font-bold leading-none ${
                        isDark ? "bg-white/10 text-white/50" : "bg-gray-200 text-gray-500"
                      }`}>?</span>
                      <div className={`absolute left-1/2 -translate-x-1/2 top-full z-[9999] mt-1 w-64 rounded-lg border px-3 py-2 text-[10px] leading-relaxed shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 ${
                        isDark ? "bg-[#2a2a3a] border-white/15 text-white/80" : "bg-white border-gray-200 text-gray-700"
                      }`}>
                        {locale === "zh"
                          ? "这是课程智能推荐算法开关。开关为ON状态时，系统将依据个人选课历史与当前选课状态，在列表内智能推送课程。开启筛选功能后，推荐功能自动停用；清空筛选条件即可恢复使用。点击开关即转为OFF状态，可停用该推荐服务。"
                          : "This is the smart recommendation toggle. When ON, the system intelligently sorts courses based on your selection history and current state. Filtering auto-disables recommendations; clearing filters restores them. Toggle OFF to disable."}
                      </div>
                    </div>
                  </div>
                  {/* Blue hint below the button */}
                  {recommendEnabled && !hasActiveFilters && stagingSemester && (() => {
                    const lines: string[] = [];
                    let idx = 0;

                    // ① Special course prompts
                    const peCourseIdsLocal = new Set(PE_BY_SEMESTER[stagingSemester] ?? []);
                    const isSummerLocal = stagingSemester.includes("开学前") || stagingSemester.includes("夏季");
                    if (!isSummerLocal && peCourseIdsLocal.size > 0 && ![...selectedCourses].some((id) => peCourseIdsLocal.has(id))) {
                      const peName = [...peCourseIdsLocal].map((id) => tName(id, courseMap.get(id)?.name ?? "")).join("/");
                      idx++;
                      lines.push(`${idx}.${t("workspace.blueNeed")}${peName}`);
                    }
                    const stagingCids = stagingSemester ? (semesterMap.get(stagingSemester) ?? []).map((c) => c.course_id) : [];
                    const shuyuanInStaging = stagingCids.filter((cid) => {
                      const infos = courseGroupInfo.get(cid) ?? [];
                      return infos.some((i) => i.groupCode === "SHUYUAN_GE");
                    });
                    if (shuyuanInStaging.length > 0 && !shuyuanInStaging.some((id) => selectedCourses.has(id))) {
                      const syName = shuyuanInStaging.map((id) => tName(id, courseMap.get(id)?.name ?? "")).join("/");
                      idx++;
                      lines.push(`${idx}.${t("workspace.blueNeed")}${syName}`);
                    }
                    const shijianInStaging = stagingCids.filter((cid) => {
                      const infos = courseGroupInfo.get(cid) ?? [];
                      return infos.some((i) => i.groupCode === "SHIJIAN");
                    });
                    if (shijianInStaging.length > 0 && !shijianInStaging.some((id) => selectedCourses.has(id))) {
                      const sjName = shijianInStaging.map((id) => tName(id, courseMap.get(id)?.name ?? "")).join("/");
                      idx++;
                      lines.push(`${idx}.${t("workspace.blueNeed")}${sjName}`);
                    }

                    // ② Foundation direction hints
                    const foundationLabels: Record<string, string> = {
                      COMP_BASIS: t("workspace.foundII"),
                      OR_STAT: t("workspace.foundIII"),
                      MECH_BASIS: t("workspace.foundI"),
                    };
                    const activeDirs = [...foundationActive.keys()].map((k) => foundationLabels[k] ?? k);
                    if (activeDirs.length > 0) {
                      idx++;
                      const dirStr = activeDirs.join(locale === "zh" ? "、" : ", ");
                      lines.push(`${idx}.${t("workspace.blueRec")}${dirStr}`);
                    }

                    // ③ Module score hints: top 2 (ties all shown)
                    const sortedMods = [...moduleScoreMap.entries()].sort((a, b) => b[1] - a[1]);
                    if (sortedMods.length > 0) {
                      const topScore = sortedMods[0][1];
                      const topTier = sortedMods.filter(([, s]) => s === topScore);
                      let shownMods = [...topTier];
                      if (shownMods.length < 2 && sortedMods.length > topTier.length) {
                        const secondScore = sortedMods[topTier.length][1];
                        const secondTier = sortedMods.filter(([, s]) => s === secondScore);
                        shownMods = [...shownMods, ...secondTier];
                      }
                      if (shownMods.length > 0) {
                        idx++;
                        const modStr = shownMods.map(([id]) => (locale === "zh" ? `模块${id}` : `Module ${id}`)).join(", ");
                        lines.push(`${idx}.${t("workspace.blueRec")}${modStr}`);
                      }
                    }

                    // ④ English course hint: 漏修的外语课进入 top-3 时提示
                    const top3Ids = [...stagingCids]
                      .sort((a, b) => (courseScores.get(b) ?? 0) - (courseScores.get(a) ?? 0))
                      .slice(0, 3);
                    const eng1InTop3 = top3Ids.includes("14201002") && termIdx(stagingSemester) > termIdx("大一·秋季");
                    const eng2InTop3 = top3Ids.includes("14201012") && termIdx(stagingSemester) > termIdx("大一·春季");
                    const eng3InTop3 = top3Ids.includes("14201022") && !hasSecondForeign;
                    const eng4InTop3 = top3Ids.includes("14201032") && !hasSecondForeign;
                    if (eng1InTop3 || eng2InTop3 || eng3InTop3 || eng4InTop3) {
                      const engParts: string[] = [];
                      if (eng1InTop3) engParts.push(tName("14201002", locale === "zh" ? "英语(1)" : "English(1)"));
                      if (eng2InTop3) engParts.push(tName("14201012", locale === "zh" ? "英语(2)" : "English(2)"));
                      if (eng3InTop3) engParts.push(tName("14201022", locale === "zh" ? "英语(3)" : "English(3)"));
                      if (eng4InTop3) engParts.push(tName("14201032", locale === "zh" ? "英语(4)" : "English(4)"));
                      idx++;
                      lines.push(`${idx}.${t("workspace.blueRecEng")}${engParts.join(locale === "zh" ? "、" : ", ")}`);
                    }

                    const hint = lines.join(" ");
                    if (!hint) return null;
                    return (
                      <div className={`mt-0.5 text-[9px] leading-tight ${isDark ? "text-blue-300" : "text-blue-500"}`}>
                        {hint}
                      </div>
                    );
                  })()}
                </div>
              </div>)}

              {/* PC 端：搜索与筛选始终内联显示；移动端已走左侧抽屉，避免与抽屉同时渲染 */}
              {!mobile && (
                <>
                  <div className={`px-3 pt-1 pb-1 text-xs font-medium ${textMuted}`}>
                    {t("workspace.filterHeader")}
                  </div>

                  {/* Filter dropdowns: PC 两列 */}
                  <div className="px-3 pb-1 grid grid-cols-2 gap-x-4">
                    {/* Col 1, Row 1: 按课程组 */}
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-xs ${textBody}`}>{t("workspace.filterGroup")}</span>
                      <Select
                        data={groupOptions}
                        selected={groupOptions.find((o) => o.key === filters.group) ?? groupOptions[0]}
                        onSelect={(opt) => opt && setFilters((f) => ({...f, group: opt.key as string}))}
                        label=""
                        filter
                      />
                    </div>
                    {/* Col 2, Row 1: 按推荐学期 */}
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-xs ${textBody}`}>{t("workspace.filterSemester")}</span>
                      <Select
                        data={semesterOptions}
                        selected={semesterOptions.find((o) => o.key === filters.semester) ?? semesterOptions[0]}
                        onSelect={(opt) => opt && setFilters((f) => ({...f, semester: opt.key as string}))}
                        label=""
                        filter
                      />
                    </div>
                    {/* Col 1, Row 2: 按模块 */}
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-xs ${textBody}`}>{t("workspace.filterModule")}</span>
                      <Select
                        data={moduleOptions}
                        selected={moduleOptions.find((o) => o.key === filters.module) ?? moduleOptions[0]}
                        onSelect={(opt) => opt && setFilters((f) => ({...f, module: opt.key as string, abGroup: "all"}))}
                        label=""
                        filter
                      />
                    </div>
                    {/* Col 2, Row 2: 课组 — always visible, disabled unless module selected */}
                    <div className="flex flex-col gap-0.5">
                      <span className={`text-xs ${textBody}`}>{t("workspace.filterABGroup")}</span>
                      <Select
                        data={abOptions}
                        selected={abOptions.find((o) => o.key === filters.abGroup) ?? abOptions[0]}
                        onSelect={(opt) => opt && moduleEnabled && setFilters((f) => ({...f, abGroup: opt.key as string}))}
                        label=""
                        disabled={!moduleEnabled}
                      />
                    </div>
                  </div>

                  {hasActiveFilters && (
                    <div className="px-3 pb-2 pt-1">
                      <Button onClick={clearFilters}>{t("workspace.filterClear")}</Button>
                    </div>
                  )}
                </>
              )}
            </Content>

            {/* ===== Course list ===== */}
            <div className="flex flex-col flex-1 min-h-0">
              {mobile ? (
                <>
                  {/* 移动端：简洁统计头 + 打开抽屉按钮 + 活跃筛选提示 */}
                  <div
                    className={`flex items-center justify-between px-3 py-2 text-xs font-medium border-b shrink-0 ${bgHeader} ${borderCls} ${textMuted}`}
                  >
                    <button
                      onClick={() => setFiltersCollapsed(false)}
                      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${isDark ? "border-blue-500/40 bg-blue-500/15 text-blue-300 hover:bg-blue-500/25" : "border-blue-500/40 bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      {t("workspace.expandSearchFilter")}
                    </button>
                    <span className="flex items-center gap-2">
                      {activeFilterCount > 0 && (
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${isDark ? "bg-blue-500/20 text-blue-300" : "bg-blue-500/10 text-blue-600"}`}>
                          {activeFilterCount} {locale === "zh" ? "个筛选生效中" : "filters active"}
                        </span>
                      )}
                      {filteredCourses.length} {locale === "zh" ? "门" : "courses"}
                    </span>
                  </div>

                  {/* 移动端：卡片式课程列表 */}
                  <div className="flex-1 overflow-auto">
                    {filteredCourses.map((c) => {
                      const categories = getCourseCategories(c.course_id);
                      const sems = courseSemesterMap.get(c.course_id) ?? [];
                      const semDisplay =
                        sems.length > 0
                          ? sems.map((s) => (locale === "zh" ? abbreviateSemester(s) : tSemester(s))).join(", ")
                          : "—";
                      const isSelected = selectedCourses.has(c.course_id);
                      const isInHistory = Object.values(savedHistory).some((ids) => ids.includes(c.course_id));
                      const inEditSem = isEditingSemesterCourse(c.course_id);
                      const boostLabel = targetedBoostLabel(c.course_id);

                      return (
                        <div
                          key={c.course_id}
                          className={`flex items-start gap-3 px-3 py-2.5 border-b ${borderLight} ${hoverBg} ${textBody}`}
                        >
                          {isInHistory && !inEditSem ? (
                            <button
                              onClick={() => {
                                let foundSem = "";
                                for (const [sem, ids] of Object.entries(savedHistory)) {
                                  if (ids.includes(c.course_id)) { foundSem = sem; break; }
                                }
                                const semLabel = foundSem ? (locale === "zh" ? abbreviateSemester(foundSem) : tSemester(foundSem)) : "";
                                setChoiceConflict({
                                  courseId: c.course_id,
                                  courseName: tName(c.course_id, c.name),
                                  setName: "历史已选课程", // 固定哨兵值（自冲突场景不对外显示；勿按语言改动，冲突弹窗靠它判断）
                                  conflictId: c.course_id,
                                  conflictName: locale === "zh"
                                    ? `该课程已在${semLabel}的历史记录中。如需特殊原因重复选择，请点击"仍然选课"`
                                    : `This course is already in ${semLabel} history. Click "Select Anyway" to proceed.`,
                                });
                              }}
                              className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-none text-sm font-bold transition-colors ${
                                isDark
                                  ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                                  : "bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/25"
                              }`}
                              title={locale === "zh" ? "已在历史记录中，点击重新选课" : "Already in history, click to re-select"}
                            >✓</button>
                          ) : (
                            <button
                              onClick={() => toggleSelected(c.course_id)}
                              className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-none text-sm font-bold transition-colors ${
                                isSelected
                                  ? isDark
                                    ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                    : "bg-green-500/15 text-green-600 hover:bg-green-500/25"
                                  : isDark
                                    ? "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/85"
                                    : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                              }`}
                              title={isSelected ? (locale === "zh" ? "从预选移除" : "Remove") : (locale === "zh" ? "添加到预选" : "Add")}
                            >
                              {isSelected ? "✓" : "+"}
                            </button>
                          )}
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm font-medium truncate cursor-pointer"
                              title={tName(c.course_id, c.name)}
                              onClick={() => setDetailCourse(c)}
                            >
                              {tName(c.course_id, c.name)}
                            </div>
                            <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] ${textMuted}`}>
                              <span className="font-mono">
                                {c.course_id.startsWith("NEW") ? (locale === "zh" ? "新开课" : "New") : c.course_id}
                              </span>
                              <span>{c.credits} {locale === "zh" ? "学分" : "cr"}</span>
                              <span>{semDisplay}</span>
                              {boostLabel && (
                                <span
                                  className={`w-full font-medium ${isDark ? "text-blue-300" : "text-blue-600"}`}
                                  title={boostLabel}
                                >
                                  ⓘ {boostLabel}
                                </span>
                              )}
                              {(() => {
                                const key = c.course_attr ?? "";
                                if (!key) return null;
                                const label = locale === "zh" ? (ATTR_LABELS[key] ?? key) : (ATTR_LABELS_EN[key] ?? key);
                                const cls =
                                  key === "required"
                                    ? isDark ? "bg-sky-500/20 text-sky-300" : "bg-sky-100 text-sky-700"
                                    : key === "prof_required"
                                      ? isDark ? "bg-violet-500/20 text-violet-300" : "bg-violet-100 text-violet-700"
                                      : isDark ? "bg-white/10 text-white/50" : "bg-gray-100 text-gray-500";
                                return (
                                  <span
                                    className={`rounded px-1 font-medium ${cls}`}
                                    title={key === "prof_required" ? c.prof_note ?? label : label}
                                  >
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                            {categories.length > 0 && (
                              <div className="mt-1 text-[11px] leading-tight break-words" style={{wordBreak: "break-word"}}>
                                {categories.join(", ")}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {filteredCourses.length === 0 && (
                      <div className={`p-6 text-center text-sm ${textMuted}`}>{t("workspace.noMatch")}</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* PC 端：冻结表头表格 */}
                  <div
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium border-b shrink-0 ${bgHeader} ${borderCls} ${textMuted}`}
                  >
                    <span className="w-7 shrink-0" />
                    <span className="w-20 shrink-0 truncate">{t("workspace.colCode")}</span>
                    <span className="flex-1 min-w-0 truncate">{t("workspace.colName")}</span>
                    <span className="w-10 shrink-0 text-right">{t("workspace.colCredits")}</span>
                    <span className="w-36 shrink-0 text-right">{t("workspace.colCategory")}</span>
                    <span className="w-16 shrink-0 text-right">{t("workspace.colSemester")}</span>
                  </div>

                  <div className="flex-1 overflow-auto">
                    {filteredCourses.map((c) => {
                      const categories = getCourseCategories(c.course_id);
                      const sems = courseSemesterMap.get(c.course_id) ?? [];
                      const semDisplay =
                        sems.length > 0
                          ? sems.map((s) => (locale === "zh" ? abbreviateSemester(s) : tSemester(s))).join(", ")
                          : "—";
                      const isSelected = selectedCourses.has(c.course_id);
                      const isInHistory = Object.values(savedHistory).some((ids) => ids.includes(c.course_id));
                      const inEditSem = isEditingSemesterCourse(c.course_id);
                      const boostLabel = targetedBoostLabel(c.course_id);

                      return (
                        <div
                          key={c.course_id}
                          className={`flex items-start gap-2 px-3 py-1.5 text-xs border-b ${borderLight} ${hoverBg} ${textBody}`}
                        >
                          {isInHistory && !inEditSem ? (
                            <button
                              onClick={() => {
                                let foundSem = "";
                                for (const [sem, ids] of Object.entries(savedHistory)) {
                                  if (ids.includes(c.course_id)) { foundSem = sem; break; }
                                }
                                const semLabel = foundSem ? (locale === "zh" ? abbreviateSemester(foundSem) : tSemester(foundSem)) : "";
                                setChoiceConflict({
                                  courseId: c.course_id,
                                  courseName: tName(c.course_id, c.name),
                                  setName: "历史已选课程", // 固定哨兵值（自冲突场景不对外显示；勿按语言改动，冲突弹窗靠它判断）
                                  conflictId: c.course_id,
                                  conflictName: locale === "zh"
                                    ? `该课程已在${semLabel}的历史记录中。如需特殊原因重复选择，请点击"仍然选课"`
                                    : `This course is already in ${semLabel} history. Click "Select Anyway" to proceed.`,
                                });
                              }}
                              className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-none text-sm font-bold transition-colors ${
                                isDark
                                  ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
                                  : "bg-yellow-500/15 text-yellow-600 hover:bg-yellow-500/25"
                              }`}
                              title={locale === "zh" ? "已在历史记录中，点击重新选课" : "Already in history, click to re-select"}
                            >✓</button>
                          ) : (
                            <button
                              onClick={() => toggleSelected(c.course_id)}
                              className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-none text-sm font-bold transition-colors ${
                                isSelected
                                  ? isDark
                                    ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                                    : "bg-green-500/15 text-green-600 hover:bg-green-500/25"
                                  : isDark
                                    ? "bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/85"
                                    : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                              }`}
                              title={isSelected ? (locale === "zh" ? "从预选移除" : "Remove") : (locale === "zh" ? "添加到预选" : "Add")}
                            >
                              {isSelected ? "✓" : "+"}
                            </button>
                          )}
                          <span className={`w-20 shrink-0 truncate font-mono pt-0.5 ${textMuted}`} title={c.course_id}>
                            {c.course_id.startsWith("NEW") ? (locale === "zh" ? "新开课" : "New") : c.course_id}
                          </span>
                          <span
                            className="flex-1 min-w-0 truncate whitespace-nowrap pt-0.5 cursor-pointer"
                            title={tName(c.course_id, c.name)}
                            onClick={() => setDetailCourse(c)}
                          >
                            {tName(c.course_id, c.name)}
                          </span>
                          {boostLabel && (
                            <span
                              className={`shrink-0 pt-0.5 text-[10px] font-bold ${isDark ? "text-blue-300" : "text-blue-600"}`}
                              title={boostLabel}
                            >
                              ⓘ
                            </span>
                          )}
                          <span className={`w-10 shrink-0 text-right pt-0.5 ${textMuted}`}>{c.credits}</span>
                          <span className="w-36 shrink-0 text-right pt-0.5 break-words leading-tight" style={{wordBreak: "break-word"}}>
                            {categories.length > 0 ? categories.join(", ") : "—"}
                          </span>
                          <span className="w-16 shrink-0 text-right pt-0.5 leading-tight" style={{wordBreak: "keep-all"}}>
                            {semDisplay}
                          </span>
                        </div>
                      );
                    })}

                    {filteredCourses.length === 0 && (
                      <div className={`p-6 text-center text-sm ${textMuted}`}>{t("workspace.noMatch")}</div>
                    )}
                  </div>
                </>
              )}

              {/* ===== Result count bar ===== */}
              <div className={`flex items-center gap-2 px-3 py-1.5 text-xs border-t shrink-0 ${bgHeader} ${borderCls} ${textMuted}`}>
                {locale === "zh"
                  ? `共 ${filteredCourses.length} 门课程`
                  : `${filteredCourses.length} courses total`}
                {selectedCourses.size > 0 && (
                  <span className="ml-auto">
                    {locale === "zh"
                      ? `已选 ${selectedCourses.size} 门`
                      : `${selectedCourses.size} selected`}
                  </span>
                )}
              </div>
            </div>

              {/* ===== Detail Popup ===== */}
              {detailCourse && (() => {
                const dc = detailCourse;
                const prereqIds = prereqMap.get(dc.course_id) ?? [];
                const prereqNames = prereqIds.map((pid) => {
                  const c = courseMap.get(pid);
                  return c ? tName(pid, c.name) : pid;
                });
                const enName = enNameMap.get(dc.course_id);
                return (
                  <div
                    className="fixed inset-0 z-50 flex items-start justify-center pt-16"
                    style={{background: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.15)"}}
                    onClick={() => setDetailCourse(null)}
                  >
                    <div
                      className={`w-80 rounded-xl shadow-2xl border overflow-hidden ${isDark ? "bg-[#1e1e2a]" : "bg-white"} ${borderCls}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={`flex items-center justify-between px-4 py-3 border-b ${borderCls}`}>
                        <span className={`text-sm font-semibold ${textDark}`}>{tName(dc.course_id, dc.name)}</span>
                        <button
                          onClick={() => setDetailCourse(null)}
                          className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none text-sm transition-colors ${
                            isDark ? "hover:bg-white/10 text-white/60" : "hover:bg-gray-100 text-gray-400"
                          }`}
                        >✕</button>
                      </div>
                      <div className="flex flex-col gap-2 px-4 py-3 text-xs">
                        <div className="flex justify-between">
                          <span className={`font-mono ${textMuted}`}>{dc.course_id.startsWith("NEW") ? (locale === "zh" ? "新开课" : "New") : dc.course_id}</span>
                        </div>
                        {locale === "zh" && enName && (
                          <div className="flex justify-between">
                            <span className={textBody}>{enName}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className={textMuted}>{t("workspace.colCredits")}</span>
                          <span className={textDark}>{dc.credits}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={textMuted}>{t("workspace.colCategory")}</span>
                          <span className={`text-right ${textDark}`} style={{maxWidth: "70%"}}>
                            {(getCourseCategories(dc.course_id).length > 0
                              ? getCourseCategories(dc.course_id).join(", ")
                              : "—")}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className={textMuted}>{locale === "zh" ? "修读属性" : "Attribute"}</span>
                          <span className={`text-right ${textDark}`} style={{maxWidth: "70%"}}>
                            {(() => {
                              const key = dc.course_attr ?? "";
                              if (!key) return "—";
                              const label = locale === "zh" ? (ATTR_LABELS[key] ?? key) : (ATTR_LABELS_EN[key] ?? key);
                              if (key === "prof_required") return locale === "zh" ? `${label}（${dc.prof_note ?? ""}）` : `${label} (${dc.prof_note ?? ""})`;
                              return label;
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className={textMuted}>{t("workspace.filterSemester")}</span>
                          <span className={`text-right ${textDark}`}>
                            {(courseSemesterMap.get(dc.course_id) ?? []).length > 0
                              ? (courseSemesterMap.get(dc.course_id) ?? []).map((s) => locale === "zh" ? abbreviateSemester(s) : tSemester(s)).join(", ")
                              : "—"}
                          </span>
                        </div>
                        {/* Multi-select relationship */}
                        {(courseChoiceSets.get(dc.course_id) ?? []).length > 0 && (
                          <div className="flex flex-col gap-0.5">
                            <span className={textMuted}>
                              {locale === "zh" ? "多选一关系" : "Mutual Exclusion"}
                            </span>
                            {(courseChoiceSets.get(dc.course_id) ?? []).map((cs) => (
                              <div key={cs.setId} className={`text-xs pl-2 ${isDark ? "text-yellow-300" : "text-yellow-700"}`}>
                                <span className="font-medium">{cs.setName}（{cs.maxSelect}选1）：</span>
                                <span>{cs.siblings.map((s) => tName(s.courseId, s.name)).join("、")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className={textMuted}>
                            {locale === "zh" ? "先修课程" : "Prerequisites"}
                          </span>
                          <span className={`text-right ${textDark}`} style={{maxWidth: "70%"}}>
                            {prereqNames.length > 0 ? prereqNames.join("; ") : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
          </Island>
        </section>
      </main>

      {/* 移动端：底部两段 Tab + 预选抽屉按钮 */}
      {mobile && (
        <>
          {!drawerOpen && (
            <button
              onClick={() => {
                if (stagingBtnDragRef.current?.dragging) {
                  stagingBtnDragRef.current = null;
                  return;
                }
                setDrawerOpen(true);
              }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                stagingBtnDragRef.current = {startY: t.clientY, startBottom: stagingBtnBottom, dragging: false};
              }}
              onTouchMove={(e) => {
                const d = stagingBtnDragRef.current;
                if (!d) return;
                const dy = e.touches[0].clientY - d.startY;
                if (Math.abs(dy) > 4) d.dragging = true;
                if (!d.dragging) return;
                const next = Math.max(56, Math.min(240, d.startBottom - dy));
                setStagingBtnBottom(next);
                try { window.localStorage.setItem("ofcourses-staging-btn-bottom", String(next)); } catch {}
              }}
              onTouchEnd={(e) => {
                const d = stagingBtnDragRef.current;
                if (!d) return;
                if (d.dragging) {
                  e.preventDefault();
                  try { window.localStorage.setItem("ofcourses-staging-btn-bottom", String(stagingBtnBottom)); } catch {}
                }
                stagingBtnDragRef.current = null;
              }}
              className={`fixed right-4 z-40 flex items-center gap-1 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg ${shakeBtn ? "oc-shake" : ""} after:content-[''] after:pointer-events-none after:absolute after:-bottom-1 after:left-1/2 after:h-1 after:w-5 after:-translate-x-1/2 after:rounded-full after:bg-white/40`}
              style={{bottom: `calc(env(safe-area-inset-bottom, 0px) + ${stagingBtnBottom}px)`}}
            >
              {locale === "zh" ? "预选" : "Selected"}
              {selectedCourses.size > 0 && (
                <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">{selectedCourses.size}</span>
              )}
            </button>
          )}
          <nav className={`shrink-0 flex border-t ${isDark ? "border-white/10 bg-[#16161f]" : "border-gray-200 bg-white"}`}>
            <button
              onClick={() => setMobileTab("catalog")}
              className={`flex-1 py-3 text-sm font-medium ${mobileTab === "catalog" ? (isDark ? "text-blue-300" : "text-blue-600") : (isDark ? "text-white/50" : "text-gray-500")}`}
            >
              {t("workspace.select")}
            </button>
            <button
              onClick={() => setMobileTab("history")}
              className={`flex-1 py-3 text-sm font-medium ${mobileTab === "history" ? (isDark ? "text-blue-300" : "text-blue-600") : (isDark ? "text-white/50" : "text-gray-500")}`}
            >
              {locale === "zh" ? "历史" : "History"}
            </button>
          </nav>
        </>
      )}
    </div>
  );
};