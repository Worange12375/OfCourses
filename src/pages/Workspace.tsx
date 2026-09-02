import {useState, useMemo, useRef, useEffect} from "react";
import Button from "@jetbrains/ring-ui-built/components/button/button";
import Input from "@jetbrains/ring-ui-built/components/input/input";
import Island, {Content, Header} from "@jetbrains/ring-ui-built/components/island/island";
import Select, {type SelectItem} from "@jetbrains/ring-ui-built/components/select/select";
import {Navbar, type NavPage} from "../components/Navbar";
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
import structuredData from "@/data/structured_data.json";
import enData from "@/data/courses_en.json";
import type { Database } from "@/database.types";
type Course = Database["public"]["Tables"]["courses"]["Row"];

interface WorkspaceProps {
  onNavigate?: (page: NavPage) => void;
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

/** Module ID → 类 label */
const moduleTypeLabel = (modId: number): string =>
  modId <= 3 ? "I" : modId <= 8 ? "II" : "III";

/** Format module option display */
const formatModuleOption = (modId: number, name: string, locale: string): string =>
  locale === "zh" ? `模块${modId}：${name}` : `Module ${modId}: ${name}`;

export const Workspace = ({onNavigate}: WorkspaceProps) => {
  const {t, locale} = useLocale();
  const {theme} = useAppTheme();
  const isDark = theme === "dark";
  const {semester: currentSemester} = useSemester();
  const {tName, tModule, tSemester, tGroup} = useTName();

  const [leftExpanded, setLeftExpanded] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    group: "all", semester: "all", module: "all", abGroup: "all",
  });
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [detailCourse, setDetailCourse] = useState<Course | null>(null);
  const [savedHistory, setSavedHistory] = useState<Record<string, string[]>>(() => {
    try { return JSON.parse(localStorage.getItem("oc_history") ?? "{}"); }
    catch { return {}; }
  });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
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
  const customStatsRef = useRef<Record<string, number>>({ "通识-艺术": 0, "通识-社科": 0, "通识-人文": 0, "通识-科学": 0, "SRT": 0 });
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [forceSaveData, setForceSaveData] = useState<string[] | null>(null);
  const [diagExpanded, setDiagExpanded] = useState(false);
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
  const editingSemesters = useMemo(() => {
    if (stagingSemester && savedHistory[stagingSemester] && !availableStagingSemesters.includes(stagingSemester)) {
      return [stagingSemester];
    }
    return [];
  }, [stagingSemester, savedHistory, availableStagingSemesters]);

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
    // 去重检查
    const allCustomNames = new Set();
    for (const list of Object.values(customCourses)) {
      list.forEach((cc) => allCustomNames.add(cc.name));
    }
    if (allCustomNames.has(customName.trim())) {
      setCustomDuplicateMsg("同名课程已存在：" + customName.trim());
      return;
    }
    setCustomDuplicateMsg(null);
    const creds = parseFloat(customCredits) || 0;
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
  }, []);

  // --- Choice set lookup (set_id → course_ids[]) ---
  const choiceSetCourseMap = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const sc of structuredData.choice_set_courses) {
      const prev = map.get(sc.set_id) ?? [];
      prev.push(sc.course_id);
      map.set(sc.set_id, prev);
    }
    return map;
  }, []);

  const choiceSetMap = useMemo(() => {
    const map = new Map<number, typeof structuredData.choice_sets[0]>();
    for (const cs of structuredData.choice_sets) {
      map.set(cs.set_id, cs);
    }
    return map;
  }, []);

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

  const getSemesterChecks = (sem: string, selected: string[]): Array<{type: "error" | "warning"; msg: string}> => {
    const checks: Array<{type: "error" | "warning"; msg: string}> = [];
    const total = calcSemesterCredits(sem, selected);
    const limit = getCreditLimit(sem);
    if (!limit) return checks;

    if (total > limit.max) {
      checks.push({
        type: "warning",
        msg: locale === "zh" ? `学分 ${total} > 上限 ${limit.max}` : `${total} credits > max ${limit.max}`,
      });
    }

    if (limit.min > 0 && total > 0 && total < limit.min) {
      checks.push({
        type: "error",
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
          msg: locale === "zh" ? `「${cs.name}」可只选 ${cs.max_select} 门` : `"${cs.name}" max ${cs.max_select}`,
        });
      } else if (selectedInSet.length > (cs.max_select ?? 1)) {
        checks.push({
          type: "warning",
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
          msg: t("workspace.peRequired"),
        });
      }
    }

    return checks;
  };

  // Build diagnostic data for all semesters + current staging
  const diagData = useMemo(() => {
    const entries: Array<{sem: string; checks: Array<{type: "error" | "warning"; msg: string}>}> = [];
    const choiceConflictEntries: Array<{type: "error" | "warning"; msg: string}> = [];
    const allSems = [...historySemesters, ...availableStagingSemesters];
    const seen = new Set<string>();
    for (const sem of allSems) {
      if (seen.has(sem)) continue;
      seen.add(sem);
      const saved = savedHistory[sem] ?? [];
      const checks = getSemesterChecks(sem, saved);
      // Separate choice set conflicts from other checks
      const conflicts = checks.filter((c) => c.msg.includes("最多选") || c.msg.includes("max"));
      const others = checks.filter((c) => !(c.msg.includes("最多选") || c.msg.includes("max")));
      if (others.length > 0) entries.push({sem, checks: others});
      // Deduplicate choice conflicts by message
      for (const conflict of conflicts) {
        if (!choiceConflictEntries.some((existing) => existing.msg === conflict.msg)) {
          choiceConflictEntries.push(conflict);
        }
      }
    }
    // Also include current staging selection (if different from saved)
    if (stagingSemester && selectedCourses.size > 0 && !seen.has(stagingSemester)) {
      const checks = getSemesterChecks(stagingSemester, [...selectedCourses]);
      const conflicts = checks.filter((c) => c.msg.includes("最多选") || c.msg.includes("max"));
      const others = checks.filter((c) => !(c.msg.includes("最多选") || c.msg.includes("max")));
      if (others.length > 0) entries.push({sem: stagingSemester, checks: others});
      choiceConflictEntries.push(...conflicts);
    }
    return {entries, choiceConflicts: choiceConflictEntries};
  }, [historySemesters, availableStagingSemesters, savedHistory, customCourses, stagingSemester, selectedCourses]);

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

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (!data.version || !data.history) {
          alert(t("workspace.importError"));
          return;
        }
        setImportPreview(JSON.stringify(data.history, null, 2).slice(0, 500) + "...");
        // Apply import
        const nextHistory = data.history as Record<string, string[]>;
        const nextCustom = (data.customCourses as typeof customCourses) ?? {};
        persistHistory(nextHistory);
        persistCustom(nextCustom);
        setShowImportModal(false);
        setImportPreview(null);
      } catch {
        alert(t("workspace.importError"));
      }
    };
    reader.readAsText(file);
  };

  const toggleSelected = (courseId: string) => {
    // Build full set of all taken courses across all history + current selection
    const allTaken = new Set(selectedCourses);
    for (const [, ids] of Object.entries(savedHistory)) {
      ids.forEach((id) => allTaken.add(id));
    }

    const isAlreadySelected = selectedCourses.has(courseId);
    if (!isAlreadySelected) {
      // Preventative: if course is already in history, block adding
      let foundInHistory = false;
      for (const [, ids] of Object.entries(savedHistory)) {
        if (ids.includes(courseId)) { foundInHistory = true; break; }
      }
      if (foundInHistory) {
        // Show alert that this course is already taken
        setChoiceConflict({
          courseId,
          courseName: courseMap.get(courseId)?.name ?? courseId,
          setName: locale === "zh" ? "历史已选课程" : "Already Taken",
          conflictId: courseId,
          conflictName: locale === "zh" ? "该课程已在历史记录中，无法重复添加" : "This course is already in your history",
        });
        return;
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
  }, [groupMap]);

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
  }, [FOUNDATION_GROUP_IDS]);

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
  }, [groupMap]);

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

  /** Course IDs for 大二·春季 special +62 */
  const DAER_CHUN_SPECIAL_62 = new Set(["10680022","10680142","14201032"]);

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

  const COURSE_BONUS: Record<string, Array<{semesterMatch: string; bonus: number}>> = {
    "10691342": [{semesterMatch: "大一·秋季", bonus: 62}],
    "30160023": [{semesterMatch: "大一·春季", bonus: 62}],
    "24100023": [{semesterMatch: "大一·秋季", bonus: 61}],
    "14920032": [{semesterMatch: "大一·春季", bonus: 61}],
    "10421403": [{semesterMatch: "大一·春季", bonus: 61}],
    "44100203": [{semesterMatch: "大二·秋季", bonus: 11}],
  };

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

      // English3 bonus: weight * 101 if not in history
      if (c.course_id === "14201022" && !historyCourseIds.has("14201022") && stagingSemester) {
        const w = ENGLISH3_WEIGHT[stagingSemester];
        if (w !== undefined && w > 0) score += w * 101;
      }
      // English4 bonus: weight * 101 if not in history
      if (c.course_id === "14201032" && !historyCourseIds.has("14201032") && stagingSemester) {
        const w = ENGLISH4_WEIGHT[stagingSemester];
        if (w !== undefined && w > 0) score += w * 101;
      }

      // History deduction: courses already recorded in history get -400
      if (historyCourseIds.has(c.course_id)) {
        score -= 400;
      }

      scores.set(c.course_id, score);
    }

    return scores;
  }, [courses, stagingCourseInfo, courseModuleMap, foundationActive, moduleScoreMap, courseGroupInfo, moduleScoringConfig, savedHistory, stagingSemester]);

  const hasActiveFilters =
    filters.group !== "all" ||
    filters.semester !== "all" ||
    filters.module !== "all" ||
    searchText.trim().length > 0;

  // --- Filtered Courses ---
  const filteredCourses = useMemo(() => {
    let result = courses;

    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      const isNewQuery = q === "新开课" || q === "新开" || q === "new course";
      result = result.filter((c) => {
        // "新开课"/"新开"/"new course" → show all NEW-id courses
        if (isNewQuery && c.course_id.startsWith("NEW")) return true;

        // Pure numeric query should NOT match NEW-id (e.g. "007" should not match "NEW007")
        if (c.course_id.startsWith("NEW") && /^\d+$/.test(q)) return false;

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
    }

    return result;
  }, [courses, filters, courseGroupInfo, semesterMap, searchText, tName, recommendEnabled, courseScores, hasActiveFilters]);

  // --- Scroll history to rightmost ---
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

  const inputTheme = isDark ? "dark" : "light";
  const moduleEnabled = filters.module !== "all" && filters.module !== "none";

  return (
    <div className={`flex h-full flex-col ${isDark ? "bg-[#0e0e14]" : "bg-gray-50"}`}>
      <Navbar currentPage="workspace" onNavigate={onNavigate ?? (() => {})} />
      <main className="flex flex-1 gap-3 p-3 overflow-hidden">
        {/* ========== LEFT: History ========== */}
        <section
          className="h-full flex flex-col overflow-hidden transition-all duration-300"
          style={{flex: leftExpanded ? "5" : "3"}}
        >
          <Island className={`flex h-full flex-col ${bgCard}`}>
            <Header border>
              <div className="flex w-full flex-col">
                <div className="flex w-full items-center gap-4">
                  <span className={`text-sm font-semibold text-nowrap ${textDark}`}>{t("workspace.history")}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <Button onClick={handleExport}>{t("workspace.exportBtn")}</Button>
                    <Button onClick={() => setShowImportModal(true)}>{t("workspace.importBtn")}</Button>
                    <Button onClick={() => setClearConfirm(true)}>{locale === "zh" ? "清除" : "Clear"}</Button>
                    <Button onClick={() => setLeftExpanded(!leftExpanded)}>
                      {leftExpanded ? t("workspace.fold") : t("workspace.unfold")}
                    </Button>
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
                    // Default courses from semesterMap (for showing default data)
                    const defaultCourses = semesterMap.get(sem) ?? [];
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
                                  setStagingSemester(sem);
                                  setSelectedCourses(new Set(savedIds));
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
            {diagData.entries.length > 0 || diagData.choiceConflicts.length > 0 ? (
              <div className={`border-t shrink-0 flex flex-col ${borderCls}`} style={{flex: diagExpanded ? "0.33" : "0 0 auto", minHeight: 0}}>
                <div className={`flex items-center gap-2 px-3 py-1.5 text-xs ${bgHeader}`}>
                  <span className={`font-semibold ${textDark}`}>
                    {locale === "zh" ? "诊断" : "Diagnostics"}
                  </span>
                  {(() => {
                    const totalErrors = diagData.entries.reduce((s, e) => s + e.checks.filter((c) => c.type === "error" && !dismissedDiag.has(`${e.sem}_${e.checks.indexOf(c)}`)).length, 0);
                    const totalWarnings = diagData.entries.reduce((s, e) => s + e.checks.filter((c) => c.type === "warning" && !dismissedDiag.has(`${e.sem}_${e.checks.indexOf(c)}`)).length, 0);
                    const totalChoiceWarnings = diagData.choiceConflicts.filter((_, i) => !dismissedDiag.has(`choice_${i}`)).length;
                    return (
                      <span className={`text-[10px] ${textMuted}`}>
                        {totalErrors > 0 && <span className="text-red-400">❌({totalErrors})</span>}
                        {(totalWarnings + totalChoiceWarnings) > 0 && <span className="text-yellow-400 ml-1">⚠({totalWarnings + totalChoiceWarnings})</span>}
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
                    {diagExpanded && diagData.entries.map((entry) => {
                      const hasError = entry.checks.some((c) => c.type === "error");
                      const remaining = entry.checks.filter((c) => !dismissedDiag.has(`${entry.sem}_${entry.checks.indexOf(c)}`));
                      if (remaining.length === 0) return null;
                      return (
                        <div key={entry.sem} className={`rounded px-2 py-1.5 text-xs ${
                          hasError
                            ? isDark ? "bg-red-500/10" : "bg-red-50"
                            : isDark ? "bg-yellow-500/10" : "bg-yellow-50"
                        } ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                          <div className={`flex items-center gap-1 font-medium ${
                            hasError ? (isDark ? "text-red-300" : "text-red-600") : (isDark ? "text-yellow-300" : "text-yellow-700")
                          }`}>
                            {hasError ? "✕" : "⚠"} {locale === "zh" ? abbreviateSemester(entry.sem) : tSemester(entry.sem)}
                          </div>
                          {remaining.map((c, i) => {
                            const diagKey = `${entry.sem}_${entry.checks.indexOf(c)}`;
                            return (
                              <div key={i} className={`ml-3 flex items-start justify-between gap-1 ${
                                c.type === "error"
                                  ? isDark ? "text-red-200" : "text-red-500"
                                  : isDark ? "text-yellow-200" : "text-yellow-600"
                              }`}>
                                <span>• {c.msg}</span>
                                <button
                                  onClick={() => {
                                    const next = new Set(dismissedDiag);
                                    next.add(diagKey);
                                    setDismissedDiag(next);
                                    localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                                  }}
                                  className={`shrink-0 cursor-pointer border-none text-[9px] ${
                                    isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
                                  }`}
                                >✕</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                    {/* Choice conflict box — separate from semester entries */}
                    {diagExpanded && diagData.choiceConflicts.length > 0 && (
                      <div className={`rounded px-2 py-1.5 text-xs ${isDark ? "bg-orange-500/10" : "bg-orange-50"} ${diagExpanded ? "w-48 shrink-0" : ""}`}>
                        <div className={`flex items-center gap-1 font-medium ${isDark ? "text-orange-300" : "text-orange-700"}`}>
                          ⚠ {locale === "zh" ? "多选一冲突" : "Mutual Exclusion"}
                        </div>
                        {diagData.choiceConflicts.map((c, i) => {
                          const diagKey = `choice_${i}`;
                          return (
                            <div key={i} className={`ml-3 flex items-start justify-between gap-1 ${isDark ? "text-yellow-200" : "text-yellow-600"}`}>
                              <span>• {c.msg}</span>
                              <button
                                onClick={() => {
                                  const next = new Set(dismissedDiag);
                                  next.add(diagKey);
                                  setDismissedDiag(next);
                                  localStorage.setItem("oc_diag_dismiss", JSON.stringify([...next]));
                                }}
                                className={`shrink-0 cursor-pointer border-none text-[9px] ${
                                  isDark ? "text-white/30 hover:text-white/60" : "text-gray-400 hover:text-gray-600"
                                }`}
                              >✕</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
        <section className="h-full flex flex-col overflow-hidden" style={{flex: "2"}}>
          <Island className={`flex h-full flex-col ${bgCard}`}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>{t("workspace.stagingCourse")}</span>
            </Header>
            <Content className="flex flex-1 flex-col p-0" style={{minHeight: 0}}>
              {/* Semester selector (always visible at top) */}
              {allStagingOptions.length > 0 && (
                <div className={`flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs shrink-0 ${textBody}`}>
                  <span className="whitespace-nowrap">{t("workspace.stagingSemester")}</span>
                  <Select
                    data={allStagingOptions.map((s) => ({
                      key: s,
                      label: locale === "zh" ? abbreviateSemester(s) : tSemester(s),
                    }))}
                    selected={{
                      key: stagingSemester,
                      label: locale === "zh" ? abbreviateSemester(stagingSemester) : tSemester(stagingSemester),
                    }}
                    onSelect={(opt) => opt && setStagingSemester(opt.key as string)}
                    label=""
                    filter
                  />
                </div>
              )}

              {/* Selected course list (scrollable middle) */}
              <div className="flex-1 overflow-auto px-3 py-1" style={{minHeight: "4.5rem"}}>
                {selectedCourses.size === 0 ? (
                  <div className={`flex h-full items-center justify-center text-xs ${textMuted}`}>
                    {t("workspace.stagingEmpty")}
                  </div>
                ) : (
                  [...selectedCourses].map((cid) => {
                    const c = courseMap.get(cid);
                    if (!c) return null;
                    // Check if this course has siblings in same choice sets
                    const csInfo = courseChoiceSets.get(cid);
                    return (
                      <div
                        key={cid}
                        className={`flex items-center justify-between gap-1 rounded px-1.5 py-1 text-xs ${hoverBg}`}
                      >
                        <span className={`flex-1 min-w-0 truncate ${textBody}`} title={tName(cid, c.name)}>
                          {tName(cid, c.name)}
                        </span>
                        <span className={`shrink-0 ${textMuted} mr-1`}>{c.credits}</span>
                        {csInfo && csInfo.length > 0 && (
                          <span className={`shrink-0 text-[9px] mr-1 ${isDark ? "text-yellow-400" : "text-yellow-600"}`}>
                            {csInfo.map((cs) => `${cs.maxSelect}选1`).join(" ")}
                          </span>
                        )}
                        <button
                          onClick={() => toggleSelected(cid)}
                          className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border-none text-[10px] transition-colors ${
                            isDark
                              ? "bg-red-500/15 text-red-400 hover:bg-red-500/30"
                              : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                          }`}
                          title={t("workspace.stagingRemove")}
                        >✕</button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Summary + Save button */}
              {selectedCourses.size > 0 && (
                <div className={`flex flex-col border-t shrink-0 ${borderCls}`}>
                  {stagingSemester && (() => {
                    const limit = getCreditLimit(stagingSemester);
                    const total = calcSemesterCredits(stagingSemester, [...selectedCourses]);
                    const customList = customCourses[stagingSemester] ?? [];
                    const customCount = customList.length;
                    const customCreditsCount = customList.reduce((s, c) => s + c.credits, 0);
                    return limit ? (
                      <div className={`flex flex-col px-3 pt-1.5 pb-0.5 text-[10px] ${textMuted}`}>
                        <span>{total}/{limit.max} 学分{limit.min > 0 && ` 每学期至少6学分（军训/暑期除外）`}</span>
                        {customCount > 0 && (
                          <span>已添加{customCount}门自定义课程，占{customCreditsCount}学分</span>
                        )}
                      </div>
                    ) : null;
                  })()}
                  <div className={`flex items-center justify-between px-3 py-2 text-xs`}>
                    <span className={textMuted}>
                    {locale === "zh"
                      ? `共${selectedCourses.size + ((customCourses[stagingSemester] ?? []).length)}门，${calcSemesterCredits(stagingSemester, [...selectedCourses])}学分`
                      : `${selectedCourses.size} courses, ${calcSemesterCredits(stagingSemester, [...selectedCourses])} cr.`}
                  </span>
                  <Button
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
                      className="w-16 rounded border px-1.5 py-0.5 text-xs outline-none"
                      style={
                        isDark
                          ? {background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.8)"}
                          : {background: "#f9fafb", borderColor: "#e5e7eb", color: "#374151"}
                      }
                      placeholder={t("workspace.customCourseCredits")}
                      value={customCredits}
                      onChange={(e) => setCustomCredits(e.target.value)}
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
                  {/* 课程属性下拉框: 用 Ring UI Select 实现，暗色模式自适应 */}
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] shrink-0 ${textMuted}`}>{locale === "zh" ? "课程属性" : "Property"}</span>
                    <div>
                      <Select
                        data={[
                          {key: "无", label: locale === "zh" ? "无" : "None"},
                          {key: "通识-艺术", label: "通识-艺术"},
                          {key: "通识-社科", label: "通识-社科"},
                          {key: "通识-人文", label: "通识-人文"},
                          {key: "通识-科学", label: "通识-科学"},
                          {key: "SRT", label: "SRT"},
                          {key: "重修", label: locale === "zh" ? "重修" : "Retake"},
                          {key: "其他", label: locale === "zh" ? "其他" : "Other"},
                        ]}
                        selected={{key: customProperty, label: customProperty === "无" ? (locale === "zh" ? "无" : "None") : customProperty}}
                        onSelect={(opt) => { if (opt) setCustomProperty(opt.key as string); }}
                        label=""
                        style={{width: "100%", minWidth: "100%", boxSizing: "border-box"}}
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
                    ? (locale === "zh" ? "课程重复选择" : "Course Duplicate")
                    : choiceConflict.courseId === choiceConflict.conflictId
                    ? (locale === "zh" ? "提示" : "Notice")
                    : (locale === "zh" ? "选课冲突" : "Course Conflict")}
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
                    setClearConfirm(false);
                  }}>
                    {locale === "zh" ? "确定清除" : "Clear All"}
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                              <span className={`font-mono ${textDark}`}>{c.course_id.startsWith("NEW") ? "新开课" : c.course_id}</span>
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
                                    {cs.setName}（{cs.maxSelect}选1）：{cs.siblings.map((s) => tName(s.courseId, s.name)).join("、")}
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

          {/* ===== Import/Export modal ===== */}
          {showImportModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background: "rgba(0,0,0,0.4)"}}
                 onClick={() => { setShowImportModal(false); setImportPreview(null); }}>
              <div className={`w-80 rounded-xl shadow-2xl border p-4 ${isDark ? "bg-[#1e1e2a] border-white/10" : "bg-white border-gray-200"}`}
                   onClick={(e) => e.stopPropagation()}>
                <div className={`text-sm font-semibold mb-3 ${textDark}`}>{t("workspace.importTitle")}</div>
                <div className={`text-[10px] mb-2 ${textBody}`}>
                  {locale === "zh" ? "请选择本地 JSON 文件导入历史记录。" : "Select a local JSON file to import history records."}
                </div>
                <div className="flex gap-2 mb-3">
                  <Button onClick={() => fileInputRef.current?.click()}>{t("workspace.importBtn")}</Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImport(f);
                    }}
                  />
                </div>
                <div className={`text-[10px] mb-2 font-medium ${textDark}`}>
                  {locale === "zh" ? "云端导入" : "Cloud Import"}
                </div>
                <div className={`text-[10px] mb-2 ${textBody}`}>
                  {locale === "zh" ? "云端导入功能正在开发中，敬请期待。" : "Cloud import is under development. Coming soon."}
                </div>
                <Button disabled>{locale === "zh" ? "云端导入（未启用）" : "Cloud Import (disabled)"}</Button>
                {importPreview && (
                  <div className={`mt-2 rounded px-2 py-1.5 text-[10px] ${isDark ? "bg-white/5 text-white/70" : "bg-gray-50 text-gray-600"}`}>
                    <pre className="whitespace-pre-wrap">{importPreview}</pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========== RIGHT: Catalog ========== */}
        <section className="h-full flex flex-col overflow-hidden" style={{flex: leftExpanded ? "3" : "5"}}>
          <Island className={`flex h-full flex-col ${bgCard}`}>
            <Header border>
              <span className={`text-sm font-semibold ${textDark}`}>{t("workspace.catalog")}</span>
            </Header>

            {/* ===== Filters ===== */}
            <Content
              className="overflow-visible border-b shrink-0"
              style={{position: "relative", zIndex: 2}}
            >
              {/* Search row: 2-column grid aligning with filters below */}
              <div className="grid grid-cols-2 gap-x-4 px-3 pt-2 pb-1">
                {/* Col 1: Search input */}
                <div className="flex flex-col gap-0.5">
                  <Input
                    label={t("workspace.searchPlaceholder")}
                    value={searchText}
                    onChange={(e) => setSearchText(e.currentTarget.value)}
                    onClear={() => setSearchText("")}
                    theme={inputTheme}
                  />
                </div>
                {/* Col 2: Recommend toggle + ? + hint */}
                <div className={`flex flex-col gap-0.5 min-w-0 justify-end`}>
                  <div className="flex items-center gap-1">
                    <button
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
                      lines.push(`${idx}.${locale === "zh" ? `须选择${peName}` : `Need ${peName}`}`);
                    }
                    const stagingCids = stagingSemester ? (semesterMap.get(stagingSemester) ?? []).map((c) => c.course_id) : [];
                    const shuyuanInStaging = stagingCids.filter((cid) => {
                      const infos = courseGroupInfo.get(cid) ?? [];
                      return infos.some((i) => i.groupCode === "SHUYUAN_GE");
                    });
                    if (shuyuanInStaging.length > 0 && !shuyuanInStaging.some((id) => selectedCourses.has(id))) {
                      const syName = shuyuanInStaging.map((id) => tName(id, courseMap.get(id)?.name ?? "")).join("/");
                      idx++;
                      lines.push(`${idx}.${locale === "zh" ? `须选择${syName}` : `Need ${syName}`}`);
                    }
                    const shijianInStaging = stagingCids.filter((cid) => {
                      const infos = courseGroupInfo.get(cid) ?? [];
                      return infos.some((i) => i.groupCode === "SHIJIAN");
                    });
                    if (shijianInStaging.length > 0 && !shijianInStaging.some((id) => selectedCourses.has(id))) {
                      const sjName = shijianInStaging.map((id) => tName(id, courseMap.get(id)?.name ?? "")).join("/");
                      idx++;
                      lines.push(`${idx}.${locale === "zh" ? `须选择${sjName}` : `Need ${sjName}`}`);
                    }

                    // ② Foundation direction hints
                    const foundationLabels: Record<string, string> = {
                      COMP_BASIS: locale === "zh" ? "II类" : "Type II",
                      OR_STAT: locale === "zh" ? "III类" : "Type III",
                      MECH_BASIS: locale === "zh" ? "I类" : "Type I",
                    };
                    const activeDirs = [...foundationActive.keys()].map((k) => foundationLabels[k] ?? k);
                    if (activeDirs.length > 0) {
                      idx++;
                      const dirStr = activeDirs.join(locale === "zh" ? "、" : ", ");
                      lines.push(`${idx}.${locale === "zh" ? `推荐${dirStr}` : `Recommended: ${dirStr}`}`);
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
                        const modStr = shownMods.map(([id]) => `模块${id}`).join("、");
                        lines.push(`${idx}.${locale === "zh" ? `推荐${modStr}` : `Recommended: ${modStr}`}`);
                      }
                    }

                    // ④ English course hint: only English3/4 when in top recommended
                    const hasEng3 = stagingCids.includes("14201022") && ENGLISH3_WEIGHT[stagingSemester ?? ""] > 0;
                    const hasEng4 = stagingCids.includes("14201032") && ENGLISH4_WEIGHT[stagingSemester ?? ""] > 0;
                    if (hasEng3 || hasEng4) {
                      const engParts: string[] = [];
                      if (hasEng3) engParts.push(locale === "zh" ? "英语(3)" : "English(3)");
                      if (hasEng4) engParts.push(locale === "zh" ? "英语(4)" : "English(4)");
                      idx++;
                      lines.push(`${idx}.${locale === "zh" ? `推荐${engParts.join("、")}` : `Rec: ${engParts.join(", ")}`}`);
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
              </div>

              <div className={`px-3 pt-1 pb-1 text-xs font-medium ${textMuted}`}>
                {t("workspace.filterHeader")}
              </div>

              {/* 2-column grid for filter dropdowns */}
              <div className="grid grid-cols-2 gap-x-4 px-3 pb-1">
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
            </Content>

            {/* ===== Course list ===== */}
            <div className="flex flex-col flex-1 min-h-0">
              {/* Frozen header (static row outside scroll area) */}
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

              {/* Scrollable rows */}
              <div className="flex-1 overflow-auto">
                {filteredCourses.map((c) => {
                  const categories = getCourseCategories(c.course_id);
                  const sems = courseSemesterMap.get(c.course_id) ?? [];
                  const semDisplay =
                    sems.length > 0
                      ? sems.map((s) => (locale === "zh" ? abbreviateSemester(s) : tSemester(s))).join(", ")
                      : "—";
                  const isSelected = selectedCourses.has(c.course_id);
                  // Check if course is in history (already taken)
                  const isInHistory = Object.values(savedHistory).some((ids) => ids.includes(c.course_id));

                  return (
                    <div
                      key={c.course_id}
                      className={`flex items-start gap-2 px-3 py-1.5 text-xs border-b ${borderLight} ${hoverBg} ${textBody}`}
                    >
                      {/* +/- button: green✓ for staged, yellow✓ for history, + for none */}
                      {isInHistory ? (
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
                              setName: locale === "zh" ? "历史已选课程" : "Already Taken",
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
                      {/* Course ID */}
                      <span className={`w-20 shrink-0 truncate font-mono pt-0.5 ${textMuted}`} title={c.course_id}>
                        {c.course_id.startsWith("NEW") ? "新开课" : c.course_id}
                      </span>
                      {/* Course name — click for detail */}
                      <span
                        className="flex-1 min-w-0 truncate whitespace-nowrap pt-0.5 cursor-pointer"
                        title={tName(c.course_id, c.name)}
                        onClick={() => setDetailCourse(c)}
                      >
                        {tName(c.course_id, c.name)}
                      </span>
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
                          <span className={`font-mono ${textMuted}`}>{dc.course_id.startsWith("NEW") ? "新开课" : dc.course_id}</span>
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
    </div>
  );
};